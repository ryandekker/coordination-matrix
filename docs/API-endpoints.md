# Coordination Matrix API Reference

Complete API reference for the Coordination Matrix backend. All endpoints are available at `http://localhost:3001` (development) and documented via Swagger UI at `/api-docs`.

## Quick Links

- **Swagger UI**: http://localhost:3001/api-docs
- **OpenAPI Spec**: http://localhost:3001/api-docs.json
- **Health Check**: http://localhost:3001/health

## Authentication

All endpoints (except `/api/auth/*`) require authentication via one of:

### JWT Token (for interactive users)
```bash
# Login to get a token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password123"}'

# Use the token
curl http://localhost:3001/api/tasks \
  -H "Authorization: Bearer <token>"
```

### API Key (for automation/AI tools)
```bash
# Create an API key (requires auth)
curl -X POST http://localhost:3001/api/auth/api-keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "CLI Tool", "scopes": ["tasks:read", "tasks:write"]}'

# Use the API key
curl http://localhost:3001/api/tasks \
  -H "X-API-Key: cm_ak_live_xxxxx"
```

## Response Format

All responses follow this structure:
```json
{
  "success": true,
  "data": { ... },
  "pagination": {          // For list endpoints
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2
  }
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## CLI Tool

A CLI tool is available for easy API access:

```bash
# Using npm scripts
npm run cli status
npm run cli login
npm run cli tasks --status pending

# Or directly
./scripts/matrix-cli.mjs tasks --brief
```

See `./scripts/matrix-cli.mjs --help` for all commands.

---

## Endpoints by Category

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

### Authentication (`/api/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/login` | Login with email/password | No |
| POST | `/register` | Register new user | No |
| GET | `/me` | Get current user | Yes |
| POST | `/change-password` | Change password | Yes |
| GET | `/status` | Check if setup required | No |

**Login Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Login Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "_id": "...",
      "email": "user@example.com",
      "displayName": "User Name",
      "role": "admin"
    }
  }
}
```

### API Keys (`/api/auth/api-keys`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List API keys (excludes hash) |
| GET | `/:id` | Get specific API key |
| POST | `/` | Create new API key |
| PATCH | `/:id` | Update API key |
| DELETE | `/:id` | Revoke API key |
| POST | `/:id/regenerate` | Regenerate key |

**Create API Key:**
```json
{
  "name": "My API Key",
  "description": "For automation",
  "scopes": ["tasks:read", "tasks:write", "views:read"],
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Available Scopes:**
- `tasks:read`, `tasks:write`
- `workflows:read`, `workflows:write`
- `views:read`, `views:write`
- `users:read`, `users:write`
- `webhooks:read`, `webhooks:write`
- `saved-searches:read`, `saved-searches:write`

---

### Tasks (`/api/tasks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List tasks with filtering |
| GET | `/tree` | Get tasks as tree |
| GET | `/:id` | Get single task |
| GET | `/:id/children` | Get direct children |
| GET | `/:id/ancestors` | Get parent chain |
| GET | `/:id/descendants` | Get all descendants |
| POST | `/` | Create task |
| PATCH | `/:id` | Update task |
| PUT | `/:id/move` | Move to new parent |
| DELETE | `/:id` | Delete task |
| POST | `/bulk` | Bulk operations |

**List Tasks Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| page | number | Page number (default: 1) |
| limit | number | Items per page (default: 50) |
| sortBy | string | Sort field (default: createdAt) |
| sortOrder | asc/desc | Sort direction |
| search | string | Search in title/summary |
| status | string | Filter by status |
| urgency | string | Filter by urgency |
| assigneeId | ObjectId | Filter by assignee |
| parentId | ObjectId | Filter by parent |
| rootOnly | boolean | Only root tasks |
| tags | string | Comma-separated tags |
| resolveReferences | boolean | Include full objects |

**Task Statuses:** `pending`, `in_progress`, `waiting`, `on_hold`, `completed`, `failed`, `cancelled`

**Urgency Levels:** `low`, `normal`, `high`, `urgent`

**Create Task:**
```json
{
  "title": "Implement feature X",
  "summary": "Description of the task",
  "status": "pending",
  "urgency": "normal",
  "parentId": null,
  "workflowId": null,
  "assigneeId": "507f1f77bcf86cd799439011",
  "tags": ["feature", "backend"],
  "extraPrompt": "AI instructions for this task",
  "dueAt": "2025-01-15T00:00:00Z",
  "metadata": {
    "customField": "value"
  }
}
```

**Update Task:**
```json
{
  "status": "completed",
  "silent": false,
  "actorId": "507f1f77bcf86cd799439011",
  "actorType": "daemon"
}
```

**Move Task:**
```json
{
  "newParentId": "507f1f77bcf86cd799439011"
}
```

**Bulk Operations:**
```json
{
  "operation": "update",
  "taskIds": ["id1", "id2", "id3"],
  "updates": {
    "status": "completed"
  }
}
```

---

### Workflows (`/api/workflows`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all workflows |
| GET | `/:id` | Get workflow |
| POST | `/` | Create workflow |
| PATCH | `/:id` | Update workflow |
| DELETE | `/:id` | Delete workflow |
| POST | `/:id/duplicate` | Duplicate workflow |
| POST | `/parse-mermaid` | Parse Mermaid to steps |
| POST | `/generate-mermaid` | Generate Mermaid from steps |
| GET | `/ai-prompt-context` | Get context for AI workflow generation |
| GET | `/ai-prompt` | Get complete AI prompt for workflow generation |

#### AI Workflow Generation

Use these endpoints to generate workflows with AI tools:

**Get AI Prompt Context** - Returns structured data for building custom prompts:
```bash
curl http://localhost:3001/api/workflows/ai-prompt-context
```

Response includes: available agents, users, existing workflows, step types, template variables, and Mermaid syntax reference.

**Get AI Prompt** - Returns a complete markdown prompt ready to use:
```bash
# Mermaid format (default)
curl "http://localhost:3001/api/workflows/ai-prompt?format=mermaid&includeContext=true"

# JSON format
curl "http://localhost:3001/api/workflows/ai-prompt?format=json"
```

See [AI Workflow Generation Guide](./ai-workflow-generation.md) for comprehensive documentation.

**Workflow Step Types:**
- `agent` - AI agent task
- `external` - External service call
- `manual` - Human task
- `decision` - Conditional routing
- `foreach` - Fan-out loop
- `join` - Fan-in aggregation
- `flow` - Nested workflow

**Create Workflow:**
```json
{
  "name": "Code Review Pipeline",
  "description": "Automated code review workflow",
  "isActive": true,
  "steps": [
    {
      "id": "review",
      "name": "AI Code Review",
      "type": "agent",
      "prompt": "Review this code for bugs and style issues",
      "nextStepId": "human-review"
    },
    {
      "id": "human-review",
      "name": "Human Approval",
      "type": "manual",
      "nextStepId": null
    }
  ]
}
```

---

### Workflow Runs (`/api/workflow-runs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List workflow runs |
| GET | `/:id` | Get run details |
| POST | `/` | Start new run |
| POST | `/:id/cancel` | Cancel run |
| POST | `/:id/callback/:stepId` | External callback |

**Workflow Run Statuses:** `pending`, `running`, `paused`, `completed`, `failed`, `cancelled`

**Start Workflow Run:**
```json
{
  "workflowId": "507f1f77bcf86cd799439011",
  "inputPayload": {
    "codeUrl": "https://github.com/...",
    "branch": "main"
  },
  "taskDefaults": {
    "urgency": "high",
    "tags": ["automated"]
  },
  "externalId": "github-pr-123",
  "source": "github-webhook"
}
```

---

### Batch Jobs (`/api/batch-jobs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List batch jobs |
| GET | `/:id` | Get job details |
| POST | `/` | Create batch job |
| POST | `/:id/start` | Start processing |
| POST | `/:id/callback` | Item callback |
| GET | `/:id/aggregate` | Get aggregate result |
| POST | `/:id/review` | Submit review decision |
| POST | `/:id/request-review` | Request manual review |
| POST | `/:id/cancel` | Cancel job |
| GET | `/stats/summary` | Get statistics |

**Batch Job Statuses:** `pending`, `processing`, `awaiting_responses`, `completed`, `completed_with_warnings`, `failed`, `cancelled`, `manual_review`

**Create Batch Job:**
```json
{
  "name": "Process 100 documents",
  "type": "document-processing",
  "expectedCount": 100,
  "minSuccessPercent": 95,
  "deadlineAt": "2025-01-15T00:00:00Z",
  "items": [
    { "key": "doc-1", "url": "..." },
    { "key": "doc-2", "url": "..." }
  ]
}
```

---

### Views/Saved Searches (`/api/views`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List views |
| GET | `/:id` | Get view |
| GET | `/:id/tasks` | Get tasks matching view |
| POST | `/` | Create view |
| PATCH | `/:id` | Update view |
| DELETE | `/:id` | Delete view |
| PUT | `/:id/preferences` | Save user preferences |

**Create View (Saved Search):**
```json
{
  "name": "My Pending Tasks",
  "collectionName": "tasks",
  "filters": {
    "status": { "$in": ["pending", "in_progress"] },
    "assigneeId": "507f1f77bcf86cd799439011"
  },
  "sorting": [
    { "field": "urgency", "order": "desc" },
    { "field": "createdAt", "order": "asc" }
  ],
  "visibleColumns": ["title", "status", "urgency", "dueAt"]
}
```

**Get Tasks from View:**
```bash
GET /api/views/:id/tasks?limit=10&resolveReferences=true
```

---

### Users (`/api/users`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List users |
| GET | `/agents` | List AI agents |
| POST | `/agents/ensure/:agentId` | Get/create agent |
| GET | `/:id` | Get user |
| POST | `/` | Create user |
| PATCH | `/:id` | Update user |
| DELETE | `/:id` | Deactivate user |

**User Roles:** `admin`, `operator`, `reviewer`, `viewer`

**Create AI Agent:**
```json
{
  "displayName": "Code Review Bot",
  "role": "operator",
  "isAgent": true,
  "agentPrompt": "You are a code review specialist. Focus on security and performance."
}
```

### Teams (`/api/users/teams`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/teams/list` | List teams |
| GET | `/teams/:id` | Get team |
| POST | `/teams` | Create team |
| PATCH | `/teams/:id` | Update team |
| DELETE | `/teams/:id` | Delete team |
| PUT | `/teams/:id/members` | Update members |

---

### Webhooks (`/api/webhooks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List webhooks |
| GET | `/:id` | Get webhook |
| POST | `/` | Create webhook |
| PATCH | `/:id` | Update webhook |
| DELETE | `/:id` | Delete webhook |
| POST | `/:id/rotate-secret` | Rotate secret |
| POST | `/:id/test` | Test delivery |
| GET | `/:id/deliveries` | Get delivery history |
| POST | `/deliveries/:id/retry` | Retry delivery |

**Webhook Triggers:**
- `task.created`, `task.updated`, `task.deleted`
- `task.status.changed`, `task.assignee.changed`, `task.priority.changed`
- `task.entered_filter`

**Create Webhook:**
```json
{
  "name": "Slack Notifications",
  "url": "https://hooks.slack.com/...",
  "triggers": ["task.created", "task.status.changed"],
  "savedSearchId": "507f1f77bcf86cd799439011",
  "isActive": true
}
```

---

### Activity Logs (`/api/activity-logs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/task/:taskId` | Get task activity |
| GET | `/recent` | Get recent activity |
| POST | `/task/:taskId/comments` | Add comment |
| POST | `/cleanup` | Cleanup orphans |

**Add Comment:**
```json
{
  "comment": "This task needs more investigation",
  "actorId": "507f1f77bcf86cd799439011",
  "actorType": "user"
}
```

---

### External Jobs (`/api/external-jobs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List jobs |
| GET | `/pending` | Get pending for workers |
| GET | `/:id` | Get job |
| POST | `/` | Create job |
| PUT | `/:id/claim` | Claim job |
| PUT | `/:id/complete` | Complete job |
| PUT | `/:id/fail` | Fail job |
| PUT | `/:id/cancel` | Cancel job |
| DELETE | `/:id` | Delete job |
| GET | `/stats/summary` | Get statistics |

**External Job Statuses:** `pending`, `processing`, `completed`, `failed`, `cancelled`

**Worker Pattern:**
```bash
# 1. Poll for pending jobs
GET /api/external-jobs/pending?type=ai-analysis&limit=1

# 2. Claim a job
PUT /api/external-jobs/:id/claim
{"workerId": "worker-001"}

# 3. Process and complete
PUT /api/external-jobs/:id/complete
{"result": {"analysis": "..."}}

# Or fail
PUT /api/external-jobs/:id/fail
{"error": "Failed to process", "retryAfter": "2025-01-01T12:00:00Z"}
```

---

### Lookups (`/api/lookups`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get all lookups grouped |
| GET | `/types` | Get lookup types |
| GET | `/:type` | Get lookups by type |
| POST | `/` | Create lookup |
| PATCH | `/:id` | Update lookup |
| DELETE | `/:id` | Deactivate lookup |
| PUT | `/:type/reorder` | Reorder lookups |

---

### Field Configs (`/api/field-configs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get all field configs |
| GET | `/:collection` | Get for collection |
| GET | `/:collection/:fieldPath` | Get specific |
| POST | `/` | Create config |
| PATCH | `/:id` | Update config |
| DELETE | `/:id` | Delete config |
| PUT | `/:collection/reorder` | Reorder fields |

**Field Types:** `text`, `textarea`, `number`, `boolean`, `select`, `multiselect`, `reference`, `datetime`, `date`, `tags`, `json`

---

## Common Patterns

### AI Agent Task Processing

```bash
# 1. Create a saved view for pending agent tasks
POST /api/views
{
  "name": "Pending AI Tasks",
  "collectionName": "tasks",
  "filters": {
    "status": "pending",
    "assigneeId": "<agent-id>"
  }
}

# 2. Poll the view for tasks
GET /api/views/:viewId/tasks?limit=1&resolveReferences=true

# 3. Claim task by updating status
PATCH /api/tasks/:taskId
{"status": "in_progress"}

# 4. Process and complete
PATCH /api/tasks/:taskId
{
  "status": "completed",
  "metadata": {"result": "Result of processing..."}
}
```

### Workflow Execution

```bash
# 1. Start a workflow
POST /api/workflow-runs
{
  "workflowId": "...",
  "inputPayload": {"data": "..."}
}

# 2. Monitor progress
GET /api/workflow-runs/:runId?includeTasks=true

# 3. Tasks are created automatically based on workflow steps
# Each step creates a task that can be processed by agents
```

### Batch Processing

```bash
# 1. Create batch job
POST /api/batch-jobs
{
  "expectedCount": 10,
  "type": "document-analysis",
  "items": [...]
}

# 2. Start processing
POST /api/batch-jobs/:id/start

# 3. External workers call back as they complete
POST /api/batch-jobs/:id/callback
{
  "itemKey": "item-1",
  "success": true,
  "result": {...}
}

# 4. Get aggregated results
GET /api/batch-jobs/:id/aggregate
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid auth |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid request data |
| `CONFLICT` | Resource conflict |
| `INTERNAL_ERROR` | Server error |

---

## Rate Limits

Currently no rate limits are enforced in development. Production deployments should implement appropriate limits.

---

## WebSocket Events (Future)

Real-time events are planned for:
- Task status changes
- Workflow progress updates
- Batch job completions
