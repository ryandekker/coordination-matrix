// OpenAPI path definitions for Users, Views, Webhooks, Activity Logs, Lookups, Tags, External Jobs

export const userPaths = {
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
};

export const viewPaths = {
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
};

export const webhookPaths = {
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
};

export const activityLogPaths = {
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
};
