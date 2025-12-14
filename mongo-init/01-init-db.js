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
        },
        // Flexible metadata for task outputs and custom fields
        metadata: {
          bsonType: 'object',
          description: 'Flexible metadata object for storing task outputs, results, and custom data'
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
// ACTIVITY LOGS - Task activity/comment history
// ============================================================================
db.createCollection('activity_logs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['taskId', 'eventType', 'actorType', 'timestamp'],
      properties: {
        taskId: {
          bsonType: 'objectId',
          description: 'Task this activity relates to - required'
        },
        eventType: {
          bsonType: 'string',
          enum: ['task.created', 'task.updated', 'task.deleted', 'task.status.changed',
                 'task.assignee.changed', 'task.priority.changed', 'task.metadata.changed',
                 'task.moved', 'task.comment.added'],
          description: 'Type of event'
        },
        actorId: {
          bsonType: ['objectId', 'null'],
          description: 'User or system that triggered the event'
        },
        actorType: {
          bsonType: 'string',
          enum: ['user', 'system', 'daemon'],
          description: 'Type of actor'
        },
        changes: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              field: { bsonType: 'string' },
              oldValue: { },
              newValue: { }
            }
          },
          description: 'Field changes made'
        },
        comment: {
          bsonType: 'string',
          description: 'Optional comment or note'
        },
        timestamp: {
          bsonType: 'date',
          description: 'When the event occurred'
        },
        metadata: {
          bsonType: 'object',
          description: 'Additional event metadata'
        }
      }
    }
  }
});

db.activity_logs.createIndex({ taskId: 1, timestamp: -1 });
db.activity_logs.createIndex({ actorId: 1 });
db.activity_logs.createIndex({ eventType: 1 });
db.activity_logs.createIndex({ timestamp: -1 });

// ============================================================================
// WEBHOOKS - Outbound webhook configurations
// ============================================================================
db.createCollection('webhooks', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'url', 'secret', 'triggers', 'isActive', 'createdAt'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Webhook name - required'
        },
        url: {
          bsonType: 'string',
          description: 'Target URL - required'
        },
        secret: {
          bsonType: 'string',
          description: 'Secret key for authentication - required'
        },
        triggers: {
          bsonType: 'array',
          items: {
            bsonType: 'string',
            enum: ['task.created', 'task.updated', 'task.deleted', 'task.status.changed',
                   'task.assignee.changed', 'task.priority.changed', 'task.entered_filter']
          },
          description: 'Event types that trigger this webhook'
        },
        savedSearchId: {
          bsonType: ['objectId', 'null'],
          description: 'Optional saved search for filter-based triggers'
        },
        filterQuery: {
          bsonType: 'string',
          description: 'Optional filter query string'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Whether the webhook is active'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this webhook'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        }
      }
    }
  }
});

db.webhooks.createIndex({ isActive: 1 });
db.webhooks.createIndex({ triggers: 1 });
db.webhooks.createIndex({ savedSearchId: 1 });

// ============================================================================
// WEBHOOK DELIVERIES - Track webhook delivery attempts
// ============================================================================
db.createCollection('webhook_deliveries', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['webhookId', 'eventId', 'eventType', 'payload', 'status', 'attempts', 'createdAt'],
      properties: {
        webhookId: {
          bsonType: 'objectId',
          description: 'Webhook this delivery belongs to'
        },
        eventId: {
          bsonType: 'string',
          description: 'Event ID being delivered'
        },
        eventType: {
          bsonType: 'string',
          description: 'Type of event'
        },
        payload: {
          bsonType: 'object',
          description: 'Payload sent to webhook'
        },
        status: {
          bsonType: 'string',
          enum: ['pending', 'success', 'failed', 'retrying'],
          description: 'Delivery status'
        },
        statusCode: {
          bsonType: 'int',
          description: 'HTTP status code from response'
        },
        responseBody: {
          bsonType: 'string',
          description: 'Response body (truncated)'
        },
        error: {
          bsonType: 'string',
          description: 'Error message if failed'
        },
        attempts: {
          bsonType: 'int',
          minimum: 0,
          description: 'Number of delivery attempts'
        },
        maxAttempts: {
          bsonType: 'int',
          minimum: 1,
          description: 'Maximum retry attempts'
        },
        nextRetryAt: {
          bsonType: ['date', 'null'],
          description: 'Scheduled retry time'
        },
        createdAt: {
          bsonType: 'date',
          description: 'When delivery was created'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When delivery completed'
        }
      }
    }
  }
});

db.webhook_deliveries.createIndex({ webhookId: 1, createdAt: -1 });
db.webhook_deliveries.createIndex({ status: 1, nextRetryAt: 1 });
db.webhook_deliveries.createIndex({ eventId: 1 });

// ============================================================================
// DAEMON EXECUTIONS - Track automation daemon executions
// ============================================================================
db.createCollection('daemon_executions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ruleName', 'taskId', 'eventId', 'command', 'status', 'createdAt'],
      properties: {
        ruleName: {
          bsonType: 'string',
          description: 'Name of the daemon rule'
        },
        taskId: {
          bsonType: 'objectId',
          description: 'Task that triggered the execution'
        },
        eventId: {
          bsonType: 'string',
          description: 'Event that triggered the execution'
        },
        command: {
          bsonType: 'string',
          description: 'Command that was executed'
        },
        status: {
          bsonType: 'string',
          enum: ['pending', 'running', 'completed', 'failed'],
          description: 'Execution status'
        },
        output: {
          bsonType: 'string',
          description: 'Command output'
        },
        error: {
          bsonType: 'string',
          description: 'Error message if failed'
        },
        updatedFields: {
          bsonType: 'object',
          description: 'Fields updated based on result'
        },
        startedAt: {
          bsonType: ['date', 'null'],
          description: 'When execution started'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When execution completed'
        },
        createdAt: {
          bsonType: 'date',
          description: 'When execution was created'
        }
      }
    }
  }
});

db.daemon_executions.createIndex({ ruleName: 1, createdAt: -1 });
db.daemon_executions.createIndex({ taskId: 1 });
db.daemon_executions.createIndex({ status: 1 });
db.daemon_executions.createIndex({ createdAt: -1 });

print('Database initialization complete!');
