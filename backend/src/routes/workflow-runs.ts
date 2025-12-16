import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { workflowExecutionService } from '../services/workflow-execution-service.js';
import { StartWorkflowInput, WorkflowRunStatus } from '../types/index.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Apply optional auth to all routes to get user ID from JWT token
router.use(optionalAuth);

// ============================================================================
// Start Workflow Run
// POST /api/workflow-runs
// ============================================================================
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const input: StartWorkflowInput = req.body;

    if (!input.workflowId) {
      res.status(400).json({ error: 'workflowId is required' });
      return;
    }

    if (!ObjectId.isValid(input.workflowId)) {
      res.status(400).json({ error: 'Invalid workflowId' });
      return;
    }

    // Get actor ID from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : null;

    const { run, rootTask } = await workflowExecutionService.startWorkflow(input, actorId);

    res.status(201).json({
      run,
      rootTask,
      message: 'Workflow started successfully',
    });
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Start error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start workflow';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// List Workflow Runs
// GET /api/workflow-runs
// ============================================================================
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      workflowId,
      status,
      page = '1',
      limit = '20',
    } = req.query;

    // Parse status (can be comma-separated)
    let statusFilter: WorkflowRunStatus | WorkflowRunStatus[] | undefined;
    if (status) {
      const statuses = (status as string).split(',') as WorkflowRunStatus[];
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    const result = await workflowExecutionService.listWorkflowRuns({
      workflowId: workflowId as string,
      status: statusFilter,
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });

    res.json({
      data: result.runs,
      pagination: {
        page: parseInt(page as string, 10),
        limit: parseInt(limit as string, 10),
        total: result.total,
        totalPages: Math.ceil(result.total / parseInt(limit as string, 10)),
      },
    });
  } catch (error) {
    console.error('[WorkflowRuns] List error:', error);
    res.status(500).json({ error: 'Failed to list workflow runs' });
  }
});

// ============================================================================
// Get Workflow Run
// GET /api/workflow-runs/:id
// ============================================================================
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const includeTasks = req.query.includeTasks === 'true';

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    if (includeTasks) {
      const result = await workflowExecutionService.getWorkflowRunWithTasks(id);
      if (!result) {
        res.status(404).json({ error: 'Workflow run not found' });
        return;
      }
      res.json(result);
    } else {
      const run = await workflowExecutionService.getWorkflowRun(id);
      if (!run) {
        res.status(404).json({ error: 'Workflow run not found' });
        return;
      }
      res.json(run);
    }
  } catch (error) {
    console.error('[WorkflowRuns] Get error:', error);
    res.status(500).json({ error: 'Failed to get workflow run' });
  }
});

// ============================================================================
// Cancel Workflow Run
// POST /api/workflow-runs/:id/cancel
// ============================================================================
router.post('/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    // Get actor ID from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : undefined;

    const run = await workflowExecutionService.cancelWorkflowRun(id, actorId);
    res.json(run);
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Cancel error:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel workflow run';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Foreach Item Callback (Streaming)
// POST /api/workflow-runs/:id/foreach/:stepId/item
// Accepts individual items to add as children to a waiting foreach task
// ============================================================================
router.post('/:id/foreach/:stepId/item', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, stepId } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      res.status(401).json({ error: 'Missing X-Workflow-Secret header' });
      return;
    }

    const { item, expectedCount, complete } = req.body;

    // Validate payload
    if (item === undefined && expectedCount === undefined && !complete) {
      res.status(400).json({
        error: 'Request body must include at least one of: item, expectedCount, or complete'
      });
      return;
    }

    const result = await workflowExecutionService.handleForeachItemCallback(
      id,
      stepId,
      { item, expectedCount, complete },
      secret
    );

    res.json(result);
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Foreach item callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process foreach item';

    if (message.includes('Invalid callback secret') || message.includes('secret')) {
      res.status(401).json({ error: message });
      return;
    }
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
});

// ============================================================================
// External Callback
// POST /api/workflow-runs/:id/callback/:stepId
// ============================================================================
router.post('/:id/callback/:stepId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, stepId } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      res.status(401).json({ error: 'Missing X-Workflow-Secret header' });
      return;
    }

    const payload = req.body;
    const task = await workflowExecutionService.handleExternalCallback(id, stepId, payload, secret);

    res.json({
      acknowledged: true,
      taskId: task._id,
      taskStatus: task.status,
    });
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process callback';

    if (message.includes('Invalid callback secret')) {
      res.status(401).json({ error: message });
      return;
    }
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
});

export default router;
