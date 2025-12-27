# Claude Code Instructions

Project context and conventions for Claude Code.

**Note:** The `.claude/settings.local.json` file contains shared Claude Code permissions (auto-allowed commands) and should be committed to the repo so all developers have consistent settings.

## Git Workflow

- **Main branch**: `main` - use this as the base for all PRs
- Feature branches should be named descriptively (e.g., `feature/add-workflow-steps`)

## Project Overview

Coordination Matrix is a full-stack AI workflow task management system:
- **Frontend**: Next.js 14 with React, TanStack Table, shadcn/ui (port 3000)
- **Backend**: Express.js with TypeScript (port 3001)
- **Database**: MongoDB 7.0 (port 27017)

## Development Setup

**Quick start (one command):**
```bash
npm run dev
```

This starts MongoDB (Docker), backend, and frontend with hot reload. First time setup requires `npm run install:all`.

**Key commands:**
- `npm run dev` - Start everything with hot reload
- `npm run db:reset` - Reset database (clears data, re-seeds)
- `npm run docker:up` - Full Docker mode (production-like)

See [DEVELOPMENT.md](./DEVELOPMENT.md) for full details.

## Code Structure

```
coordination-matrix/
├── frontend/          # Next.js app (app router)
│   └── src/
│       ├── app/       # Pages and routes
│       └── components/# React components
├── backend/           # Express API
│   └── src/
│       ├── routes/    # API endpoints
│       ├── services/  # Business logic
│       └── daemon/    # Automation daemon
├── mongo-init/        # DB initialization scripts
└── docs/              # API documentation
```

## Conventions

- **API routes**: All under `/api/*`, frontend proxies to backend
- **Components**: Use shadcn/ui components from `frontend/src/components/ui/`
- **Validation**: Zod schemas for both frontend forms and backend
- **Styling**: Tailwind CSS with class-variance-authority

## Testing Changes

After making changes:
1. Backend changes auto-reload via `tsx watch`
2. Frontend changes auto-reload via Next.js fast refresh
3. For database schema changes, run `npm run db:reset`

**For API testing (preferred method):** Use the CLI tool rather than the web UI, as the web UI requires authentication setup. The CLI stores credentials in `~/.matrix-cli.json`:

```bash
# Check if already authenticated
npm run cli status

# List workflows to verify API works
npm run cli workflows --brief

# List tasks
npm run cli tasks --status pending --brief
```

## API Documentation

Full API documentation is available at:
- **Swagger UI**: http://localhost:3001/api-docs (interactive API explorer)
- **OpenAPI Spec**: http://localhost:3001/api-docs.json
- **Reference Doc**: [docs/API-endpoints.md](./docs/API-endpoints.md) (complete endpoint reference)

### CLI Tool

A CLI tool is available for easy API interaction:

```bash
# Show help
npm run cli help

# Login and store credentials
npm run cli login

# Or use API key
npm run cli use-key cm_ak_live_xxxxx

# List tasks
npm run cli tasks --status pending --brief

# Create a task
npm run cli task:create --title "New task" --status pending

# Generic API request
npm run cli request /api/tasks --method GET

# Test SSE (Server-Sent Events) connection
npm run cli events --duration 30

# Test SSE while creating a task in another terminal
npm run cli events --duration 30 --quiet  # Suppress heartbeats
```

**Note:** Always prefer using the CLI for API testing rather than the browser, as it provides clearer output and avoids authentication complexities.

See `./scripts/matrix-cli.mjs --help` for all commands.

## Common Tasks

**Add a new API endpoint:**
1. Create route file in `backend/src/routes/`
2. Register in `backend/src/index.ts`
3. Add Swagger documentation in `backend/src/swagger.ts`

**Add a new UI component:**
1. Use `npx shadcn@latest add <component>` for shadcn components
2. Custom components go in `frontend/src/components/`

**Modify database schema:**
1. Update `mongo-init/01-init-db.js` for schema validation
2. Update seed data in `mongo-init/02-seed-data.js` if needed
3. Run `npm run db:reset` to apply

## Task Daemon

The Task Daemon is a polling-based agent that processes tasks from saved views (queues). It works with remote APIs using API key authentication and executes Claude CLI to process tasks.

### Key Files

- `scripts/task-daemon.mjs` - Main production daemon script
- `scripts/daemon-jobs.yaml` - Job configuration file
- `docs/task-daemon.md` - Full documentation

### Quick Commands

```bash
# List available jobs
node scripts/task-daemon.mjs --config scripts/daemon-jobs.yaml --list

# Run a specific job continuously
node scripts/task-daemon.mjs --config scripts/daemon-jobs.yaml --job claude-haiku

# Run once and exit (good for testing)
node scripts/task-daemon.mjs --config scripts/daemon-jobs.yaml --job claude-haiku --once

# Dry run to see the assembled prompt
node scripts/task-daemon.mjs --view <viewId> --api-key <key> --once --dry-run

# Run against a specific view (without config file)
node scripts/task-daemon.mjs --view <viewId> --api-key <key> --once
```

### How It Works

1. **Poll View**: Fetches next task from a saved view (filtered by status, assignee, tags)
2. **Assemble Prompt**: Layers base daemon prompt + agent prompt + workflow step + task context
3. **Execute**: Runs Claude CLI with the assembled prompt
4. **Parse Response**: Expects structured JSON with status, summary, output, nextAction
5. **Update Task**: Sets status based on nextAction (COMPLETE, CONTINUE, ESCALATE, HOLD)
6. **Workflow Transition**: Creates next step task if part of a workflow

### Response Schema

The daemon expects Claude to return JSON:

```json
{
  "status": "SUCCESS | PARTIAL | BLOCKED | FAILED",
  "summary": "1-2 sentence summary",
  "output": { /* structured result */ },
  "nextAction": "COMPLETE | CONTINUE | ESCALATE | HOLD",
  "nextActionReason": "optional reason",
  "metadata": {
    "confidence": 0.0-1.0,
    "suggestedTags": [],
    "suggestedNextStage": null
  }
}
```

### NextAction Values

| Action | Task Status | Behavior |
|--------|-------------|----------|
| `COMPLETE` | `completed` | Task done, create next workflow step if applicable |
| `CONTINUE` | `completed` | Task done, create follow-up task with reason |
| `ESCALATE` | `on_hold` | Needs human intervention, unassign task |
| `HOLD` | `on_hold` | Paused, unassign task |

### Configuration (daemon-jobs.yaml)

```yaml
defaults:
  apiUrl: https://cm.hcizero.com/api
  apiKey: cm_ak_xxxxx  # or use MATRIX_API_KEY env var
  interval: 5000
  exec: claude
  maxPayloadSize: 200000

jobs:
  claude-haiku:
    description: Fast triage tasks
    viewId: <saved-view-id>
    exec: "claude --model haiku"

  claude-opus:
    description: Complex reasoning tasks
    viewId: <saved-view-id>
    exec: "claude --model opus"
```

### Two Daemon Types

| Feature | Task Daemon (task-daemon.mjs) | Automation Daemon |
|---------|-------------------------------|-------------------|
| Architecture | Polling via API | Event-based (EventEmitter) |
| Remote Support | Yes (API + auth) | No (same process only) |
| Status | **Production-ready** | Limited (needs event bus upgrade) |

For production/remote deployments, always use `task-daemon.mjs`.

## Production API Debugging

For debugging production (cm.hcizero.com), use the API key from `daemon-jobs.yaml` with `X-API-Key` header.

### Quick Commands

```bash
# Get API key from daemon config
API_KEY=$(grep 'apiKey:' scripts/daemon-jobs.yaml | head -1 | awk '{print $2}')

# Query a workflow run
curl -s "https://cm.hcizero.com/api/workflow-runs/<workflowRunId>" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY"

# Get workflow definition
curl -s "https://cm.hcizero.com/api/workflows/<workflowId>" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY"

# List tasks for a workflow run
curl -s "https://cm.hcizero.com/api/tasks?workflowRunId=<workflowRunId>" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY"

# Update a task
curl -s -X PATCH "https://cm.hcizero.com/api/tasks/<taskId>" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"status": "pending"}'
```

### Workflow Run Structure

```json
{
  "_id": "workflowRunId",
  "workflowId": "workflowDefinitionId",
  "status": "running | completed | failed",
  "currentStepIds": ["step-xxx"],      // Steps waiting for tasks
  "completedStepIds": ["step-yyy"],    // Steps that finished
  "callbackSecret": "wfsec_xxx",       // For external webhooks
  "rootTaskId": "taskId"               // First task in workflow
}
```

### Common Issues

**Stuck workflow (task deleted):** If a task for a step is deleted while workflow expects it:
1. Workflow shows step in `currentStepIds` but no matching task exists
2. Fix: Create a replacement task with matching `workflowRunId` and `workflowStage`
3. Or: Cancel the workflow run and start fresh

**Auth header format:** Use `X-API-Key` header (NOT `Authorization: Bearer`)
