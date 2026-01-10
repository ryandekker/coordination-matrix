import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../../db/connection.js';
import { Workflow } from './types.js';

export const aiPromptRoutes = Router();

// GET /api/workflows/ai-prompt-context - Generate dynamic prompt context for AI tools
aiPromptRoutes.get('/ai-prompt-context', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const agents = await db
      .collection('users')
      .find({ isAgent: true, isActive: true })
      .project({ _id: 1, displayName: 1, agentPrompt: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const users = await db
      .collection('users')
      .find({ isAgent: { $ne: true }, isActive: true })
      .project({ _id: 1, displayName: 1, email: 1, role: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const workflows = await db
      .collection<Workflow>('workflows')
      .find({ isActive: true })
      .project({ _id: 1, name: 1, description: 1, steps: 1 })
      .sort({ name: 1 })
      .toArray();

    const workflowSummaries = workflows.map((w) => ({
      id: w._id.toString(),
      name: w.name,
      description: w.description,
      stepCount: w.steps?.length || 0,
      stepTypes: [...new Set(w.steps?.map((s: { stepType: string }) => s.stepType) || [])],
    }));

    const promptContext = {
      agents: agents.map((a) => ({
        id: a._id.toString(),
        name: a.displayName,
        description: a.agentPrompt?.substring(0, 200) || 'No description',
      })),
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.displayName,
        email: u.email,
        role: u.role,
      })),
      existingWorkflows: workflowSummaries,
      stepTypes: getStepTypeReference(),
      templateVariables: getTemplateVariableReference(),
      mermaidSyntax: getMermaidSyntaxReference(),
      rules: getWorkflowRules(),
    };

    res.json({ data: promptContext });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/ai-prompt-multi - Generate AI prompt for multi-workflow editing
aiPromptRoutes.get('/ai-prompt-multi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeContext = 'true' } = req.query;

    const agents = await db
      .collection('users')
      .find({ isAgent: true, isActive: true })
      .project({ _id: 1, displayName: 1, agentPrompt: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const users = await db
      .collection('users')
      .find({ isAgent: { $ne: true }, isActive: true })
      .project({ _id: 1, displayName: 1, email: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const workflows = await db
      .collection<Workflow>('workflows')
      .find({ isActive: true })
      .project({ _id: 1, name: 1, description: 1 })
      .sort({ name: 1 })
      .toArray();

    const tagResults = await db.collection('tasks').distinct('tags');
    const tags = (tagResults as string[]).filter(t => t && typeof t === 'string').sort();

    const prompt = buildMultiWorkflowAIPrompt(includeContext === 'true', {
      agents: agents as ContextData['agents'],
      users: users as ContextData['users'],
      workflows: workflows as ContextData['workflows'],
      tags,
    });

    res.json({
      data: {
        prompt,
        format: 'multi-mermaid',
        includeContext: includeContext === 'true'
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/ai-prompt - Generate a complete AI prompt for workflow generation
aiPromptRoutes.get('/ai-prompt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { format = 'mermaid', includeContext = 'true' } = req.query;

    const agents = await db
      .collection('users')
      .find({ isAgent: true, isActive: true })
      .project({ _id: 1, displayName: 1, agentPrompt: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const users = await db
      .collection('users')
      .find({ isAgent: { $ne: true }, isActive: true })
      .project({ _id: 1, displayName: 1, email: 1 })
      .sort({ displayName: 1 })
      .toArray();

    const workflows = await db
      .collection<Workflow>('workflows')
      .find({ isActive: true })
      .project({ _id: 1, name: 1, description: 1 })
      .sort({ name: 1 })
      .toArray();

    const tagResults = await db.collection('tasks').distinct('tags');
    const tags = (tagResults as string[]).filter(t => t && typeof t === 'string').sort();

    const prompt = buildFullAIPrompt(includeContext === 'true', {
      agents: agents as ContextData['agents'],
      users: users as ContextData['users'],
      workflows: workflows as ContextData['workflows'],
      tags,
    });

    res.json({
      data: {
        prompt,
        format,
        includeContext: includeContext === 'true'
      }
    });
  } catch (error) {
    next(error);
  }
});

// Helper functions to generate reference content
function getStepTypeReference() {
  return {
    agent: {
      description: 'AI-powered automated task executed by the daemon',
      mermaidShape: '["text"]',
      mermaidClass: 'agent',
      color: '#3B82F6',
      commonFields: ['additionalInstructions', 'defaultAssigneeId'],
      example: { id: 'analyze', name: 'Analyze Document', stepType: 'agent', additionalInstructions: 'Extract key themes.' }
    },
    manual: {
      description: 'Human-in-the-loop task that waits for user action',
      mermaidShape: '("text")',
      mermaidClass: 'manual',
      color: '#8B5CF6',
      commonFields: ['additionalInstructions', 'defaultAssigneeId'],
      example: { id: 'approve', name: 'Manager Approval', stepType: 'manual' }
    },
    external: {
      description: 'Calls external API and waits for callback response',
      mermaidShape: '{{"text"}}',
      mermaidClass: 'external',
      color: '#F97316',
      commonFields: ['externalConfig'],
      example: { id: 'callApi', name: 'External Validation', stepType: 'external', externalConfig: { endpoint: 'https://api.example.com/validate', method: 'POST' } }
    },
    webhook: {
      description: 'Outbound HTTP call (fire-and-forget or await response)',
      mermaidShape: '{{"text"}}',
      mermaidClass: 'external',
      color: '#F97316',
      commonFields: ['webhookConfig'],
      example: { id: 'notify', name: 'Send Notification', stepType: 'webhook', webhookConfig: { url: 'https://hooks.slack.com/xxx', method: 'POST' } }
    },
    decision: {
      description: 'Routes workflow based on conditions',
      mermaidShape: '{"text"}',
      mermaidClass: 'decision',
      color: '#F59E0B',
      commonFields: ['connections', 'defaultConnection'],
      example: { id: 'checkStatus', name: 'Is Valid?', stepType: 'decision', connections: [{ targetStepId: 'pass', condition: 'status:valid', label: 'Yes' }], defaultConnection: 'fail' }
    },
    foreach: {
      description: 'Fan-out: Creates parallel child tasks for each item in an array',
      mermaidShape: '[["Each: text"]]',
      mermaidClass: 'foreach',
      color: '#10B981',
      commonFields: ['itemsPath', 'itemVariable', 'maxItems', 'connections'],
      example: { id: 'processItems', name: 'Process Each', stepType: 'foreach', itemsPath: 'items', itemVariable: 'item', connections: [{ targetStepId: 'handleItem' }] }
    },
    join: {
      description: 'Fan-in: Waits for all parallel tasks from ForEach to complete',
      mermaidShape: '[["Join: text"]]',
      mermaidClass: 'join',
      color: '#6366F1',
      commonFields: ['awaitStepId', 'minSuccessPercent'],
      example: { id: 'aggregate', name: 'Aggregate Results', stepType: 'join', awaitStepId: 'processItems', minSuccessPercent: 90 }
    },
    flow: {
      description: 'Delegates execution to a nested/child workflow',
      mermaidShape: '[["Run: text"]]',
      mermaidClass: 'flow',
      color: '#EC4899',
      commonFields: ['flowId', 'inputMapping'],
      example: { id: 'runSub', name: 'Run Subprocess', stepType: 'flow', flowId: 'workflow_id_here' }
    }
  };
}

function getTemplateVariableReference() {
  return {
    inputPayload: {
      syntax: '{{input.path.to.value}}',
      description: 'Access values from the input payload passed to the workflow or step',
      examples: ['{{input.userId}}', '{{input.document.title}}', '{{input.items.0.name}}']
    },
    loopVariables: {
      syntax: '{{item}} or {{_item}}, {{_index}}, {{_total}}',
      description: 'Available inside ForEach child tasks',
      examples: ['{{item.email}}', '{{recipient.name}}', '{{_index}} of {{_total}}']
    },
    callbackUrls: {
      syntax: '{{callbackUrl}}, {{systemWebhookUrl}}, {{callbackSecret}}',
      description: 'System-generated URLs for external service callbacks',
      examples: ['{{callbackUrl}}', '{{callbackSecret}}']
    },
    foreachStreaming: {
      syntax: '{{foreachWebhookUrl}}',
      description: 'URL for external services to stream items to a ForEach step',
      examples: ['{{foreachWebhookUrl}}']
    }
  };
}

function getMermaidSyntaxReference() {
  return {
    header: 'flowchart TD',
    shapeMapping: {
      agent: { shape: '["label"]', example: 'step1["AI Review"]' },
      manual: { shape: '("label")', example: 'step2("Human Review")' },
      external: { shape: '{{"label"}}', example: 'step3{{"API Call"}}' },
      decision: { shape: '{"label"}', example: 'step4{"Is Valid?"}' },
      foreach: { shape: '[["Each: label"]]', example: 'step5[["Each: Process"]]' },
      join: { shape: '[["Join: label"]]', example: 'step6[["Join: Aggregate"]]' },
      flow: { shape: '[["Run: label"]]', example: 'step7[["Run: Subprocess"]]' }
    },
    connections: {
      simple: 'stepA --> stepB',
      labeled: 'stepA -->|"Label"| stepB'
    },
    requiredClasses: [
      'classDef agent fill:#3B82F6,color:#fff',
      'classDef manual fill:#8B5CF6,color:#fff',
      'classDef external fill:#F97316,color:#fff',
      'classDef decision fill:#F59E0B,color:#fff',
      'classDef foreach fill:#10B981,color:#fff',
      'classDef join fill:#6366F1,color:#fff',
      'classDef flow fill:#EC4899,color:#fff'
    ],
    metadataComment: '%% @step(nodeId): {"key": "value"}'
  };
}

function getWorkflowRules() {
  return [
    'Every step must have: id, name, stepType',
    'Always quote Mermaid labels with double quotes',
    'Never use inline style statements in Mermaid',
    'Decision steps require connections array with conditions',
    'ForEach steps need itemsPath or expect external callback',
    'Join steps should specify awaitStepId to match a ForEach',
    'Node shapes in Mermaid carry semantic meaning - don\'t change them'
  ];
}

interface ContextData {
  agents: Array<{ _id: unknown; displayName: string; agentPrompt?: string }>;
  users: Array<{ _id: unknown; displayName: string; email?: string }>;
  workflows: Array<{ _id: unknown; name: string; description: string }>;
  tags: string[];
}

function buildFullAIPrompt(includeContext: boolean, context: ContextData): string {
  let prompt = `# Workflow Generation Guide for Coordination Matrix

You are generating a workflow definition for the Coordination Matrix system. This guide provides complete documentation for all step types, configuration options, and examples.

## Workflow Structure

A workflow consists of:
- **name**: Display name for the workflow
- **description**: What this workflow does
- **steps**: Array of step objects defining the workflow logic
- **rootTaskTitleTemplate** (optional): Dynamic title template using \`{{input.field}}\` syntax

---

## Step Types Reference

### 1. Agent Step (\`agent\`)
AI-powered automated task executed by the automation daemon.

**Required Fields:**
- \`id\`: Unique identifier (e.g., "analyze", "review")
- \`name\`: Display name
- \`stepType\`: "agent"

**Optional Fields:**
- \`additionalInstructions\`: Extra context/prompt for the AI agent
- \`defaultAssigneeId\`: ID of the agent to execute this task
- \`description\`: Step description
- \`connections\`: Explicit connections to next steps

---

### 2. Manual Step (\`manual\`)
Human-in-the-loop task that waits for a user to complete it via the UI.

---

### 3. External Step (\`external\`)
Calls an external API and **waits for a callback response**.

**Template Variables Available:**
- \`{{callbackUrl}}\` - System-generated callback URL
- \`{{callbackSecret}}\` - Secret token for callback authentication
- \`{{input.field}}\` - Values from input payload

---

### 4. Webhook Step (\`webhook\`)
Outbound HTTP call that does NOT wait for a callback.

---

### 5. Decision Step (\`decision\`)
Routes workflow based on conditions.

---

### 6. ForEach Step (\`foreach\`)
Fan-out: Creates parallel child tasks for each item in an array.

---

### 7. Join Step (\`join\`)
Fan-in: Waits for all parallel tasks from ForEach to complete.

---

### 8. Flow Step (\`flow\`)
Delegates execution to a nested/child workflow.

---

## Mermaid Format

When using Mermaid format, follow this structure:

\`\`\`mermaid
flowchart TD
    step1["Step Name"]
    step2("Manual Step")
    step3{{"External API"}}
    step4{"Decision?"}
    step5[["Each: Process"]]
    step6[["Join: Aggregate"]]

    step1 --> step2
    step2 --> step3
    step3 --> step4
    step4 -->|"Yes"| step5
    step4 -->|"No"| step6
    step5 --> step6

    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff

    class step1 agent
    class step2 manual
    class step3 external
    class step4 decision
    class step5 foreach
    class step6 join

    %% @step(step1): {"additionalInstructions":"Your instructions here"}
    %% @step(step2): {"additionalInstructions":"Instructions for the human reviewer"}
\`\`\`

**Important Mermaid Rules:**
1. Always quote labels with double quotes: \`["Label"]\` not \`[Label]\`
2. Never use inline \`style\` statements
3. Include ALL classDef declarations
4. Use \`%% @step(id): {json}\` comments for step configuration
5. Decision branch labels must be quoted: \`-->|"Label"|\``;

  if (includeContext) {
    prompt += `\n\n---\n\n## Available Context\n`;

    if (context.agents.length > 0) {
      prompt += `\n### Available Agents\n`;
      for (const agent of context.agents) {
        prompt += `- **${agent.displayName}** (ID: ${agent._id})\n`;
      }
    }

    if (context.users.length > 0) {
      prompt += `\n### Available Users (for manual tasks)\n`;
      for (const user of context.users) {
        prompt += `- **${user.displayName}** (ID: ${user._id})\n`;
      }
    }

    if (context.workflows.length > 0) {
      prompt += `\n### Existing Workflows (for flow steps)\n`;
      for (const workflow of context.workflows) {
        prompt += `- **${workflow.name}** (ID: ${workflow._id}): ${workflow.description || 'No description'}\n`;
      }
    }

    if (context.tags.length > 0) {
      prompt += `\n### Available Tags\n`;
      prompt += context.tags.map(t => `\`${t}\``).join(', ');
    }
  }

  return prompt;
}

function buildMultiWorkflowAIPrompt(includeContext: boolean, context: ContextData): string {
  let prompt = `# Multi-Workflow Editor Guide for Coordination Matrix

You are editing multiple workflows in a single Mermaid document. Each workflow is defined as a **subgraph** with metadata comments above it.

## Multi-Workflow Format

The multi-workflow format uses subgraphs to contain each workflow:

\`\`\`mermaid
flowchart TD

    %% @workflow: "First Workflow Name"
    %% @id: existing_workflow_id_or_(new)
    %% @description: What this workflow does
    %% @isActive: true
    %% @rootTaskTitleTemplate: {{input.title}}
    subgraph workflow1["First Workflow Name"]
        direction TB
        step1["AI Task"]
        step2("Manual Review")
        step1 --> step2

        %% @step(step1): {"additionalInstructions":"Instructions here"}
    end

    %% @workflow: "Second Workflow Name"
    %% @id: (new)
    %% @description: Description of second workflow
    %% @isActive: true
    subgraph workflow2["Second Workflow Name"]
        direction TB
        stepA["Process"]
        stepB{"Decision?"}
        stepA --> stepB
    end

    %% Styling (at end, applies to all workflows)
    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff
    classDef flow fill:#EC4899,color:#fff
\`\`\`

## Required Metadata Comments

Each workflow subgraph MUST have these metadata comments directly above it:

| Comment | Required | Description |
|---------|----------|-------------|
| \`%% @workflow: "Name"\` | Yes | Workflow display name (quoted) |
| \`%% @id: id_or_(new)\` | Yes | Existing workflow ID to update, or \`(new)\` to create |
| \`%% @description: text\` | No | Workflow description |
| \`%% @isActive: true/false\` | No | Whether workflow is active (default: true) |
| \`%% @rootTaskTitleTemplate: template\` | No | Dynamic title using \`{{input.field}}\` |

## Step Types and Shapes

| Step Type | Mermaid Shape | Example |
|-----------|---------------|---------|
| agent | \`["label"]\` | \`step1["AI Analysis"]\` |
| manual | \`("label")\` | \`step2("Human Review")\` |
| external | \`{{"label"}}\` | \`step3{{"API Call"}}\` |
| decision | \`{"label"}\` | \`step4{"Is Valid?"}\` |
| foreach | \`[["Each: label"]]\` | \`step5[["Each: Process"]]\` |
| join | \`[["Join: label"]]\` | \`step6[["Join: Aggregate"]]\` |
| flow | \`[["Run: label"]]\` | \`step7[["Run: Subprocess"]]\` |

## Step Configuration

Use \`%% @step(nodeId): {json}\` comments inside the subgraph for step-specific config:

\`\`\`mermaid
subgraph wf1["My Workflow"]
    direction TB
    analyze["Analyze Data"]
    review("Manager Approval")
    analyze --> review

    %% @step(analyze): {"additionalInstructions":"Extract key metrics from the data"}
    %% @step(review): {"defaultAssigneeId":"user_id_here"}
end
\`\`\`

## Important Rules

1. **Metadata placement**: \`@workflow\`, \`@id\`, \`@description\`, \`@isActive\`, \`@rootTaskTitleTemplate\` go BEFORE the subgraph
2. **Step config placement**: \`@step(id)\` comments go INSIDE the subgraph
3. **Always quote labels**: Use \`["Label"]\` not \`[Label]\`
4. **Use direction TB**: Each subgraph should have \`direction TB\` as first line
5. **Styling at end**: Put all classDef and class statements after all subgraphs
6. **Never use inline style**: Don't use \`style nodeId fill:#color\`
7. **Quote branch labels**: Use \`-->|"Yes"|\` not \`-->|Yes|\`
8. **Unique node IDs**: Within each subgraph, node IDs must be unique

## Creating vs Updating Workflows

- To **update** an existing workflow: Use the actual workflow ID in \`@id:\`
- To **create** a new workflow: Use \`@id: (new)\`

## Template Variables

Available in step configurations and titles:
- \`{{input.field}}\` - Values from input payload
- \`{{callbackUrl}}\`, \`{{callbackSecret}}\` - For external steps
- \`{{item}}\`, \`{{_index}}\`, \`{{_total}}\` - Inside ForEach child tasks`;

  if (includeContext) {
    prompt += `\n\n---\n\n## Available Context\n`;

    if (context.agents.length > 0) {
      prompt += `\n### Available Agents (for defaultAssigneeId)\n`;
      for (const agent of context.agents) {
        prompt += `- **${agent.displayName}** (ID: \`${agent._id}\`)\n`;
      }
    }

    if (context.users.length > 0) {
      prompt += `\n### Available Users (for manual tasks)\n`;
      for (const user of context.users) {
        prompt += `- **${user.displayName}** (ID: \`${user._id}\`)\n`;
      }
    }

    if (context.workflows.length > 0) {
      prompt += `\n### Existing Workflows\n`;
      prompt += `Use these IDs with \`@id:\` to update, or reference in flow steps:\n`;
      for (const workflow of context.workflows) {
        prompt += `- **${workflow.name}** (ID: \`${workflow._id}\`): ${workflow.description || 'No description'}\n`;
      }
    }

    if (context.tags.length > 0) {
      prompt += `\n### Available Tags\n`;
      prompt += context.tags.map(t => `\`${t}\``).join(', ');
    }
  }

  return prompt;
}
