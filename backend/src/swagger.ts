import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Coordination Matrix API',
      version: '1.0.0',
      description: `
AI Workflow Task Management System API.

## Authentication

Most endpoints require authentication via one of:
- **Bearer Token**: JWT token in \`Authorization: Bearer <token>\` header
- **API Key**: API key in \`X-API-Key: <key>\` header

## Common Response Format

All responses follow this structure:
\`\`\`json
{
  "success": true,
  "data": { ... },
  "pagination": { "page": 1, "limit": 50, "total": 100 }
}
\`\`\`

## Error Responses

\`\`\`json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
\`\`\`
      `,
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token from /api/auth/login',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key from /api/auth/api-keys',
        },
      },
      schemas: {
        // Common schemas
        ObjectId: {
          type: 'string',
          pattern: '^[a-f\\d]{24}$',
          example: '507f1f77bcf86cd799439011',
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: {} },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 50 },
                total: { type: 'integer', example: 100 },
                totalPages: { type: 'integer', example: 2 },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Error message' },
            code: { type: 'string', example: 'ERROR_CODE' },
          },
        },

        // Task schemas
        TaskStatus: {
          type: 'string',
          enum: ['pending', 'in_progress', 'waiting', 'on_hold', 'completed', 'failed', 'cancelled', 'archived'],
        },
        Urgency: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
        },
        Task: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            title: { type: 'string', example: 'Implement feature X' },
            summary: { type: 'string', nullable: true },
            extraPrompt: { type: 'string', nullable: true, description: 'AI prompt for task execution' },
            additionalInfo: { type: 'string', nullable: true, description: 'Execution output/notes' },
            status: { $ref: '#/components/schemas/TaskStatus' },
            urgency: { $ref: '#/components/schemas/Urgency' },
            parentId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            workflowId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            workflowRunId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            workflowStepId: { type: 'string', nullable: true },
            taskType: { type: 'string', enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook'], description: 'Type of task for workflow execution' },
            executionMode: { type: 'string', enum: ['manual', 'automated', 'immediate', 'external_callback'] },
            expectedQuantity: { type: 'integer', description: 'Expected number of subtasks/results' },
            assigneeId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            dueAt: { type: 'string', format: 'date-time', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            foreachConfig: { type: 'object', description: 'Configuration for foreach tasks' },
            joinConfig: { type: 'object', description: 'Configuration for join tasks (includes awaitStepId, boundary)' },
            webhookConfig: { type: 'object', description: 'Configuration for webhook tasks' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TaskCreate: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', example: 'New task' },
            summary: { type: 'string' },
            extraPrompt: { type: 'string' },
            additionalInfo: { type: 'string' },
            status: { $ref: '#/components/schemas/TaskStatus' },
            urgency: { $ref: '#/components/schemas/Urgency' },
            parentId: { type: 'string', nullable: true },
            workflowId: { type: 'string', nullable: true },
            assigneeId: { type: 'string', nullable: true },
            createdById: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            dueAt: { type: 'string', format: 'date-time' },
            metadata: { type: 'object' },
            silent: { type: 'boolean', description: 'Skip event emission' },
          },
        },
        TaskUpdate: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            extraPrompt: { type: 'string' },
            additionalInfo: { type: 'string' },
            status: { $ref: '#/components/schemas/TaskStatus' },
            urgency: { $ref: '#/components/schemas/Urgency' },
            parentId: { type: 'string', nullable: true },
            workflowId: { type: 'string', nullable: true },
            assigneeId: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            dueAt: { type: 'string', format: 'date-time', nullable: true },
            metadata: { type: 'object' },
            silent: { type: 'boolean' },
            actorId: { type: 'string' },
            actorType: { type: 'string', enum: ['user', 'system', 'daemon'] },
          },
        },

        // Workflow schemas
        WorkflowStepType: {
          type: 'string',
          enum: ['trigger', 'agent', 'manual', 'external', 'webhook', 'decision', 'foreach', 'join', 'flow'],
          description: 'Type of workflow step - maps 1:1 to TaskType',
        },
        TaskType: {
          type: 'string',
          enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook'],
          description: 'Type of task - maps 1:1 to WorkflowStepType',
        },
        WorkflowStep: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            stepType: { $ref: '#/components/schemas/WorkflowStepType' },
            description: { type: 'string' },
            additionalInstructions: { type: 'string' },
            defaultAssigneeId: { type: 'string' },
            connections: { type: 'array', items: { type: 'object' } },
            externalConfig: { type: 'object' },
            webhookConfig: { type: 'object' },
            itemsPath: { type: 'string', description: 'For foreach: JSONPath to items array' },
            awaitStepId: { type: 'string', description: 'For join: Step ID to await' },
            joinBoundary: { type: 'object', description: 'For join: boundary conditions' },
            expectedCountPath: { type: 'string', description: 'For join: JSONPath to expected count' },
            config: { type: 'object' },
          },
        },
        Workflow: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string', example: 'Code Review Pipeline' },
            description: { type: 'string' },
            isActive: { type: 'boolean' },
            steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStep' } },
            mermaidDiagram: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
          },
        },

        // Workflow Run schemas
        WorkflowRunStatus: {
          type: 'string',
          enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
        },
        WorkflowRun: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            workflowId: { $ref: '#/components/schemas/ObjectId' },
            status: { $ref: '#/components/schemas/WorkflowRunStatus' },
            rootTaskId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            currentStepIds: { type: 'array', items: { type: 'string' } },
            completedStepIds: { type: 'array', items: { type: 'string' } },
            inputPayload: { type: 'object' },
            outputPayload: { type: 'object' },
            error: { type: 'string' },
            callbackSecret: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },

        // Batch Job schemas
        BatchJobStatus: {
          type: 'string',
          enum: ['pending', 'processing', 'awaiting_responses', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'manual_review'],
        },
        BatchJob: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string' },
            type: { type: 'string' },
            workflowId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            taskId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            status: { $ref: '#/components/schemas/BatchJobStatus' },
            expectedCount: { type: 'integer' },
            receivedCount: { type: 'integer' },
            processedCount: { type: 'integer' },
            failedCount: { type: 'integer' },
            minSuccessPercent: { type: 'number' },
            requiresManualReview: { type: 'boolean' },
            aggregateResult: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },

        // User schemas
        UserRole: {
          type: 'string',
          enum: ['admin', 'operator', 'reviewer', 'viewer'],
        },
        User: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            role: { $ref: '#/components/schemas/UserRole' },
            isActive: { type: 'boolean' },
            isAgent: { type: 'boolean' },
            agentPrompt: { type: 'string' },
            teamIds: { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // API Key schemas
        ApiKey: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string', example: 'CLI Tool Key' },
            description: { type: 'string' },
            keyPrefix: { type: 'string', example: 'cm_ak_live_abc' },
            scopes: { type: 'array', items: { type: 'string' } },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            isActive: { type: 'boolean' },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Webhook schemas
        WebhookTrigger: {
          type: 'string',
          enum: [
            'task.created', 'task.updated', 'task.deleted',
            'task.status.changed', 'task.assignee.changed', 'task.priority.changed',
            'task.entered_filter',
          ],
        },
        Webhook: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            triggers: { type: 'array', items: { $ref: '#/components/schemas/WebhookTrigger' } },
            savedSearchId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // View schemas
        View: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            name: { type: 'string', example: 'My Tasks' },
            collectionName: { type: 'string', example: 'tasks' },
            isDefault: { type: 'boolean' },
            filters: { type: 'object' },
            sorting: { type: 'array', items: { type: 'object' } },
            visibleColumns: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Lookup schemas
        Lookup: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            type: { type: 'string', example: 'task_status' },
            code: { type: 'string', example: 'pending' },
            displayName: { type: 'string', example: 'Pending' },
            color: { type: 'string', example: '#FFA500' },
            icon: { type: 'string' },
            sortOrder: { type: 'integer' },
            isActive: { type: 'boolean' },
          },
        },

        // Activity Log schemas
        ActivityLog: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            taskId: { $ref: '#/components/schemas/ObjectId' },
            eventType: { type: 'string' },
            actorId: { $ref: '#/components/schemas/ObjectId', nullable: true },
            actorType: { type: 'string', enum: ['user', 'system', 'daemon'] },
            changes: { type: 'object' },
            comment: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },

        // External Job schemas
        ExternalJobStatus: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
        },
        ExternalJob: {
          type: 'object',
          properties: {
            _id: { $ref: '#/components/schemas/ObjectId' },
            taskId: { $ref: '#/components/schemas/ObjectId' },
            type: { type: 'string' },
            status: { $ref: '#/components/schemas/ExternalJobStatus' },
            payload: { type: 'object' },
            result: { type: 'object' },
            error: { type: 'string' },
            attempts: { type: 'integer' },
            maxAttempts: { type: 'integer' },
            scheduledFor: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
    security: [
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and authorization' },
      { name: 'API Keys', description: 'API key management' },
      { name: 'Tasks', description: 'Task CRUD and tree operations' },
      { name: 'Workflows', description: 'Workflow definitions' },
      { name: 'Workflow Runs', description: 'Workflow execution instances' },
      { name: 'Batch Jobs', description: 'Fan-out/fan-in job coordination' },
      { name: 'Users', description: 'User and team management' },
      { name: 'Views', description: 'Saved searches and views' },
      { name: 'Webhooks', description: 'Webhook configuration' },
      { name: 'Activity Logs', description: 'Audit trail and comments' },
      { name: 'Lookups', description: 'Lookup/enum values' },
      { name: 'Field Configs', description: 'Dynamic field configuration' },
      { name: 'External Jobs', description: 'External worker job queue' },
    ],
    paths: {
      // Health check
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          security: [],
          responses: {
            200: {
              description: 'Server is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'healthy' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // Auth endpoints
      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with email and password',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          token: { type: 'string' },
                          user: { $ref: '#/components/schemas/User' },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/api/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'displayName'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    displayName: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Registration successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          token: { type: 'string' },
                          user: { $ref: '#/components/schemas/User' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid input or email already exists' },
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user',
          responses: {
            200: {
              description: 'Current user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
            401: { description: 'Not authenticated' },
          },
        },
      },
      '/api/auth/status': {
        get: {
          tags: ['Auth'],
          summary: 'Check if initial setup is required',
          security: [],
          responses: {
            200: {
              description: 'Setup status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          setupRequired: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // API Keys endpoints
      '/api/auth/api-keys': {
        get: {
          tags: ['API Keys'],
          summary: 'List API keys',
          parameters: [
            { name: 'userId', in: 'query', schema: { type: 'string' } },
            { name: 'includeInactive', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: {
              description: 'List of API keys',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['API Keys'],
          summary: 'Create a new API key',
          description: 'Returns the full key only once - store it securely',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', example: 'CLI Tool' },
                    description: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' }, example: ['tasks:read', 'tasks:write'] },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'API key created - save the key now, it won\'t be shown again',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          key: { type: 'string', description: 'Full API key - save this!' },
                          apiKey: { $ref: '#/components/schemas/ApiKey' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // Tasks endpoints
      '/api/tasks': {
        get: {
          tags: ['Tasks'],
          summary: 'List tasks with filtering and pagination',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'sortBy', in: 'query', schema: { type: 'string', default: 'createdAt' } },
            { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'urgency', in: 'query', schema: { type: 'string' } },
            { name: 'assigneeId', in: 'query', schema: { type: 'string' } },
            { name: 'parentId', in: 'query', schema: { type: 'string' } },
            { name: 'rootOnly', in: 'query', schema: { type: 'boolean' } },
            { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Comma-separated tags' },
            { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' }, description: 'Include resolved assignee/workflow objects' },
            { name: 'includeArchived', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include archived tasks (excluded by default)' },
          ],
          responses: {
            200: {
              description: 'Paginated list of tasks',
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/PaginatedResponse' },
                      {
                        properties: {
                          data: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Create a new task',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskCreate' },
              },
            },
          },
          responses: {
            201: {
              description: 'Task created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { $ref: '#/components/schemas/Task' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/tasks/{id}': {
        get: {
          tags: ['Tasks'],
          summary: 'Get a single task',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' } },
            { name: 'includeChildren', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: {
              description: 'Task details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { $ref: '#/components/schemas/Task' },
                    },
                  },
                },
              },
            },
            404: { description: 'Task not found' },
          },
        },
        patch: {
          tags: ['Tasks'],
          summary: 'Update a task',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskUpdate' },
              },
            },
          },
          responses: {
            200: { description: 'Task updated' },
            404: { description: 'Task not found' },
          },
        },
        delete: {
          tags: ['Tasks'],
          summary: 'Delete a task',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'deleteChildren', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: { description: 'Task deleted' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/api/tasks/tree': {
        get: {
          tags: ['Tasks'],
          summary: 'Get tasks as a tree structure',
          parameters: [
            { name: 'rootId', in: 'query', schema: { type: 'string' } },
            { name: 'maxDepth', in: 'query', schema: { type: 'integer' } },
            { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: { description: 'Task tree' },
          },
        },
      },
      '/api/tasks/{id}/children': {
        get: {
          tags: ['Tasks'],
          summary: 'Get direct children of a task',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Child tasks' },
          },
        },
      },
      '/api/tasks/{id}/descendants': {
        get: {
          tags: ['Tasks'],
          summary: 'Get all descendants of a task',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'maxDepth', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Descendant tasks' },
          },
        },
      },
      '/api/tasks/{id}/move': {
        put: {
          tags: ['Tasks'],
          summary: 'Move task to new parent',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    newParentId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Task moved' },
          },
        },
      },
      '/api/tasks/bulk': {
        post: {
          tags: ['Tasks'],
          summary: 'Bulk update or delete tasks',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['operation', 'taskIds'],
                  properties: {
                    operation: { type: 'string', enum: ['update', 'delete'] },
                    taskIds: { type: 'array', items: { type: 'string' } },
                    updates: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Bulk operation completed' },
          },
        },
      },

      // Workflows endpoints
      '/api/workflows': {
        get: {
          tags: ['Workflows'],
          summary: 'List all workflows',
          parameters: [
            { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include inactive workflows (excluded by default)' },
          ],
          responses: {
            200: {
              description: 'List of workflows',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: { type: 'array', items: { $ref: '#/components/schemas/Workflow' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Workflows'],
          summary: 'Create a new workflow',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'steps'],
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStep' } },
                    mermaidDiagram: { type: 'string' },
                    isActive: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Workflow created' },
          },
        },
      },
      '/api/workflows/{id}': {
        get: {
          tags: ['Workflows'],
          summary: 'Get a workflow',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Workflow details' },
            404: { description: 'Workflow not found' },
          },
        },
        patch: {
          tags: ['Workflows'],
          summary: 'Update a workflow',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Workflow updated' },
          },
        },
        delete: {
          tags: ['Workflows'],
          summary: 'Delete a workflow',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Workflow deleted' },
          },
        },
      },
      '/api/workflows/parse-mermaid': {
        post: {
          tags: ['Workflows'],
          summary: 'Parse Mermaid diagram to workflow steps',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['mermaidDiagram'],
                  properties: {
                    mermaidDiagram: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Parsed steps' },
          },
        },
      },

      // Workflow Runs endpoints
      '/api/workflow-runs': {
        get: {
          tags: ['Workflow Runs'],
          summary: 'List workflow runs',
          parameters: [
            { name: 'workflowId', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'List of workflow runs' },
          },
        },
        post: {
          tags: ['Workflow Runs'],
          summary: 'Start a new workflow run',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['workflowId'],
                  properties: {
                    workflowId: { type: 'string' },
                    inputPayload: { type: 'object' },
                    taskDefaults: { type: 'object' },
                    executionOptions: { type: 'object' },
                    externalId: { type: 'string' },
                    source: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Workflow run started' },
          },
        },
      },
      '/api/workflow-runs/{id}': {
        get: {
          tags: ['Workflow Runs'],
          summary: 'Get workflow run details',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeTasks', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: { description: 'Workflow run details' },
          },
        },
      },
      '/api/workflow-runs/{id}/cancel': {
        post: {
          tags: ['Workflow Runs'],
          summary: 'Cancel a workflow run',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Workflow run cancelled' },
          },
        },
      },
      '/api/workflow-runs/{id}/callback/{stepId}': {
        post: {
          tags: ['Workflow Runs'],
          summary: 'Unified callback endpoint for workflow step',
          description: 'Handles all callback types: single result, streaming items, batch items. For foreach steps, use X-Expected-Count header to set expected item count.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Workflow run ID' },
            { name: 'stepId', in: 'path', required: true, schema: { type: 'string' }, description: 'Step ID to receive callback' },
            { name: 'X-Workflow-Secret', in: 'header', required: true, schema: { type: 'string' }, description: 'Callback secret for authentication' },
            { name: 'X-Expected-Count', in: 'header', required: false, schema: { type: 'integer' }, description: 'Expected number of items (for foreach steps)' },
            { name: 'X-Workflow-Complete', in: 'header', required: false, schema: { type: 'string', enum: ['true'] }, description: 'Signal that no more items will be sent' },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'Payload can be: 1) object with "item" key, 2) object with "items" array, 3) any object (treated as single item)',
                  properties: {
                    item: { type: 'object', description: 'Single item to process' },
                    items: { type: 'array', items: { type: 'object' }, description: 'Multiple items to process' },
                    workflowUpdate: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer', description: 'Expected number of items' },
                        complete: { type: 'boolean', description: 'Signal that no more items will be sent' },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Callback processed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      acknowledged: { type: 'boolean' },
                      taskId: { type: 'string' },
                      taskType: { type: 'string' },
                      childTaskIds: { type: 'array', items: { type: 'string' } },
                      receivedCount: { type: 'integer' },
                      expectedCount: { type: 'integer' },
                      isComplete: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            401: { description: 'Invalid or missing callback secret' },
            404: { description: 'Workflow run or step not found' },
          },
        },
      },

      // Batch Jobs endpoints
      '/api/batch-jobs': {
        get: {
          tags: ['Batch Jobs'],
          summary: 'List batch jobs',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'workflowId', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'List of batch jobs' },
          },
        },
        post: {
          tags: ['Batch Jobs'],
          summary: 'Create a new batch job',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['expectedCount'],
                  properties: {
                    expectedCount: { type: 'integer' },
                    name: { type: 'string' },
                    type: { type: 'string' },
                    workflowId: { type: 'string' },
                    taskId: { type: 'string' },
                    minSuccessPercent: { type: 'number', default: 100 },
                    deadlineAt: { type: 'string', format: 'date-time' },
                    items: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Batch job created' },
          },
        },
      },

      // Users endpoints
      '/api/users': {
        get: {
          tags: ['Users'],
          summary: 'List users',
          parameters: [
            { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'List of users' },
          },
        },
        post: {
          tags: ['Users'],
          summary: 'Create a new user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['displayName'],
                  properties: {
                    email: { type: 'string' },
                    displayName: { type: 'string' },
                    role: { $ref: '#/components/schemas/UserRole' },
                    isAgent: { type: 'boolean' },
                    agentPrompt: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'User created' },
          },
        },
      },
      '/api/users/agents': {
        get: {
          tags: ['Users'],
          summary: 'List AI agent users',
          responses: {
            200: { description: 'List of agents' },
          },
        },
      },

      // Views endpoints
      '/api/views': {
        get: {
          tags: ['Views'],
          summary: 'List saved views/searches',
          parameters: [
            { name: 'collectionName', in: 'query', schema: { type: 'string' } },
            { name: 'userId', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'List of views' },
          },
        },
        post: {
          tags: ['Views'],
          summary: 'Create a new view',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'collectionName'],
                  properties: {
                    name: { type: 'string' },
                    collectionName: { type: 'string' },
                    isDefault: { type: 'boolean' },
                    filters: { type: 'object' },
                    sorting: { type: 'array', items: { type: 'object' } },
                    visibleColumns: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'View created' },
          },
        },
      },
      '/api/views/{id}/tasks': {
        get: {
          tags: ['Views'],
          summary: 'Get tasks matching view filters',
          description: 'Useful for AI agents to fetch tasks from a saved search',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: { description: 'Tasks matching view' },
          },
        },
      },

      // Webhooks endpoints
      '/api/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhooks',
          responses: {
            200: { description: 'List of webhooks' },
          },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Create a webhook',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'url', 'triggers'],
                  properties: {
                    name: { type: 'string' },
                    url: { type: 'string', format: 'uri' },
                    triggers: { type: 'array', items: { $ref: '#/components/schemas/WebhookTrigger' } },
                    savedSearchId: { type: 'string' },
                    isActive: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Webhook created' },
          },
        },
      },

      // Activity Logs endpoints
      '/api/activity-logs/task/{taskId}': {
        get: {
          tags: ['Activity Logs'],
          summary: 'Get activity log for a task',
          parameters: [
            { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Activity log entries' },
          },
        },
      },
      '/api/activity-logs/task/{taskId}/comments': {
        post: {
          tags: ['Activity Logs'],
          summary: 'Add a comment to a task',
          parameters: [
            { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['comment'],
                  properties: {
                    comment: { type: 'string' },
                    actorId: { type: 'string' },
                    actorType: { type: 'string', enum: ['user', 'system', 'daemon'] },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Comment added' },
          },
        },
      },

      // Lookups endpoints
      '/api/lookups': {
        get: {
          tags: ['Lookups'],
          summary: 'Get all lookups grouped by type',
          responses: {
            200: { description: 'Lookups by type' },
          },
        },
        post: {
          tags: ['Lookups'],
          summary: 'Create a lookup value',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['type', 'code', 'displayName'],
                  properties: {
                    type: { type: 'string' },
                    code: { type: 'string' },
                    displayName: { type: 'string' },
                    color: { type: 'string' },
                    icon: { type: 'string' },
                    sortOrder: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Lookup created' },
          },
        },
      },

      // External Jobs endpoints
      '/api/external-jobs': {
        get: {
          tags: ['External Jobs'],
          summary: 'List external jobs',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'taskId', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'List of external jobs' },
          },
        },
        post: {
          tags: ['External Jobs'],
          summary: 'Create an external job',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['taskId', 'type'],
                  properties: {
                    taskId: { type: 'string' },
                    type: { type: 'string' },
                    payload: { type: 'object' },
                    scheduledFor: { type: 'string', format: 'date-time' },
                    maxAttempts: { type: 'integer', default: 3 },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Job created' },
          },
        },
      },
      '/api/external-jobs/pending': {
        get: {
          tags: ['External Jobs'],
          summary: 'Get pending jobs for workers',
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Pending jobs' },
          },
        },
      },
      '/api/external-jobs/{id}/claim': {
        put: {
          tags: ['External Jobs'],
          summary: 'Claim a job for processing',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    workerId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Job claimed' },
          },
        },
      },
      '/api/external-jobs/{id}/complete': {
        put: {
          tags: ['External Jobs'],
          summary: 'Mark job as completed',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Job completed' },
          },
        },
      },
      '/api/external-jobs/{id}/fail': {
        put: {
          tags: ['External Jobs'],
          summary: 'Mark job as failed',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: { type: 'string' },
                    retryAfter: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Job marked as failed' },
          },
        },
      },
    },
  },
  apis: [], // We're defining paths inline above
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  // Serve swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Coordination Matrix API',
  }));

  // Serve raw OpenAPI spec
  app.get('/api-docs.json', (_, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log('Swagger UI available at /api-docs');
}

export { swaggerSpec };
