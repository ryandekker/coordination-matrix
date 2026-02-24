---
capabilityId: ask-questions
title: Ask Questions
complexity: 1
tags: [capability, questions, human-input]
summary: Ask structured questions to humans when you need input to proceed.
---

# Asking Questions

When you need human input to proceed, use `nextAction: "ASK"` with a `questions` array.
The task will be placed on hold and the human can answer questions through the UI.

## Question Types

### 1. Text Input
```json
{
  "id": "user-input",
  "type": "text",
  "question": "What should the title be?",
  "description": "Optional longer explanation shown below the question",
  "required": true,
  "placeholder": "Enter title here...",
  "defaultValue": "Default text",
  "validation": {
    "minLength": 1,
    "maxLength": 500,
    "pattern": "^[A-Za-z].*"
  }
}
```

### 2. Choice (Single Select)
```json
{
  "id": "environment",
  "type": "choice",
  "question": "Select deployment environment",
  "required": true,
  "options": [
    { "value": "dev", "label": "Development", "description": "For testing" },
    { "value": "staging", "label": "Staging", "description": "Pre-production" },
    { "value": "production", "label": "Production", "description": "Live environment" }
  ],
  "defaultValue": "staging"
}
```

### 3. Multiselect (Multiple Choices)
```json
{
  "id": "features",
  "type": "multiselect",
  "question": "Which features should be enabled?",
  "required": true,
  "options": [
    { "value": "auth", "label": "Authentication" },
    { "value": "logging", "label": "Logging" },
    { "value": "metrics", "label": "Metrics" }
  ],
  "defaultValue": ["logging"]
}
```

### 4. Confirm (Boolean)
```json
{
  "id": "proceed",
  "type": "confirm",
  "question": "Should I proceed with the deployment?",
  "description": "This will update the production database",
  "defaultValue": false
}
```

### 5. Number Input
```json
{
  "id": "batch-size",
  "type": "number",
  "question": "How many items per batch?",
  "required": true,
  "placeholder": "Enter a number",
  "defaultValue": 100,
  "validation": {
    "min": 1,
    "max": 1000
  }
}
```

## Complete Response Example

```json
{
  "status": "BLOCKED",
  "summary": "Need user input to continue",
  "output": { "partialWork": "..." },
  "nextAction": "ASK",
  "nextActionReason": "Cannot proceed without configuration details",
  "questions": [
    {
      "id": "target-env",
      "type": "choice",
      "question": "Which environment should this deploy to?",
      "required": true,
      "options": [
        { "value": "staging", "label": "Staging" },
        { "value": "production", "label": "Production" }
      ]
    },
    {
      "id": "notify-team",
      "type": "confirm",
      "question": "Notify the team after deployment?",
      "defaultValue": true
    }
  ],
  "context": "The task mentions deployment but doesn't specify the target environment."
}
```

## Validation Options

| Type | Validation Fields |
|------|------------------|
| text | minLength, maxLength, pattern (regex) |
| number | min, max |
| choice | (validated against options) |
| multiselect | (validated against options) |
| confirm | (none needed) |

## Best Practices

1. **Group related questions** - Ask all related questions at once
2. **Provide context** - Use `context` field to explain the situation
3. **Use descriptions** - Help users understand complex options
4. **Set sensible defaults** - Reduce friction for common choices
5. **Validate appropriately** - Don't over-constrain inputs
6. **Keep it minimal** - Only ask what you truly need
