---
capabilityId: create-workflow
title: Create Workflow
complexity: 3
tags: [capability, workflow, creation, advanced]
summary: Create and import workflow definitions via the API.
source: docs/ai-workflow-generation.md
---

<!-- This capability wraps the full workflow generation guide.
     Source of truth: docs/ai-workflow-generation.md
     When that file is updated, re-run migrate-capabilities.mjs to sync. -->

# Creating Workflows

You can create workflows by posting JSON to the workflows API. Include a
`documentOperations` array with action `create-workflow`, or the daemon can
process workflow JSON in your output.

## How to Create a Workflow

Include workflow JSON in your output and use ESCALATE to have a human review,
or use the API directly via document operations:

```json
{
  "status": "SUCCESS",
  "summary": "Designed workflow for recurring process",
  "output": {
    "workflow": {
      "name": "Customer Onboarding",
      "description": "5-step onboarding process for new customers",
      "steps": [
        {
          "id": "validate",
          "name": "Validate Customer Data",
          "stepType": "agent",
          "additionalInstructions": "Verify all required fields are present and valid."
        },
        {
          "id": "create-accounts",
          "name": "Create Accounts",
          "stepType": "agent",
          "additionalInstructions": "Provision accounts in all required systems."
        },
        {
          "id": "review",
          "name": "Human Review",
          "stepType": "manual",
          "additionalInstructions": "Verify accounts were created correctly."
        },
        {
          "id": "welcome",
          "name": "Send Welcome Email",
          "stepType": "webhook",
          "webhookConfig": {
            "url": "https://api.email.example.com/send",
            "method": "POST",
            "bodyTemplate": "{\"to\": \"{{input.email}}\", \"template\": \"welcome\"}"
          }
        },
        {
          "id": "assign",
          "name": "Assign Account Manager",
          "stepType": "manual",
          "additionalInstructions": "Assign an account manager to the new customer."
        }
      ]
    }
  },
  "nextAction": "ESCALATE",
  "nextActionReason": "Workflow design ready for review before creation"
}
```

## Minimal Workflow Format

Only `name` and `steps` are required:

```json
{
  "name": "Workflow Name",
  "steps": [
    {
      "id": "step1",
      "name": "Step Name",
      "stepType": "agent"
    }
  ]
}
```

## Step Types Reference

| Step Type | Execution Mode | Use Case |
|-----------|---------------|----------|
| `trigger` | immediate | Entry point / workflow start |
| `agent` | automated | AI-powered tasks |
| `manual` | manual | Human-in-the-loop tasks |
| `external` | external_callback | External API with callback |
| `webhook` | automated | Outbound HTTP (no callback) |
| `decision` | immediate | Conditional routing |
| `foreach` | immediate | Fan-out iteration |
| `join` | immediate | Fan-in synchronization |
| `flow` | automated | Nested workflow |
| `code` | automated | JavaScript code execution |
| `findDocument` | automated | Semantic document search |

### Agent Step

AI-powered automated task:

```json
{
  "id": "analyze",
  "name": "Analyze Document",
  "stepType": "agent",
  "additionalInstructions": "Extract key themes and summarize.",
  "defaultAssigneeId": "agent-user-id"
}
```

### Manual Step

Human-in-the-loop task:

```json
{
  "id": "approve",
  "name": "Manager Approval",
  "stepType": "manual",
  "additionalInstructions": "Review the analysis and approve or reject."
}
```

### Decision Step

Conditional routing:

```json
{
  "id": "route",
  "name": "Route by Priority",
  "stepType": "decision",
  "decisionField": "priority",
  "connections": [
    { "targetStepId": "urgent", "condition": "priority:urgent,high", "label": "Urgent" },
    { "targetStepId": "normal", "condition": "priority:medium", "label": "Normal" }
  ],
  "defaultConnection": "lowPriority"
}
```

Condition syntax: `field:value`, `field:value1,value2`, `field:>10`

### Webhook Step

Outbound HTTP call:

```json
{
  "id": "notify",
  "name": "Send Notification",
  "stepType": "webhook",
  "webhookConfig": {
    "url": "https://hooks.slack.com/xxx",
    "method": "POST",
    "bodyTemplate": "{\"text\": \"Task completed: {{input.title}}\"}"
  }
}
```

### ForEach / Join Steps

Fan-out and fan-in for parallel processing:

```json
{
  "id": "foreach",
  "name": "Process Each Item",
  "stepType": "foreach",
  "itemsPath": "items",
  "itemVariable": "item",
  "maxItems": 50,
  "connections": [{ "targetStepId": "processItem" }]
}
```

```json
{
  "id": "waitAll",
  "name": "Aggregate Results",
  "stepType": "join",
  "awaitStepId": "foreach",
  "minSuccessPercent": 90
}
```

### Code Step

Execute JavaScript in a sandboxed environment:

```json
{
  "id": "transform",
  "name": "Transform Data",
  "stepType": "code",
  "codeConfig": {
    "code": "const results = input.items.map(i => ({ name: i.name.toUpperCase() })); return { processed: results };",
    "packages": ["lodash"],
    "timeout": 30000
  }
}
```

### FindDocument Step

Semantic document search:

```json
{
  "id": "findContext",
  "name": "Find Related Docs",
  "stepType": "findDocument",
  "findDocumentConfig": {
    "mode": "dynamic",
    "searchPrompt": "Find documentation about {{input.topic}}",
    "documentTypes": ["reference", "sop"],
    "limit": 3,
    "minScore": 0.5,
    "storeAs": "contextDocs"
  }
}
```

### Flow Step (Nested Workflow)

```json
{
  "id": "runSub",
  "name": "Run Validation Workflow",
  "stepType": "flow",
  "flowId": "existing-workflow-id",
  "inputMapping": {
    "document": "{{input.content}}"
  }
}
```

## Template Variables

Use `{{variable}}` syntax in instructions, URLs, and payloads:

| Variable | Description |
|----------|-------------|
| `{{input.path}}` | Access input payload |
| `{{trigger.payload.path}}` | Original trigger data |
| `{{item}}` / `{{_index}}` / `{{_total}}` | ForEach context |
| `{{callbackUrl}}` | System callback URL (external steps) |
| `{{workflowRunId}}` | Current run ID |

## Connections and Flow Control

**Linear flow** (default): Steps run in order if no `connections` specified.

**Explicit connections**: Use `connections` array to skip or branch:

```json
{
  "connections": [
    { "targetStepId": "stepC", "label": "Skip to C" }
  ]
}
```

## Common Patterns

### Linear Pipeline
agent → manual → agent → manual

### Fan-out/Fan-in
prepare → foreach → [process each] → join → report

### Conditional Routing
analyze → decision → (path A | path B | path C)

### Human-in-the-Loop
agent draft → manual review → agent revise → manual approve

## Validation Rules

1. Every step must have: `id`, `name`, `stepType`
2. Decision steps must have `connections` with at least one entry
3. ForEach needs `itemsPath` or expects external callback
4. Join needs `awaitStepId` pointing to a foreach step
5. Use descriptive step IDs: `analyzeDocument` not `step1`

## API Endpoints

```
POST /api/workflows                    - Create workflow
POST /api/workflows/import-multi       - Import multiple workflows
GET  /api/workflows/export-multi       - Export workflows as JSON
```

Import supports `dryRun: true` for validation.
