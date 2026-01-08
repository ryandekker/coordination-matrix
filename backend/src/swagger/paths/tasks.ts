// OpenAPI path definitions for Tasks endpoints

export const taskPaths = {
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
};
