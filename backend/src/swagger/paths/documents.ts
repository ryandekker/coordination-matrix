// OpenAPI path definitions for Documents endpoints

export const documentPaths = {
  '/api/documents': {
    get: {
      tags: ['Documents'],
      summary: 'List documents with filtering and pagination',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'sortBy', in: 'query', schema: { type: 'string', default: 'updatedAt' } },
        { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Text search in title, content, summary' },
        { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Filter by document type' },
        { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
        { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Filter by tags (comma-separated)' },
        { name: 'includeArchived', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include archived documents' },
        { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' }, description: 'Include resolved user objects' },
      ],
      responses: {
        200: {
          description: 'Paginated list of documents',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/PaginatedResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
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
      tags: ['Documents'],
      summary: 'Create a new document',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DocumentCreate' },
          },
        },
      },
      responses: {
        201: {
          description: 'Document created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Document' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/documents/{id}': {
    get: {
      tags: ['Documents'],
      summary: 'Get a single document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'resolveReferences', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'Document details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Document' },
                },
              },
            },
          },
        },
        404: { description: 'Document not found' },
      },
    },
    patch: {
      tags: ['Documents'],
      summary: 'Update a document',
      description: 'Updates document fields. If title or content changes, a new version is created automatically.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DocumentUpdate' },
          },
        },
      },
      responses: {
        200: { description: 'Document updated' },
        404: { description: 'Document not found' },
      },
    },
    delete: {
      tags: ['Documents'],
      summary: 'Delete a document',
      description: 'Soft deletes (archives) by default. Use permanent=true for hard delete.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'permanent', in: 'query', schema: { type: 'boolean' }, description: 'Hard delete (removes versions too)' },
      ],
      responses: {
        200: { description: 'Document deleted/archived' },
        404: { description: 'Document not found' },
      },
    },
  },
  '/api/documents/{id}/versions': {
    get: {
      tags: ['Documents'],
      summary: 'Get version history for a document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'List of versions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/DocumentVersion' } },
                },
              },
            },
          },
        },
        404: { description: 'Document not found' },
      },
    },
  },
  '/api/documents/{id}/versions/{version}': {
    get: {
      tags: ['Documents'],
      summary: 'Get a specific version of a document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        200: { description: 'Version details' },
        404: { description: 'Version not found' },
      },
    },
  },
  '/api/documents/{id}/restore/{version}': {
    post: {
      tags: ['Documents'],
      summary: 'Restore a document to a specific version',
      description: 'Creates a new version with the content from the specified version.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        200: { description: 'Document restored' },
        404: { description: 'Version not found' },
      },
    },
  },
  '/api/documents/{id}/diff': {
    post: {
      tags: ['Documents'],
      summary: 'Compare two versions of a document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['fromVersion', 'toVersion'],
              properties: {
                fromVersion: { type: 'integer' },
                toVersion: { type: 'integer' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Both versions for comparison',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      from: { $ref: '#/components/schemas/DocumentVersion' },
                      to: { $ref: '#/components/schemas/DocumentVersion' },
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
  '/api/documents/{id}/link-task': {
    post: {
      tags: ['Documents'],
      summary: 'Link a task to this document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['taskId'],
              properties: {
                taskId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Task linked' },
        404: { description: 'Document or task not found' },
      },
    },
  },
  '/api/documents/{id}/link-task/{taskId}': {
    delete: {
      tags: ['Documents'],
      summary: 'Unlink a task from this document',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Task unlinked' },
        404: { description: 'Document not found' },
      },
    },
  },
  '/api/documents/search': {
    post: {
      tags: ['Documents'],
      summary: 'Semantic search for documents',
      description: 'Search documents using natural language prompts. Uses vector embeddings for semantic similarity.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DocumentSearchQuery' },
          },
        },
      },
      responses: {
        200: {
          description: 'Search results ranked by relevance',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/DocumentSearchResult' } },
                },
              },
            },
          },
        },
      },
    },
  },
};
