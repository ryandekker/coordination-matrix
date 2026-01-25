import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../db/connection.js';
import { createError } from '../../middleware/error-handler.js';
import { Workflow, WorkflowStep, VALID_STEP_TYPES } from './types.js';
import { parseMermaidToSteps, generateMermaidFromSteps } from './mermaid-parser.js';
import { handleExportMulti, handleImportMulti } from './multi-workflow.js';
import { aiPromptRoutes } from './ai-prompts.js';
import { executeCode } from '../../services/workflow/code-executor.js';

export const workflowsRouter = Router();

// Mount AI prompt routes (must come before /:id to avoid matching)
workflowsRouter.use(aiPromptRoutes);

// GET /api/workflows - List all workflows
// Query params:
//   - includeInactive: 'true' to include inactive workflows
//   - brief: 'true' to return step counts instead of full steps array (for faster list views)
//   - folderId: filter by folder (use 'null' for unfiled workflows)
workflowsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive, brief, folderId } = req.query;

    const filter: Record<string, unknown> = {};
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    // Filter by folder
    if (folderId === 'null') {
      filter.folderId = { $in: [null, undefined] };
    } else if (folderId) {
      filter.folderId = new ObjectId(folderId as string);
    }

    const workflows = await db
      .collection<Workflow>('workflows')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    // In brief mode, replace steps array with step counts for lighter payload
    if (brief === 'true') {
      const briefWorkflows = workflows.map(w => {
        const steps = w.steps || [];

        // Count by step type, with legacy fallback
        let agentCount = 0;
        let manualCount = 0;
        let otherCount = 0;

        for (const s of steps) {
          // Check explicit stepType first
          if (s.stepType === 'agent') {
            agentCount++;
          } else if (s.stepType === 'manual') {
            manualCount++;
          } else if (s.stepType) {
            // Has stepType but it's not agent or manual (decision, foreach, join, flow, external, etc.)
            otherCount++;
          } else {
            // Legacy fallback: check execution or type fields
            if (s.execution === 'manual' || s.type === 'manual') {
              manualCount++;
            } else {
              agentCount++;
            }
          }
        }

        // Return workflow without steps array, but with step counts
        const { steps: _steps, ...rest } = w;
        return {
          ...rest,
          stepCounts: {
            total: steps.length,
            agent: agentCount,
            manual: manualCount,
            other: otherCount,
          },
        };
      });
      res.json({ data: briefWorkflows });
      return;
    }

    res.json({ data: workflows });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/stats - Get workflow run statistics
workflowsRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();

    // Collection name uses snake_case in the database
    const collections = await db.listCollections({ name: 'workflow_runs' }).toArray();
    if (collections.length === 0) {
      res.json({ data: {} });
      return;
    }

    const stats = await db.collection('workflow_runs').aggregate([
      {
        $group: {
          _id: '$workflowId',
          runCount: { $sum: 1 },
          lastRunAt: { $max: '$createdAt' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const statsMap: Record<string, {
      runCount: number;
      lastRunAt: Date | null;
      completedCount: number;
      failedCount: number;
    }> = {};

    for (const stat of stats) {
      if (stat._id) {
        // Convert ObjectId to string for consistent keying
        const key = typeof stat._id === 'string' ? stat._id : stat._id.toString();
        statsMap[key] = {
          runCount: stat.runCount,
          lastRunAt: stat.lastRunAt,
          completedCount: stat.completedCount,
          failedCount: stat.failedCount
        };
      }
    }

    res.json({ data: statsMap });
  } catch (error) {
    next(error);
  }
});

// Multi-workflow routes (must come before /:id)
workflowsRouter.get('/export-multi', handleExportMulti);
workflowsRouter.post('/import-multi', handleImportMulti);

// GET /api/workflows/:id - Get a specific workflow
workflowsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const workflow = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!workflow) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: workflow });
  } catch (error) {
    next(error);
  }
});

// Helper to ensure all steps have IDs
function ensureStepIds(steps: WorkflowStep[]): WorkflowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  return steps.map((step) => {
    const normalized = { ...step };

    if (!normalized.id) {
      normalized.id = new ObjectId().toString();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepAny = step as any;
    if (!normalized.stepType && stepAny.type && VALID_STEP_TYPES.includes(stepAny.type)) {
      normalized.stepType = stepAny.type;
      delete stepAny.type;
    }

    return normalized;
  });
}

// POST /api/workflows - Create a new workflow
workflowsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, description, steps, mermaidDiagram, isActive, folderId, color } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    const now = new Date();
    const newWorkflow: Omit<Workflow, '_id'> = {
      name,
      description: description || '',
      isActive: isActive ?? true,
      steps: ensureStepIds(steps || []),
      mermaidDiagram: mermaidDiagram || '',
      folderId: folderId ? new ObjectId(folderId) : null,
      color: color || undefined,
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflows/:id - Update a workflow
workflowsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.createdAt;
    updates.updatedAt = new Date();

    if (updates.steps) {
      updates.steps = ensureStepIds(updates.steps);
    }

    // Handle folderId conversion
    if ('folderId' in updates) {
      updates.folderId = updates.folderId ? new ObjectId(updates.folderId) : null;
    }

    const result = await db.collection<Workflow>('workflows').findOneAndUpdate(
      { _id: workflowId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id - Delete a workflow
workflowsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const result = await db.collection('workflows').deleteOne({ _id: workflowId });

    if (result.deletedCount === 0) {
      throw createError('Workflow not found', 404);
    }

    res.json({ success: true, message: 'Workflow deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/duplicate - Duplicate a workflow
workflowsRouter.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const original = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!original) {
      throw createError('Workflow not found', 404);
    }

    const now = new Date();
    const duplicate: Omit<Workflow, '_id'> = {
      name: `${original.name} (Copy)`,
      description: original.description,
      isActive: false,
      steps: original.steps.map((step) => ({ ...step, id: new ObjectId().toString() })),
      mermaidDiagram: original.mermaidDiagram,
      folderId: original.folderId || null,
      color: original.color,
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(duplicate as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/parse-mermaid - Parse Mermaid diagram to workflow steps
workflowsRouter.post('/parse-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mermaidDiagram } = req.body;

    if (!mermaidDiagram) {
      throw createError('mermaidDiagram is required', 400);
    }

    const steps = parseMermaidToSteps(mermaidDiagram);

    res.json({ data: { steps, mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/generate-mermaid - Generate Mermaid diagram from steps
workflowsRouter.post('/generate-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { steps, name } = req.body;

    if (!steps || !Array.isArray(steps)) {
      throw createError('steps array is required', 400);
    }

    const mermaidDiagram = generateMermaidFromSteps(steps, name);

    res.json({ data: { mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/test-code - Test code execution in sandbox
workflowsRouter.post('/test-code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, input, trigger, steps, variables, packages, timeout } = req.body;

    if (!code || typeof code !== 'string') {
      throw createError('code is required', 400);
    }

    // Build execution context
    const context = {
      input: input || {},
      trigger: trigger || {},
      steps: steps || {},
    };

    // Execute the code in sandbox with variable mappings
    // Variables are resolved from context paths at execution time
    const result = await executeCode(code, context, {
      packages: packages || [],
      variables: variables || [], // Array of { name, path } mappings
      timeout: timeout || 5000, // Shorter timeout for testing (5s)
    });

    if (result.success) {
      res.json({
        output: result.output,
        logs: result.logs,
      });
    } else {
      res.status(400).json({
        error: result.error,
        logs: result.logs,
      });
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:workflowId/runs/:runId/context - Get execution context from a workflow run
// Returns trigger payload and step outputs for testing code steps
workflowsRouter.get('/:workflowId/runs/:runId/context', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { workflowId, runId } = req.params;
    const { stepId } = req.query; // Optional: get context as of a specific step

    if (!ObjectId.isValid(workflowId) || !ObjectId.isValid(runId)) {
      throw createError('Invalid workflow or run ID', 400);
    }

    // Get the workflow run
    const run = await db.collection('workflow_runs').findOne({
      _id: new ObjectId(runId),
      workflowId: new ObjectId(workflowId),
    });

    if (!run) {
      throw createError('Workflow run not found', 404);
    }

    // Get the workflow to map step IDs to names
    const workflow = await db.collection<Workflow>('workflows').findOne({
      _id: new ObjectId(workflowId),
    });

    // Get all completed tasks for this run to extract step outputs
    const tasks = await db.collection('tasks').find({
      workflowRunId: new ObjectId(runId),
      status: { $in: ['completed', 'on_hold'] },
    }).sort({ completedAt: 1 }).toArray();

    // Build step outputs map (by step ID)
    const steps: Record<string, unknown> = {};
    let previousStepOutput: unknown = null;

    for (const task of tasks) {
      const taskStepId = task.workflowStage;
      if (!taskStepId) continue;

      // If stepId is specified, only include steps before it
      if (stepId && taskStepId === stepId) {
        break;
      }

      // Get the step's output from result or metadata
      const output = task.result?.current?.output ?? task.metadata?.output ?? task.metadata;
      steps[taskStepId] = output;
      previousStepOutput = output;

      // Also store by step name for convenience
      const stepDef = workflow?.steps?.find((s: WorkflowStep) => s.id === taskStepId);
      if (stepDef?.name) {
        steps[stepDef.name] = output;
      }
    }

    res.json({
      data: {
        trigger: run.inputPayload || {},
        input: previousStepOutput || run.inputPayload || {},
        steps,
        runStatus: run.status,
        workflowName: workflow?.name,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:workflowId/runs - List recent runs for a workflow (for test input selection)
workflowsRouter.get('/:workflowId/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { workflowId } = req.params;
    const { limit = '10', status } = req.query;

    if (!ObjectId.isValid(workflowId)) {
      throw createError('Invalid workflow ID', 400);
    }

    const filter: Record<string, unknown> = {
      workflowId: new ObjectId(workflowId),
    };

    if (status) {
      filter.status = status;
    }

    const runs = await db.collection('workflow_runs')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit as string, 10), 50))
      .project({
        _id: 1,
        status: 1,
        createdAt: 1,
        completedAt: 1,
        inputPayload: 1,
      })
      .toArray();

    res.json({ data: runs });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:workflowId/steps/:stepId/input-preview - Preview input for a step based on a previous run
// Accepts optional inputConfig in body to preview with unsaved configuration
workflowsRouter.post('/:workflowId/steps/:stepId/input-preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { workflowId, stepId } = req.params;
    const { workflowRunId, inputConfig: providedInputConfig } = req.body;

    if (!ObjectId.isValid(workflowId)) {
      throw createError('Invalid workflow ID', 400);
    }

    // Get the workflow
    const workflow = await db.collection<Workflow>('workflows').findOne({
      _id: new ObjectId(workflowId),
    });

    if (!workflow) {
      throw createError('Workflow not found', 404);
    }

    // Find the step
    const step = workflow.steps?.find(s => s.id === stepId);
    if (!step) {
      throw createError('Step not found in workflow', 404);
    }

    // Get a previous run to use for preview
    let run;
    if (workflowRunId && ObjectId.isValid(workflowRunId as string)) {
      run = await db.collection('workflow_runs').findOne({
        _id: new ObjectId(workflowRunId as string),
        workflowId: new ObjectId(workflowId),
      });
    } else {
      // Get the most recent completed run
      run = await db.collection('workflow_runs').findOne(
        { workflowId: new ObjectId(workflowId), status: 'completed' },
        { sort: { completedAt: -1 } }
      );
    }

    if (!run) {
      res.json({
        data: {
          previewSource: 'none',
          message: 'No completed workflow runs available for preview',
          inputConfig: step.inputConfig,
        },
      });
      return;
    }

    // Find the step index to determine which previous step's output to use
    const stepIndex = workflow.steps?.findIndex(s => s.id === stepId) ?? -1;

    let previousStepOutput: Record<string, unknown> = {};
    let previousStepId: string | null = null;

    if (stepIndex > 0) {
      // Get output from previous step
      const prevStep = workflow.steps?.[stepIndex - 1];
      if (prevStep) {
        previousStepId = prevStep.id;
        const prevTask = await db.collection('tasks').findOne({
          workflowRunId: run._id,
          workflowStepId: prevStep.id,
          status: 'completed',
        }, { sort: { completedAt: -1 } });

        if (prevTask) {
          // Use stepOutput if available, otherwise fall back to metadata
          if (prevTask.stepOutput?.data !== undefined) {
            previousStepOutput = { output: prevTask.stepOutput.data, ...prevTask.stepOutput };
          } else {
            previousStepOutput = (prevTask.metadata as Record<string, unknown>) || {};
            previousStepOutput.output = previousStepOutput.response || previousStepOutput.output || {};
          }
        }
      }
    } else {
      // First step - use trigger payload
      previousStepOutput = run.inputPayload || {};
    }

    // Resolve the input based on inputConfig
    // Use provided inputConfig (for previewing unsaved changes) or fall back to saved step config
    let resolvedInput: Record<string, unknown>;
    const inputConfig = providedInputConfig || step.inputConfig;

    if (inputConfig) {
      // Use the new unified input config
      let sourceData = previousStepOutput;

      if (inputConfig.source === 'trigger') {
        sourceData = run.inputPayload || {};
      } else if (inputConfig.source !== 'previous' && inputConfig.source) {
        // Specific step ID
        const sourceTask = await db.collection('tasks').findOne({
          workflowRunId: run._id,
          workflowStepId: inputConfig.source,
          status: 'completed',
        }, { sort: { completedAt: -1 } });

        if (sourceTask?.stepOutput?.data !== undefined) {
          sourceData = { output: sourceTask.stepOutput.data, ...sourceTask.stepOutput };
        } else if (sourceTask?.metadata) {
          sourceData = sourceTask.metadata as Record<string, unknown>;
        }
      }

      if (inputConfig.extractPath) {
        // Simple path extraction
        const extracted = getNestedValue(sourceData, inputConfig.extractPath);
        resolvedInput = { _input: extracted, _source: sourceData };
      } else if (inputConfig.mapping && Object.keys(inputConfig.mapping).length > 0) {
        // Field mapping
        resolvedInput = {};
        const mapping = inputConfig.mapping as Record<string, string>;
        for (const [key, template] of Object.entries(mapping)) {
          // Simple template resolution for preview
          const value = resolveSimpleTemplate(template, sourceData, (run.inputPayload as Record<string, unknown>) || {});
          resolvedInput[key] = value;
        }
      } else {
        resolvedInput = sourceData;
      }
    } else {
      // No inputConfig - use previous step output directly
      resolvedInput = previousStepOutput;
    }

    res.json({
      data: {
        previewSource: 'run',
        workflowRunId: run._id.toString(),
        runCompletedAt: run.completedAt,
        runStatus: run.status,
        previousStepId,
        previousStepOutput,
        resolvedInput,
        inputConfig: inputConfig || null,
        inputConfigSource: providedInputConfig ? 'provided' : 'saved',
        // Also include legacy fields for reference
        legacyInputPath: step.inputPath,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:workflowId/steps/:stepId/test-execute - Execute a step with test input
workflowsRouter.post('/:workflowId/steps/:stepId/test-execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { workflowId, stepId } = req.params;
    const { inputPayload, dryRun } = req.body;

    if (!ObjectId.isValid(workflowId)) {
      throw createError('Invalid workflow ID', 400);
    }

    // Get the workflow
    const workflow = await db.collection<Workflow>('workflows').findOne({
      _id: new ObjectId(workflowId),
    });

    if (!workflow) {
      throw createError('Workflow not found', 404);
    }

    // Find the step
    const step = workflow.steps?.find(s => s.id === stepId);
    if (!step) {
      throw createError('Step not found in workflow', 404);
    }

    const stepType = step.stepType || 'agent';
    const startTime = Date.now();

    // Handle different step types
    switch (stepType) {
      case 'code': {
        if (!step.codeConfig?.code) {
          throw createError('Code step has no code configured', 400);
        }

        const result = await executeCode(step.codeConfig.code, {
          input: inputPayload || {},
          trigger: {},
          steps: {},
        }, {
          packages: step.codeConfig.packages || [],
          variables: [], // Would need to resolve these from context
          timeout: step.codeConfig.timeout || 5000,
        });

        res.json({
          data: {
            success: result.success,
            output: result.output,
            error: result.error,
            logs: result.logs,
            executionTimeMs: result.executionTimeMs,
            stepType: 'code',
          },
        });
        break;
      }

      case 'decision': {
        // Evaluate conditions against input
        const connections = step.connections || [];
        let selectedBranch = null;

        for (const conn of connections) {
          if (!conn.condition) continue;

          // Simple condition evaluation (for preview purposes)
          try {
            const conditionResult = evaluateSimpleCondition(conn.condition, inputPayload || {});
            if (conditionResult) {
              selectedBranch = {
                targetStepId: conn.targetStepId,
                condition: conn.condition,
                label: conn.label,
              };
              break;
            }
          } catch {
            // Condition evaluation failed, continue to next
          }
        }

        // If no branch matched, use default
        if (!selectedBranch && step.defaultConnection) {
          selectedBranch = {
            targetStepId: step.defaultConnection,
            condition: 'default',
          };
        }

        res.json({
          data: {
            success: true,
            output: { selectedBranch },
            executionTimeMs: Date.now() - startTime,
            stepType: 'decision',
          },
        });
        break;
      }

      case 'foreach': {
        // Extract items from input based on itemsPath
        const itemsPath = step.itemsPath || 'items';
        const items = getNestedValue(inputPayload || {}, itemsPath);

        if (!Array.isArray(items)) {
          res.json({
            data: {
              success: false,
              error: `Items path "${itemsPath}" did not return an array`,
              output: { extractedValue: items },
              executionTimeMs: Date.now() - startTime,
              stepType: 'foreach',
            },
          });
          return;
        }

        const maxItems = step.maxItems || 100;
        const limitedItems = items.slice(0, maxItems);

        res.json({
          data: {
            success: true,
            output: {
              totalItems: items.length,
              itemsToProcess: limitedItems.length,
              sampleItems: limitedItems.slice(0, 5), // Show first 5 items as sample
              itemVariable: step.itemVariable || 'item',
            },
            executionTimeMs: Date.now() - startTime,
            stepType: 'foreach',
          },
        });
        break;
      }

      case 'webhook':
      case 'external': {
        // For webhook/external, show what would be sent
        const url = step.externalConfig?.endpoint || step.webhookConfig?.url;
        const method = step.externalConfig?.method || step.webhookConfig?.method || 'POST';
        const bodyTemplate = step.externalConfig?.payloadTemplate || step.webhookConfig?.bodyTemplate;

        // Resolve the body template
        let resolvedBody = null;
        if (bodyTemplate) {
          try {
            resolvedBody = resolveSimpleTemplate(bodyTemplate, inputPayload || {}, {});
          } catch {
            resolvedBody = bodyTemplate;
          }
        }

        if (dryRun) {
          // Just show what would be sent
          res.json({
            data: {
              success: true,
              dryRun: true,
              output: {
                request: {
                  url,
                  method,
                  headers: step.externalConfig?.headers || step.webhookConfig?.headers,
                  body: resolvedBody,
                },
              },
              executionTimeMs: Date.now() - startTime,
              stepType,
            },
          });
        } else {
          // Actually make the HTTP call
          // For now, just show the request details
          res.json({
            data: {
              success: true,
              dryRun: true,
              message: 'Live HTTP execution not yet implemented in test mode',
              output: {
                request: {
                  url,
                  method,
                  headers: step.externalConfig?.headers || step.webhookConfig?.headers,
                  body: resolvedBody,
                },
              },
              executionTimeMs: Date.now() - startTime,
              stepType,
            },
          });
        }
        break;
      }

      case 'agent':
      case 'manual':
        res.json({
          data: {
            success: false,
            error: `Step type "${stepType}" requires human or AI execution and cannot be test-executed`,
            executionTimeMs: Date.now() - startTime,
            stepType,
          },
        });
        break;

      default:
        res.json({
          data: {
            success: false,
            error: `Test execution not supported for step type "${stepType}"`,
            executionTimeMs: Date.now() - startTime,
            stepType,
          },
        });
    }
  } catch (error) {
    next(error);
  }
});

// Helper function to get nested value from object by path
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// Helper function to resolve simple template expressions
function resolveSimpleTemplate(
  template: string,
  sourceData: Record<string, unknown>,
  triggerData: Record<string, unknown>
): unknown {
  // If it's a simple variable reference like "{{output.field}}"
  const simpleMatch = template.match(/^\{\{([^}]+)\}\}$/);
  if (simpleMatch) {
    const path = simpleMatch[1].trim();

    if (path.startsWith('trigger.')) {
      return getNestedValue(triggerData, path.substring(8));
    }
    if (path.startsWith('input.')) {
      return getNestedValue(sourceData, path.substring(6));
    }
    return getNestedValue(sourceData, path);
  }

  // Otherwise, replace all template variables with string values
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
    const trimmedPath = path.trim();
    let value: unknown;

    if (trimmedPath.startsWith('trigger.')) {
      value = getNestedValue(triggerData, trimmedPath.substring(8));
    } else if (trimmedPath.startsWith('input.')) {
      value = getNestedValue(sourceData, trimmedPath.substring(6));
    } else {
      value = getNestedValue(sourceData, trimmedPath);
    }

    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

// Helper function to evaluate simple conditions
function evaluateSimpleCondition(condition: string, input: Record<string, unknown>): boolean {
  // Handle simple equality checks like "output.status == 'approved'"
  const equalityMatch = condition.match(/^(.+?)\s*===?\s*['"](.+)['"]$/);
  if (equalityMatch) {
    const [, path, expected] = equalityMatch;
    const actual = getNestedValue(input, path.trim());
    return actual === expected;
  }

  // Handle simple truthy checks like "output.approved"
  const truthyMatch = condition.match(/^(.+)$/);
  if (truthyMatch) {
    const value = getNestedValue(input, condition.trim());
    return Boolean(value);
  }

  return false;
}

// Re-export types and utilities
export * from './types.js';
export { parseMermaidToSteps, generateMermaidFromSteps } from './mermaid-parser.js';
export { ensureStepIds };
