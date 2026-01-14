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
  '/api/tasks/{id}/documents': {
    get: {
      tags: ['Tasks', 'Documents'],
      summary: 'List documents attached to a task',
      description: 'Returns all documents that are linked to this task via the relatedTaskIds field.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
      ],
      responses: {
        200: {
          description: 'List of attached documents',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Document' },
                  },
                },
              },
            },
          },
        },
        404: { description: 'Task not found' },
      },
    },
    post: {
      tags: ['Tasks', 'Documents'],
      summary: 'Attach a document to a task',
      description: 'Supports two modes: (1) Link an existing document by ID, or (2) Create a new document with inline content. Useful for AI agents to attach output documents to tasks.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                documentId: {
                  type: 'string',
                  description: 'ID of existing document to link (mutually exclusive with title/content)',
                },
                title: {
                  type: 'string',
                  description: 'Title for new document (required if creating)',
                },
                content: {
                  type: 'string',
                  description: 'Markdown content for new document (required if creating)',
                },
                type: {
                  type: 'string',
                  enum: ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'],
                  default: 'output',
                  description: 'Document type',
                },
                status: {
                  type: 'string',
                  enum: ['draft', 'review', 'approved', 'archived'],
                  default: 'draft',
                  description: 'Document status',
                },
                summary: {
                  type: 'string',
                  description: 'Optional summary',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional tags',
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata',
                },
              },
            },
            examples: {
              linkExisting: {
                summary: 'Link existing document',
                value: { documentId: '507f1f77bcf86cd799439011' },
              },
              createNew: {
                summary: 'Create new document',
                value: {
                  title: 'Analysis Report',
                  content: '# Analysis\n\nThis is the analysis result...',
                  type: 'output',
                  status: 'review',
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Document attached or created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  message: { type: 'string' },
                  document: { $ref: '#/components/schemas/Document' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid request (missing required fields or document already attached)' },
        404: { description: 'Task or document not found' },
      },
    },
  },
  '/api/tasks/{id}/documents/{documentId}': {
    delete: {
      tags: ['Tasks', 'Documents'],
      summary: 'Detach a document from a task',
      description: 'Removes the task-document link. The document is not deleted, only unlinked from this task.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Task ID' },
        { name: 'documentId', in: 'path', required: true, schema: { type: 'string' }, description: 'Document ID' },
      ],
      responses: {
        200: {
          description: 'Document detached',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        400: { description: 'Document is not attached to this task' },
        404: { description: 'Task or document not found' },
      },
    },
  },
};
