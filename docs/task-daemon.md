# Task Daemon

The Task Daemon is a polling-based agent that processes tasks from saved views (queues). It works with any remote API endpoint, uses API key authentication, and executes Claude or custom commands to process tasks.

## Quick Start

```bash
# Run once against a specific view
node scripts/task-daemon.mjs --view <viewId> --api-key <key> --once

# Run with a config file
node scripts/task-daemon.mjs --config scripts/daemon-jobs.yaml --job claude-haiku

# List available jobs
node scripts/task-daemon.mjs --config scripts/daemon-jobs.yaml --list
```

## How It Works

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────────┐
│  Saved View     │◄─────│  Task Daemon │─────►│  Claude CLI     │
│  (task queue)   │ poll │  (polling)   │ exec │  (or custom)    │
└─────────────────┘      └──────────────┘      └─────────────────┘
        │                       │                      │
        │                       │                      │
        ▼                       ▼                      ▼
   Filter: status,        Assembles prompt:      Returns JSON:
   assignee, tags         base + agent +         status, summary,
                          workflow + task        output, nextAction
```

1. **Poll View**: Fetches the next task from a saved view (filter by status, assignee, tags)
2. **Assemble Prompt**: Layers base daemon prompt + agent prompt + workflow step + task context
3. **Execute**: Runs Claude CLI (or custom command) with the assembled prompt
4. **Parse Response**: Expects structured JSON with status, summary, output, nextAction
5. **Update Task**: Sets status based on nextAction (COMPLETE, CONTINUE, ESCALATE, HOLD)
6. **Workflow Transition**: Creates next step task if part of a workflow

## Configuration

### YAML Config File

Create `daemon-jobs.yaml`:

```yaml
# Default settings for all jobs
defaults:
  apiUrl: https://your-api.example.com/api
  apiKey: cm_ak_live_xxxxx  # or use MATRIX_API_KEY env var
  interval: 5000            # polling interval (ms)
  exec: claude              # default command

# Define processing jobs
jobs:
  content-review:
    description: Review content tasks
    viewId: 694c66a8c5a45a2792a77f86
    exec: "claude --model claude-sonnet-4-20250514"

  fast-triage:
    description: Quick triage with Haiku
    viewId: 694c669ac5a45a2792a77f85
    exec: "claude --model haiku"
    interval: 3000

  code-analysis:
    description: Complex code tasks with Opus
    viewId: abc123def456
    exec: "claude --model opus"
    interval: 10000

  disabled-job:
    enabled: false
    description: This job won't run
    viewId: xyz789
```

### CLI Options

```bash
node scripts/task-daemon.mjs [options]

Options:
  --config, -c <file>   Load configuration from YAML file
  --job, -j <name>      Run a specific job from config
  --list, -l            List available jobs from config
  --view, -v <id>       View ID to poll (if not using config)
  --api-key, -k <key>   API key (or MATRIX_API_KEY env)
  --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
  --interval, -i <ms>   Polling interval (default: 5000)
  --once, -o            Run once and exit (don't poll)
  --exec, -e <cmd>      Command to execute (default: "claude")
  --dry-run, -d         Don't execute, just show prompt
  --no-update, -n       Don't update task status
  --help, -h            Show help
```

### Environment Variables

```bash
export MATRIX_API_KEY=cm_ak_live_xxxxx
export MATRIX_API_URL=https://your-api.example.com/api
export MATRIX_VIEW_ID=your-default-view-id
export MATRIX_EXEC_CMD=claude
```

## Prompt Assembly

The daemon assembles prompts from multiple layers:

### 1. Base Daemon Prompt

Forces structured JSON output:

```
You are a task automation agent. You MUST respond with valid JSON only.

Response schema:
{
  "status": "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED",
  "summary": "1-2 sentence summary",
  "output": { /* structured result */ },
  "nextAction": "COMPLETE" | "CONTINUE" | "ESCALATE" | "HOLD",
  "nextActionReason": "optional reason",
  "metadata": {
    "confidence": 0.0-1.0,
    "suggestedTags": [],
    "suggestedNextStage": null
  }
}
```

### 2. Agent Prompt (if assignee is an agent)

If the task's assignee is a user with `isAgent: true`, their `agentPrompt` is included:

```
## Agent Role
You are a content review specialist. Focus on accuracy, tone, and...
```

### 3. Workflow Step Prompt (if task has workflowStage)

If the task is part of a workflow, the current step's prompt and output schema:

```
## Workflow Step: Content Analysis
Analyze the provided content for...

## Output Schema
Your "output" field MUST match:
{
  "sentiment": "positive" | "negative" | "neutral",
  "topics": ["array", "of", "topics"],
  "summary": "string"
}
```

### 4. Task Context

```
## Task Instructions
{task.extraPrompt}

## Task Context
{
  "title": "Review quarterly report",
  "summary": null,
  "tags": ["content", "urgent"],
  "inputPayload": { /* from webhook/external trigger */ },
  "workflowStage": "analysis"
}
```

## Response Handling

### NextAction Values

| Action | Task Status | Behavior |
|--------|-------------|----------|
| `COMPLETE` | `completed` | Task done, create next workflow step if applicable |
| `CONTINUE` | `completed` | Task done, create follow-up task with `nextActionReason` |
| `ESCALATE` | `on_hold` | Needs human intervention, unassign task |
| `HOLD` | `on_hold` | Paused, unassign task |

### Status Values

| Status | Meaning |
|--------|---------|
| `SUCCESS` | Fully completed as expected |
| `PARTIAL` | Partially completed |
| `BLOCKED` | Cannot proceed (missing info, etc.) |
| `FAILED` | Error occurred |

### Workflow Transitions

When a task with `workflowStage` completes:

1. Daemon finds the next step in the workflow
2. Creates a new task with:
   - Title: `{workflowName}: {nextStepName}`
   - Stage: Next step's ID
   - Parent: Current task's ID
   - Metadata: Previous output for context

## Setting Up Views as Queues

Create saved views in the UI to filter tasks for each daemon job:

**Example: Agent Processing Queue**
```json
{
  "name": "Claude Haiku Queue",
  "filters": {
    "status": "pending",
    "assigneeId": "agent-user-id",
    "tags": ["auto-process"]
  },
  "sort": { "createdAt": 1 }
}
```

**Example: Workflow Step Queue**
```json
{
  "name": "Email Analysis Queue",
  "filters": {
    "status": "pending",
    "workflowStage": "email-analysis",
    "executionMode": "automated"
  }
}
```

## Running in Production

### Using PM2

```bash
# Start daemon as a managed process
pm2 start scripts/task-daemon.mjs --name "task-daemon-content" -- \
  --config scripts/daemon-jobs.yaml --job content-review

# Start multiple daemons
pm2 start scripts/task-daemon.mjs --name "task-daemon-triage" -- \
  --config scripts/daemon-jobs.yaml --job fast-triage

# Monitor
pm2 logs task-daemon-content
pm2 status
```

### Using systemd

```ini
[Unit]
Description=Task Daemon - Content Review
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/coordination-matrix
Environment=MATRIX_API_KEY=cm_ak_live_xxxxx
ExecStart=/usr/bin/node scripts/task-daemon.mjs \
  --config scripts/daemon-jobs.yaml --job content-review
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY scripts/ ./scripts/
COPY daemon-jobs.yaml ./
CMD ["node", "scripts/task-daemon.mjs", "--config", "daemon-jobs.yaml", "--job", "content-review"]
```

## Examples

### Process One Task (Debug)

```bash
# Dry run to see the assembled prompt
node scripts/task-daemon.mjs --view <viewId> --api-key <key> --once --dry-run

# Process one task
node scripts/task-daemon.mjs --view <viewId> --api-key <key> --once
```

### Use Different Claude Models

```bash
# Fast triage with Haiku
node scripts/task-daemon.mjs --view <viewId> --exec "claude --model haiku" --once

# Complex analysis with Opus
node scripts/task-daemon.mjs --view <viewId> --exec "claude --model opus" --once

# With specific tools
node scripts/task-daemon.mjs --view <viewId> \
  --exec "claude --model claude-sonnet-4-20250514 --allowedTools Read,Edit" --once
```

### Custom Command Integration

```bash
# Use any CLI that accepts prompt via stdin
node scripts/task-daemon.mjs --view <viewId> --exec "my-custom-llm --json" --once
```

## Comparison with Event-Based Daemon

There's also an event-based daemon in `backend/src/daemon/automation-daemon.ts` that uses YAML rules and triggers on task events. However, it currently uses an in-memory event bus and only works within the same process as the backend.

| Feature | Task Daemon (task-daemon.mjs) | Automation Daemon |
|---------|-------------------------------|-------------------|
| Architecture | Polling via API | Event-based (EventEmitter) |
| Remote Support | Yes (API + auth) | No (same process only) |
| Task Selection | Saved views | Event filters |
| Command | Claude CLI | Shell commands |
| Response | Structured JSON | Raw output + field updates |
| Status | Production-ready | Needs event bus upgrade |

For remote/distributed deployments, use `task-daemon.mjs`.

## Related Files

- `scripts/task-daemon.mjs` - Main daemon script
- `scripts/daemon-jobs.yaml` - Example job configuration
- `backend/src/daemon/automation-daemon.ts` - Event-based daemon (limited)
- `docs/api/AGENT_TASK_RETRIEVAL_API.md` - API for task retrieval
