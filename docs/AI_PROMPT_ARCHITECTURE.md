# AI Prompt Architecture & Pipeline Automation

This document explores options for structuring AI prompts and automating task progression through workflows.

## Current State

### Existing Prompt Fields
- **`extraPrompt`** (Task): Primary instruction field for AI tasks
- **`summary`** (Task): Short task description used as context
- **`additionalInfo`** (Task): Context storage, also receives AI responses

### Current Daemon Behavior
The task daemon builds prompts by:
1. Using `extraPrompt` as the main instruction (if present)
2. Appending task context (title, summary, tags, additionalInfo)
3. Executing Claude and storing results in `additionalInfo`

---

## Proposed Architecture

### 1. Prompt Layering System

We propose a **layered prompt architecture** where prompts are assembled from multiple sources:

```
┌─────────────────────────────────────────────────────────────┐
│                    ASSEMBLED PROMPT                          │
├─────────────────────────────────────────────────────────────┤
│  1. Base Daemon Prompt (system-level)                       │
│     - Ensures parsable output format                        │
│     - Defines response structure                            │
│                                                             │
│  2. Agent Prompt (user-level)                               │
│     - Agent's role, capabilities, constraints               │
│     - Persona and behavior guidelines                       │
│                                                             │
│  3. Workflow Step Prompt (workflow-level)                   │
│     - Step-specific instructions                            │
│     - Expected outputs for this stage                       │
│                                                             │
│  4. Task Prompt (task-level)                                │
│     - extraPrompt: specific instructions                    │
│     - Task context: title, summary, tags, additionalInfo    │
└─────────────────────────────────────────────────────────────┘
```

### 2. Base Daemon Prompt

**Purpose:** Ensure consistent, parsable responses that can be saved automatically.

**Proposed Structure:**
```markdown
You are a task automation agent. Your response MUST follow this exact format:

## Status
[SUCCESS | PARTIAL | BLOCKED | FAILED]

## Summary
[1-2 sentence summary of what was accomplished]

## Output
[Main response content - the actual work product]

## Next Action
[COMPLETE | CONTINUE | ESCALATE | HOLD]
- If CONTINUE: Describe what the next task should be
- If ESCALATE: Explain why human intervention is needed
- If HOLD: Specify what you're waiting for

## Metadata
```json
{
  "confidence": 0.0-1.0,
  "tokens_used": number,
  "suggested_tags": ["tag1", "tag2"],
  "suggested_next_stage": "stage_name" | null
}
```
```

**Benefits:**
- Daemon can parse status and determine task state
- Auto-advance workflows based on `suggested_next_stage`
- Track confidence for human review thresholds
- Structured data for analytics

---

### 3. Agent Users (Role + Prompt)

**Schema Changes:**
```typescript
interface User {
  // ... existing fields ...
  isAgent: boolean;           // NEW: Is this user an AI agent?
  agentPrompt?: string;       // NEW: Agent's base prompt/persona
}
```

**UI Changes:**
- Add "Is Agent" checkbox in user form
- Show `agentPrompt` textarea when `isAgent` is checked
- Agent users can be assigned to tasks like regular users

**Use Cases:**
- Different agents for different domains (code review, documentation, testing)
- Agent personas with specific expertise or constraints
- Easy to swap agents on workflows

---

### 4. Workflow Step Prompts

**Schema Changes:**
```typescript
interface WorkflowStep {
  id: string;
  name: string;
  type: 'automated' | 'manual';
  hitlPhase: string;
  description?: string;
  config?: Record<string, unknown>;
  prompt?: string;              // NEW: Step-specific prompt
}
```

**Mermaid Integration Options:**

#### Option A: Store in Node Config (Hidden from Diagram)
```
graph TD
    A[Review Code]:::automated
    B(Human Approval):::manual
```
- Prompts stored in workflow `steps[]` array, not in mermaid
- Mermaid diagram remains clean and readable
- **Recommended approach**

#### Option B: Mermaid Comments (Exportable but Verbose)
```
graph TD
    %% prompt:A: Review the code for security issues
    A[Review Code]:::automated
    %% prompt:B: Approve or reject the changes
    B(Human Approval):::manual
```
- Prompts embedded as comments
- Exports with diagram but clutters the mermaid
- Requires custom parser

#### Option C: Mermaid Subgraph Descriptions
```
graph TD
    subgraph A_config[" "]
        A_prompt["prompt: Review code"]
    end
    A[Review Code]
```
- Very verbose, not recommended

**Recommendation:** Use **Option A** - keep prompts in the workflow JSON, export/import them alongside the mermaid but separately.

---

## Task Pipeline Automation

### How Should Tasks Move Forward?

#### Option 1: Daemon-Driven Progression
The daemon (running for an agent) handles all movement:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Pending    │───▶│ In Progress │───▶│  Completed  │
└─────────────┘    └─────────────┘    └─────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Create Next Task   │
              │  (if workflow step) │
              └─────────────────────┘
```

**Flow:**
1. Daemon picks up task from view (filtered by status, assignee, etc.)
2. Assembles prompt: base + agent + workflow step + task
3. Executes and parses response
4. Based on response `Next Action`:
   - `COMPLETE`: Mark done, optionally create next workflow task
   - `CONTINUE`: Create follow-up task with context
   - `ESCALATE`: Set to `on_hold`, notify human
   - `HOLD`: Set to `on_hold` with reason

**Pros:**
- Simple daemon logic
- Clear ownership (agent owns the view)
- Easy to debug

**Cons:**
- Requires daemon to understand workflow structure
- Manual next-task creation logic

---

#### Option 2: Workflow Engine (Centralized)
A separate workflow engine manages task creation and progression:

```
┌──────────────────┐
│  Workflow Engine │
├──────────────────┤
│ - Task created   │
│ - On completion  │
│   ▶ Check workflow │
│   ▶ Create next task │
│   ▶ Assign to agent │
└──────────────────┘
```

**Flow:**
1. When task completes, webhook/trigger fires
2. Workflow engine looks up workflow step
3. Creates next task(s) based on workflow definition
4. Assigns to appropriate agent/user

**Pros:**
- Centralized workflow logic
- Daemon stays simple (just execute tasks)
- Supports complex branching

**Cons:**
- More infrastructure
- Additional service to maintain

---

#### Option 3: Task-Creates-Task (Self-Propagating)
AI response includes next task definition:

```json
{
  "next_action": "CONTINUE",
  "next_task": {
    "title": "Deploy to staging",
    "workflowStage": "deploy",
    "extraPrompt": "Deploy the reviewed code to staging environment"
  }
}
```

**Flow:**
1. AI completes task, suggests next task in response
2. Daemon parses response and creates next task
3. New task inherits workflow, parent reference

**Pros:**
- AI can make intelligent decisions about next steps
- Flexible, adapts to context
- No separate workflow engine needed

**Cons:**
- AI might hallucinate wrong next steps
- Need validation against workflow definition
- Less predictable

---

### Recommendation: Hybrid Approach

Combine **Option 1 (Daemon-Driven)** with **Option 3 (Task-Creates-Task)** validation:

1. **Daemon assembles prompt** with workflow context
2. **AI response includes** suggested next action and stage
3. **Daemon validates** against workflow definition
4. **If valid**, create next task and assign to workflow's designated agent
5. **If invalid**, fall back to workflow default or set to `on_hold`

```typescript
// Pseudo-code for daemon task completion
async function completeTask(task, response) {
  const parsed = parseAIResponse(response);

  if (parsed.nextAction === 'COMPLETE' && task.workflowId) {
    const workflow = await getWorkflow(task.workflowId);
    const currentStep = workflow.steps.find(s => s.id === task.workflowStage);
    const nextStep = getNextStep(workflow, currentStep, parsed.suggestedNextStage);

    if (nextStep) {
      await createTask({
        title: `${workflow.name}: ${nextStep.name}`,
        workflowId: task.workflowId,
        workflowStage: nextStep.id,
        parentId: task._id,
        extraPrompt: nextStep.prompt,  // Step prompt becomes task prompt
        assigneeId: nextStep.defaultAssignee,
        additionalInfo: parsed.output,  // Carry forward context
      });
    }
  }

  await updateTask(task._id, { status: 'completed' });
}
```

---

## Prompt Assembly Order

When the daemon processes a task:

```typescript
function assemblePrompt(task, agent, workflowStep) {
  const parts = [];

  // 1. Base daemon prompt (ensures parsable output)
  parts.push(BASE_DAEMON_PROMPT);

  // 2. Agent prompt (persona, capabilities)
  if (agent?.agentPrompt) {
    parts.push(`## Agent Context\n${agent.agentPrompt}`);
  }

  // 3. Workflow step prompt (stage-specific instructions)
  if (workflowStep?.prompt) {
    parts.push(`## Workflow Step: ${workflowStep.name}\n${workflowStep.prompt}`);
  }

  // 4. Task-specific prompt
  if (task.extraPrompt) {
    parts.push(`## Task Instructions\n${task.extraPrompt}`);
  }

  // 5. Task context
  parts.push(`## Task Context
**Title:** ${task.title}
**Summary:** ${task.summary || 'N/A'}
**Tags:** ${task.tags?.join(', ') || 'None'}
**Additional Info:** ${task.additionalInfo || 'None'}`);

  return parts.join('\n\n---\n\n');
}
```

---

## Export/Import Format

For workflow export with prompts (separate from mermaid diagram):

```json
{
  "workflow": {
    "name": "Code Review Pipeline",
    "description": "Automated code review workflow",
    "mermaidDiagram": "graph TD\n  A[Lint Check] --> B[Security Scan] --> C(Human Review)",
    "steps": [
      {
        "id": "lint",
        "name": "Lint Check",
        "type": "automated",
        "hitlPhase": "automated",
        "prompt": "Run linting on the code and report any issues found. Focus on code style and potential bugs."
      },
      {
        "id": "security",
        "name": "Security Scan",
        "type": "automated",
        "hitlPhase": "automated",
        "prompt": "Scan the code for security vulnerabilities. Check for SQL injection, XSS, and other OWASP top 10 issues."
      },
      {
        "id": "human_review",
        "name": "Human Review",
        "type": "manual",
        "hitlPhase": "review",
        "prompt": "Review the automated findings and make final approval decision."
      }
    ]
  },
  "exportVersion": "1.0",
  "exportedAt": "2025-01-15T10:00:00Z"
}
```

---

## Questions for Discussion

1. **Response Format Strictness:** How strict should the base prompt be? Should we require JSON-only responses, or allow markdown with structured sections?

2. **Agent Assignment:** Should workflows define default agents per step, or should this be configured separately?

3. **Branching Logic:** How should the daemon handle workflow decision points (diamonds in mermaid)?

4. **Context Carry-Forward:** How much context should flow from task to task? All additionalInfo, or summarized?

5. **Human-in-the-Loop:** When a task is `ESCALATE`d, what notification mechanism should trigger?

6. **Failure Handling:** If an agent fails repeatedly on a step, should there be automatic reassignment or workflow pause?

---

## Next Steps

1. [ ] Finalize base daemon prompt format
2. [ ] Add `isAgent` and `agentPrompt` to User schema
3. [ ] Add `prompt` to WorkflowStep schema
4. [ ] Update daemon to assemble layered prompts
5. [ ] Add workflow step prompt editor to UI
6. [ ] Implement export/import with prompts
7. [ ] Add task auto-creation on workflow progression
