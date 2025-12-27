import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';

export const workflowsRouter = Router();

// Step types for workflow routing - maps 1:1 to TaskType
// - trigger: Entry point / workflow start
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - manual: Human-in-the-loop task
// - external: External service call - waits for callback
// - webhook: Outbound HTTP call (fire-and-forget or await response)
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection (spawns subtasks)
// - join: Fan-in aggregation point (awaits boundary conditions)
// - flow: Delegate to another workflow (nested)
type WorkflowStepType = 'trigger' | 'agent' | 'manual' | 'external' | 'webhook' | 'decision' | 'foreach' | 'join' | 'flow';

// Connection between steps (for non-linear flows)
interface StepConnection {
  targetStepId: string;
  condition?: string | null;  // JSONPath condition or null for default/unconditional
  label?: string;             // Display label for the connection
}

// External service configuration (waits for callback)
interface ExternalConfig {
  endpoint?: string;          // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payloadTemplate?: string;   // JSON template with {{variable}} interpolation
  responseMapping?: Record<string, string>;  // Map response fields to output
}

// Webhook step configuration (outbound HTTP call, does not wait for callback)
interface WebhookConfig {
  url?: string;               // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;      // JSON template with {{variable}} interpolation
  maxRetries?: number;        // Max retry attempts (default: 3)
  timeoutMs?: number;         // Request timeout (default: 30000)
  successStatusCodes?: number[];  // HTTP status codes considered success
}

// Join boundary conditions
interface JoinBoundary {
  minCount?: number;          // Minimum tasks that must complete
  minPercent?: number;        // Minimum percentage (default: 100)
  maxWaitMs?: number;         // Maximum time to wait
  failOnTimeout?: boolean;    // Fail or continue with partial results
}

interface WorkflowStep {
  id: string;
  name: string;
  description?: string;

  // Step classification
  stepType: WorkflowStepType;

  // Non-linear flow: explicit connections to next steps
  // If empty/undefined for non-decision steps, assumes linear flow to next step in array
  connections?: StepConnection[];

  // Agent/manual step configuration
  additionalInstructions?: string;  // Extra context for the agent (not required)
  defaultAssigneeId?: string;       // Agent or user to assign to

  // External step configuration (waits for callback)
  externalConfig?: ExternalConfig;

  // Webhook step configuration (outbound HTTP call)
  webhookConfig?: WebhookConfig;

  // Decision step configuration
  // Uses connections[] with conditions for routing
  // Each connection.condition is evaluated against previous step output
  defaultConnection?: string;       // targetStepId for when no conditions match

  // ForEach configuration - spawns subtasks
  itemsPath?: string;               // JSONPath to array in previous output
  itemVariable?: string;            // Template variable name for each item
  maxItems?: number;                // Safety limit (default: 100)

  // Join configuration - explicit reference to which step's tasks to await
  awaitStepId?: string;             // Step ID whose tasks we're waiting for (can be earlier in flow)
  joinBoundary?: JoinBoundary;      // Boundary conditions for when the join fires
  minSuccessPercent?: number;       // Legacy: percentage of tasks that must succeed
  expectedCountPath?: string;       // JSONPath to get expected count from previous step

  // Flow configuration (nested workflow)
  flowId?: string;
  inputMapping?: Record<string, string>;

  // Input aggregation
  inputSource?: string;             // Step ID to get input from (default: previous step)
  inputPath?: string;               // JSONPath to extract input from source step

  // Legacy fields (kept for compatibility)
  execution?: 'automated' | 'manual';
  type?: 'automated' | 'manual';
  prompt?: string;                  // Mapped to additionalInstructions
  hitlPhase?: string;
  config?: Record<string, unknown>;
  branches?: { condition: string | null; targetStepId: string }[];  // Legacy, use connections
}

interface Workflow {
  _id: ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  steps: WorkflowStep[];
  mermaidDiagram?: string;
  rootTaskTitleTemplate?: string;
  createdAt: Date;
  updatedAt: Date;
  createdById?: ObjectId | null;
}

// GET /api/workflows - List all workflows
workflowsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive } = req.query;

    // By default, only show active workflows unless explicitly requested
    const filter: Record<string, unknown> = {};
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    const workflows = await db
      .collection<Workflow>('workflows')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    res.json({ data: workflows });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/stats - Get workflow run statistics
workflowsRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();

    // Check if workflowRuns collection exists to avoid errors on empty databases
    const collections = await db.listCollections({ name: 'workflowRuns' }).toArray();
    if (collections.length === 0) {
      // Collection doesn't exist yet - return empty stats
      res.json({ data: {} });
      return;
    }

    // Aggregate run statistics per workflow
    const stats = await db.collection('workflowRuns').aggregate([
      {
        $group: {
          _id: '$workflowId',
          runCount: { $sum: 1 },
          lastRunAt: { $max: '$createdAt' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    // Convert to a map keyed by workflow ID
    const statsMap: Record<string, {
      runCount: number;
      lastRunAt: Date | null;
      completedCount: number;
      failedCount: number;
    }> = {};

    for (const stat of stats) {
      if (stat._id) {
        statsMap[stat._id.toString()] = {
          runCount: stat.runCount,
          lastRunAt: stat.lastRunAt,
          completedCount: stat.completedCount,
          failedCount: stat.failedCount
        };
      }
    }

    res.json({ data: statsMap });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/ai-prompt-context - Generate dynamic prompt context for AI tools
// NOTE: This must come BEFORE /:id route to avoid being matched as an ID
workflowsRouter.get('/ai-prompt-context', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    // Fetch available agents
    const agents = await db
      .collection('users')
      .find({ isAgent: true, isActive: true })
      .project({ _id: 1, displayName: 1, agentPrompt: 1 })
      .sort({ displayName: 1 })
      .toArray();

    // Fetch available users (non-agents) for manual task assignment
    const users = await db
      .collection('users')
      .find({ isAgent: { $ne: true }, isActive: true })
      .project({ _id: 1, displayName: 1, email: 1, role: 1 })
      .sort({ displayName: 1 })
      .toArray();

    // Fetch existing workflows (for nesting via flow step)
    const workflows = await db
      .collection<Workflow>('workflows')
      .find({ isActive: true })
      .project({ _id: 1, name: 1, description: 1, steps: 1 })
      .sort({ name: 1 })
      .toArray();

    // Format workflows for context
    const workflowSummaries = workflows.map((w) => ({
      id: w._id.toString(),
      name: w.name,
      description: w.description,
      stepCount: w.steps?.length || 0,
      stepTypes: [...new Set(w.steps?.map((s: { stepType: string }) => s.stepType) || [])],
    }));

    // Build the prompt context
    const promptContext = {
      // Available assignees
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

      // Available workflows for nesting
      existingWorkflows: workflowSummaries,

      // Step type reference
      stepTypes: {
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
      },

      // Template variable reference
      templateVariables: {
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
      },

      // Mermaid syntax quick reference
      mermaidSyntax: {
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
      },

      // Important rules
      rules: [
        'Every step must have: id, name, stepType',
        'Always quote Mermaid labels with double quotes',
        'Never use inline style statements in Mermaid',
        'Decision steps require connections array with conditions',
        'ForEach steps need itemsPath or expect external callback',
        'Join steps should specify awaitStepId to match a ForEach',
        'Node shapes in Mermaid carry semantic meaning - don\'t change them'
      ]
    };

    res.json({ data: promptContext });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/ai-prompt - Generate a complete AI prompt for workflow generation
// NOTE: This must come BEFORE /:id route to avoid being matched as an ID
workflowsRouter.get('/ai-prompt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { format = 'mermaid', includeContext = 'true' } = req.query;

    // Fetch context data
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

    // Fetch distinct tags from tasks
    const tagResults = await db.collection('tasks').distinct('tags');
    const tags = (tagResults as string[]).filter(t => t && typeof t === 'string').sort();

    // Build the comprehensive prompt
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

**JSON Example:**
\`\`\`json
{
  "id": "analyze-content",
  "name": "Analyze Content",
  "stepType": "agent",
  "additionalInstructions": "Review the submitted content for:\\n1. Grammar and spelling errors\\n2. Factual accuracy\\n3. Tone appropriateness\\n\\nProvide a structured report with findings.",
  "defaultAssigneeId": "content-reviewer"
}
\`\`\`

**Mermaid Shape:** Rectangle \`["text"]\`
\`\`\`mermaid
analyze["Analyze Content"]
class analyze agent
%% @step(analyze): {"additionalInstructions":"Review for grammar, accuracy, and tone.","defaultAssigneeId":"content-reviewer"}
\`\`\`

---

### 2. Manual Step (\`manual\`)
Human-in-the-loop task that waits for a user to complete it via the UI.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "manual"

**Optional Fields:**
- \`additionalInstructions\`: Instructions shown to the human user
- \`defaultAssigneeId\`: User ID to assign the task to
- \`description\`: Step description

**JSON Example:**
\`\`\`json
{
  "id": "manager-approval",
  "name": "Manager Approval",
  "stepType": "manual",
  "additionalInstructions": "Review the analysis results and either:\\n- Approve to proceed to publication\\n- Reject with feedback for revision\\n\\nCheck the attached documents before deciding.",
  "defaultAssigneeId": "user-id-here"
}
\`\`\`

**Mermaid Shape:** Stadium/Rounded \`("text")\`
\`\`\`mermaid
approve("Manager Approval")
class approve manual
%% @step(approve): {"additionalInstructions":"Review and approve or reject with feedback."}
\`\`\`

---

### 3. External Step (\`external\`)
Calls an external API and **waits for a callback response**. Use this when an external service needs time to process and will call back when done.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "external"

**Optional Fields (externalConfig object):**
- \`endpoint\`: URL to call (supports \`{{variable}}\` templates)
- \`method\`: HTTP method (GET, POST, PUT, PATCH, DELETE)
- \`headers\`: Key-value headers (supports templates)
- \`payloadTemplate\`: JSON template for request body
- \`responseMapping\`: Map response fields to output

**Template Variables Available:**
- \`{{callbackUrl}}\` - System-generated callback URL for the external service
- \`{{callbackSecret}}\` - Secret token for callback authentication
- \`{{input.field}}\` - Values from input payload

**JSON Example:**
\`\`\`json
{
  "id": "process-document",
  "name": "OCR Processing",
  "stepType": "external",
  "externalConfig": {
    "endpoint": "https://ocr-service.example.com/process",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{input.apiKey}}",
      "Content-Type": "application/json"
    },
    "payloadTemplate": "{\\"documentUrl\\": \\"{{input.documentUrl}}\\", \\"callbackUrl\\": \\"{{callbackUrl}}\\", \\"secret\\": \\"{{callbackSecret}}\\"}"
  }
}
\`\`\`

**Mermaid Shape:** Hexagon \`{{"text"}}\`
\`\`\`mermaid
ocr{{"OCR Processing"}}
class ocr external
%% @step(ocr): {"externalConfig":{"endpoint":"https://ocr.example.com/process","method":"POST"}}
\`\`\`

**Callback Pattern:**
The external service should POST to \`{{callbackUrl}}\` with:
\`\`\`json
{
  "success": true,
  "data": { "extractedText": "...", "confidence": 0.95 }
}
\`\`\`

---

### 4. Webhook Step (\`webhook\`)
Outbound HTTP call that does NOT wait for a callback. Fire-and-forget or immediate response.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "webhook"

**Optional Fields (webhookConfig object):**
- \`url\`: URL to call (supports templates)
- \`method\`: HTTP method (default: POST)
- \`headers\`: Request headers
- \`bodyTemplate\`: JSON body template
- \`maxRetries\`: Max retry attempts (default: 3)
- \`timeoutMs\`: Request timeout in ms (default: 30000)
- \`successStatusCodes\`: HTTP codes considered success (default: 200-299)

**JSON Example:**
\`\`\`json
{
  "id": "notify-slack",
  "name": "Send Slack Notification",
  "stepType": "webhook",
  "webhookConfig": {
    "url": "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "bodyTemplate": "{\\"text\\": \\"Workflow completed for {{input.projectName}}\\", \\"channel\\": \\"#notifications\\"}"
  }
}
\`\`\`

**Mermaid Shape:** Hexagon \`{{"text"}}\`
\`\`\`mermaid
notify{{"Slack Notification"}}
class notify external
%% @step(notify): {"webhookConfig":{"url":"https://hooks.slack.com/xxx","method":"POST"}}
\`\`\`

---

### 5. Decision Step (\`decision\`)
Routes workflow to different paths based on conditions evaluated against input data.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name (usually a question)
- \`stepType\`: "decision"
- \`connections\`: Array of conditional routes

**Optional Fields:**
- \`defaultConnection\`: Target step ID when no conditions match

**Connection Object:**
- \`targetStepId\`: ID of step to route to
- \`condition\`: Condition expression (see syntax below)
- \`label\`: Display label for the branch

**Condition Syntax:**
- \`field:value\` - Exact match
- \`field:value1,value2\` - Match any of values
- \`field:>10\` - Greater than (also <, >=, <=)
- \`field:!value\` - Not equal

**JSON Example:**
\`\`\`json
{
  "id": "check-priority",
  "name": "Priority Level?",
  "stepType": "decision",
  "connections": [
    {
      "targetStepId": "escalate",
      "condition": "priority:critical,urgent",
      "label": "High Priority"
    },
    {
      "targetStepId": "standard-queue",
      "condition": "priority:normal",
      "label": "Normal"
    }
  ],
  "defaultConnection": "low-priority-queue"
}
\`\`\`

**Mermaid Shape:** Diamond \`{"text"}\`
\`\`\`mermaid
checkPriority{"Priority Level?"}
checkPriority -->|"High Priority"| escalate
checkPriority -->|"Normal"| standardQueue
checkPriority -->|"Low"| lowQueue
class checkPriority decision
\`\`\`

---

### 6. ForEach Step (\`foreach\`)
Fan-out: Creates parallel child tasks for each item in an array.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "foreach"
- \`connections\`: Steps to execute for each item

**Optional Fields:**
- \`itemsPath\`: JSONPath to array in input (e.g., "recipients", "items.emails")
- \`itemVariable\`: Variable name for each item (default: "item")
- \`maxItems\`: Safety limit (default: 100)
- \`expectedCountPath\`: JSONPath to get expected count from input

**Child Task Variables:**
Each child task receives:
- \`{{item}}\` or \`{{variableName}}\` - The current item
- \`{{_index}}\` - Zero-based index (0, 1, 2...)
- \`{{_total}}\` - Total number of items

**JSON Example:**
\`\`\`json
{
  "id": "process-recipients",
  "name": "Process Each Recipient",
  "stepType": "foreach",
  "itemsPath": "recipients",
  "itemVariable": "recipient",
  "maxItems": 50,
  "connections": [
    { "targetStepId": "send-email" }
  ]
}
\`\`\`

**Mermaid Shape:** Subroutine \`[["Each: text"]]\`
\`\`\`mermaid
processRecipients[["Each: Process Recipient"]]
processRecipients --> sendEmail
class processRecipients foreach
%% @step(processRecipients): {"itemsPath":"recipients","itemVariable":"recipient","maxItems":50}
\`\`\`

**Streaming Items Pattern:**
If \`itemsPath\` is omitted, the ForEach waits for items via callback. External steps can use \`{{foreachWebhookUrl}}\` to stream items:
\`\`\`json
{
  "id": "fetch-items",
  "stepType": "external",
  "externalConfig": {
    "payloadTemplate": "{\\"streamTo\\": \\"{{foreachWebhookUrl}}\\"}"
  }
}
\`\`\`

---

### 7. Join Step (\`join\`)
Fan-in: Waits for all parallel tasks from a ForEach to complete before continuing.

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "join"

**Optional Fields:**
- \`awaitStepId\`: ID of the ForEach step to wait for
- \`awaitTag\`: Alternative: wait for tasks with this tag
- \`minSuccessPercent\`: Minimum % that must succeed (default: 100)
- \`expectedCountPath\`: JSONPath to expected count
- \`joinBoundary\`: Advanced boundary conditions object

**joinBoundary Object:**
- \`minCount\`: Minimum tasks that must complete
- \`minPercent\`: Minimum percentage (default: 100)
- \`maxWaitMs\`: Maximum time to wait
- \`failOnTimeout\`: Fail or continue with partial results

**Output Available to Next Step:**
- \`aggregatedResults\`: Array of all child task outputs
- \`successCount\`: Number of successful children
- \`failedCount\`: Number of failed children

**JSON Example:**
\`\`\`json
{
  "id": "aggregate-results",
  "name": "Aggregate Email Results",
  "stepType": "join",
  "awaitStepId": "process-recipients",
  "minSuccessPercent": 90
}
\`\`\`

**Mermaid Shape:** Subroutine \`[["Join: text"]]\`
\`\`\`mermaid
aggregate[["Join: Aggregate Results"]]
class aggregate join
%% @step(aggregate): {"awaitStepId":"process-recipients","minSuccessPercent":90}
\`\`\`

---

### 8. Flow Step (\`flow\`)
Delegates execution to another workflow (nested/child workflow).

**Required Fields:**
- \`id\`: Unique identifier
- \`name\`: Display name
- \`stepType\`: "flow"

**Optional Fields:**
- \`flowId\`: ID of the workflow to run
- \`inputMapping\`: Map values from current context to child workflow input

**JSON Example:**
\`\`\`json
{
  "id": "run-validation",
  "name": "Run Validation Workflow",
  "stepType": "flow",
  "flowId": "workflow-id-here",
  "inputMapping": {
    "document": "{{input.content}}",
    "validationRules": "{{input.rules}}",
    "strictMode": "true"
  }
}
\`\`\`

**Mermaid Shape:** Subroutine \`[["Run: text"]]\`
\`\`\`mermaid
validate[["Run: Validation Workflow"]]
class validate flow
%% @step(validate): {"flowId":"workflow-id","inputMapping":{"document":"{{input.content}}"}}
\`\`\`

---

## Template Variables Reference

| Variable | Context | Description |
|----------|---------|-------------|
| \`{{input.path.to.value}}\` | All steps | Access input payload by dot path |
| \`{{item}}\` or \`{{_item}}\` | ForEach children | Current item being processed |
| \`{{_index}}\` | ForEach children | Zero-based index of current item |
| \`{{_total}}\` | ForEach children | Total number of items |
| \`{{callbackUrl}}\` | External steps | System callback URL |
| \`{{callbackSecret}}\` | External steps | Secret for callback auth |
| \`{{foreachWebhookUrl}}\` | External→ForEach | URL to stream items to ForEach |

---

## Mermaid Syntax Reference

### Required Structure
\`\`\`mermaid
flowchart TD
    %% Node definitions
    step1["Agent Task"]
    step2("Manual Task")
    step3{{"External API"}}
    step4{"Decision?"}
    step5[["Each: Process"]]
    step6[["Join: Aggregate"]]
    step7[["Run: Subprocess"]]

    %% Connections
    step1 --> step2
    step4 -->|"Yes"| step5
    step4 -->|"No"| step7

    %% Required class definitions
    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff
    classDef flow fill:#EC4899,color:#fff

    %% Class assignments
    class step1 agent
    class step2 manual
    class step3 external
    class step4 decision
    class step5 foreach
    class step6 join
    class step7 flow

    %% Step configuration (preserved on import)
    %% @step(step1): {"additionalInstructions":"..."}
\`\`\`

### Shape-to-Type Mapping
| Step Type | Shape | Syntax | Color |
|-----------|-------|--------|-------|
| agent | Rectangle | \`["text"]\` | Blue #3B82F6 |
| manual | Stadium | \`("text")\` | Purple #8B5CF6 |
| external | Hexagon | \`{{"text"}}\` | Orange #F97316 |
| webhook | Hexagon | \`{{"text"}}\` | Orange #F97316 |
| decision | Diamond | \`{"text"}\` | Amber #F59E0B |
| foreach | Subroutine | \`[["Each: text"]]\` | Green #10B981 |
| join | Subroutine | \`[["Join: text"]]\` | Indigo #6366F1 |
| flow | Subroutine | \`[["Run: text"]]\` | Pink #EC4899 |

---

## Common Workflow Patterns

### Pattern 1: Linear Review Pipeline
\`\`\`json
{
  "name": "Content Review Pipeline",
  "steps": [
    { "id": "draft", "name": "AI Draft", "stepType": "agent", "additionalInstructions": "Create initial draft from the brief." },
    { "id": "review", "name": "Editor Review", "stepType": "manual", "additionalInstructions": "Review and provide feedback." },
    { "id": "revise", "name": "AI Revision", "stepType": "agent", "additionalInstructions": "Apply feedback and revise." },
    { "id": "approve", "name": "Final Approval", "stepType": "manual" }
  ]
}
\`\`\`

### Pattern 2: Parallel Processing with Aggregation
\`\`\`json
{
  "name": "Batch Email Campaign",
  "steps": [
    { "id": "prepare", "name": "Prepare Campaign", "stepType": "agent" },
    { "id": "foreach", "name": "Process Recipients", "stepType": "foreach", "itemsPath": "recipients", "itemVariable": "recipient", "connections": [{"targetStepId": "send"}] },
    { "id": "send", "name": "Send Email", "stepType": "webhook", "webhookConfig": {"url": "https://email-api.example.com/send", "bodyTemplate": "{\\"to\\": \\"{{recipient.email}}\\", \\"template\\": \\"{{input.templateId}}\\"}"} },
    { "id": "join", "name": "Aggregate Results", "stepType": "join", "awaitStepId": "foreach" },
    { "id": "report", "name": "Generate Report", "stepType": "agent", "additionalInstructions": "Summarize delivery results from aggregatedResults." }
  ]
}
\`\`\`

### Pattern 3: Conditional Routing with Escalation
\`\`\`json
{
  "name": "Support Ticket Triage",
  "steps": [
    { "id": "analyze", "name": "Analyze Ticket", "stepType": "agent", "additionalInstructions": "Classify severity and category." },
    { "id": "route", "name": "Severity Check", "stepType": "decision", "connections": [
      {"targetStepId": "escalate", "condition": "severity:critical", "label": "Critical"},
      {"targetStepId": "assign", "condition": "severity:high,normal", "label": "Standard"}
    ], "defaultConnection": "queue" },
    { "id": "escalate", "name": "Page On-Call", "stepType": "webhook" },
    { "id": "assign", "name": "Assign to Team", "stepType": "agent" },
    { "id": "queue", "name": "Add to Backlog", "stepType": "manual" }
  ]
}
\`\`\`
`;

    // Add context section if requested
    if (includeContext === 'true') {
      prompt += `
---

## Available Context (Current System)

### AI Agents
Use these IDs for \`defaultAssigneeId\` on agent steps:
${agents.length > 0 ? agents.map(a => `- **${a.displayName}** (\`${a._id}\`)${a.agentPrompt ? `\n  _${a.agentPrompt.substring(0, 100).replace(/\n/g, ' ')}${a.agentPrompt.length > 100 ? '...' : ''}_` : ''}`).join('\n') : '- _No agents configured_'}

### Users
Use these IDs for \`defaultAssigneeId\` on manual steps:
${users.length > 0 ? users.map(u => `- **${u.displayName}**${u.email ? ` <${u.email}>` : ''} (\`${u._id}\`)`).join('\n') : '- _No users configured_'}

### Existing Workflows
Use these IDs for \`flowId\` on flow steps:
${workflows.length > 0 ? workflows.map(w => `- **${w.name}** (\`${w._id}\`)${w.description ? `\n  _${w.description}_` : ''}`).join('\n') : '- _No workflows configured_'}

### Available Tags
Use these in \`taskDefaults.tags\` or for filtering:
${tags.length > 0 ? tags.map(t => `\`${t}\``).join(', ') : '- _No tags in use yet_'}
`;
    }

    // Add output format section
    prompt += `
---

## Output Format

${format === 'json' ? `Provide the workflow as a JSON object:

\`\`\`json
{
  "name": "Workflow Name",
  "description": "Clear description of what this workflow accomplishes",
  "rootTaskTitleTemplate": "{{input.projectName}} - Processing",
  "steps": [
    {
      "id": "step-id",
      "name": "Step Display Name",
      "stepType": "agent|manual|external|webhook|decision|foreach|join|flow",
      // ... additional fields based on step type
    }
  ]
}
\`\`\`

Ensure all step IDs are unique and connections reference valid step IDs.` : `Provide the workflow as a Mermaid diagram:

\`\`\`mermaid
flowchart TD
    step1["First Step"]
    step2("Human Review")
    step3{"Decision Point?"}

    step1 --> step2
    step2 --> step3
    step3 -->|"Yes"| step4
    step3 -->|"No"| step5

    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff
    classDef flow fill:#EC4899,color:#fff

    class step1 agent
    class step2 manual
    class step3 decision

    %% Step configuration (IMPORTANT - include for all steps that need config)
    %% @step(step1): {"additionalInstructions":"Your instructions here"}
    %% @step(step2): {"additionalInstructions":"Instructions for the human reviewer"}
\`\`\`

**Important Mermaid Rules:**
1. Always quote labels with double quotes: \`["Label"]\` not \`[Label]\`
2. Never use inline \`style\` statements
3. Include ALL classDef declarations
4. Use \`%% @step(id): {json}\` comments for step configuration
5. Decision branch labels must be quoted: \`-->|"Label"|\``}
`;

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

// GET /api/workflows/:id - Get a specific workflow
workflowsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const workflow = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!workflow) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: workflow });
  } catch (error) {
    next(error);
  }
});

// Helper to ensure all steps have IDs
// Valid step types for normalization
const VALID_STEP_TYPES: WorkflowStepType[] = ['trigger', 'agent', 'manual', 'external', 'webhook', 'decision', 'foreach', 'join', 'flow'];

function ensureStepIds(steps: WorkflowStep[]): WorkflowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  return steps.map((step) => {
    const normalized = { ...step };

    // Generate a unique ID if missing
    if (!normalized.id) {
      normalized.id = new ObjectId().toString();
    }

    // Normalize 'type' to 'stepType' for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepAny = step as any;
    if (!normalized.stepType && stepAny.type && VALID_STEP_TYPES.includes(stepAny.type)) {
      normalized.stepType = stepAny.type;
      delete stepAny.type;
    }

    return normalized;
  });
}

// POST /api/workflows - Create a new workflow
workflowsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, description, steps, mermaidDiagram, isActive } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    const now = new Date();
    const newWorkflow: Omit<Workflow, '_id'> = {
      name,
      description: description || '',
      isActive: isActive ?? true,
      steps: ensureStepIds(steps || []),
      mermaidDiagram: mermaidDiagram || '',
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflows/:id - Update a workflow
workflowsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.createdAt;
    updates.updatedAt = new Date();

    // Ensure step IDs are generated when updating steps
    if (updates.steps) {
      updates.steps = ensureStepIds(updates.steps);
    }

    const result = await db.collection<Workflow>('workflows').findOneAndUpdate(
      { _id: workflowId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id - Delete a workflow
workflowsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const result = await db.collection('workflows').deleteOne({ _id: workflowId });

    if (result.deletedCount === 0) {
      throw createError('Workflow not found', 404);
    }

    res.json({ success: true, message: 'Workflow deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/duplicate - Duplicate a workflow
workflowsRouter.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const original = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!original) {
      throw createError('Workflow not found', 404);
    }

    const now = new Date();
    const duplicate: Omit<Workflow, '_id'> = {
      name: `${original.name} (Copy)`,
      description: original.description,
      isActive: false,
      steps: original.steps.map((step) => ({ ...step, id: new ObjectId().toString() })),
      mermaidDiagram: original.mermaidDiagram,
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(duplicate as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/parse-mermaid - Parse Mermaid diagram to workflow steps
workflowsRouter.post('/parse-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mermaidDiagram } = req.body;

    if (!mermaidDiagram) {
      throw createError('mermaidDiagram is required', 400);
    }

    const steps = parseMermaidToSteps(mermaidDiagram);

    res.json({ data: { steps, mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/generate-mermaid - Generate Mermaid diagram from steps
workflowsRouter.post('/generate-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { steps, name } = req.body;

    if (!steps || !Array.isArray(steps)) {
      throw createError('steps array is required', 400);
    }

    const mermaidDiagram = generateMermaidFromSteps(steps, name);

    res.json({ data: { mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/export-multi - Export all workflows as multi-workflow Mermaid
workflowsRouter.get('/export-multi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { ids } = req.query;

    // Build query - optionally filter by IDs
    const query: Record<string, unknown> = {};
    if (ids && typeof ids === 'string') {
      const idList = ids.split(',').map(id => new ObjectId(id.trim()));
      query._id = { $in: idList };
    }

    const workflows = await db
      .collection<Workflow>('workflows')
      .find(query)
      .sort({ name: 1 })
      .toArray();

    if (workflows.length === 0) {
      res.json({ data: { mermaid: '', workflows: [] } });
      return;
    }

    // Generate multi-workflow Mermaid document using subgraphs
    const lines: string[] = ['flowchart TD'];
    const workflowSummaries: Array<{ id: string; name: string; isNew: boolean }> = [];

    for (const workflow of workflows) {
      const workflowId = workflow._id.toString();
      const safeName = workflow.name.replace(/"/g, "'");

      // Add blank line before each workflow section
      lines.push('');

      // Workflow metadata as comments
      lines.push(`    %% @workflow: "${workflow.name}"`);
      lines.push(`    %% @id: ${workflowId}`);
      if (workflow.description) {
        lines.push(`    %% @description: ${workflow.description}`);
      }
      if (workflow.isActive !== undefined) {
        lines.push(`    %% @isActive: ${workflow.isActive}`);
      }
      if (workflow.rootTaskTitleTemplate) {
        lines.push(`    %% @rootTaskTitleTemplate: ${workflow.rootTaskTitleTemplate}`);
      }

      // Start subgraph
      lines.push(`    subgraph ${workflowId}["${safeName}"]`);
      lines.push('        direction TB');

      // Generate nodes and connections for this workflow
      const subgraphContent = generateMermaidSubgraphContent(workflow.steps || [], workflowId);
      if (subgraphContent) {
        lines.push(subgraphContent);
      }

      // End subgraph
      lines.push('    end');

      workflowSummaries.push({
        id: workflowId,
        name: workflow.name,
        isNew: false,
      });
    }

    // Add styling at the end
    lines.push('');
    lines.push('    %% Styling');
    lines.push('    classDef agent fill:#3B82F6,color:#fff');
    lines.push('    classDef external fill:#F97316,color:#fff');
    lines.push('    classDef manual fill:#8B5CF6,color:#fff');
    lines.push('    classDef decision fill:#F59E0B,color:#fff');
    lines.push('    classDef foreach fill:#10B981,color:#fff');
    lines.push('    classDef join fill:#6366F1,color:#fff');
    lines.push('    classDef flow fill:#EC4899,color:#fff');

    const mermaid = lines.join('\n');

    res.json({
      data: {
        mermaid,
        workflows: workflowSummaries,
      }
    });
  } catch (error) {
    next(error);
  }
});

// Helper to generate subgraph content (nodes and connections only, no flowchart declaration)
function generateMermaidSubgraphContent(steps: WorkflowStep[], workflowId: string): string {
  if (steps.length === 0) return '';

  const lines: string[] = [];
  const metadataComments: string[] = [];
  const connectedFrom = new Set<string>();

  // Generate node definitions based on step type
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `${workflowId}_step${i}`;
    const nodeName = step.name.replace(/"/g, "'");

    // Collect step metadata
    const metadata: Record<string, unknown> = {};
    if (step.description) metadata.description = step.description;
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId;
    if (step.inputPath) metadata.inputPath = step.inputPath;
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions;
    if (step.externalConfig) metadata.externalConfig = step.externalConfig;
    if (step.webhookConfig) metadata.webhookConfig = step.webhookConfig;
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection;
    if (step.itemsPath) metadata.itemsPath = step.itemsPath;
    if (step.itemVariable) metadata.itemVariable = step.itemVariable;
    if (step.maxItems) metadata.maxItems = step.maxItems;
    if (step.awaitStepId) metadata.awaitStepId = step.awaitStepId;
    if (step.awaitTag) metadata.awaitTag = step.awaitTag;
    if (step.joinBoundary) metadata.joinBoundary = step.joinBoundary;
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent;
    if (step.flowId) metadata.flowId = step.flowId;
    if (step.inputMapping) metadata.inputMapping = step.inputMapping;

    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`        %% @step(${nodeId}): ${JSON.stringify(metadata)}`);
    }

    // Generate node shape based on step type
    let nodeShape: string;
    let nodeClass: string;

    switch (step.stepType) {
      case 'agent':
        nodeShape = `${nodeId}["${nodeName}"]`;
        nodeClass = 'agent';
        break;
      case 'external':
      case 'webhook':
        nodeShape = `${nodeId}{{"${nodeName}"}}`;
        nodeClass = 'external';
        break;
      case 'manual':
        nodeShape = `${nodeId}("${nodeName}")`;
        nodeClass = 'manual';
        break;
      case 'decision':
        nodeShape = `${nodeId}{"${nodeName}"}`;
        nodeClass = 'decision';
        break;
      case 'foreach':
        nodeShape = `${nodeId}[["Each: ${nodeName}"]]`;
        nodeClass = 'foreach';
        break;
      case 'join':
        nodeShape = `${nodeId}[["Join: ${nodeName}"]]`;
        nodeClass = 'join';
        break;
      case 'flow':
        nodeShape = `${nodeId}[["Run: ${nodeName}"]]`;
        nodeClass = 'flow';
        break;
      default:
        nodeShape = `${nodeId}["${nodeName}"]`;
        nodeClass = 'agent';
    }

    lines.push(`        ${nodeShape}:::${nodeClass}`);
  }

  // Generate connections
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `${workflowId}_step${i}`;

    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`        ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`);
        } else {
          lines.push(`        ${nodeId} --> ${conn.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
  }

  // Add linear connections for nodes without explicit connections
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nodeId = step.id || `${workflowId}_step${i}`;

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = steps[i + 1].id || `${workflowId}_step${i + 1}`;
      lines.push(`        ${nodeId} --> ${nextNodeId}`);
    }
  }

  // Add metadata comments at the end
  if (metadataComments.length > 0) {
    lines.push('');
    lines.push(...metadataComments);
  }

  return lines.join('\n');
}

// POST /api/workflows/import-multi - Import multiple workflows from multi-workflow Mermaid
workflowsRouter.post('/import-multi', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { mermaid, dryRun = false } = req.body;

    if (!mermaid || typeof mermaid !== 'string') {
      throw createError('mermaid is required', 400);
    }

    // Parse workflows from subgraphs
    const workflowSections = parseMultiWorkflowMermaid(mermaid);

    if (workflowSections.length === 0) {
      throw createError('No workflow subgraphs found. Use subgraph blocks with @workflow metadata.', 400);
    }

    const results: Array<{
      name: string;
      id?: string;
      action: 'create' | 'update' | 'skip';
      stepCount: number;
      error?: string;
    }> = [];

    for (const section of workflowSections) {
      try {
        const { name: workflowName, id: workflowId, description, isActive, rootTaskTitleTemplate, mermaidContent } = section;

        if (!workflowName) {
          results.push({
            name: '(unknown)',
            action: 'skip',
            stepCount: 0,
            error: 'Missing @workflow metadata',
          });
          continue;
        }

        // Create a fake flowchart for parsing
        const mermaidDiagram = `flowchart TD\n${mermaidContent}`;

        // Parse steps from the subgraph content
        const steps = parseMermaidToSteps(mermaidDiagram);

        if (dryRun) {
          // Just report what would happen
          results.push({
            name: workflowName,
            id: workflowId || undefined,
            action: workflowId ? 'update' : 'create',
            stepCount: steps.length,
          });
        } else {
          // Actually create or update
          if (workflowId) {
            // Update existing workflow
            const updateResult = await db.collection<Workflow>('workflows').findOneAndUpdate(
              { _id: new ObjectId(workflowId) },
              {
                $set: {
                  name: workflowName,
                  description,
                  isActive,
                  rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                  steps: ensureStepIds(steps),
                  mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
                  updatedAt: new Date(),
                },
              },
              { returnDocument: 'after' }
            );

            if (updateResult) {
              results.push({
                name: workflowName,
                id: workflowId,
                action: 'update',
                stepCount: steps.length,
              });
            } else {
              // ID not found, create new instead
              const now = new Date();
              const newWorkflow: Omit<Workflow, '_id'> = {
                name: workflowName,
                description,
                isActive,
                rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                steps: ensureStepIds(steps),
                mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
                createdAt: now,
                updatedAt: now,
                createdById: null,
              };

              const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
              results.push({
                name: workflowName,
                id: insertResult.insertedId.toString(),
                action: 'create',
                stepCount: steps.length,
              });
            }
          } else {
            // Create new workflow
            const now = new Date();
            const newWorkflow: Omit<Workflow, '_id'> = {
              name: workflowName,
              description,
              isActive,
              rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
              steps: ensureStepIds(steps),
              mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
              createdAt: now,
              updatedAt: now,
              createdById: null,
            };

            const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
            results.push({
              name: workflowName,
              id: insertResult.insertedId.toString(),
              action: 'create',
              stepCount: steps.length,
            });
          }
        }
      } catch (sectionError) {
        results.push({
          name: '(parse error)',
          action: 'skip',
          stepCount: 0,
          error: sectionError instanceof Error ? sectionError.message : 'Unknown error',
        });
      }
    }

    res.json({
      data: {
        results,
        summary: {
          total: results.length,
          created: results.filter(r => r.action === 'create').length,
          updated: results.filter(r => r.action === 'update').length,
          skipped: results.filter(r => r.action === 'skip').length,
        },
        dryRun,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Parse multi-workflow Mermaid document with subgraphs
interface ParsedWorkflowSection {
  name: string;
  id: string | null;
  description: string;
  isActive: boolean;
  rootTaskTitleTemplate: string;
  mermaidContent: string;
}

function parseMultiWorkflowMermaid(mermaid: string): ParsedWorkflowSection[] {
  const lines = mermaid.split('\n');
  const workflows: ParsedWorkflowSection[] = [];

  let currentWorkflow: Partial<ParsedWorkflowSection> = {};
  let currentContent: string[] = [];
  let inSubgraph = false;
  let subgraphDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Parse workflow metadata from comments (before subgraph)
    if (!inSubgraph) {
      const nameMatch = trimmedLine.match(/^%% @workflow:\s*"?([^"]+)"?$/);
      if (nameMatch) {
        currentWorkflow.name = nameMatch[1].trim();
        continue;
      }

      const idMatch = trimmedLine.match(/^%% @id:\s*(\S+)$/);
      if (idMatch && idMatch[1] !== '(new)') {
        currentWorkflow.id = idMatch[1].trim();
        continue;
      }

      const descMatch = trimmedLine.match(/^%% @description:\s*(.+)$/);
      if (descMatch) {
        currentWorkflow.description = descMatch[1].trim();
        continue;
      }

      const activeMatch = trimmedLine.match(/^%% @isActive:\s*(true|false)$/);
      if (activeMatch) {
        currentWorkflow.isActive = activeMatch[1] === 'true';
        continue;
      }

      const templateMatch = trimmedLine.match(/^%% @rootTaskTitleTemplate:\s*(.+)$/);
      if (templateMatch) {
        currentWorkflow.rootTaskTitleTemplate = templateMatch[1].trim();
        continue;
      }
    }

    // Detect subgraph start
    const subgraphMatch = trimmedLine.match(/^subgraph\s+(\S+)/);
    if (subgraphMatch) {
      if (subgraphDepth === 0) {
        // This is the main workflow subgraph
        inSubgraph = true;
        currentContent = [];
      }
      subgraphDepth++;
      continue;
    }

    // Detect end of subgraph
    if (trimmedLine === 'end') {
      subgraphDepth--;
      if (subgraphDepth === 0 && inSubgraph) {
        // End of workflow subgraph - save it
        workflows.push({
          name: currentWorkflow.name || '',
          id: currentWorkflow.id || null,
          description: currentWorkflow.description || '',
          isActive: currentWorkflow.isActive !== undefined ? currentWorkflow.isActive : true,
          rootTaskTitleTemplate: currentWorkflow.rootTaskTitleTemplate || '',
          mermaidContent: currentContent.join('\n'),
        });

        // Reset for next workflow
        currentWorkflow = {};
        currentContent = [];
        inSubgraph = false;
      }
      continue;
    }

    // Collect content inside subgraph
    if (inSubgraph && subgraphDepth === 1) {
      // Skip direction declaration
      if (!trimmedLine.startsWith('direction ')) {
        currentContent.push(line);
      }
    }
  }

  return workflows;
}

// Helper function to parse Mermaid flowchart to workflow steps
function parseMermaidToSteps(mermaid: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lines = mermaid.split('\n').map((l) => l.trim()).filter(Boolean);

  // Node storage with full step info
  interface ParsedNode {
    id: string;  // Keep original mermaid ID for connection mapping
    name: string;
    stepType: WorkflowStepType;
  }

  const nodes: Map<string, ParsedNode> = new Map();
  const connections: Array<{ from: string; to: string; label?: string }> = [];

  // Step metadata from comments: %% @step(nodeId): {json}
  const stepMetadata: Map<string, Record<string, unknown>> = new Map();

  for (const line of lines) {
    // Parse step configuration comments first
    const stepConfigMatch = line.match(/%% @step\(([^)]+)\):\s*(.+)/);
    if (stepConfigMatch) {
      try {
        const [, stepId, configJson] = stepConfigMatch;
        const config = JSON.parse(configJson);
        stepMetadata.set(stepId, config);
      } catch {
        // Invalid JSON, skip
      }
      continue;
    }

    // Skip diagram type declarations, styling, and other comments
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;
    if (line.startsWith('classDef') || line.startsWith('class ')) continue;
    if (line.startsWith('%%')) continue;
    if (line.startsWith('subgraph') || line === 'end' || line.startsWith('direction')) continue;

    // Parse node definitions - order matters! More specific patterns first

    // Hexagon {{ }} - external service/API call
    // Pattern: ID{{"text"}} or ID{{text}}
    const hexagonMatch = line.match(/^([\w-]+)\{\{["']?([^"}]+?)["']?\}\}/);
    if (hexagonMatch) {
      const [, id, text] = hexagonMatch;
      // Check for ext:, api:, trigger:, or webhook: prefix
      const cleanName = text.replace(/^(ext|api|webhook|trigger):\s*/i, '').trim();
      nodes.set(id, { id, name: cleanName, stepType: 'external' });
      continue;
    }

    // Double square brackets [[ ]] - foreach/join/flow
    // Pattern: ID[["text"]] or ID[[text]]
    const doubleSquareMatch = line.match(/^([\w-]+)\[\[["']?([^"\]]+?)["']?\]\]/);
    if (doubleSquareMatch) {
      const [, id, text] = doubleSquareMatch;
      const lowerText = text.toLowerCase();

      let stepType: WorkflowStepType = 'agent';
      let cleanName = text;
      let itemsPath: string | undefined;
      let minSuccessPercent: number | undefined;

      if (lowerText.startsWith('each:') || lowerText.startsWith('foreach:')) {
        stepType = 'foreach';
        cleanName = text.replace(/^(each|foreach):\s*/i, '').trim();
        // Extract itemsPath from format: "Name (path.to.items)"
        const itemsMatch = cleanName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (itemsMatch) {
          cleanName = itemsMatch[1].trim();
          itemsPath = itemsMatch[2].trim();
        }
      } else if (lowerText.startsWith('join:') || lowerText.startsWith('merge:')) {
        stepType = 'join';
        cleanName = text.replace(/^(join|merge):\s*/i, '').trim();
        // Extract minSuccessPercent from format: "Name @95%"
        const pctMatch = cleanName.match(/^(.+?)\s*@(\d+)%\s*$/);
        if (pctMatch) {
          cleanName = pctMatch[1].trim();
          minSuccessPercent = parseInt(pctMatch[2]);
        }
      } else if (lowerText.startsWith('run:') || lowerText.startsWith('flow:')) {
        stepType = 'flow';
        cleanName = text.replace(/^(run|flow):\s*/i, '').trim();
      } else {
        // Default double brackets to foreach if no prefix
        stepType = 'foreach';
        cleanName = text;
      }

      // Store with extracted config (will be used when creating steps)
      const node: ParsedNode & { itemsPath?: string; minSuccessPercent?: number } = {
        id, name: cleanName, stepType, itemsPath, minSuccessPercent
      };
      nodes.set(id, node);
      continue;
    }

    // Diamond brackets { } - decision/routing
    // Pattern: ID{"text"} or ID{text}
    const diamondMatch = line.match(/^([\w-]+)\{["']?([^"}]+?)["']?\}/);
    if (diamondMatch) {
      const [, id, text] = diamondMatch;
      nodes.set(id, { id, name: text, stepType: 'decision' });
      continue;
    }

    // Double round brackets (( )) - manual/HITL task (stadium shape)
    // Pattern: ID(("text")) or ID((text))
    const stadiumMatch = line.match(/^([\w-]+)\(\(["']?([^")]+?)["']?\)\)/);
    if (stadiumMatch) {
      const [, id, text] = stadiumMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single round brackets ( ) - manual/HITL task
    // Pattern: ID("text") or ID(text)
    const roundMatch = line.match(/^([\w-]+)\(["']?([^")]+?)["']?\)/);
    if (roundMatch) {
      const [, id, text] = roundMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single square brackets [ ] - agent task (default)
    // Pattern: ID["text"] or ID[text]
    // Check for ext: prefix to make it external
    const squareMatch = line.match(/^([\w-]+)\[["']?([^"\]]+?)["']?\]/);
    if (squareMatch) {
      const [, id, text] = squareMatch;
      const lowerText = text.toLowerCase();

      if (lowerText.startsWith('ext:') || lowerText.startsWith('api:') || lowerText.startsWith('webhook:')) {
        const cleanName = text.replace(/^(ext|api|webhook):\s*/i, '').trim();
        nodes.set(id, { id, name: cleanName, stepType: 'external' });
      } else {
        nodes.set(id, { id, name: text, stepType: 'agent' });
      }
      continue;
    }

    // Parse connections
    // Labeled connections: A -->|"label"| B or A -->|label| B
    const labeledConnMatch = line.match(/([\w-]+)\s*-->?\|["']?([^|"']+?)["']?\|\s*([\w-]+)/);
    if (labeledConnMatch) {
      connections.push({
        from: labeledConnMatch[1],
        to: labeledConnMatch[3],
        label: labeledConnMatch[2].trim()
      });
      continue;
    }

    // Simple connections: A --> B
    const simpleConnMatch = line.match(/([\w-]+)\s*-->\s*([\w-]+)/);
    if (simpleConnMatch) {
      // Check if already added as labeled connection
      const from = simpleConnMatch[1];
      const to = simpleConnMatch[2];
      if (!connections.some((c) => c.from === from && c.to === to)) {
        connections.push({ from, to });
      }
    }
  }

  // Build ordered steps using topological sort
  const visited = new Set<string>();
  const orderedNodes: string[] = [];

  // Count incoming connections for each node
  const incomingCount: Map<string, number> = new Map();
  for (const node of nodes.keys()) {
    incomingCount.set(node, 0);
  }
  for (const conn of connections) {
    if (nodes.has(conn.to)) {
      incomingCount.set(conn.to, (incomingCount.get(conn.to) || 0) + 1);
    }
  }

  // Start with nodes that have no incoming connections
  const queue: string[] = [];
  for (const [node, count] of incomingCount) {
    if (count === 0) queue.push(node);
  }

  // Topological sort
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    orderedNodes.push(node);

    for (const conn of connections) {
      if (conn.from === node && nodes.has(conn.to)) {
        const newCount = (incomingCount.get(conn.to) || 1) - 1;
        incomingCount.set(conn.to, newCount);
        if (newCount === 0 && !visited.has(conn.to)) {
          queue.push(conn.to);
        }
      }
    }
  }

  // Add any remaining nodes not connected
  for (const node of nodes.keys()) {
    if (!visited.has(node)) {
      orderedNodes.push(node);
    }
  }

  // Create a map from mermaid ID to generated step ID for connection mapping
  const mermaidIdToStepId: Map<string, string> = new Map();

  // Create workflow steps
  for (const mermaidId of orderedNodes) {
    const node = nodes.get(mermaidId) as ParsedNode & { itemsPath?: string; minSuccessPercent?: number } | undefined;
    if (node) {
      // Use original mermaid ID if it was a step ID (for round-trip preservation)
      const stepId = mermaidId.startsWith('step-') ? mermaidId : new ObjectId().toString();
      mermaidIdToStepId.set(mermaidId, stepId);

      const step: WorkflowStep = {
        id: stepId,
        name: node.name,
        stepType: node.stepType,
      };

      // Apply config extracted from node label
      if (node.itemsPath) step.itemsPath = node.itemsPath;
      if (node.minSuccessPercent !== undefined) step.minSuccessPercent = node.minSuccessPercent;

      // Apply metadata from @step comments if present (overrides label-extracted config)
      const metadata = stepMetadata.get(mermaidId);
      if (metadata) {
        // Merge metadata into step, but don't overwrite id/name/stepType (those come from node shape)
        const { id: _id, name: _name, stepType: _stepType, ...safeMetadata } = metadata as Record<string, unknown>;
        Object.assign(step, safeMetadata);
      }

      // Build connections for this step (non-linear flow support)
      const stepConnections: StepConnection[] = [];
      for (const conn of connections) {
        if (conn.from === mermaidId) {
          stepConnections.push({
            targetStepId: conn.to,  // Will be remapped after all steps created
            condition: conn.label || undefined,
            label: conn.label || undefined,
          });
        }
      }

      if (stepConnections.length > 0) {
        step.connections = stepConnections;
      }

      // Legacy compatibility
      if (node.stepType === 'agent') {
        step.execution = 'automated';
        step.type = 'automated';
      } else if (node.stepType === 'manual') {
        step.execution = 'manual';
        step.type = 'manual';
        step.hitlPhase = 'approval_required';
      }

      steps.push(step);
    }
  }

  // Remap connection targetStepIds from mermaid IDs to actual step IDs
  for (const step of steps) {
    if (step.connections) {
      for (const conn of step.connections) {
        const actualStepId = mermaidIdToStepId.get(conn.targetStepId);
        if (actualStepId) {
          conn.targetStepId = actualStepId;
        }
      }
    }
    // Also handle legacy branches for decision nodes
    if (step.stepType === 'decision' && step.connections) {
      step.branches = step.connections.map(c => ({
        condition: c.condition || null,
        targetStepId: c.targetStepId,
      }));
    }
  }

  return steps;
}

// Helper function to generate Mermaid diagram from workflow steps
function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return '';

  const lines: string[] = ['flowchart TD'];
  const metadataComments: string[] = [];  // Collect metadata comments to add at the end

  // Generate node definitions based on step type
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;
    const nodeName = step.name.replace(/"/g, "'");

    // Collect step metadata to preserve in comments
    // Exclude fields that are represented in the Mermaid shape itself
    const metadata: Record<string, unknown> = {};

    // Common fields
    if (step.description) metadata.description = step.description;
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId;
    if (step.inputPath) metadata.inputPath = step.inputPath;

    // Agent/manual step fields
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions;

    // External step fields
    if (step.externalConfig) metadata.externalConfig = step.externalConfig;

    // Webhook step fields
    if (step.webhookConfig) metadata.webhookConfig = step.webhookConfig;

    // Decision step fields
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection;

    // ForEach step fields
    if (step.itemsPath) metadata.itemsPath = step.itemsPath;
    if (step.itemVariable) metadata.itemVariable = step.itemVariable;
    if (step.maxItems) metadata.maxItems = step.maxItems;
    if (step.stepType === 'foreach' && step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath;

    // Join step fields
    if (step.awaitStepId) metadata.awaitStepId = step.awaitStepId;
    if (step.joinBoundary) metadata.joinBoundary = step.joinBoundary;
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent;
    if (step.stepType === 'join' && step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath;

    // Flow step fields
    if (step.flowId) metadata.flowId = step.flowId;
    if (step.inputMapping) metadata.inputMapping = step.inputMapping;

    // Queue metadata comment if there's any data to preserve (will add at the end)
    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`    %% @step(${nodeId}): ${JSON.stringify(metadata)}`);
    }

    switch (step.stepType) {
      case 'agent':
        // Square brackets for agent tasks (AI)
        lines.push(`    ${nodeId}["${nodeName}"]`);
        break;
      case 'external':
        // Hexagon for external/API tasks
        lines.push(`    ${nodeId}{{"${nodeName}"}}`);
        break;
      case 'manual':
        // Round brackets for manual/HITL tasks
        lines.push(`    ${nodeId}("${nodeName}")`);
        break;
      case 'decision':
        // Diamond for decision/routing
        lines.push(`    ${nodeId}{"${nodeName}"}`);
        break;
      case 'foreach':
        lines.push(`    ${nodeId}[["Each: ${nodeName}"]]`);
        break;
      case 'join':
        lines.push(`    ${nodeId}[["Join: ${nodeName}"]]`);
        break;
      case 'flow':
        lines.push(`    ${nodeId}[["Run: ${nodeName}"]]`);
        break;
      default:
        // Legacy support: check execution mode
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${nodeName}")`);
        } else {
          lines.push(`    ${nodeId}["${nodeName}"]`);
        }
    }
  }

  // Generate connections - use explicit connections if available, otherwise linear
  const connectedFrom = new Set<string>();  // Track which nodes have outgoing connections

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    // Use explicit connections if defined
    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`    ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`);
        } else {
          lines.push(`    ${nodeId} --> ${conn.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
    // Legacy: use branches for decision nodes
    else if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${branch.targetStepId}`);
        } else {
          lines.push(`    ${nodeId} --> ${branch.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
  }

  // Add linear connections for nodes without explicit connections
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = steps[i + 1].id || `step${i + 1}`;
      lines.push(`    ${nodeId} --> ${nextNodeId}`);
    }
  }

  // Add styling classes with distinct colors for each type
  lines.push('');
  lines.push('    classDef agent fill:#3B82F6,color:#fff');      // Blue - AI agent
  lines.push('    classDef external fill:#F97316,color:#fff');   // Orange - External/API
  lines.push('    classDef manual fill:#8B5CF6,color:#fff');     // Purple - Human/HITL
  lines.push('    classDef decision fill:#F59E0B,color:#fff');   // Amber - Decision
  lines.push('    classDef foreach fill:#10B981,color:#fff');    // Green - Loop
  lines.push('    classDef join fill:#6366F1,color:#fff');       // Indigo - Join
  lines.push('    classDef flow fill:#EC4899,color:#fff');       // Pink - Flow

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    agent: [],
    external: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    flow: [],
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    switch (step.stepType) {
      case 'agent':
        classGroups.agent.push(nodeId);
        break;
      case 'external':
        classGroups.external.push(nodeId);
        break;
      case 'manual':
        classGroups.manual.push(nodeId);
        break;
      case 'decision':
        classGroups.decision.push(nodeId);
        break;
      case 'foreach':
        classGroups.foreach.push(nodeId);
        break;
      case 'join':
        classGroups.join.push(nodeId);
        break;
      case 'flow':
        classGroups.flow.push(nodeId);
        break;
      default:
        // Legacy support
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          classGroups.manual.push(nodeId);
        } else {
          classGroups.agent.push(nodeId);
        }
    }
  }

  // Output class assignments
  for (const [className, nodeIds] of Object.entries(classGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${className}`);
    }
  }

  // Add step metadata comments at the end (keeps diagram structure clean at the top)
  if (metadataComments.length > 0) {
    lines.push('');
    lines.push('    %% Step configuration (preserved on import)');
    lines.push(...metadataComments);
  }

  return lines.join('\n');
}
