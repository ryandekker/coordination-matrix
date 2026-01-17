// OpenAPI path definitions for Field Configs endpoints

export const fieldConfigPaths = {
  '/api/field-configs': {
    get: {
      tags: ['Field Configs'],
      summary: 'Get all field configurations',
      description: 'Returns all field configurations, optionally filtered by collection. If no collection is specified, results are grouped by collection name.',
      parameters: [
        { name: 'collectionName', in: 'query', schema: { type: 'string' }, description: 'Filter by collection name (e.g., "tasks", "workflows")' },
      ],
      responses: {
        200: {
          description: 'Field configurations',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    oneOf: [
                      { type: 'array', items: { $ref: '#/components/schemas/FieldConfig' } },
                      { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/FieldConfig' } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['Field Configs'],
      summary: 'Create a new field configuration',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['collectionName', 'fieldPath', 'displayName'],
              properties: {
                collectionName: { type: 'string', example: 'tasks' },
                fieldPath: { type: 'string', example: 'customField' },
                displayName: { type: 'string', example: 'Custom Field' },
                fieldType: { type: 'string', enum: ['text', 'number', 'boolean', 'date', 'select', 'multiselect', 'reference'], default: 'text' },
                isRequired: { type: 'boolean', default: false },
                isEditable: { type: 'boolean', default: true },
                isSearchable: { type: 'boolean', default: false },
                isSortable: { type: 'boolean', default: true },
                isFilterable: { type: 'boolean', default: false },
                displayOrder: { type: 'integer', default: 0 },
                width: { type: 'integer' },
                minWidth: { type: 'integer' },
                lookupType: { type: 'string', description: 'For select fields, the lookup type to use for options' },
                options: { type: 'array', items: { type: 'object' }, description: 'Static options for select fields' },
                referenceCollection: { type: 'string', description: 'For reference fields, the target collection' },
                referenceDisplayField: { type: 'string', default: 'displayName' },
                defaultValue: { type: 'string' },
                defaultVisible: { type: 'boolean', default: true },
                renderAs: { type: 'string', default: 'text' },
                validation: { type: 'object', description: 'Validation rules' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Field configuration created' },
        400: { description: 'Missing required fields' },
        409: { description: 'Field configuration already exists for this collection and field' },
      },
    },
  },
  '/api/field-configs/{collection}': {
    get: {
      tags: ['Field Configs'],
      summary: 'Get field configurations for a collection',
      parameters: [
        { name: 'collection', in: 'path', required: true, schema: { type: 'string' }, description: 'Collection name (e.g., "tasks")' },
        { name: 'editableOnly', in: 'query', schema: { type: 'boolean' }, description: 'Only return editable fields' },
        { name: 'visibleOnly', in: 'query', schema: { type: 'boolean' }, description: 'Only return default visible fields' },
      ],
      responses: {
        200: {
          description: 'Field configurations for the collection',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/FieldConfig' } },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/field-configs/{collection}/{fieldPath}': {
    get: {
      tags: ['Field Configs'],
      summary: 'Get a specific field configuration',
      parameters: [
        { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'fieldPath', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Field configuration found' },
        404: { description: 'Field configuration not found' },
      },
    },
  },
  '/api/field-configs/{id}': {
    patch: {
      tags: ['Field Configs'],
      summary: 'Update a field configuration',
      description: 'Updates a field configuration. collectionName and fieldPath cannot be changed.',
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
                fieldType: { type: 'string' },
                isRequired: { type: 'boolean' },
                isEditable: { type: 'boolean' },
                isSearchable: { type: 'boolean' },
                isSortable: { type: 'boolean' },
                isFilterable: { type: 'boolean' },
                displayOrder: { type: 'integer' },
                width: { type: 'integer' },
                minWidth: { type: 'integer' },
                lookupType: { type: 'string' },
                options: { type: 'array', items: { type: 'object' } },
                referenceCollection: { type: 'string' },
                referenceDisplayField: { type: 'string' },
                defaultValue: { type: 'string' },
                defaultVisible: { type: 'boolean' },
                renderAs: { type: 'string' },
                validation: { type: 'object' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Field configuration updated' },
        404: { description: 'Field configuration not found' },
      },
    },
    delete: {
      tags: ['Field Configs'],
      summary: 'Delete a field configuration',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Field configuration deleted' },
        404: { description: 'Field configuration not found' },
      },
    },
  },
  '/api/field-configs/{collection}/reorder': {
    put: {
      tags: ['Field Configs'],
      summary: 'Reorder field configurations',
      description: 'Bulk update display order for field configurations in a collection',
      parameters: [
        { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
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
                    required: ['fieldPath', 'displayOrder'],
                    properties: {
                      fieldPath: { type: 'string' },
                      displayOrder: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Field configurations reordered',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/FieldConfig' } },
                },
              },
            },
          },
        },
        400: { description: 'order array is required' },
      },
    },
  },
};
