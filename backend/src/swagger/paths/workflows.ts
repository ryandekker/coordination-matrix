// OpenAPI path definitions for Workflows and Workflow Runs endpoints

export const workflowPaths = {
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
  '/api/workflows/generate-mermaid': {
    post: {
      tags: ['Workflows'],
      summary: 'Generate Mermaid diagram from workflow steps',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['steps'],
              properties: {
                steps: { type: 'array', items: { type: 'object' } },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Generated Mermaid diagram' },
      },
    },
  },
  '/api/workflows/ai-prompt-context': {
    get: {
      tags: ['Workflows', 'AI'],
      summary: 'Get dynamic context for AI workflow generation',
      description: 'Returns structured data about available agents, users, workflows, step types, template variables, and Mermaid syntax. Use this to build prompts for AI tools generating workflows.',
      responses: {
        200: {
          description: 'AI prompt context data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      agents: { type: 'array', description: 'Available AI agents' },
                      users: { type: 'array', description: 'Available users for manual tasks' },
                      existingWorkflows: { type: 'array', description: 'Workflows available for nesting' },
                      stepTypes: { type: 'object', description: 'Step type definitions and examples' },
                      templateVariables: { type: 'object', description: 'Template variable reference' },
                      mermaidSyntax: { type: 'object', description: 'Mermaid syntax reference' },
                      rules: { type: 'array', description: 'Important validation rules' },
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
  '/api/workflows/ai-prompt': {
    get: {
      tags: ['Workflows', 'AI'],
      summary: 'Generate a complete AI prompt for workflow generation',
      description: 'Returns a markdown-formatted prompt ready to be used with AI tools. Includes step type reference, template variables, and optionally available context (agents, users, workflows).',
      parameters: [
        { name: 'format', in: 'query', schema: { type: 'string', enum: ['markdown', 'json'] }, description: 'Output format preference (default: markdown)' },
        { name: 'includeContext', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Include available agents/users/workflows (default: true)' },
      ],
      responses: {
        200: {
          description: 'AI prompt for workflow generation',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      prompt: { type: 'string', description: 'The complete prompt text' },
                      format: { type: 'string' },
                      includeContext: { type: 'boolean' },
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
};

export const workflowRunPaths = {
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
};

export const batchJobPaths = {
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
};
