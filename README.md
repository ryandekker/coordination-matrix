# Coordination Matrix

AI Workflow Task Management System with hierarchical task support.

## Overview

Coordination Matrix is a full-stack application for managing AI workflow tasks with:
- **Task Hierarchy**: Parent-child task relationships for organizing complex work
- **Dynamic Field Configuration**: Configurable field display, editing, and filtering stored in the database
- **Reference Resolution**: Automatic resolution of linked records (users, workflows, statuses) with human-readable names
- **Inline Editing**: Spreadsheet-style editing directly in the table
- **External Job Integration**: API for external systems to perform AI work
- **Workflow Support**: Associate tasks with workflows and track stages

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

2. **Start all services:**
   ```bash
   docker compose up -d
   ```

   This will:
   - Start MongoDB with initialization scripts
   - Load sample data (users, tasks, workflows, field configs)
   - Start the Express backend
   - Start the Next.js frontend

3. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Mongo Express (optional): http://localhost:8081

   To enable Mongo Express for database management:
   ```bash
   docker compose --profile tools up -d
   ```

4. **Reset the database** (if needed):
   ```bash
   docker compose down -v
   docker compose up -d
   ```

### Local Development

1. **Start MongoDB:**
   ```bash
   docker compose up -d mongodb
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

- **Nested Tasks**: Create hierarchical task structures with parent-child relationships
- **Status Tracking**: Pending, In Progress, On Hold, Completed, Cancelled
- **Urgency Levels**: Low, Normal, High, Urgent
- **Tags**: Flexible categorization with tag arrays
- **External Tracking**: Link tasks to external systems with `externalId` and `externalHoldDate`

### Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Task title (required) |
| `summary` | string | Task description/summary |
| `extraPrompt` | string | Additional prompt for AI tasks |
| `additionalInfo` | string | Supplementary information |
| `status` | enum | pending, in_progress, on_hold, completed, cancelled |
| `urgency` | enum | low, normal, high, urgent |
| `parentId` | ObjectId | Parent task for hierarchy |
| `workflowId` | ObjectId | Associated workflow |
| `workflowStage` | string | Current stage in workflow |
| `externalId` | string | External system reference |
| `externalHoldDate` | Date | When external hold expires |
| `assigneeId` | ObjectId | Assigned user |
| `createdById` | ObjectId | Creator user |
| `tags` | string[] | Task tags |
| `dueAt` | Date | Due date |

### Dynamic Configuration

All field configurations are stored in the database:
- Display names and ordering
- Field types (text, textarea, select, reference, datetime, tags, etc.)
- Editability and visibility defaults
- Lookup types for status/urgency displays
- Reference fields for linked records

### Views System

Create and save custom views with:
- Filters and sorting
- Column visibility
- User-specific preferences
- System default views (All Tasks, My Tasks, On Hold, Urgent Tasks)

### Workflows

Define workflows with stages to track task progression:
- Content Generation Pipeline
- Bug Fix Process
- Feature Development

### External Job Interface

The external jobs API allows AI workers to:
1. **Get pending jobs**: `GET /api/external-jobs/pending`
2. **Claim jobs**: `PUT /api/external-jobs/:id/claim`
3. **Complete jobs**: `PUT /api/external-jobs/:id/complete`
4. **Fail jobs**: `PUT /api/external-jobs/:id/fail` (with automatic retry)

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
- `DELETE /api/lookups/:id` - Delete lookup

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

### Workflows
- `GET /api/workflows` - List workflows
- `POST /api/workflows` - Create workflow
- `PATCH /api/workflows/:id` - Update workflow

## Database Schema

### Collections

- **tasks** - Main task records with hierarchy support
- **field_configs** - Dynamic field configuration
- **lookups** - Status codes, urgency levels
- **views** - Saved view configurations
- **user_preferences** - Per-user column preferences
- **users** - User records
- **teams** - Team records
- **workflows** - Workflow definitions
- **external_jobs** - External work queue
- **audit_logs** - Change tracking

## Sample Data

The application comes with sample data loaded on first run:

**Users:**
- Admin User (admin)
- Alex Operator (operator)
- Sarah Chen (operator)
- Marcus Johnson (reviewer)
- Emma Wilson (viewer)

**Sample Tasks:**
- Q4 Marketing Campaign (with subtasks)
- Website Redesign Project
- Fix Login Authentication Bug
- Update API Documentation
- And more...

**Workflows:**
- Content Generation Pipeline
- Bug Fix Process
- Feature Development

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

1. Add field to MongoDB schema validator in `mongo-init/01-init-db.js`
2. Create field configuration in `field_configs` collection
3. Add lookup values if needed (for select fields)

### Adding New Lookup Values

Use the Settings > Lookups page or API to add new status codes or urgency levels.

### Integrating AI Workers

```javascript
// Worker example
async function processJobs() {
  // 1. Get pending jobs
  const response = await fetch('/api/external-jobs/pending?type=ai_generation');
  const jobs = await response.json();

  for (const job of jobs.data) {
    // 2. Claim job
    await fetch(`/api/external-jobs/${job._id}/claim`, { method: 'PUT' });

    try {
      // 3. Do AI work
      const result = await performAIWork(job.payload);

      // 4. Complete job
      await fetch(`/api/external-jobs/${job._id}/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      });
    } catch (error) {
      // 5. Fail job (will retry automatically)
      await fetch(`/api/external-jobs/${job._id}/fail`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message, retryAfter: 60 })
      });
    }
  }
}
```

## Tech Stack

- **Frontend**: Next.js 14, React, TanStack Table, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TypeScript
- **Database**: MongoDB 7.0
- **Infrastructure**: Docker, Docker Compose

## License

MIT
