# Claude Code Instructions

Project context and conventions for Claude Code.

**Note:** The `.claude/settings.local.json` file contains shared Claude Code permissions (auto-allowed commands) and should be committed to the repo so all developers have consistent settings.

## Git Workflow

- **Main branch**: `main` - use this as the base for all PRs
- Feature branches should be named descriptively (e.g., `feature/add-workflow-steps`)

## Project Overview

Coordination Matrix is a full-stack AI workflow task management system:
- **Frontend**: Next.js 14 with React, TanStack Table, shadcn/ui (port 3000)
- **Backend**: Express.js with TypeScript (port 3100 local dev, 3001 in Docker)
- **Database**: MongoDB 7.0 (port 27017)

### Checking Server Status

Before making API calls, verify the servers are running:

```bash
# Quick health check (preferred method)
npm run cli status

# Or check backend directly
curl -s http://localhost:3100/health
# Returns: {"status":"healthy","timestamp":"..."}
```

**Port Note:** The backend runs on port **3100** during local development (`npm run dev`). Port 3001 is used in Docker/production mode.

## Development Setup

**Quick start (one command):**
```bash
npm run dev
```

This starts MongoDB (Docker), backend, and frontend with hot reload. First time setup requires `npm run install:all`.

**Key commands:**
- `npm run dev` - Start everything with hot reload
- `npm run db:migrate` - Run pending database migrations
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
3. For database schema changes, write a migration in `backend/src/migrations/` and run `npm run db:migrate`

**For API testing (preferred method):** Use the CLI tool rather than the web UI, as the web UI requires authentication setup. The CLI stores credentials in `~/.matrix-cli.json`:

```bash
# Check if already authenticated
npm run cli status

# List workflows to verify API works
npm run cli workflows --brief

# List tasks
npm run cli tasks --status pending --brief
```

## Post-Agent Validation

After completing any code changes, **always run the validation suite before committing**:

```bash
# Default: check changed files (typecheck, lint, test, audit)
npm run check

# Quick: skip tests (typecheck, lint, audit only)
npm run check:quick

# Full: all files, all steps including build
npm run check:full

# Auto-fix lint issues
npm run check:fix
```

Fix any reported errors before committing. The `check` script runs:
1. **Git Status** - Identifies changed files
2. **TypeScript** - `tsc --noEmit` type checking
3. **Linting** - ESLint for backend and frontend
4. **Tests** - Vitest unit tests
5. **Build** - Full build verification (only with `check:full`)
6. **Audit** - Checks for debug console.logs, TODOs, merge conflicts, sensitive files

**Rules enforced by hooks:**
- Do NOT use `--no-verify` with git commit
- Do NOT disable ESLint rules or use `@ts-ignore` to work around errors
- Do NOT set `NEXT_DISABLE_ESLINT=true` or similar environment bypasses
- Fix the root cause of lint/type errors instead of suppressing them

## API Documentation

Full API documentation is available at:
- **Swagger UI**: http://localhost:3100/api-docs (interactive API explorer)
- **OpenAPI Spec**: http://localhost:3100/api-docs.json
- **AI Quick Reference**: [docs/API-for-AI.md](./docs/API-for-AI.md) (concise guide for AI agents)
- **Full Reference**: [docs/API-endpoints.md](./docs/API-endpoints.md) (complete endpoint reference)

The Swagger spec is defined in `backend/src/swagger/` with paths organized by domain (tasks, workflows, auth, etc.).

### CLI Tool

A CLI tool is available for easy API interaction. **Always prefer the CLI over curl for API testing.**

```bash
# Show help
npm run cli help

# Check connection and auth status
npm run cli status

# Login and store credentials (first time setup)
npm run cli login

# Or use API key
npm run cli use-key cm_ak_live_xxxxx
```

**Task Operations:**
```bash
# List tasks
npm run cli tasks --status pending --brief

# Get a specific task (with full details)
npm run cli task <taskId>

# Create a task
npm run cli task:create --title "New task" --status pending

# Update a task
npm run cli task:update <taskId> --status completed
npm run cli task:update <taskId> --status pending --assignee <userId>
```

**Workflow Debugging:**
```bash
# List workflow runs
npm run cli runs --status running

# Get workflow run details
npm run cli request /api/workflow-runs/<runId>?includeTasks=true

# List tasks for a workflow run
npm run cli tasks --workflow-run <runId>
```

**Generic API Requests:**
```bash
# GET request
npm run cli request /api/tasks/<taskId>

# PATCH request with JSON body
npm run cli request /api/tasks/<taskId> --method PATCH --body '{"status":"completed"}'

# Test SSE (Server-Sent Events) connection
npm run cli events --duration 30 --quiet
```

**Note:** The CLI automatically uses the correct local port (3100) and handles authentication. Always prefer it over manual curl commands.

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
1. Create a migration file in `backend/src/migrations/` (see existing ones for pattern)
2. Register it in `backend/src/migrations/index.ts`
3. Run `npm run db:migrate` to apply
4. Also update `mongo-init/01-init-db.js` so fresh installs have the schema

> **Do NOT run `npm run db:reset`** — it destroys all data and requires human confirmation.
> Use `npm run db:migrate` for all schema changes. Migrations are non-destructive and required for production.

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

  # Job with MCP server access
  with-mcp:
    description: Agent with external tools via MCP
    viewId: <saved-view-id>
    exec: "claude --model claude-sonnet-4-20250514"
    mcpServers:
      github:
        type: http
        url: https://api.github.com/mcp
        headers:
          Authorization: "Bearer ${GITHUB_TOKEN}"
    strictMcpConfig: true  # Only use these MCP servers
```

### Resilience Features

The daemon includes several resilience mechanisms to recover from failures:

- **Exponential Backoff**: API failures trigger increasing delays (2s → 5min max) with jitter
- **Circuit Breaker**: After 5 consecutive API failures, blocks requests for 60s to let the API recover
- **Task Update Retries**: Failed task updates retry up to 3 times with backoff
- **Health Check**: Verifies API connectivity before starting the main loop
- **Max Failure Threshold**: Exits after 20 consecutive API failures for process manager restart
- **Clean Exit on Errors**: Unhandled exceptions trigger exit for clean restart by systemd/pm2

**For long-running production deployments**, use a process manager (systemd, pm2, supervisord) that will automatically restart the daemon if it exits.

### Running with PM2 (Recommended for Production)

PM2 provides automatic restarts, logging, and monitoring. An ecosystem config is included:

```bash
# Install pm2 globally (one time)
npm install -g pm2

# Start all enabled daemon jobs
pm2 start scripts/ecosystem.config.cjs

# Common pm2 commands
pm2 list                          # Show all running processes
pm2 logs                          # Tail all logs
pm2 logs daemon-claude-haiku      # Tail specific job
pm2 restart all                   # Restart all daemons
pm2 stop all                      # Stop all
pm2 delete all                    # Remove from pm2

# Make daemons survive reboot
pm2 save                          # Save current process list
pm2 startup                       # Generate OS startup script
```

The ecosystem config reads from `daemon-jobs.yaml` and creates a PM2 process for each enabled job with:
- Automatic restart on crash (with exponential backoff)
- Memory limit (500MB) with auto-restart
- Separate log files in `logs/` directory

### Two Daemon Types

| Feature | Task Daemon (task-daemon.mjs) | Automation Daemon |
|---------|-------------------------------|-------------------|
| Architecture | Polling via API | Event-based (EventEmitter) |
| Remote Support | Yes (API + auth) | No (same process only) |
| Status | **Production-ready** | Limited (needs event bus upgrade) |

For production/remote deployments, always use `task-daemon.mjs`.

## Workflow Authoring

Workflows are JSON definitions deployed via `scripts/workflows/deploy-workflows.mjs`. Key patterns:

### Group Visibility (Critical)

**Always set `groupId` when creating workflows via API.** The frontend filters workflows by the user's selected group, so workflows with `groupId: null` are invisible in the UI — even to admins. The backend applies the group filter whenever the frontend passes a `groupId` query parameter, which it always does.

- Production group (ryans-workspace): `6976de9a24f7f6625819aca0`
- Include `groupId` in the workflow JSON when calling `POST /api/workflows`
- If a workflow is missing from the UI, check its `groupId` field first

### Deploy & Test Scripts

```bash
# Deploy workflows to local dev
node scripts/workflows/deploy-workflows.mjs --env local

# Deploy to production
node scripts/workflows/deploy-workflows.mjs --env production

# E2E progression test (simulates full workflow lifecycle via API)
node scripts/workflows/test-workflow-e2e.mjs --workflow wc   # Workflow Creation
node scripts/workflows/test-workflow-e2e.mjs --workflow mc   # Multi-Model Creation
```

### Dynamic Agent Assignment

Agent IDs are resolved dynamically at runtime — no hardcoded IDs or variable packages needed. Use `{{agent.*}}` templates in `defaultAssigneeId`:

```
{{agent.complexity.3}}          → first active agent with agentComplexity=3 (opus-class)
{{agent.complexity.1}}          → first active agent with agentComplexity=1 (haiku-class)
{{agent.tag.api-integration}}   → first active agent tagged "api-integration"
{{agent.name.Claude Opus}}      → agent by display name (case-insensitive)
```

- Resolution is cached 60s, invalidated on user create/update/delete
- No match → task left unassigned (warning logged)
- Oldest-created matching agent wins (deterministic)
- `agentTags` field on User model: `string[]` of capability tags
- `GET /api/users/agents?complexity=3&tag=api-integration` for API filtering

### Step Input Data Flow

When a step completes, the next step receives `inputPayload = { ...taskMetadata, output: stepOutputData }`. Key rules:

- **Decision steps**: Use `decisionField: 'output.verdict'` (not `steps.X.output.result.verdict`)
- **Code steps**: `input` = inputPayload from previous step. `trigger` = original workflow run inputPayload. `_stepLog` = array of step execution logs
- **Foreach steps**: `itemsPath` resolves from inputPayload. Use `inputConfig: { source: 'stepId' }` to pull from a specific step's output instead of the previous step
- **Manual steps**: Set `reviewDecision` on task. This propagates via `metadata` to the next step's inputPayload

### Code Step Patterns

```javascript
// Loop counting — check _stepLog for previous executions of a step
const count = (_stepLog || []).filter(e => e.stepId === 'some-step').length;

// Access original workflow input via trigger
const userConfig = (trigger && trigger.someField) || defaultValue;

// Access previous step's output verdict
const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
```

### No Trigger Steps

Trigger steps are optional. The engine executes `workflow.steps[0]` directly. Don't add empty trigger steps.

### Unit Tests

Workflow code step tests in `backend/src/services/workflow/workflow-deployment.test.ts`. When testing code steps with `_stepLog`, pass context mode: `{ input: {}, _stepLog: [...] }`.

## Production Architecture (Quick Reference)

| Component | Platform | URL |
|-----------|----------|-----|
| Frontend | Cloudflare Pages | `cm.hcizero.com` (root), `coordination-matrix.pages.dev` |
| Backend API | Render | `cm.hcizero.com/api/*` (proxied through Cloudflare) |
| Database | MongoDB Atlas | Internal connection string |

**URL routing:** `cm.hcizero.com` is a Cloudflare Pages site. All root paths serve the frontend. Only `/api/*` is proxied to the Render backend.

**Cloudflare Pages production branch:** `prod`. Frontend deploys via `wrangler pages deploy --branch prod`. Without `--branch prod`, deploys land as previews only.

**Health & version endpoints (no auth required):**
- `cm.hcizero.com/api/health` — backend liveness + deployed commit SHA
- `cm.hcizero.com/build-info.json` — frontend deployed commit SHA

```bash
# Quick version check after deploy
curl -s https://cm.hcizero.com/api/health | jq '.version.commitSha'
curl -s https://cm.hcizero.com/build-info.json | jq '.commitSha'
```

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
