---
capabilityId: delegation-patterns
title: Delegation Patterns
complexity: 3
tags: [capability, delegation, advanced, escalation]
summary: Patterns for task continuation, escalation, and workflow recommendations.
---

# Delegation Patterns

This capability covers patterns for handling work that exceeds a single task's scope.

## Available Actions for Delegation

| Action | Task Status | What Happens |
|--------|-------------|--------------|
| COMPLETE | completed | Task done. Workflow advances if in a workflow. |
| CONTINUE | completed | Task done, a follow-up task is created with your reason as its prompt. |
| ESCALATE | on_hold | Task paused, unassigned. Human reviews your recommendation. |
| HOLD | on_hold | Task paused, unassigned. Waiting for external condition. |

## When to Use Each

| Situation | Recommended Action |
|-----------|-------------------|
| Work fits in single response | COMPLETE |
| Work partially done, need another pass | CONTINUE with clear next-step reason |
| Need human decision or judgment | ESCALATE with options |
| Need specialized agent or different approach | ESCALATE with recommendation |
| Identified a repeatable process | ESCALATE, recommend workflow creation |
| Blocked on external system | HOLD with clear reason |

## CONTINUE: Follow-Up Tasks

When you use CONTINUE, the daemon creates a follow-up task:
- Title: "Follow-up: {original title}"
- Prompt: Your `nextActionReason` becomes the new task's instructions
- Context: Your `output` is passed as `previousOutput` to the follow-up
- Assignee: Same agent as the original task

```json
{
  "status": "PARTIAL",
  "summary": "Completed first phase, need additional processing",
  "output": {
    "phase1Results": { "itemsProcessed": 50, "remaining": 150 }
  },
  "nextAction": "CONTINUE",
  "nextActionReason": "Process the remaining 150 items using the same approach. Phase 1 results are in previousOutput."
}
```

## ESCALATE: Human Decision Required

Provide rich context so the human can act quickly:

```json
{
  "status": "BLOCKED",
  "summary": "Need human decision on approach",
  "output": {
    "options": [
      { "name": "Option A", "pros": ["Fast"], "cons": ["Risky"] },
      { "name": "Option B", "pros": ["Safe"], "cons": ["Slow"] }
    ],
    "recommendation": "Option B",
    "reasoning": "Given the production context, safety is more important than speed."
  },
  "nextAction": "ESCALATE",
  "nextActionReason": "Architectural decision required - two valid approaches identified"
}
```

## Recommending Workflow Creation

When you identify a recurring pattern that should be a workflow:

```json
{
  "status": "SUCCESS",
  "summary": "Completed task, identified workflow opportunity",
  "output": { "result": "..." },
  "nextAction": "ESCALATE",
  "nextActionReason": "This process would benefit from a structured workflow",
  "metadata": {
    "workflowRecommendation": {
      "name": "Customer Onboarding",
      "reason": "This 5-step process repeats frequently",
      "suggestedSteps": [
        "Validate customer data",
        "Create accounts",
        "Send welcome email",
        "Schedule kickoff",
        "Assign account manager"
      ]
    }
  }
}
```

## Workflow Context Rules

Your behavior differs based on whether you're in a workflow:

**In a workflow** (task has `workflowStage`):
- Complete your assigned step, use COMPLETE
- The workflow engine handles what's next
- Use ESCALATE if something unexpected occurs
- Do NOT try to redesign the flow mid-execution

**Ad-hoc task** (no `workflowStage`):
- More autonomy in how you approach the work
- CONTINUE to create follow-up tasks for multi-step work
- ESCALATE to recommend workflows for repeatable patterns

## Anti-Patterns to Avoid

1. **Premature escalation** - Complete what you can before escalating
2. **Vague escalations** - Always explain why AND provide options/recommendations
3. **CONTINUE loops** - If you've continued 3+ times, consider ESCALATE instead
4. **Workflow bypass** - Don't use CONTINUE to work around workflow structure
