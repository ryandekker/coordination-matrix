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
        humanInstruction: {
          bsonType: 'string',
          description: 'Original human request/goal — propagated unchanged to all child tasks'
        },
        status: {
          bsonType: 'string',
          enum: ['pending', 'in_progress', 'on_hold', 'waiting', 'completed', 'failed', 'cancelled', 'archived'],
          description: 'Current task status'
        },
        urgency: {
          bsonType: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Task urgency level'
        },
        // Group and Project access control
        groupId: {
          bsonType: ['objectId', 'null'],
          description: 'Group this task belongs to (admin-only if null)'
        },
        projectId: {
          bsonType: ['objectId', 'null'],
          description: 'Project within the group (optional)'
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
        creatorType: {
          bsonType: 'string',
          enum: ['human', 'agent', 'system'],
          description: 'Type of creator: human, agent, or system'
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
          enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', 'findDocument', 'code'],
          description: 'Type of task for workflow execution - maps 1:1 to workflow step types'
        },
        executionMode: {
          bsonType: 'string',
          enum: ['manual', 'automated', 'immediate', 'external_callback'],
          description: 'How the task should be executed'
        },
        // Expected quantity of subtasks/results this task produces
        expectedQuantity: {
          bsonType: 'int',
          description: 'Expected number of subtasks/results this task will produce'
        },
        foreachConfig: {
          bsonType: 'object',
          description: 'Configuration for foreach tasks'
        },
        externalConfig: {
          bsonType: 'object',
          description: 'Configuration for external callback tasks'
        },
        webhookConfig: {
          bsonType: 'object',
          description: 'Configuration for webhook tasks (outbound HTTP calls)'
        },
        batchCounters: {
          bsonType: 'object',
          description: 'Counters for batch/foreach operations'
        },
        joinConfig: {
          bsonType: 'object',
          description: 'Configuration for join tasks (includes awaitStepId, boundary conditions)'
        },
        decisionResult: {
          bsonType: 'string',
          description: 'Result of a decision task (selected step ID)'
        },
        // Task-to-workflow routing fields
        spawnedWorkflowRunId: {
          bsonType: ['objectId', 'null'],
          description: 'Workflow run spawned FROM this task (for routing/decision tasks)'
        },
        workflowResult: {
          bsonType: 'object',
          description: 'Result information from spawned workflow (status, outputPayload, error)'
        },
        // Trigger field: when set, system auto-starts this workflow with task as trigger
        triggerWorkflowId: {
          bsonType: ['objectId', 'null'],
          description: 'Workflow ID to trigger - when set, system starts this workflow with task as trigger'
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
db.tasks.createIndex({ workflowStepId: 1 });  // For join step lookups
db.tasks.createIndex({ taskType: 1 });  // For filtering by task type
db.tasks.createIndex({ createdAt: -1 });
db.tasks.createIndex({ tags: 1 });
db.tasks.createIndex({ externalId: 1 });
db.tasks.createIndex({ spawnedWorkflowRunId: 1 });  // For finding tasks that spawned workflows
db.tasks.createIndex({ createdById: 1 });
db.tasks.createIndex({ creatorType: 1 });
db.tasks.createIndex({ creatorType: 1, status: 1, assigneeId: 1 });  // For dashboard/kanban queries
db.tasks.createIndex({ title: 'text', summary: 'text' });
// Group and project indexes for access control
db.tasks.createIndex({ groupId: 1, status: 1, createdAt: -1 });
db.tasks.createIndex({ projectId: 1, status: 1, createdAt: -1 });
db.tasks.createIndex({ groupId: 1, projectId: 1 });

// Compound indexes for workflow task queries (prevents blocking in-memory sorts)
// Critical for GET /api/workflow-runs/:id?includeTasks=true with large task sets
db.tasks.createIndex({ workflowRunId: 1, createdAt: 1 });
// For queries filtering by workflowRunId and status (e.g., completeWorkflow)
db.tasks.createIndex({ workflowRunId: 1, status: 1 });
// Compound indexes for subtask queries (filter by parent + sort)
db.tasks.createIndex({ parentId: 1, createdAt: 1 });
// For filtered subtask queries (parent + status + sort)
db.tasks.createIndex({ parentId: 1, status: 1, createdAt: 1 });
// Additional compound indexes for common query patterns (performance optimization)
// For workflowStepId with status filter (used in workflow step lookups)
db.tasks.createIndex({ workflowStepId: 1, status: 1 });
// For assignee-based queries with status and date sort
db.tasks.createIndex({ assigneeId: 1, status: 1, createdAt: -1 });
// Sparse index for human instruction search
db.tasks.createIndex({ humanInstruction: 1 }, { sparse: true });

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
db.views.createIndex({ folderId: 1 });

// ============================================================================
// VIEW FOLDERS - Folders for organizing saved views
// ============================================================================
db.createCollection('view_folders');

db.view_folders.createIndex({ collectionName: 1, sortOrder: 1 });
db.view_folders.createIndex({ createdById: 1 });

// ============================================================================
// USERS - Basic user management
// ============================================================================
db.createCollection('users');

db.users.createIndex({ email: 1 }, { unique: true, sparse: true });
db.users.createIndex({ isActive: 1 });
db.users.createIndex({ isSystem: 1 }, { sparse: true });  // For finding the system user

// ============================================================================
// GROUPS - Access control groups
// ============================================================================
db.createCollection('groups', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'displayName', 'members', 'visibility', 'createdAt', 'updatedAt'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Unique slug (lowercase, no spaces) - required'
        },
        displayName: {
          bsonType: 'string',
          description: 'Human-readable name - required'
        },
        description: {
          bsonType: 'string',
          description: 'Group description'
        },
        members: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['userId', 'role', 'addedAt'],
            properties: {
              userId: {
                bsonType: 'objectId',
                description: 'User ID'
              },
              role: {
                bsonType: 'string',
                enum: ['owner', 'admin', 'member', 'viewer'],
                description: 'Role within the group'
              },
              addedAt: {
                bsonType: 'date',
                description: 'When the user was added'
              },
              addedById: {
                bsonType: ['objectId', 'null'],
                description: 'Who added this user'
              }
            }
          },
          description: 'Group members with roles - required'
        },
        visibility: {
          bsonType: 'string',
          enum: ['private', 'internal'],
          description: 'Group visibility - required'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this group'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp - required'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp - required'
        }
      }
    }
  }
});

db.groups.createIndex({ name: 1 }, { unique: true });
db.groups.createIndex({ 'members.userId': 1 });
db.groups.createIndex({ visibility: 1 });
db.groups.createIndex({ createdById: 1 });

// ============================================================================
// PROJECTS - Organizational units within groups
// ============================================================================
db.createCollection('projects', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'displayName', 'groupId', 'status', 'createdAt', 'updatedAt'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Unique name per group (lowercase) - required'
        },
        displayName: {
          bsonType: 'string',
          description: 'Human-readable name - required'
        },
        description: {
          bsonType: 'string',
          description: 'Project description'
        },
        groupId: {
          bsonType: 'objectId',
          description: 'Group this project belongs to - required'
        },
        status: {
          bsonType: 'string',
          enum: ['active', 'archived'],
          description: 'Project status - required'
        },
        color: {
          bsonType: 'string',
          description: 'Hex color for UI display'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this project'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp - required'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp - required'
        }
      }
    }
  }
});

db.projects.createIndex({ groupId: 1, name: 1 }, { unique: true });
db.projects.createIndex({ groupId: 1, status: 1 });
db.projects.createIndex({ createdById: 1 });

// ============================================================================
// WORKFLOW FOLDERS - Organize workflows into folders
// ============================================================================
db.createCollection('workflow_folders');

db.workflow_folders.createIndex({ sortOrder: 1 });
db.workflow_folders.createIndex({ createdById: 1 });

// ============================================================================
// WORKFLOWS - Workflow definitions
// ============================================================================
db.createCollection('workflows');

db.workflows.createIndex({ name: 1 });
db.workflows.createIndex({ isActive: 1 });
db.workflows.createIndex({ folderId: 1 });

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

        // Group access control - inherited from workflow
        groupId: {
          bsonType: ['objectId', 'null'],
          description: 'Group this run belongs to (inherited from workflow)'
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
        // Task-to-workflow routing: the task that triggered/spawned this workflow
        triggerTaskId: {
          bsonType: ['objectId', 'null'],
          description: 'Task that triggered/spawned this workflow run (for routing patterns)'
        },
        triggerContext: {
          bsonType: 'object',
          description: 'Context passed from the trigger task (metadata, routing decision, etc.)'
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
db.workflow_runs.createIndex({ triggerTaskId: 1 });  // For finding workflows spawned by a task
db.workflow_runs.createIndex({ createdAt: -1 });
db.workflow_runs.createIndex({ createdById: 1 });
db.workflow_runs.createIndex({ groupId: 1, status: 1, createdAt: -1 });  // Group filtering

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

// ============================================================================
// API KEYS COLLECTION - API key storage with optional user association
// ============================================================================
db.createCollection('api_keys', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'keyHash', 'keyPrefix', 'scopes', 'createdAt', 'isActive'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Human-readable name for the API key'
        },
        description: {
          bsonType: ['string', 'null'],
          description: 'Optional description of what this key is used for'
        },
        keyHash: {
          bsonType: 'string',
          description: 'SHA256 hash of the API key (never store raw key)'
        },
        keyPrefix: {
          bsonType: 'string',
          description: 'Prefix of the key for display purposes'
        },
        scopes: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Array of permission scopes'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this API key'
        },
        userId: {
          bsonType: ['objectId', 'null'],
          description: 'User this API key acts as - when set, inherits user permissions'
        },
        groupId: {
          bsonType: ['objectId', 'null'],
          description: 'Group this API key is scoped to - when set, can only access resources in this group'
        },
        createdAt: {
          bsonType: 'date',
          description: 'When the key was created'
        },
        expiresAt: {
          bsonType: ['date', 'null'],
          description: 'When the key expires (null = never)'
        },
        lastUsedAt: {
          bsonType: ['date', 'null'],
          description: 'When the key was last used'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Whether the key is active'
        }
      }
    }
  }
});

// Index on keyHash for authentication lookups
db.api_keys.createIndex({ keyHash: 1 }, { unique: true });
// Index on userId to find keys tied to a specific user
db.api_keys.createIndex({ userId: 1 });
// Index on createdById to find keys created by a user
db.api_keys.createIndex({ createdById: 1 });
// Index on isActive for filtering
db.api_keys.createIndex({ isActive: 1 });
// Index on groupId for group-scoped keys
db.api_keys.createIndex({ groupId: 1 });

// ============================================================================
// TAGS COLLECTION - Structured tag definitions with colors
// ============================================================================
db.createCollection('tags', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'color', 'createdAt', 'isActive'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Tag name (unique, lowercase) - required'
        },
        displayName: {
          bsonType: 'string',
          description: 'Human-readable display name'
        },
        color: {
          bsonType: 'string',
          description: 'Hex color code for the tag - required'
        },
        description: {
          bsonType: ['string', 'null'],
          description: 'Optional description of the tag purpose'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Whether the tag is active'
        },
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this tag'
        },
        createdAt: {
          bsonType: 'date',
          description: 'When the tag was created'
        },
        updatedAt: {
          bsonType: ['date', 'null'],
          description: 'When the tag was last updated'
        }
      }
    }
  }
});

// Unique index on tag name (case-insensitive matching)
db.tags.createIndex({ name: 1 }, { unique: true });
// Index for active tags
db.tags.createIndex({ isActive: 1 });

// ============================================================================
// DOCUMENTS COLLECTION - Markdown documentation with semantic search
// ============================================================================
db.createCollection('documents', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['title', 'content', 'type', 'status', 'version', 'createdAt'],
      properties: {
        title: {
          bsonType: 'string',
          description: 'Document title - required'
        },
        content: {
          bsonType: 'string',
          description: 'Markdown content - required'
        },
        summary: {
          bsonType: 'string',
          description: 'Brief summary of the document (AI-generated or manual)'
        },

        // Group and Project access control
        groupId: {
          bsonType: ['objectId', 'null'],
          description: 'Group this document belongs to (admin-only if null)'
        },
        projectId: {
          bsonType: ['objectId', 'null'],
          description: 'Project within the group (optional)'
        },

        // Classification
        type: {
          bsonType: 'string',
          enum: ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt', 'capability'],
          description: 'Document type - required'
        },
        status: {
          bsonType: 'string',
          enum: ['draft', 'review', 'approved', 'archived'],
          description: 'Document status - required'
        },
        tags: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Document tags for categorization'
        },

        // Capability document fields (only used when type='capability')
        capabilityId: {
          bsonType: 'string',
          description: 'Unique identifier for capability (e.g., ask-questions)'
        },
        capabilityComplexity: {
          bsonType: 'int',
          enum: [1, 2, 3],
          description: 'Required agent complexity level to access (1=basic, 2=intermediate, 3=advanced)'
        },

        // Ownership
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this document'
        },
        lastModifiedById: {
          bsonType: ['objectId', 'null'],
          description: 'User who last modified this document'
        },

        // Semantic search - vector embedding
        embedding: {
          bsonType: 'array',
          items: { bsonType: 'double' },
          description: 'Vector embedding for semantic search'
        },
        embeddingModel: {
          bsonType: 'string',
          description: 'Model used to generate embedding (e.g., text-embedding-3-small)'
        },
        embeddingUpdatedAt: {
          bsonType: ['date', 'null'],
          description: 'When the embedding was last updated'
        },

        // Relationships
        parentDocumentId: {
          bsonType: ['objectId', 'null'],
          description: 'Parent document for hierarchical organization'
        },
        relatedTaskIds: {
          bsonType: 'array',
          items: { bsonType: 'objectId' },
          description: 'Tasks that reference this document'
        },
        workflowRunId: {
          bsonType: ['objectId', 'null'],
          description: 'Workflow run that created this document'
        },

        // Versioning
        version: {
          bsonType: 'int',
          minimum: 1,
          description: 'Document version number - required'
        },

        // Flexible metadata
        metadata: {
          bsonType: 'object',
          description: 'Additional metadata for the document'
        },

        // Timestamps
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp - required'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        }
      }
    }
  }
});

// Document indexes
db.documents.createIndex({ type: 1 });
db.documents.createIndex({ status: 1 });
db.documents.createIndex({ tags: 1 });
db.documents.createIndex({ createdById: 1 });
db.documents.createIndex({ parentDocumentId: 1 });
db.documents.createIndex({ workflowRunId: 1 });
db.documents.createIndex({ relatedTaskIds: 1 });  // For task->document lookups
db.documents.createIndex({ createdAt: -1 });
db.documents.createIndex({ updatedAt: -1 });
// Full-text search on title, content, and summary
db.documents.createIndex({ title: 'text', content: 'text', summary: 'text' });
// Compound indexes for common queries
db.documents.createIndex({ type: 1, status: 1 });
db.documents.createIndex({ status: 1, createdAt: -1 });
// Group and project indexes for access control
db.documents.createIndex({ groupId: 1, status: 1 });
db.documents.createIndex({ projectId: 1, status: 1 });

// ============================================================================
// DOCUMENT VERSIONS COLLECTION - Version history for documents
// ============================================================================
db.createCollection('document_versions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['documentId', 'version', 'title', 'content', 'modifiedById', 'modifiedAt'],
      properties: {
        documentId: {
          bsonType: 'objectId',
          description: 'Reference to the parent document - required'
        },
        version: {
          bsonType: 'int',
          minimum: 1,
          description: 'Version number - required'
        },
        title: {
          bsonType: 'string',
          description: 'Document title at this version - required'
        },
        content: {
          bsonType: 'string',
          description: 'Markdown content at this version - required'
        },
        summary: {
          bsonType: 'string',
          description: 'Summary at this version'
        },
        changeDescription: {
          bsonType: 'string',
          description: 'Description of changes made in this version'
        },
        modifiedById: {
          bsonType: 'objectId',
          description: 'User who created this version - required'
        },
        modifiedAt: {
          bsonType: 'date',
          description: 'When this version was created - required'
        }
      }
    }
  }
});

// Document version indexes
db.document_versions.createIndex({ documentId: 1, version: -1 });
db.document_versions.createIndex({ documentId: 1, modifiedAt: -1 });
// Unique constraint: only one version number per document
db.document_versions.createIndex({ documentId: 1, version: 1 }, { unique: true });

// ============================================================================
// VARIABLE PACKAGES - Global variable packages with branches for credentials
// ============================================================================
db.createCollection('variable_packages', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'branches', 'createdAt', 'isActive'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Package name (unique, used in templates) - required'
        },
        displayName: {
          bsonType: 'string',
          description: 'Human-readable display name'
        },
        description: {
          bsonType: 'string',
          description: 'Package description'
        },
        // Branch definitions - each branch is a variant of the package
        // Example: { "personal": { email: "...", password: "enc:..." }, "work": { ... } }
        branches: {
          bsonType: 'object',
          description: 'Map of branch name -> branch data'
        },
        // Default branch to use when not specified
        defaultBranch: {
          bsonType: 'string',
          description: 'Default branch name'
        },
        // Schema definition for UI and validation
        // Each field defines: key, displayName, type (string|secret|number|boolean), required, description
        schema: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              key: { bsonType: 'string' },
              displayName: { bsonType: 'string' },
              type: { bsonType: 'string' },
              required: { bsonType: 'bool' },
              description: { bsonType: 'string' }
            }
          },
          description: 'Field schema for the package'
        },
        // Ownership and audit
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this package'
        },
        updatedById: {
          bsonType: ['objectId', 'null'],
          description: 'User who last updated this package'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Whether the package is active'
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

// Variable package indexes
db.variable_packages.createIndex({ name: 1 }, { unique: true });
db.variable_packages.createIndex({ isActive: 1 });
db.variable_packages.createIndex({ createdById: 1 });

// ============================================================================
// CONVERSATION RECORDS - Agent conversation logs with tool execution traces
// ============================================================================
db.createCollection('conversation_records', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['taskId', 'sessionId', 'status', 'startedAt'],
      properties: {
        // Link to the task
        taskId: {
          bsonType: 'objectId',
          description: 'Task this conversation was executed for - required'
        },

        // Session tracking
        sessionId: {
          bsonType: 'string',
          description: 'Claude CLI session ID - required'
        },

        // Execution context
        jobName: {
          bsonType: 'string',
          description: 'Daemon job name that executed this'
        },
        model: {
          bsonType: 'string',
          description: 'Claude model used (e.g., claude-sonnet-4-20250514)'
        },
        execCommand: {
          bsonType: 'string',
          description: 'Full exec command used'
        },

        // Execution status
        status: {
          bsonType: 'string',
          enum: ['running', 'completed', 'failed', 'timeout'],
          description: 'Conversation execution status - required'
        },
        exitCode: {
          bsonType: 'int',
          description: 'Process exit code'
        },

        // Conversation thread - array of messages
        messages: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              type: {
                bsonType: 'string',
                enum: ['system', 'user', 'assistant', 'tool_use', 'tool_result'],
                description: 'Message type'
              },
              timestamp: {
                bsonType: 'date',
                description: 'When this message was emitted'
              },
              content: {
                description: 'Message content (text or structured)'
              },
              // For tool_use messages
              toolName: {
                bsonType: 'string',
                description: 'Name of the tool called'
              },
              toolInput: {
                bsonType: 'object',
                description: 'Input parameters for the tool'
              },
              toolUseId: {
                bsonType: 'string',
                description: 'Unique ID for this tool invocation'
              },
              // For tool_result messages
              toolResult: {
                description: 'Output from the tool execution'
              },
              isError: {
                bsonType: 'bool',
                description: 'Whether the tool execution failed'
              }
            }
          },
          description: 'Ordered list of conversation messages and tool calls'
        },

        // Final result
        result: {
          bsonType: 'string',
          description: 'Final text result from Claude'
        },
        parsedResult: {
          bsonType: 'object',
          description: 'Parsed JSON result if applicable'
        },

        // Cost and usage tracking
        usage: {
          bsonType: 'object',
          properties: {
            inputTokens: { bsonType: 'int' },
            outputTokens: { bsonType: 'int' },
            cacheCreationInputTokens: { bsonType: 'int' },
            cacheReadInputTokens: { bsonType: 'int' },
            totalCostUsd: { bsonType: 'double' }
          },
          description: 'Token usage and cost'
        },

        // Permission denials (when tools were blocked)
        permissionDenials: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              toolName: { bsonType: 'string' },
              toolUseId: { bsonType: 'string' },
              toolInput: { bsonType: 'object' }
            }
          },
          description: 'Tool calls that were denied'
        },

        // Error information
        error: {
          bsonType: 'string',
          description: 'Error message if failed'
        },
        stderr: {
          bsonType: 'string',
          description: 'Stderr output from execution'
        },

        // Timestamps
        startedAt: {
          bsonType: 'date',
          description: 'When conversation started - required'
        },
        completedAt: {
          bsonType: ['date', 'null'],
          description: 'When conversation completed'
        },
        durationMs: {
          bsonType: 'int',
          description: 'Total execution time in milliseconds'
        },
        durationApiMs: {
          bsonType: 'int',
          description: 'Total API call time in milliseconds'
        },

        // Number of turns (request-response cycles)
        numTurns: {
          bsonType: 'int',
          description: 'Number of conversation turns'
        }
      }
    }
  }
});

// Conversation record indexes
db.conversation_records.createIndex({ taskId: 1, startedAt: -1 });
db.conversation_records.createIndex({ sessionId: 1 }, { unique: true });
db.conversation_records.createIndex({ jobName: 1, startedAt: -1 });
db.conversation_records.createIndex({ status: 1 });
db.conversation_records.createIndex({ startedAt: -1 });
db.conversation_records.createIndex({ model: 1 });
// For finding conversations with specific tools used
db.conversation_records.createIndex({ 'messages.toolName': 1 });

print('Database initialization complete!');
