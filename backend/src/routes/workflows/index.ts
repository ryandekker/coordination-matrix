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
workflowsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive, brief } = req.query;

    const filter: Record<string, unknown> = {};
    if (includeInactive !== 'true') {
      filter.isActive = true;
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
    const { name, description, steps, mermaidDiagram, isActive } = req.body;

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
    const { code, input, trigger, steps, packages, timeout } = req.body;

    if (!code || typeof code !== 'string') {
      throw createError('code is required', 400);
    }

    // Build execution context - supports both simple input and full context
    const context = trigger !== undefined || steps !== undefined
      ? { input: input || {}, trigger: trigger || {}, steps: steps || {} }
      : input || {};

    // Execute the code in sandbox
    const result = await executeCode(code, context, {
      packages: packages || [],
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

// Re-export types and utilities
export * from './types.js';
export { parseMermaidToSteps, generateMermaidFromSteps } from './mermaid-parser.js';
export { ensureStepIds };
