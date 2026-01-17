// OpenAPI path definitions for Workflows and Workflow Runs endpoints

export const workflowPaths = {
  '/api/workflows': {
    get: {
      tags: ['Workflows'],
      summary: 'List all workflows',
      parameters: [
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include inactive workflows (excluded by default)' },
        { name: 'brief', in: 'query', schema: { type: 'boolean' }, description: 'Return step counts instead of full steps array (faster for list views)' },
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
                rootTaskTitleTemplate: { type: 'string', description: 'Template for root task title' },
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
  '/api/workflows/stats': {
    get: {
      tags: ['Workflows'],
      summary: 'Get workflow run statistics',
      description: 'Returns run counts, success/failure counts, and last run time for each workflow',
      responses: {
        200: {
          description: 'Workflow statistics by workflow ID',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        runCount: { type: 'integer' },
                        lastRunAt: { type: 'string', format: 'date-time', nullable: true },
                        completedCount: { type: 'integer' },
                        failedCount: { type: 'integer' },
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
  },
  '/api/workflows/export-multi': {
    get: {
      tags: ['Workflows'],
      summary: 'Export workflows as multi-workflow Mermaid',
      description: 'Export one or more workflows as a single Mermaid document with subgraphs. Use for backup or sharing.',
      parameters: [
        { name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Comma-separated workflow IDs (omit to export all)' },
      ],
      responses: {
        200: {
          description: 'Multi-workflow Mermaid document',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      mermaid: { type: 'string', description: 'Mermaid document with subgraphs' },
                      workflows: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            isNew: { type: 'boolean' },
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
      },
    },
  },
  '/api/workflows/import-multi': {
    post: {
      tags: ['Workflows'],
      summary: 'Import workflows from multi-workflow Mermaid',
      description: 'Import workflows from a Mermaid document with subgraphs. Use @workflow, @id, @description metadata in comments.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['mermaid'],
              properties: {
                mermaid: { type: 'string', description: 'Mermaid document with subgraphs' },
                dryRun: { type: 'boolean', default: false, description: 'Validate without saving' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Import results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      results: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            id: { type: 'string' },
                            action: { type: 'string', enum: ['create', 'update', 'skip'] },
                            stepCount: { type: 'integer' },
                            error: { type: 'string' },
                            warnings: { type: 'array', items: { type: 'string' } },
                          },
                        },
                      },
                      summary: {
                        type: 'object',
                        properties: {
                          total: { type: 'integer' },
                          created: { type: 'integer' },
                          updated: { type: 'integer' },
                          skipped: { type: 'integer' },
                        },
                      },
                      dryRun: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        400: { description: 'Invalid Mermaid document or no subgraphs found' },
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
        { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated statuses' },
        { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
      ],
      responses: {
        200: { description: 'List of workflow runs with pagination' },
      },
    },
    post: {
      tags: ['Workflow Runs'],
      summary: 'Start a new workflow run',
      description: 'Requires authentication (JWT or API key)',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['workflowId'],
              properties: {
                workflowId: { type: 'string' },
                inputPayload: { type: 'object', description: 'Input data passed to workflow' },
                taskDefaults: { type: 'object', description: 'Default values for created tasks' },
                executionOptions: { type: 'object', description: 'Workflow execution options' },
                externalId: { type: 'string', description: 'External reference ID' },
                source: { type: 'string', description: 'Source system identifier' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Workflow run started',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  run: { type: 'object' },
                  rootTask: { type: 'object' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid workflowId or workflow not found' },
      },
    },
  },
  '/api/workflow-runs/requests': {
    get: {
      tags: ['Workflow Runs'],
      summary: 'List workflow requests (inbound request log)',
      description: 'Returns logged inbound requests that trigger or interact with workflows',
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string', enum: ['workflow_start', 'workflow_callback'] } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'failed'] } },
        { name: 'workflowId', in: 'query', schema: { type: 'string' } },
        { name: 'workflowRunId', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        200: { description: 'List of workflow requests' },
      },
    },
  },
  '/api/workflow-runs/requests/{requestId}': {
    get: {
      tags: ['Workflow Runs'],
      summary: 'Get a specific workflow request',
      parameters: [
        { name: 'requestId', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Workflow request details' },
        404: { description: 'Workflow request not found' },
      },
    },
  },
  '/api/workflow-runs/{id}': {
    get: {
      tags: ['Workflow Runs'],
      summary: 'Get workflow run details',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'includeTasks', in: 'query', schema: { type: 'boolean' }, description: 'Include tasks for this run' },
        { name: 'includeChildCounts', in: 'query', schema: { type: 'boolean' }, description: 'Include descendant counts for tasks' },
        { name: 'includeDetails', in: 'query', schema: { type: 'boolean' }, description: 'Include full task details' },
        { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Limit number of tasks' },
        { name: 'beforeCreatedAt', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Cursor for pagination' },
        { name: 'afterCreatedAt', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Cursor for pagination' },
      ],
      responses: {
        200: { description: 'Workflow run details' },
        404: { description: 'Workflow run not found' },
      },
    },
  },
  '/api/workflow-runs/{id}/tasks/{taskId}/children': {
    get: {
      tags: ['Workflow Runs'],
      summary: 'Get child tasks for a workflow run task',
      description: 'Lazy loading endpoint for task children in workflow run view',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Workflow run ID' },
        { name: 'taskId', in: 'path', required: true, schema: { type: 'string' }, description: 'Parent task ID' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        200: { description: 'Child tasks' },
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
        400: { description: 'Cannot cancel workflow run' },
      },
    },
  },
  '/api/workflow-runs/{id}/execute-step/{stepId}': {
    post: {
      tags: ['Workflow Runs'],
      summary: 'Manually execute a stuck workflow step',
      description: 'Used to recover stuck workflows where step tracking advanced but task was not created',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Workflow run ID' },
        { name: 'stepId', in: 'path', required: true, schema: { type: 'string' }, description: 'Step ID to execute' },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                inputPayload: { type: 'object', description: 'Input data for the step' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Step executed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  taskId: { type: 'string' },
                },
              },
            },
          },
        },
        400: { description: 'Cannot execute step' },
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
        { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated statuses' },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'workflowId', in: 'query', schema: { type: 'string' } },
        { name: 'taskId', in: 'query', schema: { type: 'string' } },
        { name: 'requiresManualReview', in: 'query', schema: { type: 'boolean' } },
        { name: 'taskStatus', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task status' },
        { name: 'taskType', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task type' },
        { name: 'assigneeId', in: 'query', schema: { type: 'string' }, description: 'Filter by associated task assignee' },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
      ],
      responses: {
        200: { description: 'List of batch jobs with pagination' },
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
                expectedCount: { type: 'integer', minimum: 0 },
                name: { type: 'string' },
                type: { type: 'string' },
                workflowId: { type: 'string' },
                taskId: { type: 'string' },
                minSuccessPercent: { type: 'number', default: 100 },
                deadlineAt: { type: 'string', format: 'date-time' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['itemKey'],
                    properties: {
                      itemKey: { type: 'string', description: 'Unique key for this item' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Batch job created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  _id: { type: 'string' },
                  callbackUrl: { type: 'string', description: 'URL for posting item completions' },
                  callbackSecretHint: { type: 'string', description: 'First 10 chars of callback secret' },
                },
              },
            },
          },
        },
        400: { description: 'Validation error (duplicate itemKey, invalid expectedCount)' },
      },
    },
  },
  '/api/batch-jobs/stats/summary': {
    get: {
      tags: ['Batch Jobs'],
      summary: 'Get batch job statistics',
      responses: {
        200: {
          description: 'Batch job statistics',
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
            },
          },
        },
      },
    },
  },
  '/api/batch-jobs/admin/check-deadlines': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Force deadline check (admin/debug)',
      description: 'Triggers deadline check for batch jobs. Used for debugging.',
      responses: {
        200: { description: 'Deadline check completed' },
      },
    },
  },
  '/api/batch-jobs/{id}': {
    get: {
      tags: ['Batch Jobs'],
      summary: 'Get a specific batch job',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
        { name: 'includeItems', in: 'query', schema: { type: 'boolean' }, description: 'Include all items' },
      ],
      responses: {
        200: { description: 'Batch job details' },
        404: { description: 'Batch job not found' },
      },
    },
  },
  '/api/batch-jobs/{id}/start': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Start a batch job',
      description: 'Transitions job from pending to running',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Batch job started' },
        400: { description: 'Cannot start batch job (wrong state)' },
      },
    },
  },
  '/api/batch-jobs/{id}/callback': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Batch job callback (fan-in)',
      description: 'Called when an item completes. Used by external workers.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
        { name: 'X-Batch-Secret', in: 'header', required: true, schema: { type: 'string' }, description: 'Callback secret for authentication' },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['itemKey', 'success'],
              properties: {
                itemKey: { type: 'string', description: 'Unique key for this item' },
                externalId: { type: 'string' },
                success: { type: 'boolean' },
                result: { type: 'object', description: 'Result data for successful items' },
                error: { type: 'string', description: 'Error message for failed items' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Callback processed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  acknowledged: { type: 'boolean' },
                  itemId: { type: 'string' },
                  itemStatus: { type: 'string' },
                  joinSatisfied: { type: 'boolean', description: 'Whether batch is now complete' },
                  joinResult: { type: 'object', nullable: true },
                },
              },
            },
          },
        },
        401: { description: 'Invalid callback secret' },
        404: { description: 'Batch job or item not found' },
        409: { description: 'Batch job is sealed (no more callbacks accepted)' },
      },
    },
  },
  '/api/batch-jobs/{id}/aggregate': {
    get: {
      tags: ['Batch Jobs'],
      summary: 'Get aggregated batch job results',
      description: 'Returns aggregated results from all completed items',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Aggregated results' },
        404: { description: 'Batch job not found' },
      },
    },
  },
  '/api/batch-jobs/{id}/review': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Submit review for batch job',
      description: 'Approve, reject, or proceed with partial results. Requires authentication.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['decision'],
              properties: {
                decision: { type: 'string', enum: ['approved', 'rejected', 'proceed_with_partial'] },
                notes: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Review submitted' },
        400: { description: 'Invalid decision' },
        401: { description: 'Authentication required for review' },
      },
    },
  },
  '/api/batch-jobs/{id}/request-review': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Request manual review for batch job',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                reason: { type: 'string', default: 'Manual review requested' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Review requested' },
        400: { description: 'Cannot request review' },
      },
    },
  },
  '/api/batch-jobs/{id}/cancel': {
    post: {
      tags: ['Batch Jobs'],
      summary: 'Cancel a batch job',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'Batch job cancelled' },
        400: { description: 'Cannot cancel batch job' },
      },
    },
  },
};
