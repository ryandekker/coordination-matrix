---
capabilityId: task-routing
title: Task Routing
complexity: 2
tags: [capability, routing, assignment, workflows]
summary: Route tasks by assigning agents, triggering workflows, or adding tags.
---

# Task Routing

Include a `routingOperations` array in your response to route tasks to agents, trigger workflows, or categorize with tags.
The system processes these operations after your response — you declare intent, the system executes.

## 1. Assign to Agent

Reassign the current task to a different agent or user by ID:

```json
{
  "routingOperations": [
    {
      "action": "assign",
      "assigneeId": "694a349fc38f94e454f76a88"
    }
  ]
}
```

## 2. Trigger Workflow

Start a workflow run, passing context from the current task:

```json
{
  "routingOperations": [
    {
      "action": "triggerWorkflow",
      "workflowId": "696682ae9e695ebeecb8042f",
      "input": {
        "title": "Document to create",
        "contentPrompt": "Write a blog post about..."
      }
    }
  ]
}
```

The workflow receives the task's title, summary, tags, and inputPayload automatically. The `input` field merges additional data.

## 3. Add Tags

Add classification or routing tags to the task:

```json
{
  "routingOperations": [
    {
      "action": "addTags",
      "tags": ["content-request", "high-priority"]
    }
  ]
}
```

## Combining Operations

You can combine multiple operations in a single response. They execute in order:

```json
{
  "status": "SUCCESS",
  "summary": "Routed content request to document creation workflow",
  "output": {
    "classification": "content-creation",
    "reasoning": "Task asks for a blog post, routing to content workflow"
  },
  "nextAction": "COMPLETE",
  "routingOperations": [
    { "action": "addTags", "tags": ["content-request"] },
    { "action": "triggerWorkflow", "workflowId": "696682ae9e695ebeecb8042f", "input": { "contentPrompt": "..." } }
  ]
}
```

## Available Agents

Reference agents by their ID when using the `assign` action.
Agents and their capabilities are configured in the system — use `REQUEST_DOCS` if you need the current list.

## Available Workflows

Reference workflows by their ID when using `triggerWorkflow`.
Workflow IDs should be provided in your agent prompt or task context.

## Best Practices

1. **Classify first, route second** — Understand what the task is before deciding where it goes
2. **Add tags for traceability** — Tag tasks with their classification so routing patterns are visible
3. **Provide reasoning** — Put your routing rationale in the output field
4. **Use ESCALATE for ambiguous tasks** — If you can't determine the right route, escalate to a human
5. **Don't over-route** — Simple tasks that are already assigned correctly don't need rerouting
