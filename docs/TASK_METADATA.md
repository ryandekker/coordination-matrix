# Task Metadata

Task metadata provides a flexible key-value store attached to each task for storing structured outputs, work products, and custom data. It's designed for AI agents and automation workflows that need to collect and aggregate information across tasks.

## Overview

The `metadata` field is a flexible JSON object that can store any structured data:

```json
{
  "_id": "...",
  "title": "Research competitor pricing",
  "status": "completed",
  "metadata": {
    "source": "email",
    "priority_score": 85,
    "draft_title": "Pricing Analysis Q4",
    "rough_draft": "Our analysis shows...",
    "tags": ["research", "pricing"]
  }
}
```

## Use Cases

### 1. Task Outputs / Work Products
Store the results of a task so subsequent tasks can access them:

```bash
# Agent completes a draft task and stores the result
curl -X PATCH http://localhost:3001/api/tasks/:id \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "metadata": {
      "draft_title": "AI in Healthcare",
      "tags": ["ai", "healthcare"],
      "rough_draft": "Content of the draft..."
    }
  }'
```

### 2. Collecting Information Across Tasks
A parent task can query child tasks by metadata to aggregate results:

```bash
# Find all completed tasks with rough drafts
curl "http://localhost:3001/api/tasks?filters[metadata.rough_draft][$exists]=true&status=completed"
```

### 3. Workflow State
Track workflow-specific data that doesn't fit in standard fields:

```json
{
  "metadata": {
    "workflow_run_id": "run_12345",
    "step_outputs": {
      "step1": "result...",
      "step2": "result..."
    },
    "retry_count": 2
  }
}
```

## API Reference

### Create Task with Metadata

```bash
POST /api/tasks
Content-Type: application/json

{
  "title": "Research task",
  "metadata": {
    "source": "automation",
    "priority_score": 75
  }
}
```

### Update Metadata (Merge Behavior)

When you PATCH metadata, **new keys are merged** with existing metadata (not replaced):

```bash
# Original task has: { "source": "email" }

PATCH /api/tasks/:id
Content-Type: application/json

{
  "metadata": {
    "priority_score": 85
  }
}

# Result: { "source": "email", "priority_score": 85 }
```

To update an existing key, just include it:

```bash
PATCH /api/tasks/:id
{
  "metadata": {
    "source": "api",           // Updates existing key
    "new_field": "value"       // Adds new key
  }
}
```

### Clear All Metadata

To clear all metadata, send `null`:

```bash
PATCH /api/tasks/:id
{
  "metadata": null
}
# Result: metadata becomes {}
```

### Query by Metadata

Use dot notation in filters to query nested metadata fields:

```bash
# Find tasks by metadata field
GET /api/tasks?filters[metadata.source]=email

# Find tasks with a specific priority score
GET /api/tasks?filters[metadata.priority_score]=85

# MongoDB query operators work too
GET /api/tasks?filters[metadata.priority_score][$gte]=70
```

## Versioning via Activity Logs

All metadata changes are automatically tracked in the activity log with full before/after values:

```json
{
  "eventType": "task.metadata.changed",
  "taskId": "...",
  "changes": [{
    "field": "metadata",
    "oldValue": {
      "source": "email",
      "draft_title": "Draft v1"
    },
    "newValue": {
      "source": "email",
      "draft_title": "Draft v2",
      "rough_draft": "New content..."
    }
  }],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

Query activity logs to see metadata history:

```bash
GET /api/activity-logs/task/:taskId?eventTypes=task.metadata.changed
```

## Events

When metadata changes, the following events are published:

| Event | Description |
|-------|-------------|
| `task.updated` | General update event (includes metadata in changes) |
| `task.metadata.changed` | Specific event for metadata changes only |

Subscribe to these events via webhooks or the daemon system for automation.

## Example Workflow: Draft Article Pipeline

```
1. Create parent task: "Publish article about AI"

2. Create child tasks for drafting:
   - "Write draft 1"
   - "Write draft 2"
   - "Write draft 3"

3. Each draft task stores output in metadata:
   {
     "metadata": {
       "draft_title": "AI Revolution",
       "draft_content": "...",
       "quality_score": 85
     }
   }

4. Parent task queries children to find best draft:
   GET /api/tasks?parentId=:parentId&filters[metadata.quality_score][$gte]=80&status=completed

5. Parent task publishes the best draft
```

## Best Practices

1. **Keep metadata reasonably sized** - MongoDB documents max at 16MB total
2. **Use consistent key names** - Establish conventions for your metadata keys
3. **Query by indexed paths** - For frequently queried metadata fields, consider adding indexes
4. **Store references, not copies** - For large content, consider storing URLs or artifact IDs

## Indexes

By default, the `metadata` field is not indexed. For high-performance queries on specific metadata paths, add indexes:

```javascript
// In MongoDB shell or migration
db.tasks.createIndex({ "metadata.priority_score": 1 })
db.tasks.createIndex({ "metadata.source": 1 })
```

## TypeScript Types

### Backend
```typescript
interface Task {
  // ... other fields
  metadata?: Record<string, unknown>;
}
```

### Frontend
```typescript
interface Task {
  // ... other fields
  metadata?: Record<string, unknown>;
}
```
