# Coordination Matrix

AI Workflow Task Management System with Human-in-the-Loop (HITL) support.

## Overview

Coordination Matrix is a full-stack application for managing AI workflow tasks with:
- **Task Nesting**: Deep hierarchical task structures with parent-child relationships
- **Human-in-the-Loop (HITL)**: Flag tasks for human review at various workflow phases
- **Dynamic Field Configuration**: Configurable field display, editing, and filtering stored in the database
- **Reference Resolution**: Automatic resolution of linked records (users, teams, statuses) with human-readable names
- **Spreadsheet-style Editing**: Inline editing directly in the table, plus modal editing for detailed changes
- **External Job Integration**: API for external systems to perform actual AI work

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│    Backend      │────▶│    MongoDB      │
│   (Next.js)     │     │   (Express)     │     │                 │
│   Port: 3000    │     │   Port: 3001    │     │   Port: 27017   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  External Jobs  │
                        │   (AI Workers)  │
                        └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)

### Running with Docker Compose

1. **Clone and navigate to the project:**
   ```bash
   cd coordination-matrix
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Start all services:**
   ```bash
   docker-compose up -d
   ```

4. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Mongo Express (optional): http://localhost:8081

   To enable Mongo Express:
   ```bash
   docker-compose --profile tools up -d
   ```

### Local Development

1. **Start MongoDB:**
   ```bash
   docker-compose up -d mongodb
   ```

2. **Start backend:**
   ```bash
   cd backend
   npm install
   npm run dev
   ```

3. **Start frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Features

### Task Management

- **Nested Tasks**: Create unlimited depth task hierarchies
- **Status Tracking**: Pending, In Progress, Waiting Review, Waiting Human, Completed, Failed, Cancelled
- **Priority Levels**: Low, Medium, High, Critical
- **Tags and Metadata**: Flexible categorization and custom data storage

### Human-in-the-Loop (HITL)

Configure when human intervention is required:
- **Pre-Execution**: Approval before work begins
- **During Execution**: Checkpoints during processing
- **Post-Execution**: Review of completed work
- **On Error**: Human review when failures occur
- **Approval Required**: Explicit sign-off needed

HITL Status tracking:
- Not Required, Pending, In Review, Approved, Rejected, Escalated

### Dynamic Configuration

All field configurations are stored in the database:
- Display names and ordering
- Field types (text, select, reference, datetime, tags, etc.)
- Editability and visibility defaults
- Lookup types for status/priority displays
- Reference fields for linked records

### Views System

Create and save custom views with:
- Filters and sorting
- Column visibility
- User-specific preferences
- System default views

### External Job Interface

The external jobs API allows AI workers to:
1. **Claim jobs**: `PUT /api/external-jobs/:id/claim`
2. **Complete jobs**: `PUT /api/external-jobs/:id/complete`
3. **Fail jobs**: `PUT /api/external-jobs/:id/fail` (with automatic retry)

## API Endpoints

### Tasks
- `GET /api/tasks` - List tasks with pagination, filtering, sorting
- `GET /api/tasks/tree` - Get tasks as tree structure
- `GET /api/tasks/:id` - Get single task
- `GET /api/tasks/:id/children` - Get child tasks
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/:id` - Update task
- `PUT /api/tasks/:id/move` - Move task to new parent
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/bulk` - Bulk operations

### Lookups
- `GET /api/lookups` - Get all lookups grouped by type
- `GET /api/lookups/:type` - Get lookups by type
- `POST /api/lookups` - Create lookup
- `PATCH /api/lookups/:id` - Update lookup

### Field Configurations
- `GET /api/field-configs/:collection` - Get field configs
- `POST /api/field-configs` - Create field config
- `PATCH /api/field-configs/:id` - Update field config

### Views
- `GET /api/views` - List views
- `POST /api/views` - Create view
- `PATCH /api/views/:id` - Update view
- `PUT /api/views/:id/preferences` - Save user preferences

### External Jobs
- `GET /api/external-jobs` - List jobs
- `GET /api/external-jobs/pending` - Get pending jobs for workers
- `POST /api/external-jobs` - Create job
- `PUT /api/external-jobs/:id/claim` - Claim job for processing
- `PUT /api/external-jobs/:id/complete` - Mark job complete
- `PUT /api/external-jobs/:id/fail` - Mark job failed

### Users
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PATCH /api/users/:id` - Update user

## Database Schema

### Collections

- **tasks** - Main task records with nesting support
- **field_configs** - Dynamic field configuration
- **lookups** - Status codes, priorities, HITL phases
- **views** - Saved view configurations
- **user_preferences** - Per-user column preferences
- **users** - User records
- **teams** - Team records
- **workflows** - Workflow definitions
- **external_jobs** - External work queue
- **audit_logs** - Change tracking

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_ROOT_USER` | MongoDB admin username | admin |
| `MONGO_ROOT_PASSWORD` | MongoDB admin password | adminpassword |
| `NODE_ENV` | Environment | development |
| `JWT_SECRET` | JWT signing secret | - |
| `NEXT_PUBLIC_API_URL` | Backend API URL | http://localhost:3001/api |

## Extending the System

### Adding New Fields

1. Add field to MongoDB schema validator (optional)
2. Create field configuration in `field_configs` collection
3. Add lookup values if needed

### Adding New Task Types

Use the `metadata` field and `tags` for custom task categorization without schema changes.

### Integrating AI Workers

```javascript
// Worker example
async function processJobs() {
  // 1. Get pending jobs
  const jobs = await fetch('/api/external-jobs/pending?type=ai_generation');

  for (const job of jobs.data) {
    // 2. Claim job
    await fetch(`/api/external-jobs/${job._id}/claim`, { method: 'PUT' });

    try {
      // 3. Do AI work
      const result = await performAIWork(job.payload);

      // 4. Complete job
      await fetch(`/api/external-jobs/${job._id}/complete`, {
        method: 'PUT',
        body: JSON.stringify({ result })
      });
    } catch (error) {
      // 5. Fail job (will retry automatically)
      await fetch(`/api/external-jobs/${job._id}/fail`, {
        method: 'PUT',
        body: JSON.stringify({ error: error.message, retryAfter: 60 })
      });
    }
  }
}
```

## License

MIT
