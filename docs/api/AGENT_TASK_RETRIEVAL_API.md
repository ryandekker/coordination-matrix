# Agent Task Retrieval API

This document describes the API endpoints for agent-based task retrieval from saved searches. These endpoints enable automated agents to authenticate, retrieve saved searches, and pull actionable tasks using intelligent descendant resolution.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
  - [API Key Generation](#api-key-generation)
  - [Using API Keys](#using-api-keys)
- [Saved Searches](#saved-searches)
  - [Create a Saved Search](#create-a-saved-search)
  - [List Saved Searches](#list-saved-searches)
  - [Get Saved Search Details](#get-saved-search-details)
  - [Update a Saved Search](#update-a-saved-search)
  - [Delete a Saved Search](#delete-a-saved-search)
- [Task Retrieval](#task-retrieval)
  - [Retrieve Tasks from Saved Search](#retrieve-tasks-from-saved-search)
  - [Query Parameters](#query-parameters)
  - [Descendant Resolution](#descendant-resolution)
- [Status Definitions](#status-definitions)
- [Use Cases](#use-cases)
- [Error Handling](#error-handling)

---

## Overview

The Agent Task Retrieval API allows automated agents to:

1. **Authenticate** using API keys as bearer tokens
2. **Access saved searches** with pre-configured filters and sort orders
3. **Retrieve actionable tasks** with intelligent descendant resolution

The key feature is the ability to retrieve the "next actionable task" from a saved search. If the top-priority task has unresolved subtasks, the API returns the topmost unresolved descendant instead—ensuring agents always receive work they can immediately act upon.

---

## Authentication

### API Key Generation

Generate an API key for programmatic access. API keys are associated with a user account and inherit that user's permissions.

**Endpoint:** `POST /api/auth/api-keys`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <user_session_token>
```

**Request Body:**
```json
{
  "name": "Agent Worker Key",
  "description": "API key for automated task processing agent",
  "expiresAt": "2025-12-31T23:59:59Z",
  "scopes": ["tasks:read", "saved-searches:read"]
}
```

**Response:**
```json
{
  "id": "ak_1234567890abcdef",
  "name": "Agent Worker Key",
  "description": "API key for automated task processing agent",
  "key": "cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "keyPrefix": "cm_ak_live_xxxx",
  "scopes": ["tasks:read", "saved-searches:read"],
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2025-12-31T23:59:59Z",
  "lastUsedAt": null
}
```

> **Important:** The full API key is only returned once upon creation. Store it securely.

#### Example: Generate API Key

```bash
curl -X POST http://localhost:3001/api/auth/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{
    "name": "Task Processing Agent",
    "description": "Key for automated task retrieval",
    "scopes": ["tasks:read", "saved-searches:read"]
  }'
```

### Using API Keys

Include the API key as a Bearer token in the `Authorization` header for all authenticated requests.

**Header Format:**
```
Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### Example: Authenticated Request

```bash
curl http://localhost:3001/api/saved-searches \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Saved Searches

Saved searches store pre-configured filter criteria and sort orders for task retrieval. They enable consistent, repeatable queries for agent automation.

### Create a Saved Search

**Endpoint:** `POST /api/saved-searches`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <api_key>
```

**Request Body:**
```json
{
  "name": "High Priority Pending Tasks",
  "description": "All high/critical priority tasks that are not yet complete",
  "filters": {
    "status": ["pending", "in_progress", "waiting_review"],
    "priority": ["high", "critical"]
  },
  "sort": {
    "field": "priority",
    "order": "desc"
  },
  "secondarySort": {
    "field": "createdAt",
    "order": "asc"
  },
  "includeSubtasks": true,
  "rootTasksOnly": false
}
```

**Response:**
```json
{
  "id": "ss_abc123def456",
  "name": "High Priority Pending Tasks",
  "description": "All high/critical priority tasks that are not yet complete",
  "filters": {
    "status": ["pending", "in_progress", "waiting_review"],
    "priority": ["high", "critical"]
  },
  "sort": {
    "field": "priority",
    "order": "desc"
  },
  "secondarySort": {
    "field": "createdAt",
    "order": "asc"
  },
  "includeSubtasks": true,
  "rootTasksOnly": false,
  "createdById": "user_123",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### Example: Create a Saved Search for Agent Work Queue

```bash
curl -X POST http://localhost:3001/api/saved-searches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "name": "Agent Work Queue",
    "description": "Unresolved tasks sorted by priority for agent processing",
    "filters": {
      "status": ["pending", "in_progress", "waiting_review", "waiting_human"],
      "assigneeId": null
    },
    "sort": {
      "field": "priority",
      "order": "desc"
    },
    "secondarySort": {
      "field": "createdAt",
      "order": "asc"
    }
  }'
```

### List Saved Searches

**Endpoint:** `GET /api/saved-searches`

**Headers:**
```
Authorization: Bearer <api_key>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Maximum results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `includeSystem` | boolean | Include system-defined saved searches |

#### Example: List All Saved Searches

```bash
curl http://localhost:3001/api/saved-searches \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response:**
```json
{
  "data": [
    {
      "id": "ss_abc123def456",
      "name": "Agent Work Queue",
      "description": "Unresolved tasks sorted by priority",
      "filters": { ... },
      "sort": { ... },
      "createdAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "ss_xyz789ghi012",
      "name": "HITL Review Queue",
      "description": "Tasks awaiting human review",
      "filters": { ... },
      "sort": { ... },
      "createdAt": "2024-01-10T08:00:00Z"
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

### Get Saved Search Details

**Endpoint:** `GET /api/saved-searches/:id`

**Headers:**
```
Authorization: Bearer <api_key>
```

#### Example: Get Saved Search by ID

```bash
curl http://localhost:3001/api/saved-searches/ss_abc123def456 \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Update a Saved Search

**Endpoint:** `PATCH /api/saved-searches/:id`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <api_key>
```

#### Example: Update Saved Search Filters

```bash
curl -X PATCH http://localhost:3001/api/saved-searches/ss_abc123def456 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "filters": {
      "status": ["pending"],
      "priority": ["critical"]
    }
  }'
```

### Delete a Saved Search

**Endpoint:** `DELETE /api/saved-searches/:id`

**Headers:**
```
Authorization: Bearer <api_key>
```

#### Example: Delete a Saved Search

```bash
curl -X DELETE http://localhost:3001/api/saved-searches/ss_abc123def456 \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Task Retrieval

### Retrieve Tasks from Saved Search

Fetch tasks matching a saved search's criteria. This is the primary endpoint for agents to retrieve actionable work.

**Endpoint:** `GET /api/saved-searches/:id/tasks`

**Headers:**
```
Authorization: Bearer <api_key>
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum tasks to return (1-200) |
| `offset` | number | 0 | Pagination offset |
| `resolve_descendant` | boolean | false | If true, returns the topmost unresolved descendant instead of blocked parent tasks |
| `resolve_references` | boolean | true | Include resolved reference data (assignee names, status labels, etc.) |

### Basic Task Retrieval

Retrieve all tasks matching the saved search criteria.

#### Example: Get All Tasks from Saved Search

```bash
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "674a1b2c3d4e5f6a7b8c9d0e",
      "title": "Process customer data export",
      "description": "Export and validate Q4 customer data",
      "status": "pending",
      "priority": "critical",
      "parentId": null,
      "childCount": 3,
      "depth": 0,
      "createdAt": "2024-01-15T10:00:00Z",
      "_resolved": {
        "status": { "code": "pending", "displayName": "Pending", "color": "#6B7280" },
        "priority": { "code": "critical", "displayName": "Critical", "color": "#DC2626" }
      }
    },
    ...
  ],
  "total": 25,
  "limit": 50,
  "offset": 0,
  "savedSearch": {
    "id": "ss_abc123def456",
    "name": "Agent Work Queue"
  }
}
```

### Get Top Task Only

Use `limit=1` to retrieve only the highest-priority task based on the saved search's sort order.

#### Example: Get Single Top Task

```bash
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks?limit=1" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "674a1b2c3d4e5f6a7b8c9d0e",
      "title": "Process customer data export",
      "status": "pending",
      "priority": "critical",
      "childCount": 3,
      "depth": 0,
      ...
    }
  ],
  "total": 25,
  "limit": 1,
  "offset": 0
}
```

### Descendant Resolution

When `resolve_descendant=true`, if the top task has unresolved descendants (subtasks at any depth), the API returns the **topmost unresolved descendant** instead of the blocked parent.

This ensures agents always receive a task they can immediately work on, rather than a parent task that's waiting for subtasks to complete.

#### Example: Get Actionable Task with Descendant Resolution

```bash
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks?limit=1&resolve_descendant=true" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Scenario:**
```
Task Hierarchy:
├── "Process customer data export" (pending, priority: critical)  ← Top task
│   ├── "Validate data format" (completed) ✓
│   ├── "Clean invalid records" (pending)  ← First unresolved child
│   │   ├── "Remove duplicates" (pending)  ← Topmost unresolved descendant
│   │   └── "Fix encoding issues" (pending)
│   └── "Generate export file" (pending)
```

**Response (with resolve_descendant=true):**
```json
{
  "data": [
    {
      "_id": "674a9f8e7d6c5b4a3f2e1d0c",
      "title": "Remove duplicates",
      "status": "pending",
      "priority": "high",
      "parentId": "674a5e4d3c2b1a0f9e8d7c6b",
      "rootId": "674a1b2c3d4e5f6a7b8c9d0e",
      "depth": 2,
      "path": [
        "674a1b2c3d4e5f6a7b8c9d0e",
        "674a5e4d3c2b1a0f9e8d7c6b"
      ],
      "childCount": 0,
      ...
      "_resolved": {
        "status": { "code": "pending", "displayName": "Pending" },
        "priority": { "code": "high", "displayName": "High" }
      },
      "_resolution": {
        "originalTaskId": "674a1b2c3d4e5f6a7b8c9d0e",
        "originalTaskTitle": "Process customer data export",
        "resolutionPath": [
          { "id": "674a1b2c3d4e5f6a7b8c9d0e", "title": "Process customer data export" },
          { "id": "674a5e4d3c2b1a0f9e8d7c6b", "title": "Clean invalid records" },
          { "id": "674a9f8e7d6c5b4a3f2e1d0c", "title": "Remove duplicates" }
        ],
        "reason": "descendant_resolution"
      }
    }
  ],
  "total": 25,
  "limit": 1,
  "offset": 0
}
```

The `_resolution` field provides context about why this task was returned instead of the original top task.

#### Resolution Algorithm

1. Execute the saved search query to get sorted tasks
2. For each task (respecting limit):
   a. If `resolve_descendant=false`: return the task as-is
   b. If `resolve_descendant=true`:
      - Check if task has any unresolved descendants
      - If yes: traverse descendants depth-first to find the topmost unresolved task
      - If no: return the task as-is
3. "Topmost" means the first unresolved descendant encountered in depth-first traversal

---

## Status Definitions

### Terminal vs Non-Terminal Statuses

Understanding which statuses are "resolved" (terminal) is critical for descendant resolution.

| Status | Type | Description |
|--------|------|-------------|
| `pending` | **Non-terminal** | Task is awaiting work |
| `in_progress` | **Non-terminal** | Task is actively being worked on |
| `waiting_review` | **Non-terminal** | Task is awaiting review |
| `waiting_human` | **Non-terminal** | Task requires human intervention |
| `completed` | **Terminal** | Task finished successfully |
| `failed` | **Terminal** | Task failed and won't be retried |
| `cancelled` | **Terminal** | Task was cancelled |

### Unresolved Definition

A task is considered **unresolved** if its status is any of the non-terminal statuses:
- `pending`
- `in_progress`
- `waiting_review`
- `waiting_human`

A task is considered **resolved** if its status is any of the terminal statuses:
- `completed`
- `failed`
- `cancelled`

---

## Use Cases

### Use Case 1: Agent Pulls Next Actionable Task

An automated agent needs to pull the next task it can work on from a priority queue.

```bash
# Get the single highest-priority actionable task
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks?limit=1&resolve_descendant=true" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Workflow:**
1. Agent calls this endpoint
2. Receives the topmost actionable task (may be a subtask if parent is blocked)
3. Agent processes the task
4. Agent updates task status to `completed` or `failed`
5. Agent repeats from step 1

### Use Case 2: Review Queue for Human Operators

Fetch tasks that require human review.

```bash
# First, create a saved search for HITL tasks
curl -X POST http://localhost:3001/api/saved-searches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "name": "HITL Review Queue",
    "filters": {
      "status": ["waiting_human"],
      "hitlStatus": ["pending", "in_review"]
    },
    "sort": { "field": "createdAt", "order": "asc" }
  }'

# Then retrieve tasks from it
curl "http://localhost:3001/api/saved-searches/ss_hitl_queue/tasks?limit=10" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Use Case 3: Team-Specific Work Queue

Create a saved search for a specific team's unassigned work.

```bash
# Create team-specific saved search
curl -X POST http://localhost:3001/api/saved-searches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "name": "Engineering Team Queue",
    "filters": {
      "teamId": "team_engineering_123",
      "status": ["pending"],
      "assigneeId": null
    },
    "sort": { "field": "priority", "order": "desc" }
  }'

# Agent pulls next task for the team
curl "http://localhost:3001/api/saved-searches/ss_eng_queue/tasks?limit=1&resolve_descendant=true" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Use Case 4: Batch Processing with Pagination

Process multiple tasks in batches.

```bash
# Get first batch of 20 tasks
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks?limit=20&offset=0" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Get next batch
curl "http://localhost:3001/api/saved-searches/ss_abc123def456/tasks?limit=20&offset=20" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... }
  }
}
```

### Common Errors

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | API key lacks required scope |
| 404 | `NOT_FOUND` | Saved search not found |
| 400 | `INVALID_REQUEST` | Invalid query parameters |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

### Example: Invalid API Key

```bash
curl http://localhost:3001/api/saved-searches \
  -H "Authorization: Bearer invalid_key"
```

**Response (401):**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired API key"
  }
}
```

### Example: Saved Search Not Found

```bash
curl http://localhost:3001/api/saved-searches/ss_nonexistent/tasks \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response (404):**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Saved search not found",
    "details": {
      "id": "ss_nonexistent"
    }
  }
}
```

---

## Complete Example: Agent Workflow

Here's a complete example of an agent setting up and using the task retrieval API:

```bash
# Step 1: Generate an API key (one-time setup, requires user session)
curl -X POST http://localhost:3001/api/auth/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user_session_token>" \
  -d '{
    "name": "Production Agent",
    "scopes": ["tasks:read", "tasks:write", "saved-searches:read"]
  }'
# Save the returned API key securely

# Step 2: Create a saved search for the agent's work queue
curl -X POST http://localhost:3001/api/saved-searches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "name": "Agent Priority Queue",
    "description": "High priority unresolved tasks for automated processing",
    "filters": {
      "status": ["pending", "in_progress"],
      "priority": ["high", "critical"],
      "hitlRequired": false
    },
    "sort": { "field": "priority", "order": "desc" },
    "secondarySort": { "field": "createdAt", "order": "asc" }
  }'
# Returns: { "id": "ss_agent_queue_123", ... }

# Step 3: Agent pulls the next actionable task (in a loop)
curl "http://localhost:3001/api/saved-searches/ss_agent_queue_123/tasks?limit=1&resolve_descendant=true" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Step 4: Agent processes the task and updates status
curl -X PATCH http://localhost:3001/api/tasks/674a9f8e7d6c5b4a3f2e1d0c \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cm_ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "status": "completed"
  }'

# Step 5: Repeat step 3 to get the next task
```

---

## API Reference Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/api-keys` | Generate API key |
| `GET` | `/api/auth/api-keys` | List API keys |
| `DELETE` | `/api/auth/api-keys/:id` | Revoke API key |
| `POST` | `/api/saved-searches` | Create saved search |
| `GET` | `/api/saved-searches` | List saved searches |
| `GET` | `/api/saved-searches/:id` | Get saved search |
| `PATCH` | `/api/saved-searches/:id` | Update saved search |
| `DELETE` | `/api/saved-searches/:id` | Delete saved search |
| `GET` | `/api/saved-searches/:id/tasks` | **Retrieve tasks from saved search** |

---

## Notes

- API keys should be stored securely and never exposed in client-side code
- The `resolve_descendant` feature only affects the returned task; it does not modify task data
- Saved searches are evaluated at query time; filter results reflect current task states
- For high-frequency polling, consider implementing exponential backoff when no tasks are available
