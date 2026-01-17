# Coordination Matrix API Reference for AI Agents

This document helps AI agents understand and use the Coordination Matrix API effectively.

## Quick Start

**API Documentation Location:**
- **Swagger UI (Interactive):** `http://localhost:3100/api-docs`
- **OpenAPI Spec (JSON):** `http://localhost:3100/api-docs.json`
- **Production:** `https://cm.hcizero.com/api-docs`

**Preferred Testing Method:** Use the CLI tool rather than raw curl:
```bash
npm run cli help              # Show all commands
npm run cli status            # Check connection
npm run cli tasks --brief     # List tasks
npm run cli request /api/...  # Raw API request
```

## Authentication

Two methods supported:
1. **JWT Token** - From `/api/auth/login`, use as `Authorization: Bearer <token>`
2. **API Key** - Use as `X-API-Key: cm_ak_...` header

## Core Endpoints by Use Case

### Task Management (Most Common)
| Action | Endpoint | CLI |
|--------|----------|-----|
| List tasks | `GET /api/tasks` | `npm run cli tasks` |
| Get task | `GET /api/tasks/{id}` | `npm run cli task <id>` |
| Create task | `POST /api/tasks` | `npm run cli task:create` |
| Update task | `PATCH /api/tasks/{id}` | `npm run cli task:update <id>` |
| Get children | `GET /api/tasks/{id}/children` | - |
| Get tree | `GET /api/tasks/tree` | - |

### Workflow Operations
| Action | Endpoint |
|--------|----------|
| List workflows | `GET /api/workflows` |
| Start workflow | `POST /api/workflow-runs` |
| Get run status | `GET /api/workflow-runs/{id}` |
| Cancel run | `POST /api/workflow-runs/{id}/cancel` |

### Saved Views (Task Queues)
| Action | Endpoint |
|--------|----------|
| List views | `GET /api/views` |
| Get tasks from view | `GET /api/views/{id}/tasks` |

### Reference Data
| Data | Endpoint |
|------|----------|
| Users/Agents | `GET /api/users`, `GET /api/users/agents` |
| Tags | `GET /api/tags` |
| Lookups (statuses, etc.) | `GET /api/lookups` |

## Common Task Fields

```typescript
{
  title: string;           // Required
  summary?: string;        // Description
  status: 'pending' | 'in_progress' | 'waiting' | 'on_hold' | 'completed' | 'failed' | 'cancelled';
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  assigneeId?: ObjectId;   // User/agent to assign
  parentId?: ObjectId;     // For subtasks
  tags?: string[];         // Tag names
  metadata?: object;       // Arbitrary data
  extraPrompt?: string;    // AI instructions for this task
}
```

## Real-Time Events (SSE)

Connect to `GET /api/events/stream` for live updates:
```bash
npm run cli events --duration 30
```

Events: `task.created`, `task.updated`, `task.deleted`, `workflow.completed`, etc.

## Swagger Source Files

The OpenAPI spec is built from TypeScript files in `backend/src/swagger/`:

```
backend/src/swagger/
├── index.ts           # Main spec assembly
├── schemas.ts         # Data type definitions
└── paths/
    ├── index.ts       # Combines all paths
    ├── tasks.ts       # Task endpoints
    ├── workflows.ts   # Workflow & batch job endpoints
    ├── health-auth.ts # Auth & API key endpoints
    ├── documents.ts   # Document management
    ├── field-configs.ts # Dynamic field configuration
    ├── events.ts      # SSE endpoints
    └── other.ts       # Users, views, webhooks, lookups, tags, external jobs
```

## Tips for AI Agents

1. **Check Swagger first** - The interactive docs at `/api-docs` show all parameters and examples
2. **Use views for queues** - Saved views filter tasks; use `/api/views/{id}/tasks` to poll work queues
3. **Include `actorId`** when updating tasks to track who made changes
4. **Use `silent: true`** in task updates to skip notifications/webhooks
5. **Resolve references** - Add `?resolveReferences=true` to get populated user/workflow names
6. **Pagination** - Most list endpoints support `page` and `limit` parameters
