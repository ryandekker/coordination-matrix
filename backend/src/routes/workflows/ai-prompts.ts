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
        format: 'multi-json',
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
    const { format = 'json', includeContext = 'true' } = req.query;

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
    trigger: {
      description: 'Entry point / workflow start. Fires once to begin workflow execution.',
      mermaidShape: '>"text"]',
      mermaidClass: 'trigger',
      color: '#6B7280',
      executionMode: 'immediate',
      commonFields: [],
      example: { id: 'start', name: 'Start Workflow', stepType: 'trigger' }
    },
    agent: {
      description: 'AI-powered automated task executed by the daemon (Claude, GPT, etc.)',
      mermaidShape: '["text"]',
      mermaidClass: 'agent',
      color: '#3B82F6',
      executionMode: 'automated',
      commonFields: ['additionalInstructions', 'defaultAssigneeId', 'promptDocumentIds', 'inputConfig'],
      example: { id: 'analyze', name: 'Analyze Document', stepType: 'agent', additionalInstructions: 'Extract key themes and summarize.', defaultAssigneeId: 'agent_id' }
    },
    manual: {
      description: 'Human-in-the-loop task that waits for user action via UI',
      mermaidShape: '("text")',
      mermaidClass: 'manual',
      color: '#8B5CF6',
      executionMode: 'manual',
      commonFields: ['additionalInstructions', 'defaultAssigneeId', 'inputConfig'],
      example: { id: 'approve', name: 'Manager Approval', stepType: 'manual', additionalInstructions: 'Review and approve the analysis.' }
    },
    external: {
      description: 'Calls external API and waits for callback response',
      mermaidShape: '{{"text"}}',
      mermaidClass: 'external',
      color: '#F97316',
      executionMode: 'external_callback',
      commonFields: ['externalConfig'],
      example: { id: 'callApi', name: 'External Validation', stepType: 'external', externalConfig: { endpoint: 'https://api.example.com/validate', method: 'POST', payloadTemplate: '{"data": "{{input.content}}", "callback": "{{callbackUrl}}"}' } }
    },
    webhook: {
      description: 'Outbound HTTP call (fire-and-forget, no callback wait)',
      mermaidShape: '{{"text"}}',
      mermaidClass: 'external',
      color: '#F97316',
      executionMode: 'automated',
      commonFields: ['webhookConfig'],
      example: { id: 'notify', name: 'Send Notification', stepType: 'webhook', webhookConfig: { url: 'https://hooks.slack.com/xxx', method: 'POST', bodyTemplate: '{"text": "Task completed: {{input.title}}"}' } }
    },
    decision: {
      description: 'Routes workflow based on conditions evaluated against previous step output',
      mermaidShape: '{"text"}',
      mermaidClass: 'decision',
      color: '#F59E0B',
      executionMode: 'immediate',
      commonFields: ['connections', 'defaultConnection'],
      example: { id: 'checkStatus', name: 'Is Valid?', stepType: 'decision', connections: [{ targetStepId: 'pass', condition: 'status:valid', label: 'Yes' }, { targetStepId: 'fail', condition: 'status:invalid', label: 'No' }], defaultConnection: 'fail' }
    },
    foreach: {
      description: 'Fan-out: Creates parallel child tasks for each item in an array',
      mermaidShape: '[["Each: text"]]',
      mermaidClass: 'foreach',
      color: '#10B981',
      executionMode: 'immediate',
      commonFields: ['itemsPath', 'itemVariable', 'maxItems', 'expectedCountPath', 'connections'],
      example: { id: 'processItems', name: 'Process Each', stepType: 'foreach', itemsPath: 'items', itemVariable: 'item', maxItems: 100, connections: [{ targetStepId: 'handleItem' }] }
    },
    join: {
      description: 'Fan-in: Waits for all parallel tasks from ForEach to complete',
      mermaidShape: '[["Join: text"]]',
      mermaidClass: 'join',
      color: '#6366F1',
      executionMode: 'immediate',
      commonFields: ['awaitStepId', 'joinBoundary', 'minSuccessPercent'],
      example: { id: 'aggregate', name: 'Aggregate Results', stepType: 'join', awaitStepId: 'processItems', joinBoundary: { minPercent: 90, maxWaitMs: 300000 } }
    },
    flow: {
      description: 'Delegates execution to a nested/child workflow',
      mermaidShape: '[["Run: text"]]',
      mermaidClass: 'flow',
      color: '#EC4899',
      executionMode: 'automated',
      commonFields: ['flowId', 'inputMapping'],
      example: { id: 'runSub', name: 'Run Subprocess', stepType: 'flow', flowId: 'workflow_id_here', inputMapping: { document: '{{input.content}}', userId: '{{input.userId}}' } }
    },
    code: {
      description: 'Execute JavaScript code in a sandboxed vm2 environment',
      mermaidShape: '[/"text"/]',
      mermaidClass: 'code',
      color: '#0EA5E9',
      executionMode: 'automated',
      commonFields: ['codeConfig'],
      example: { id: 'transform', name: 'Transform Data', stepType: 'code', codeConfig: { code: 'return { processed: input.items.map(i => i.name), count: input.items.length };', packages: ['lodash'], timeout: 30000 } }
    },
    findDocument: {
      description: 'Search for documents using semantic search or fetch by ID',
      mermaidShape: '[(text)]',
      mermaidClass: 'findDocument',
      color: '#14B8A6',
      executionMode: 'automated',
      commonFields: ['findDocumentConfig'],
      example: { id: 'findDocs', name: 'Find Related Docs', stepType: 'findDocument', findDocumentConfig: { mode: 'dynamic', searchPrompt: 'Find documents about {{input.topic}}', documentTypes: ['workflow-prompt'], limit: 3, minScore: 0.5 } }
    }
  };
}

function getTemplateVariableReference() {
  return {
    inputPayload: {
      syntax: '{{input.path.to.value}}',
      description: 'Access values from the input payload passed to the workflow or step. Supports dot notation and array access.',
      examples: ['{{input.userId}}', '{{input.document.title}}', '{{input.items.0.name}}', '{{input.data.records}}']
    },
    directAccess: {
      syntax: '{{fieldName}}',
      description: 'Direct lookup from input payload without "input." prefix. Useful for short field names.',
      examples: ['{{userId}}', '{{message}}', '{{status}}']
    },
    triggerPayload: {
      syntax: '{{trigger.payload.path}}',
      description: 'Access the original workflow trigger payload from any step (not just the input from previous step)',
      examples: ['{{trigger.payload.userId}}', '{{trigger.payload.config.apiKey}}']
    },
    loopVariables: {
      syntax: '{{item}} or {{_item}}, {{_index}}, {{_total}}',
      description: 'Available inside ForEach child tasks. {{item}} is the current item, or use custom variable name from itemVariable config.',
      examples: ['{{item.email}}', '{{item}}', '{{recipient.name}}', '{{_index}}', '{{_total}}']
    },
    variablePackages: {
      syntax: '{{variables.packageName}} or {{variables.packageName.path}}',
      description: 'Access stored variable packages (credentials, config). Supports dot notation and bracket notation for dynamic keys.',
      examples: ['{{variables.apiKeys.openai}}', '{{variables.config.database.host}}', '{{variables.endpoints[{{input.env}}].url}}']
    },
    callbackUrls: {
      syntax: '{{callbackUrl}}, {{callbackSecret}}',
      description: 'System-generated callback URL and secret for external service callbacks. Use in external/webhook step payloads.',
      examples: ['{{callbackUrl}}', '{{callbackSecret}}']
    },
    systemUrls: {
      syntax: '{{systemWebhookUrl}}, {{foreachWebhookUrl}}',
      description: 'Smart callback URLs that route to the next foreach step when available. Use for streaming items from external services.',
      examples: ['{{systemWebhookUrl}}', '{{foreachWebhookUrl}}']
    },
    systemVariables: {
      syntax: '{{workflowRunId}}, {{stepId}}, {{taskId}}',
      description: 'System-provided IDs for the current execution context',
      examples: ['{{workflowRunId}}', '{{stepId}}', '{{taskId}}']
    },
    apiAccess: {
      syntax: '{{_apiUrl}}, {{_apiKey}}',
      description: 'Base API URL and API key for making calls back to the Coordination Matrix API',
      examples: ['{{_apiUrl}}/api/tasks', '{{_apiKey}}']
    }
  };
}

function getMermaidSyntaxReference() {
  return {
    header: 'flowchart TD',
    shapeMapping: {
      trigger: { shape: '>"label"]', example: 'start>"Start Workflow"]', description: 'Asymmetric shape for entry point' },
      agent: { shape: '["label"]', example: 'step1["AI Review"]', description: 'Rectangle for AI tasks' },
      manual: { shape: '("label")', example: 'step2("Human Review")', description: 'Stadium/rounded for human tasks' },
      external: { shape: '{{"label"}}', example: 'step3{{"API Call"}}', description: 'Hexagon for external API with callback' },
      webhook: { shape: '{{"label"}}', example: 'step3{{"Send Webhook"}}', description: 'Hexagon for outbound HTTP (same as external)' },
      decision: { shape: '{"label"}', example: 'step4{"Is Valid?"}', description: 'Diamond for conditional routing' },
      foreach: { shape: '[["Each: label"]]', example: 'step5[["Each: Process"]]', description: 'Subroutine with "Each:" prefix for fan-out' },
      join: { shape: '[["Join: label"]]', example: 'step6[["Join: Aggregate"]]', description: 'Subroutine with "Join:" prefix for fan-in' },
      flow: { shape: '[["Run: label"]]', example: 'step7[["Run: Subprocess"]]', description: 'Subroutine with "Run:" prefix for nested workflow' },
      code: { shape: '[/"label"/]', example: 'step8[/"Transform Data"/]', description: 'Parallelogram for code execution' },
      findDocument: { shape: '[(label)]', example: 'step9[("Find Docs")]', description: 'Cylinder for document search' }
    },
    connections: {
      simple: 'stepA --> stepB',
      labeled: 'stepA -->|"Label"| stepB',
      note: 'Always quote labels with double quotes to handle special characters'
    },
    requiredClasses: [
      'classDef trigger fill:#6B7280,color:#fff',
      'classDef agent fill:#3B82F6,color:#fff',
      'classDef manual fill:#8B5CF6,color:#fff',
      'classDef external fill:#F97316,color:#fff',
      'classDef decision fill:#F59E0B,color:#fff',
      'classDef foreach fill:#10B981,color:#fff',
      'classDef join fill:#6366F1,color:#fff',
      'classDef flow fill:#EC4899,color:#fff',
      'classDef code fill:#0EA5E9,color:#fff',
      'classDef findDocument fill:#14B8A6,color:#fff'
    ],
    metadataComment: '%% @step(nodeId): {"key": "value"}',
    metadataNote: 'Use @step comments to add configuration that cannot be represented in the diagram (e.g., additionalInstructions, externalConfig)'
  };
}

function getWorkflowRules() {
  return [
    'Every step must have: id, name, stepType',
    'Valid stepTypes: trigger, agent, manual, external, webhook, decision, foreach, join, flow, code, findDocument',
    'Always quote Mermaid labels with double quotes: ["Label"] not [Label]',
    'Never use inline style statements in Mermaid - use classDef and class assignments',
    'Decision steps require connections array with conditions; use defaultConnection for fallback',
    'ForEach steps need itemsPath (path to array in input) or expect items via external callback',
    'Join steps should specify awaitStepId to reference the foreach step to wait for',
    'Flow steps require flowId (existing workflow ID) and optional inputMapping',
    'Code steps require codeConfig with code property; packages are optional',
    'Node shapes in Mermaid carry semantic meaning - use the correct shape for each step type',
    'Data flows from step to step: each step receives previous step output as its input',
    'Use inputConfig.mapping for complex input transformation between steps',
    'Use @step(id): {json} comments to add configuration not representable in diagram'
  ];
}

// Additional reference for code sandbox packages
function getCodeSandboxPackages() {
  return {
    http: ['node-fetch (as fetch)', 'axios', 'qs'],
    data: ['lodash (as _)', 'ramda (as R)', 'immer', 'deepmerge'],
    strings: ['validator', 'slugify', 'change-case', 'marked', 'sanitize-html'],
    numbers: ['bignumber.js (as BigNumber)', 'decimal.js (as Decimal)', 'mathjs (as math)', 'currency.js (as currency)'],
    dates: ['date-fns (as dateFns)', 'dayjs', 'luxon', 'ms'],
    json: ['jsonpath-plus (as JSONPath)', 'json5 (as JSON5)', 'yaml (as YAML)', 'csv-parse', 'csv-stringify', 'papaparse (as Papa)', 'fast-xml-parser (as XMLParser)'],
    validation: ['zod (as z)', 'yup', 'ajv (as Ajv)'],
    ids: ['uuid', 'nanoid', 'ulid', 'hashids (as Hashids)'],
    crypto: ['crypto-js (as CryptoJS)', 'bcryptjs (as bcrypt)', 'jsonwebtoken (as jwt)', 'js-base64 (as Base64)'],
    async: ['p-limit (as pLimit)', 'p-map (as pMap)', 'p-retry (as pRetry)', 'delay'],
    templating: ['handlebars (as Handlebars)', 'mustache (as Mustache)', 'ejs'],
    other: ['fast-json-patch (as jsonPatch)', 'diff (as Diff)', 'pako', 'lz-string (as LZString)', '@faker-js/faker (as faker)']
  };
}

// Step configuration schemas for AI reference
function getStepConfigSchemas() {
  return {
    externalConfig: {
      endpoint: 'string - URL to call (supports {{variable}} templates)',
      method: 'GET | POST | PUT | PATCH | DELETE',
      headers: 'Record<string, string> - Custom headers (supports templates)',
      payloadTemplate: 'string - JSON template for request body',
      responseMapping: 'Record<string, string> - Map response fields to output',
      waitForCallback: 'boolean - true to wait for callback, false for fire-and-forget',
      successStatusCodes: 'number[] - HTTP codes considered success'
    },
    webhookConfig: {
      url: 'string - URL to call (supports templates)',
      method: 'GET | POST | PUT | PATCH | DELETE (default: POST)',
      headers: 'Record<string, string> - Custom headers',
      bodyTemplate: 'string - JSON body template',
      maxRetries: 'number - Max retry attempts (default: 3)',
      timeoutMs: 'number - Request timeout (default: 30000)',
      successStatusCodes: 'number[] - HTTP codes considered success'
    },
    codeConfig: {
      code: 'string - JavaScript code to execute. Receives `input` variable. Must return a value.',
      packages: 'string[] - Packages to inject (see available packages)',
      variables: 'Array<{name, path}> - Inject context values as named variables',
      timeout: 'number - Max execution time in ms (default: 30000)',
      memoryLimit: 'number - Memory limit in MB (default: 128)',
      outputSchema: 'object - JSON Schema to validate output',
      continueOnError: 'boolean - Complete with error in output instead of failing'
    },
    findDocumentConfig: {
      mode: '"static" | "dynamic" - Static fetches by ID, dynamic searches',
      documentId: 'string - Specific document ID (for static mode)',
      searchPrompt: 'string - Search query template (for dynamic mode)',
      documentTypes: 'string[] - Filter by document type',
      documentStatus: 'string[] - Filter by status',
      tags: 'string[] - Filter by tags',
      limit: 'number - Max results (default: 1)',
      minScore: 'number - Minimum similarity threshold (default: 0.5)',
      storeAs: 'string - Variable name for result',
      failIfNotFound: 'boolean - Fail step if no documents found'
    },
    joinBoundary: {
      minCount: 'number - Minimum tasks that must complete',
      minPercent: 'number - Minimum percentage of expected (default: 100)',
      maxWaitMs: 'number - Maximum time to wait (soft deadline)',
      failOnTimeout: 'boolean - Fail or continue with partial results'
    },
    inputConfig: {
      source: '"previous" | "trigger" | "<stepId>" - Where to get input from',
      mapping: 'Record<string, string> - Field mapping with template expressions',
      extractPath: 'string - Simple path extraction (alternative to mapping)'
    }
  };
}

interface ContextData {
  agents: Array<{ _id: unknown; displayName: string; agentPrompt?: string }>;
  users: Array<{ _id: unknown; displayName: string; email?: string }>;
  workflows: Array<{ _id: unknown; name: string; description: string }>;
  tags: string[];
}

function buildFullAIPrompt(includeContext: boolean, context: ContextData): string {
  const sandboxPackages = getCodeSandboxPackages();
  const configSchemas = getStepConfigSchemas();

  let prompt = `# Workflow Generation Guide for Coordination Matrix

You are generating a workflow definition for the Coordination Matrix system. This guide provides complete documentation for all step types, configuration options, template variables, and data flow between steps.

## Workflow Structure

A workflow consists of:
- **name**: Display name for the workflow
- **description**: What this workflow does
- **steps**: Array of step objects defining the workflow logic
- **rootTaskTitleTemplate** (optional): Dynamic title template using \`{{input.field}}\` syntax
- **samplePayload** (optional): Example JSON payload for triggering this workflow

---

## Step Types Reference (11 Types)

### 1. Trigger Step (\`trigger\`)
Entry point that fires once to begin workflow execution. Typically the first step.

**Execution Mode:** immediate (runs instantly)

\`\`\`json
{ "id": "start", "name": "Start Workflow", "stepType": "trigger" }
\`\`\`

---

### 2. Agent Step (\`agent\`)
AI-powered automated task executed by the daemon (Claude, GPT, etc.).

**Execution Mode:** automated
**Fields:**
- \`additionalInstructions\`: Extra context/prompt for the AI agent
- \`defaultAssigneeId\`: ID of the agent to execute this task
- \`promptDocumentIds\`: Array of document IDs to prepend as context
- \`inputConfig\`: Configure where input comes from (see Input Configuration)

\`\`\`json
{
  "id": "analyze",
  "name": "Analyze Document",
  "stepType": "agent",
  "additionalInstructions": "Extract key themes and summarize in 3 bullet points.",
  "defaultAssigneeId": "agent_id_here"
}
\`\`\`

---

### 3. Manual Step (\`manual\`)
Human-in-the-loop task that waits for a user to complete it via the UI.

**Execution Mode:** manual
**Fields:** Same as agent step

\`\`\`json
{
  "id": "approve",
  "name": "Manager Approval",
  "stepType": "manual",
  "additionalInstructions": "Review the analysis and approve or reject with feedback."
}
\`\`\`

---

### 4. External Step (\`external\`)
Calls an external API and **waits for a callback response**.

**Execution Mode:** external_callback
**Fields:**
- \`externalConfig\`: API call configuration (see externalConfig schema below)

**Available Template Variables:**
- \`{{callbackUrl}}\` - System-generated callback URL for the external service to call back
- \`{{callbackSecret}}\` - Secret token for callback authentication
- \`{{input.field}}\` - Values from input payload

\`\`\`json
{
  "id": "validateExternal",
  "name": "External Validation",
  "stepType": "external",
  "externalConfig": {
    "endpoint": "https://api.example.com/validate",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{variables.apiKeys.service}}" },
    "payloadTemplate": "{\\"data\\": \\"{{input.content}}\\", \\"callback\\": \\"{{callbackUrl}}\\", \\"secret\\": \\"{{callbackSecret}}\\"}"
  }
}
\`\`\`

---

### 5. Webhook Step (\`webhook\`)
Outbound HTTP call (fire-and-forget, does NOT wait for callback).

**Execution Mode:** automated
**Fields:**
- \`webhookConfig\`: Webhook configuration (see webhookConfig schema below)

\`\`\`json
{
  "id": "notify",
  "name": "Send Slack Notification",
  "stepType": "webhook",
  "webhookConfig": {
    "url": "https://hooks.slack.com/services/xxx",
    "method": "POST",
    "bodyTemplate": "{\\"text\\": \\"Workflow completed: {{input.title}}\\"}"
  }
}
\`\`\`

---

### 6. Decision Step (\`decision\`)
Routes workflow based on conditions evaluated against previous step output.

**Execution Mode:** immediate
**Fields:**
- \`connections\`: Array of {targetStepId, condition, label}
- \`defaultConnection\`: Step ID when no conditions match

**Condition Syntax:**
- \`field:value\` - Exact match
- \`field:value1,value2\` - Match any of values
- \`field:>10\` - Numeric comparison (>, <, >=, <=)

\`\`\`json
{
  "id": "route",
  "name": "Is Urgent?",
  "stepType": "decision",
  "connections": [
    { "targetStepId": "urgentPath", "condition": "priority:urgent,critical", "label": "Yes" },
    { "targetStepId": "normalPath", "condition": "priority:normal", "label": "No" }
  ],
  "defaultConnection": "lowPriorityPath"
}
\`\`\`

---

### 7. ForEach Step (\`foreach\`)
Fan-out: Creates parallel child tasks for each item in an array.

**Execution Mode:** immediate
**Fields:**
- \`itemsPath\`: JSONPath to array in previous step output (e.g., "items", "data.records")
- \`itemVariable\`: Variable name for each item (default: "item")
- \`maxItems\`: Safety limit (default: 100)
- \`expectedCountPath\`: JSONPath to get expected count (for external streaming)
- \`connections\`: Steps to execute for each item

**Child Task Variables:**
- \`{{item}}\` or \`{{_item}}\` - Current item being processed
- \`{{recipient}}\` - If itemVariable is "recipient"
- \`{{_index}}\` - Zero-based index (0, 1, 2...)
- \`{{_total}}\` - Total number of items

\`\`\`json
{
  "id": "processItems",
  "name": "Process Each Item",
  "stepType": "foreach",
  "itemsPath": "data.records",
  "itemVariable": "record",
  "maxItems": 50,
  "connections": [{ "targetStepId": "handleItem" }]
}
\`\`\`

---

### 8. Join Step (\`join\`)
Fan-in: Waits for all parallel tasks from ForEach to complete.

**Execution Mode:** immediate
**Fields:**
- \`awaitStepId\`: ID of the ForEach step to wait for
- \`joinBoundary\`: Boundary conditions (minCount, minPercent, maxWaitMs, failOnTimeout)
- \`minSuccessPercent\`: Legacy - percentage of tasks that must succeed

**Output:**
- \`aggregatedResults\`: Array of all child task results
- \`successCount\`, \`failedCount\`: Statistics

\`\`\`json
{
  "id": "aggregate",
  "name": "Aggregate Results",
  "stepType": "join",
  "awaitStepId": "processItems",
  "joinBoundary": {
    "minPercent": 90,
    "maxWaitMs": 300000,
    "failOnTimeout": false
  }
}
\`\`\`

---

### 9. Flow Step (\`flow\`)
Delegates execution to a nested/child workflow.

**Execution Mode:** automated
**Fields:**
- \`flowId\`: ID of the workflow to execute
- \`inputMapping\`: Template mapping for input payload to child workflow

\`\`\`json
{
  "id": "runValidation",
  "name": "Run Validation Workflow",
  "stepType": "flow",
  "flowId": "workflow_id_here",
  "inputMapping": {
    "document": "{{input.content}}",
    "userId": "{{input.userId}}",
    "rules": "{{input.validationRules}}"
  }
}
\`\`\`

---

### 10. Code Step (\`code\`)
Execute JavaScript code in a sandboxed vm2 environment.

**Execution Mode:** automated
**Fields:**
- \`codeConfig\`: Code execution configuration (see codeConfig schema below)

**Code receives:**
- \`input\`: Previous step output
- Injected packages (lodash as _, date-fns as dateFns, etc.)
- Custom variables via \`variables\` config

**Code must return:** A value that becomes the step output

\`\`\`json
{
  "id": "transform",
  "name": "Transform Data",
  "stepType": "code",
  "codeConfig": {
    "code": "const processed = input.items.map(i => ({ name: i.name.toUpperCase(), id: i.id })); return { processed, count: processed.length };",
    "packages": ["lodash"],
    "timeout": 30000
  }
}
\`\`\`

**Available Packages (35+):**
- HTTP: ${sandboxPackages.http.join(', ')}
- Data: ${sandboxPackages.data.join(', ')}
- Strings: ${sandboxPackages.strings.join(', ')}
- Numbers: ${sandboxPackages.numbers.join(', ')}
- Dates: ${sandboxPackages.dates.join(', ')}
- JSON/Data: ${sandboxPackages.json.join(', ')}
- Validation: ${sandboxPackages.validation.join(', ')}
- IDs: ${sandboxPackages.ids.join(', ')}
- Crypto: ${sandboxPackages.crypto.join(', ')}
- Async: ${sandboxPackages.async.join(', ')}

---

### 11. FindDocument Step (\`findDocument\`)
Search for documents using semantic search or fetch by ID.

**Execution Mode:** automated
**Fields:**
- \`findDocumentConfig\`: Document search configuration

**Modes:**
- \`static\`: Fetch a specific document by ID
- \`dynamic\`: Semantic search with query

\`\`\`json
{
  "id": "findContext",
  "name": "Find Related Documents",
  "stepType": "findDocument",
  "findDocumentConfig": {
    "mode": "dynamic",
    "searchPrompt": "Find documents about {{input.topic}}",
    "documentTypes": ["workflow-prompt", "reference"],
    "limit": 3,
    "minScore": 0.5,
    "storeAs": "contextDocs"
  }
}
\`\`\`

---

## Template Variables Reference

### Input Payload Access
\`\`\`
{{input.path.to.value}}    - Explicit input prefix
{{fieldName}}              - Direct lookup (shorthand)
{{input.items.0.name}}     - Array access
{{trigger.payload.field}}  - Access original trigger payload from any step
\`\`\`

### ForEach Loop Variables
\`\`\`
{{item}} or {{_item}}      - Current item
{{customVar}}              - If itemVariable is set to "customVar"
{{_index}}                 - Zero-based index (0, 1, 2...)
{{_total}}                 - Total number of items
\`\`\`

### Variable Packages (Stored Credentials/Config)
\`\`\`
{{variables.packageName}}              - Simple variable
{{variables.config.database.host}}     - Nested path
{{variables.keys[{{input.env}}].api}}  - Dynamic key with nested interpolation
\`\`\`

### System Variables
\`\`\`
{{callbackUrl}}            - Callback URL for external services
{{callbackSecret}}         - Secret for callback authentication
{{systemWebhookUrl}}       - Smart callback (routes to foreach if available)
{{foreachWebhookUrl}}      - URL for streaming items to foreach
{{workflowRunId}}          - Current workflow run ID
{{stepId}}                 - Current step ID
{{taskId}}                 - Current task ID
{{_apiUrl}}                - Base API URL
{{_apiKey}}                - API key for callbacks
\`\`\`

---

## Data Flow Between Steps

1. **Trigger → First Step**: Trigger payload becomes first step's input
2. **Step → Next Step**: Each step's output becomes the next step's input
3. **ForEach → Child Tasks**: Each child receives one item plus loop variables
4. **Join → Next Step**: Aggregated results from all children become output

### Custom Input Configuration (inputConfig)
Override default data flow:
\`\`\`json
{
  "inputConfig": {
    "source": "trigger",
    "mapping": {
      "userId": "{{output.user.id}}",
      "items": "{{output.data.records}}"
    }
  }
}
\`\`\`

---

## Step Configuration Schemas

### externalConfig
${Object.entries(configSchemas.externalConfig).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}

### webhookConfig
${Object.entries(configSchemas.webhookConfig).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}

### codeConfig
${Object.entries(configSchemas.codeConfig).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}

### findDocumentConfig
${Object.entries(configSchemas.findDocumentConfig).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}

### joinBoundary
${Object.entries(configSchemas.joinBoundary).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}

---

## Mermaid Format

When using Mermaid format, follow this structure:

\`\`\`mermaid
flowchart TD
    start>"Start"]
    step1["AI Analysis"]
    step2("Human Review")
    step3{{"External API"}}
    step4{"Decision?"}
    step5[["Each: Process"]]
    step6[["Join: Aggregate"]]
    step7[["Run: Subprocess"]]
    step8[/"Transform Data"/]

    start --> step1
    step1 --> step2
    step2 --> step3
    step3 --> step4
    step4 -->|"Yes"| step5
    step4 -->|"No"| step7
    step5 --> step6
    step6 --> step8

    classDef trigger fill:#6B7280,color:#fff
    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff
    classDef flow fill:#EC4899,color:#fff
    classDef code fill:#0EA5E9,color:#fff

    class start trigger
    class step1 agent
    class step2 manual
    class step3 external
    class step4 decision
    class step5 foreach
    class step6 join
    class step7 flow
    class step8 code

    %% @step(step1): {"additionalInstructions":"Analyze the document for key themes."}
    %% @step(step3): {"externalConfig":{"endpoint":"https://api.example.com","method":"POST"}}
    %% @step(step5): {"itemsPath":"items","itemVariable":"item","maxItems":50}
    %% @step(step6): {"awaitStepId":"step5","joinBoundary":{"minPercent":90}}
\`\`\`

### Shape-to-Type Mapping

| Step Type | Mermaid Shape | Example |
|-----------|---------------|---------|
| trigger | \`>"label"]\` | \`start>"Start"]\` |
| agent | \`["label"]\` | \`step1["AI Review"]\` |
| manual | \`("label")\` | \`step2("Human Review")\` |
| external | \`{{"label"}}\` | \`step3{{"API Call"}}\` |
| webhook | \`{{"label"}}\` | \`step3{{"Notify"}}\` |
| decision | \`{"label"}\` | \`step4{"Is Valid?"}\` |
| foreach | \`[["Each: label"]]\` | \`step5[["Each: Process"]]\` |
| join | \`[["Join: label"]]\` | \`step6[["Join: Aggregate"]]\` |
| flow | \`[["Run: label"]]\` | \`step7[["Run: Subprocess"]]\` |
| code | \`[/"label"/]\` | \`step8[/"Transform"/]\` |

**Important Mermaid Rules:**
1. Always quote labels with double quotes: \`["Label"]\` not \`[Label]\`
2. Never use inline \`style\` statements - use classDef and class
3. Include ALL classDef declarations for step types you use
4. Use \`%% @step(id): {json}\` comments for step configuration
5. Decision branch labels must be quoted: \`-->|"Label"|\`
6. Node shapes carry semantic meaning - use the correct shape for each type`;

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
  let prompt = `# Multi-Workflow JSON Editor Guide for Coordination Matrix

You are editing multiple workflows in JSON format. This is the canonical format for workflow import/export.

## Multi-Workflow JSON Format

The multi-workflow format wraps workflows in an array:

\`\`\`json
{
  "version": "1.0",
  "workflows": [
    {
      "_id": "existing_workflow_id",
      "name": "First Workflow Name",
      "description": "What this workflow does",
      "isActive": true,
      "rootTaskTitleTemplate": "{{input.title}}",
      "steps": [
        {
          "id": "start",
          "name": "Start",
          "stepType": "trigger",
          "connections": [{ "targetStepId": "step1" }]
        },
        {
          "id": "step1",
          "name": "AI Task",
          "stepType": "agent",
          "additionalInstructions": "Instructions here",
          "connections": [{ "targetStepId": "step2" }]
        },
        {
          "id": "step2",
          "name": "Manual Review",
          "stepType": "manual"
        }
      ]
    },
    {
      "name": "Second Workflow Name",
      "description": "Description of second workflow",
      "isActive": true,
      "steps": [
        {
          "id": "stepA",
          "name": "Process",
          "stepType": "agent",
          "connections": [{ "targetStepId": "stepB" }]
        },
        {
          "id": "stepB",
          "name": "Decision?",
          "stepType": "decision",
          "connections": [
            { "targetStepId": "stepC", "condition": "result:success", "label": "Yes" }
          ]
        },
        {
          "id": "stepC",
          "name": "Transform",
          "stepType": "code",
          "codeConfig": {
            "code": "return { result: input.value * 2 };"
          }
        }
      ]
    }
  ]
}
\`\`\`

## Workflow Fields

| Field | Required | Description |
|-------|----------|-------------|
| \`_id\` | No | Include to UPDATE an existing workflow, omit to CREATE new |
| \`name\` | Yes | Workflow display name |
| \`description\` | No | Workflow description |
| \`isActive\` | No | Whether workflow is active (default: true) |
| \`rootTaskTitleTemplate\` | No | Dynamic title using \`{{input.field}}\` |
| \`steps\` | Yes | Array of step objects |

## Step Types (11 Types)

| Step Type | Execution | Description |
|-----------|-----------|-------------|
| trigger | immediate | Entry point / workflow start |
| agent | automated | AI-powered automated task |
| manual | manual | Human-in-the-loop task |
| external | callback | External API with callback |
| webhook | automated | Outbound HTTP (no callback) |
| decision | immediate | Conditional routing |
| foreach | immediate | Fan-out iteration |
| join | immediate | Fan-in synchronization |
| flow | automated | Nested workflow |
| code | automated | JavaScript code execution |
| findDocument | automated | Semantic document search |

## Step Configuration Examples

### Agent/Manual Step
\`\`\`json
{
  "id": "analyze",
  "name": "Analyze Data",
  "stepType": "agent",
  "additionalInstructions": "Extract key metrics from the data",
  "defaultAssigneeId": "agent_id_here"
}
\`\`\`

### Code Step
\`\`\`json
{
  "id": "transform",
  "name": "Process Results",
  "stepType": "code",
  "codeConfig": {
    "code": "return { summary: input.metrics.join(', ') };",
    "packages": ["lodash"]
  }
}
\`\`\`

### Decision Step
\`\`\`json
{
  "id": "route",
  "name": "Is Valid?",
  "stepType": "decision",
  "connections": [
    { "targetStepId": "pass", "condition": "status:valid", "label": "Yes" },
    { "targetStepId": "fail", "condition": "status:invalid", "label": "No" }
  ],
  "defaultConnection": "fail"
}
\`\`\`

### ForEach + Join Pattern
\`\`\`json
{
  "id": "processItems",
  "name": "Process Each Item",
  "stepType": "foreach",
  "itemsPath": "data.records",
  "itemVariable": "record",
  "maxItems": 50,
  "connections": [{ "targetStepId": "handleItem" }]
},
{
  "id": "aggregate",
  "name": "Aggregate Results",
  "stepType": "join",
  "awaitStepId": "processItems",
  "joinBoundary": { "minPercent": 90 }
}
\`\`\`

## Template Variables

**Input Payload:**
- \`{{input.field}}\` - Values from input/previous step output
- \`{{fieldName}}\` - Direct lookup (shorthand)
- \`{{trigger.payload.field}}\` - Original trigger payload

**ForEach Loop:**
- \`{{item}}\` or \`{{_item}}\` - Current item
- \`{{_index}}\` - Zero-based index
- \`{{_total}}\` - Total count

**External/Webhook:**
- \`{{callbackUrl}}\` - Callback URL for external services
- \`{{callbackSecret}}\` - Secret for callback auth

**Variable Packages:**
- \`{{variables.name}}\` - Stored credentials/config
- \`{{variables.config.path}}\` - Nested access

**System:**
- \`{{workflowRunId}}\`, \`{{stepId}}\`, \`{{taskId}}\` - Current IDs
- \`{{_apiUrl}}\`, \`{{_apiKey}}\` - API access

## Creating vs Updating Workflows

- To **update** an existing workflow: Include \`_id\` field with the workflow ID
- To **create** a new workflow: Omit the \`_id\` field

## Import API

\`\`\`http
POST /api/workflows/import-multi
Content-Type: application/json

{
  "workflows": [...],
  "dryRun": true
}
\`\`\`

Use \`dryRun: true\` to preview changes without applying them.

## Step Configuration Reference

**Agent/Manual:** additionalInstructions, defaultAssigneeId, promptDocumentIds
**External:** externalConfig: {endpoint, method, headers, payloadTemplate, responseMapping}
**Webhook:** webhookConfig: {url, method, headers, bodyTemplate, maxRetries}
**Decision:** connections: [{targetStepId, condition, label}], defaultConnection
**ForEach:** itemsPath, itemVariable, maxItems, expectedCountPath, connections
**Join:** awaitStepId, joinBoundary: {minPercent, maxWaitMs, failOnTimeout}
**Flow:** flowId, inputMapping: {"field": "{{input.value}}"}
**Code:** codeConfig: {code, packages, timeout, outputSchema}
**FindDocument:** findDocumentConfig: {mode, searchPrompt, documentTypes, limit}`;

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
