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
          enum: ['pending', 'in_progress', 'on_hold', 'waiting', 'completed', 'failed', 'cancelled'],
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
        },
        // Workflow execution fields
        workflowRunId: {
          bsonType: ['objectId', 'null'],
          description: 'Associated workflow run instance'
        },
        workflowStepId: {
          bsonType: 'string',
          description: 'Step ID within workflow definition'
        },
        taskType: {
          bsonType: 'string',
          enum: ['standard', 'decision', 'foreach', 'join', 'external', 'subflow'],
          description: 'Type of task for workflow execution'
        },
        executionMode: {
          bsonType: 'string',
          enum: ['manual', 'automated', 'immediate', 'external_callback'],
          description: 'How the task should be executed'
        },
        foreachConfig: {
          bsonType: 'object',
          description: 'Configuration for foreach tasks'
        },
        externalConfig: {
          bsonType: 'object',
          description: 'Configuration for external callback tasks'
        },
        batchCounters: {
          bsonType: 'object',
          description: 'Counters for batch/foreach operations'
        },
        joinConfig: {
          bsonType: 'object',
          description: 'Configuration for join tasks'
        },
        decisionResult: {
          bsonType: 'string',
          description: 'Result of a decision task (selected step ID)'
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
db.tasks.createIndex({ workflowRunId: 1 });
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
// WORKFLOW RUNS - Workflow execution instances
// ============================================================================
db.createCollection('workflow_runs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['workflowId', 'status', 'createdAt'],
      properties: {
        workflowId: {
          bsonType: 'objectId',
          description: 'Reference to workflow definition'
        },
        workflowVersion: {
          bsonType: 'int',
          description: 'Snapshot version of workflow at run time'
        },

        // Execution status
        status: {
          bsonType: 'string',
          enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
          description: 'Current run status'
        },

        // Task tracking
        rootTaskId: {
          bsonType: ['objectId', 'null'],
          description: 'Root task created for this run'
        },
        currentStepIds: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Currently active step IDs (supports parallel execution)'
        },
        completedStepIds: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Steps that have completed'
        },

        // Input/Output
        inputPayload: {
          bsonType: 'object',
          description: 'Initial input data for the workflow'
        },
        outputPayload: {
          bsonType: 'object',
          description: 'Final aggregated output from the workflow'
        },

        // Error handling
        error: {
          bsonType: 'string',
          description: 'Error message if failed'
        },
        failedStepId: {
          bsonType: 'string',
          description: 'Step ID where failure occurred'
        },

        // Callback configuration (for external triggers)
        callbackSecret: {
          bsonType: 'string',
          description: 'Secret for authenticating external callbacks'
        },

        // Ownership
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who triggered this run'
        },

        // Task defaults applied to all child tasks
        taskDefaults: {
          bsonType: 'object',
          description: 'Default values for tasks created in this run'
        },

        // Execution options
        executionOptions: {
          bsonType: 'object',
          description: 'Options controlling workflow execution'
        },

        // External correlation
        externalId: {
          bsonType: 'string',
          description: 'External system reference ID'
        },
        source: {
          bsonType: 'string',
          description: 'Source system that triggered this run'
        },

        // Timestamps
        createdAt: {
          bsonType: 'date',
          description: 'When the run was created'
        },
        startedAt: {
          bsonType: ['date', 'null'],
          description: 'When execution started'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When execution completed'
        }
      }
    }
  }
});

db.workflow_runs.createIndex({ workflowId: 1, createdAt: -1 });
db.workflow_runs.createIndex({ status: 1 });
db.workflow_runs.createIndex({ rootTaskId: 1 });
db.workflow_runs.createIndex({ createdAt: -1 });
db.workflow_runs.createIndex({ createdById: 1 });

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

// ============================================================================
// BATCH JOBS - Fan-out/fan-in workflow coordination
// ============================================================================
db.createCollection('batch_jobs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['status', 'expectedCount', 'createdAt'],
      properties: {
        // Core identification
        name: {
          bsonType: 'string',
          description: 'Human-readable batch job name'
        },
        type: {
          bsonType: 'string',
          description: 'Batch job type (e.g., email_analysis, data_processing)'
        },

        // Workflow correlation
        workflowId: {
          bsonType: ['objectId', 'null'],
          description: 'Associated workflow if part of a workflow run'
        },
        workflowStepId: {
          bsonType: 'string',
          description: 'Step ID within workflow (e.g., foreach step)'
        },
        taskId: {
          bsonType: ['objectId', 'null'],
          description: 'Parent task that initiated this batch'
        },

        // Callback configuration
        callbackUrl: {
          bsonType: 'string',
          description: 'URL where external service should POST results'
        },
        callbackSecret: {
          bsonType: 'string',
          description: 'Secret for authenticating callbacks (whsec_ prefix)'
        },

        // Batch tracking
        status: {
          bsonType: 'string',
          enum: ['pending', 'processing', 'awaiting_responses', 'completed',
                 'completed_with_warnings', 'failed', 'cancelled', 'manual_review'],
          description: 'Current batch job status'
        },
        expectedCount: {
          bsonType: 'int',
          minimum: 0,
          description: 'Expected number of items to process'
        },
        receivedCount: {
          bsonType: 'int',
          minimum: 0,
          description: 'Number of callback responses received'
        },
        processedCount: {
          bsonType: 'int',
          minimum: 0,
          description: 'Number of items successfully processed'
        },
        failedCount: {
          bsonType: 'int',
          minimum: 0,
          description: 'Number of items that failed'
        },

        // Completion policy
        minSuccessPercent: {
          bsonType: 'double',
          minimum: 0,
          maximum: 100,
          description: 'Minimum success percentage required (default: 100)'
        },
        deadlineAt: {
          bsonType: ['date', 'null'],
          description: 'Deadline for receiving all responses'
        },

        // Payload and results
        inputPayload: {
          bsonType: 'object',
          description: 'Original input data sent to external service'
        },
        aggregateResult: {
          bsonType: 'object',
          description: 'Aggregated results after join (sealed on completion)'
        },
        isResultSealed: {
          bsonType: 'bool',
          description: 'Whether aggregate result is finalized'
        },

        // Manual review
        requiresManualReview: {
          bsonType: 'bool',
          description: 'Whether this job requires manual review before proceeding'
        },
        reviewedById: {
          bsonType: ['objectId', 'null'],
          description: 'User who reviewed this batch job'
        },
        reviewedAt: {
          bsonType: ['date', 'null'],
          description: 'When the job was reviewed'
        },
        reviewDecision: {
          bsonType: 'string',
          enum: ['approved', 'rejected', 'proceed_with_partial'],
          description: 'Manual review decision'
        },
        reviewNotes: {
          bsonType: 'string',
          description: 'Notes from manual review'
        },

        // Ownership
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this batch job'
        },

        // Timestamps
        createdAt: {
          bsonType: 'date',
          description: 'When the batch job was created'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        },
        startedAt: {
          bsonType: ['date', 'null'],
          description: 'When processing started'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When the batch job completed'
        }
      }
    }
  }
});

db.batch_jobs.createIndex({ status: 1, deadlineAt: 1 });
db.batch_jobs.createIndex({ workflowId: 1, workflowStepId: 1 });
db.batch_jobs.createIndex({ taskId: 1 });
db.batch_jobs.createIndex({ type: 1 });
db.batch_jobs.createIndex({ createdAt: -1 });
db.batch_jobs.createIndex({ status: 1, requiresManualReview: 1 });

// ============================================================================
// BATCH ITEMS - Individual items within a batch job (for deduplication)
// ============================================================================
db.createCollection('batch_items', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['batchJobId', 'itemKey', 'status', 'createdAt'],
      properties: {
        batchJobId: {
          bsonType: 'objectId',
          description: 'Parent batch job'
        },

        // Idempotency key (e.g., job_id + email_message_id)
        itemKey: {
          bsonType: 'string',
          description: 'Unique key for deduplication within batch'
        },

        // Optional external reference
        externalId: {
          bsonType: 'string',
          description: 'External system ID (e.g., email_message_id)'
        },

        // Processing status
        status: {
          bsonType: 'string',
          enum: ['pending', 'received', 'processing', 'completed', 'failed', 'skipped'],
          description: 'Item processing status'
        },

        // Item data
        inputData: {
          bsonType: 'object',
          description: 'Input data for this item'
        },
        resultData: {
          bsonType: 'object',
          description: 'Result data from processing'
        },
        error: {
          bsonType: 'string',
          description: 'Error message if failed'
        },

        // Tracking
        attempts: {
          bsonType: 'int',
          minimum: 0,
          description: 'Number of processing attempts'
        },

        // Timestamps
        createdAt: {
          bsonType: 'date',
          description: 'When the item was created'
        },
        receivedAt: {
          bsonType: ['date', 'null'],
          description: 'When callback was received'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When processing completed'
        }
      }
    }
  }
});

// Unique constraint for idempotent processing
db.batch_items.createIndex({ batchJobId: 1, itemKey: 1 }, { unique: true });
db.batch_items.createIndex({ batchJobId: 1, status: 1 });
db.batch_items.createIndex({ batchJobId: 1, createdAt: 1 });
db.batch_items.createIndex({ externalId: 1 });

print('Database initialization complete!');
