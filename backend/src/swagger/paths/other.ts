// OpenAPI path definitions for Users, Views, Webhooks, Activity Logs, Lookups, Tags, External Jobs

export const userPaths = {
  '/api/users': {
    get: {
      tags: ['Users'],
      summary: 'List users',
      parameters: [
        { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
        { name: 'role', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by displayName or email' },
      ],
      responses: {
        200: { description: 'List of users' },
      },
    },
    post: {
      tags: ['Users'],
      summary: 'Create a new user',
      description: 'Only admins can create users. Email is required for non-agent users.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['displayName'],
              properties: {
                email: { type: 'string', description: 'Required for non-agent users' },
                displayName: { type: 'string' },
                role: { $ref: '#/components/schemas/UserRole' },
                isAgent: { type: 'boolean' },
                agentPrompt: { type: 'string' },
                profilePicture: { type: 'string', description: 'Profile picture URL (human users only)' },
                botColor: { type: 'string', description: 'Bot color (agent users only)' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'User created' },
        400: { description: 'email is required for non-agent users' },
        409: { description: 'User with this email already exists' },
      },
    },
  },
  '/api/users/agents': {
    get: {
      tags: ['Users'],
      summary: 'List AI agent users',
      description: 'Returns active agent users only',
      responses: {
        200: { description: 'List of agents' },
      },
    },
  },
  '/api/users/agents/ensure/{agentId}': {
    post: {
      tags: ['Users'],
      summary: 'Get or create a default agent by ID',
      description: 'Used by workflows to reference agents that may not exist yet. Creates agent with default settings if not found.',
      parameters: [
        { name: 'agentId', in: 'path', required: true, schema: { type: 'string' }, description: 'Agent ID or displayName' },
      ],
      responses: {
        200: { description: 'Agent found or created' },
      },
    },
  },
  '/api/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get a specific user',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'User found' },
        404: { description: 'User not found' },
      },
    },
    patch: {
      tags: ['Users'],
      summary: 'Update a user',
      description: 'Users can update themselves. Admins can update anyone. Only admins can change roles or isActive status.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                displayName: { type: 'string' },
                role: { $ref: '#/components/schemas/UserRole', description: 'Admin only' },
                isActive: { type: 'boolean', description: 'Admin only' },
                isAgent: { type: 'boolean' },
                agentPrompt: { type: 'string' },
                profilePicture: { type: 'string' },
                botColor: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'User updated' },
        403: { description: 'You do not have permission to update this user' },
        404: { description: 'User not found' },
      },
    },
    delete: {
      tags: ['Users'],
      summary: 'Deactivate a user',
      description: 'Soft delete by setting isActive to false. Only admins can deactivate users.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'User deactivated' },
        400: { description: 'You cannot deactivate your own account' },
        404: { description: 'User not found' },
      },
    },
  },
  '/api/users/teams/list': {
    get: {
      tags: ['Users', 'Teams'],
      summary: 'List all teams',
      responses: {
        200: { description: 'List of teams' },
      },
    },
  },
  '/api/users/teams': {
    post: {
      tags: ['Users', 'Teams'],
      summary: 'Create a new team',
      description: 'Only admins can create teams',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                memberIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Team created' },
        409: { description: 'Team with this name already exists' },
      },
    },
  },
  '/api/users/teams/{id}': {
    get: {
      tags: ['Users', 'Teams'],
      summary: 'Get a specific team',
      description: 'Returns team with its members',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Team found' },
        404: { description: 'Team not found' },
      },
    },
    patch: {
      tags: ['Users', 'Teams'],
      summary: 'Update a team',
      description: 'Only admins can update teams',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                memberIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Team updated' },
        404: { description: 'Team not found' },
      },
    },
    delete: {
      tags: ['Users', 'Teams'],
      summary: 'Delete a team',
      description: 'Only admins can delete teams',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Team deleted' },
        404: { description: 'Team not found' },
      },
    },
  },
  '/api/users/teams/{id}/members': {
    put: {
      tags: ['Users', 'Teams'],
      summary: 'Update team members',
      description: 'Replace all team members. Only admins can update team members.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['memberIds'],
              properties: {
                memberIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Team members updated' },
        400: { description: 'memberIds array is required' },
        404: { description: 'Team not found' },
      },
    },
  },
};

export const viewPaths = {
  '/api/views/batch-poll': {
    post: {
      tags: ['Views'],
      summary: 'Batch poll tasks from multiple views',
      description: 'Fetches tasks from multiple saved views in a single request. Designed for consolidated daemon polling to reduce API calls.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['viewIds'],
              properties: {
                viewIds: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Array of view ObjectId strings' },
                limit: { type: 'integer', default: 1, maximum: 10, description: 'Max tasks per view' },
                resolveReferences: { type: 'boolean', default: true },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Results per view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  results: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        tasks: { type: 'array', items: { type: 'object' } },
                        total: { type: 'integer' },
                        viewName: { type: 'string' },
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input' },
      },
    },
  },
  '/api/views': {
    get: {
      tags: ['Views'],
      summary: 'List saved views/searches',
      parameters: [
        { name: 'collectionName', in: 'query', schema: { type: 'string' } },
        { name: 'userId', in: 'query', schema: { type: 'string' }, description: 'Merge with user preferences for this user' },
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
                columnWidths: { type: 'object' },
                createdById: { type: 'string' },
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
  '/api/views/{id}': {
    get: {
      tags: ['Views'],
      summary: 'Get a specific view',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
        { name: 'userId', in: 'query', schema: { type: 'string' }, description: 'Merge with user preferences' },
      ],
      responses: {
        200: { description: 'View found' },
        404: { description: 'View not found' },
      },
    },
    patch: {
      tags: ['Views'],
      summary: 'Update a view',
      description: 'System views only allow updating visibleColumns, columnWidths, and sorting',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                isDefault: { type: 'boolean' },
                filters: { type: 'object' },
                sorting: { type: 'array', items: { type: 'object' } },
                visibleColumns: { type: 'array', items: { type: 'string' } },
                columnWidths: { type: 'object' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'View updated' },
        404: { description: 'View not found' },
      },
    },
    delete: {
      tags: ['Views'],
      summary: 'Delete a view',
      description: 'Cannot delete system views',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'View deleted' },
        403: { description: 'Cannot delete system views' },
        404: { description: 'View not found' },
      },
    },
  },
  '/api/views/{id}/tasks': {
    get: {
      tags: ['Views'],
      summary: 'Get tasks matching view filters',
      description: 'Useful for AI agents to fetch tasks from a saved search. Only supports task views.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
        { name: 'resolveReferences', in: 'query', schema: { type: 'boolean', default: true } },
      ],
      responses: {
        200: { description: 'Tasks matching view' },
        400: { description: 'This endpoint only supports task views' },
        404: { description: 'View not found' },
      },
    },
  },
  '/api/views/{id}/preferences': {
    put: {
      tags: ['Views'],
      summary: 'Save user preferences for a view',
      description: 'Save per-user column visibility and widths for a view',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId'],
              properties: {
                userId: { type: 'string' },
                visibleColumns: { type: 'array', items: { type: 'string' } },
                columnWidths: { type: 'object' },
                columnOrder: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Preferences saved' },
        400: { description: 'userId is required' },
      },
    },
  },
  '/api/views/{id}/preferences/{userId}': {
    delete: {
      tags: ['Views'],
      summary: 'Reset user preferences for a view',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
        { name: 'userId', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Preferences reset' },
      },
    },
  },
};

export const webhookPaths = {
  '/api/webhooks': {
    get: {
      tags: ['Webhooks'],
      summary: 'List webhooks',
      description: 'Secrets are masked in list view (only last 4 chars shown)',
      parameters: [
        { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
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
                filterQuery: { type: 'object' },
                isActive: { type: 'boolean', default: true },
                createdById: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Webhook created with generated secret' },
        400: { description: 'Invalid input' },
      },
    },
  },
  '/api/webhooks/deliveries': {
    get: {
      tags: ['Webhooks'],
      summary: 'Get all deliveries across all webhooks',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        200: { description: 'List of webhook deliveries' },
      },
    },
  },
  '/api/webhooks/deliveries/{deliveryId}/retry': {
    post: {
      tags: ['Webhooks'],
      summary: 'Retry a specific delivery',
      parameters: [
        { name: 'deliveryId', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Delivery retried successfully' },
        400: { description: 'Failed to retry delivery' },
      },
    },
  },
  '/api/webhooks/{id}': {
    get: {
      tags: ['Webhooks'],
      summary: 'Get a single webhook',
      description: 'Returns full webhook details including secret',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Webhook found' },
        404: { description: 'Webhook not found' },
      },
    },
    patch: {
      tags: ['Webhooks'],
      summary: 'Update a webhook',
      description: 'Cannot update secret or createdBy fields',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                url: { type: 'string', format: 'uri' },
                triggers: { type: 'array', items: { $ref: '#/components/schemas/WebhookTrigger' } },
                savedSearchId: { type: 'string' },
                filterQuery: { type: 'object' },
                isActive: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Webhook updated' },
        400: { description: 'Invalid input' },
        404: { description: 'Webhook not found' },
      },
    },
    delete: {
      tags: ['Webhooks'],
      summary: 'Delete a webhook',
      description: 'Also deletes associated delivery history',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Webhook deleted successfully' },
        404: { description: 'Webhook not found' },
      },
    },
  },
  '/api/webhooks/{id}/rotate-secret': {
    post: {
      tags: ['Webhooks'],
      summary: 'Rotate webhook secret',
      description: 'Generate a new secret for the webhook',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: {
          description: 'New secret generated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      secret: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        404: { description: 'Webhook not found' },
      },
    },
  },
  '/api/webhooks/{id}/test': {
    post: {
      tags: ['Webhooks'],
      summary: 'Test a webhook',
      description: 'Send a test payload to the webhook URL',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Test webhook delivered successfully' },
        400: { description: 'Test webhook failed' },
      },
    },
  },
  '/api/webhooks/{id}/deliveries': {
    get: {
      tags: ['Webhooks'],
      summary: 'Get delivery history for a webhook',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        200: { description: 'List of webhook deliveries' },
      },
    },
  },
};

export const activityLogPaths = {
  '/api/activity-logs/recent': {
    get: {
      tags: ['Activity Logs'],
      summary: 'Get recent activity across all tasks',
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        { name: 'actorType', in: 'query', schema: { type: 'string', enum: ['user', 'system', 'daemon'] } },
        { name: 'action', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Recent activity log entries across all tasks' },
      },
    },
  },
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
  '/api/activity-logs/cleanup': {
    post: {
      tags: ['Activity Logs'],
      summary: 'Trigger cleanup of orphaned logs',
      description: 'Removes activity logs for tasks that no longer exist',
      responses: {
        200: {
          description: 'Cleanup completed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deletedCount: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const lookupPaths = {
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
        409: { description: 'Lookup with this type and code already exists' },
      },
    },
  },
  '/api/lookups/types': {
    get: {
      tags: ['Lookups'],
      summary: 'Get list of lookup types',
      description: 'Returns distinct lookup types in the system',
      responses: {
        200: {
          description: 'List of lookup types',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/lookups/{type}': {
    get: {
      tags: ['Lookups'],
      summary: 'Get lookups by type',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Lookups of this type' },
      },
    },
  },
  '/api/lookups/{id}': {
    patch: {
      tags: ['Lookups'],
      summary: 'Update a lookup',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                displayName: { type: 'string' },
                color: { type: 'string' },
                icon: { type: 'string' },
                sortOrder: { type: 'integer' },
                isActive: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Lookup updated' },
        404: { description: 'Lookup not found' },
      },
    },
    delete: {
      tags: ['Lookups'],
      summary: 'Delete a lookup',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Lookup deleted' },
        404: { description: 'Lookup not found' },
      },
    },
  },
  '/api/lookups/{type}/reorder': {
    put: {
      tags: ['Lookups'],
      summary: 'Reorder lookup values',
      description: 'Bulk update sort order for lookups of a given type',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['order'],
              properties: {
                order: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'sortOrder'],
                    properties: {
                      id: { type: 'string' },
                      sortOrder: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Lookups reordered' },
        400: { description: 'order array is required' },
      },
    },
  },
};

export const tagPaths = {
  '/api/tags': {
    get: {
      tags: ['Tags'],
      summary: 'Get all tags',
      description: 'Returns all active tags. Daemons and agents should use this endpoint to get the list of available tags.',
      parameters: [
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean' }, description: 'Include inactive tags' },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by name or displayName' },
      ],
      responses: {
        200: {
          description: 'List of tags',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['Tags'],
      summary: 'Create a new tag',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TagInput' },
          },
        },
      },
      responses: {
        201: {
          description: 'Tag created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Tag' },
                },
              },
            },
          },
        },
        409: { description: 'Tag with this name already exists' },
      },
    },
  },
  '/api/tags/{id}': {
    get: {
      tags: ['Tags'],
      summary: 'Get a tag by ID',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Tag found' },
        404: { description: 'Tag not found' },
      },
    },
    patch: {
      tags: ['Tags'],
      summary: 'Update a tag',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TagInput' },
          },
        },
      },
      responses: {
        200: { description: 'Tag updated' },
        404: { description: 'Tag not found' },
        409: { description: 'Tag with this name already exists' },
      },
    },
    delete: {
      tags: ['Tags'],
      summary: 'Deactivate a tag (soft delete)',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Tag deactivated' },
        404: { description: 'Tag not found' },
      },
    },
  },
  '/api/tags/ensure': {
    post: {
      tags: ['Tags'],
      summary: 'Ensure tags exist (create if they do not)',
      description: 'Bulk operation to ensure multiple tags exist. Useful for migrations or bulk operations.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tags'],
              properties: {
                tags: {
                  type: 'array',
                  items: {
                    oneOf: [
                      { type: 'string' },
                      { $ref: '#/components/schemas/TagInput' },
                    ],
                  },
                  description: 'Array of tag names or tag objects',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Tags ensured',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const externalJobPaths = {
  '/api/external-jobs': {
    get: {
      tags: ['External Jobs'],
      summary: 'List external jobs',
      description: 'Supports filtering by task fields via lookup',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Can be comma-separated for multiple statuses' },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'taskId', in: 'query', schema: { type: 'string' } },
        { name: 'taskStatus', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task status' },
        { name: 'taskType', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task type' },
        { name: 'assigneeId', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task assignee' },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        { name: 'sortBy', in: 'query', schema: { type: 'string', default: 'createdAt' } },
        { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
      ],
      responses: {
        200: { description: 'List of external jobs with pagination' },
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
        404: { description: 'Task not found' },
      },
    },
  },
  '/api/external-jobs/pending': {
    get: {
      tags: ['External Jobs'],
      summary: 'Get pending jobs for workers',
      description: 'Returns pending jobs ready for processing (scheduledFor is null or in the past)',
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 100 } },
      ],
      responses: {
        200: { description: 'Pending jobs' },
      },
    },
  },
  '/api/external-jobs/stats/summary': {
    get: {
      tags: ['External Jobs'],
      summary: 'Get job statistics',
      description: 'Returns counts by status and type',
      responses: {
        200: {
          description: 'Job statistics',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      byStatus: { type: 'object' },
                      byTypeAndStatus: { type: 'array', items: { type: 'object' } },
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
  '/api/external-jobs/{id}': {
    get: {
      tags: ['External Jobs'],
      summary: 'Get a specific external job',
      description: 'Returns job with associated task',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'External job found' },
        404: { description: 'External job not found' },
      },
    },
    delete: {
      tags: ['External Jobs'],
      summary: 'Delete an external job',
      description: 'Cannot delete a job that is currently processing',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'External job deleted' },
        400: { description: 'Cannot delete a job that is currently processing' },
        404: { description: 'Job not found' },
      },
    },
  },
  '/api/external-jobs/{id}/claim': {
    put: {
      tags: ['External Jobs'],
      summary: 'Claim a job for processing',
      description: 'Atomically claims a pending job, sets status to processing, increments attempts',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
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
        409: { description: 'Job not found or already claimed' },
      },
    },
  },
  '/api/external-jobs/{id}/complete': {
    put: {
      tags: ['External Jobs'],
      summary: 'Mark job as completed',
      description: 'Also updates associated task status to completed',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                result: { type: 'object', description: 'Job result data' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Job completed' },
        409: { description: 'Job not found or not in processing state' },
      },
    },
  },
  '/api/external-jobs/{id}/fail': {
    put: {
      tags: ['External Jobs'],
      summary: 'Mark job as failed',
      description: 'If attempts < maxAttempts, job returns to pending for retry. Otherwise marked as failed permanently.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', description: 'Error message' },
                retryAfter: { type: 'integer', description: 'Seconds to wait before retry' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Job marked as failed (may retry)' },
        404: { description: 'Job not found' },
      },
    },
  },
  '/api/external-jobs/{id}/cancel': {
    put: {
      tags: ['External Jobs'],
      summary: 'Cancel a job',
      description: 'Cancels a pending or processing job. Also cancels associated task.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Job cancelled' },
        409: { description: 'Job not found or already completed' },
      },
    },
  },
};
