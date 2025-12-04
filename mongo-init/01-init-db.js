// MongoDB Initialization Script
// This script runs when the container is first created

db = db.getSiblingDB('coordination_matrix');

// ============================================================================
// TASKS COLLECTION - Core task management with simplified nesting support
// ============================================================================
db.createCollection('tasks', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['title', 'status', 'createdAt'],
      properties: {
        title: {
          bsonType: 'string',
          description: 'Task title - required'
        },
        summary: {
          bsonType: 'string',
          description: 'Task summary'
        },
        extraPrompt: {
          bsonType: 'string',
          description: 'Extra prompt for AI tasks'
        },
        additionalInfo: {
          bsonType: 'string',
          description: 'Additional information'
        },
        status: {
          bsonType: 'string',
          enum: ['pending', 'in_progress', 'on_hold', 'completed', 'cancelled'],
          description: 'Current task status'
        },
        urgency: {
          bsonType: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Task urgency level'
        },
        // Simplified hierarchy - just parent reference
        parentId: {
          bsonType: ['objectId', 'null'],
          description: 'Parent task ID for nested tasks'
        },
        // Workflow metadata
        workflowId: {
          bsonType: ['objectId', 'null'],
          description: 'Associated workflow definition'
        },
        workflowStage: {
          bsonType: 'string',
          description: 'Current stage in workflow'
        },
        // External tracking
        externalId: {
          bsonType: 'string',
          description: 'External reference ID'
        },
        externalHoldDate: {
          bsonType: ['date', 'null'],
          description: 'Date when external hold expires'
        },
        // Assignment and ownership
        assigneeId: {
          bsonType: ['objectId', 'null'],
          description: 'Assigned user ID'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'Creator user ID'
        },
        // Tags
        tags: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Task tags for categorization'
        },
        // Timestamps
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        },
        dueAt: {
          bsonType: ['date', 'null'],
          description: 'Due date for the task'
        }
      }
    }
  }
});

// Task indexes
db.tasks.createIndex({ status: 1 });
db.tasks.createIndex({ parentId: 1 });
db.tasks.createIndex({ urgency: 1 });
db.tasks.createIndex({ assigneeId: 1 });
db.tasks.createIndex({ workflowId: 1 });
db.tasks.createIndex({ createdAt: -1 });
db.tasks.createIndex({ tags: 1 });
db.tasks.createIndex({ externalId: 1 });
db.tasks.createIndex({ title: 'text', summary: 'text' });

// ============================================================================
// FIELD CONFIGURATIONS - Dynamic field definitions
// ============================================================================
db.createCollection('field_configs');

db.field_configs.createIndex({ collectionName: 1, fieldPath: 1 }, { unique: true });
db.field_configs.createIndex({ collectionName: 1, displayOrder: 1 });

// ============================================================================
// LOOKUP TABLES - For human-readable name resolution
// ============================================================================
db.createCollection('lookups');

db.lookups.createIndex({ type: 1, code: 1 }, { unique: true });
db.lookups.createIndex({ type: 1, isActive: 1 });

// ============================================================================
// USER PREFERENCES - Per-user column/view configurations
// ============================================================================
db.createCollection('user_preferences');

db.user_preferences.createIndex({ userId: 1, viewId: 1 }, { unique: true });

// ============================================================================
// VIEWS - Saved view configurations
// ============================================================================
db.createCollection('views');

db.views.createIndex({ collectionName: 1, isDefault: 1 });
db.views.createIndex({ createdById: 1 });

// ============================================================================
// USERS - Basic user management
// ============================================================================
db.createCollection('users');

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ isActive: 1 });

// ============================================================================
// TEAMS - Team management
// ============================================================================
db.createCollection('teams');

db.teams.createIndex({ name: 1 }, { unique: true });

// ============================================================================
// WORKFLOWS - Workflow definitions
// ============================================================================
db.createCollection('workflows');

db.workflows.createIndex({ name: 1 });
db.workflows.createIndex({ isActive: 1 });

// ============================================================================
// EXTERNAL JOBS - Queue for external work
// ============================================================================
db.createCollection('external_jobs');

db.external_jobs.createIndex({ status: 1, createdAt: 1 });
db.external_jobs.createIndex({ taskId: 1 });
db.external_jobs.createIndex({ type: 1 });

// ============================================================================
// AUDIT LOG - Track changes
// ============================================================================
db.createCollection('audit_logs');

db.audit_logs.createIndex({ collectionName: 1, documentId: 1 });
db.audit_logs.createIndex({ userId: 1 });
db.audit_logs.createIndex({ createdAt: -1 });

print('Database initialization complete!');
