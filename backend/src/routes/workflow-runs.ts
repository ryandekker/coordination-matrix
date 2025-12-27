import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { workflowExecutionService } from '../services/workflow-execution-service.js';
import { StartWorkflowInput, WorkflowRunStatus } from '../types/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================================================
// Start Workflow Run
// POST /api/workflow-runs
// Requires authentication (JWT or API key) to prevent spam
// ============================================================================
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      workflowId,
      status,
      dateFrom,
      dateTo,
      page = '1',
      limit = '20',
    } = req.query;

    // Parse status (can be comma-separated)
    let statusFilter: WorkflowRunStatus | WorkflowRunStatus[] | undefined;
    if (status) {
      const statuses = (status as string).split(',') as WorkflowRunStatus[];
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    // Parse date filters
    let dateFromParsed: Date | undefined;
    let dateToParsed: Date | undefined;
    if (dateFrom) {
      dateFromParsed = new Date(dateFrom as string);
      dateFromParsed.setHours(0, 0, 0, 0);
    }
    if (dateTo) {
      dateToParsed = new Date(dateTo as string);
      dateToParsed.setHours(23, 59, 59, 999);
    }

    const result = await workflowExecutionService.listWorkflowRuns({
      workflowId: workflowId as string,
      status: statusFilter,
      dateFrom: dateFromParsed,
      dateTo: dateToParsed,
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
// Requires authentication (JWT or API key)
// ============================================================================
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const includeTasks = req.query.includeTasks === 'true';
    const taskLimit = req.query.taskLimit ? parseInt(req.query.taskLimit as string, 10) : undefined;
    const taskOffset = req.query.taskOffset ? parseInt(req.query.taskOffset as string, 10) : undefined;
    const includeChildCounts = req.query.includeChildCounts === 'true';

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    if (includeTasks) {
      const result = await workflowExecutionService.getWorkflowRunWithTasks(id, {
        limit: taskLimit,
        offset: taskOffset,
        includeDescendantCounts: includeChildCounts,
      });
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
// Get Child Tasks for a Workflow Run Task (lazy loading)
// GET /api/workflow-runs/:id/tasks/:taskId/children
// ============================================================================
router.get('/:id/tasks/:taskId/children', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, taskId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    if (!ObjectId.isValid(id) || !ObjectId.isValid(taskId)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const result = await workflowExecutionService.getChildTasks(id, taskId, { limit, offset });
    res.json(result);
  } catch (error) {
    console.error('[WorkflowRuns] Get child tasks error:', error);
    res.status(500).json({ error: 'Failed to get child tasks' });
  }
});

// ============================================================================
// Cancel Workflow Run
// POST /api/workflow-runs/:id/cancel
// Requires authentication (JWT or API key)
// ============================================================================
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
// Unified Callback Endpoint
// POST /api/workflow-runs/:id/callback/:stepId
//
// Handles all callback types: single result, streaming items, batch items
//
// Payload detection (in order of precedence):
// 1. If payload has `item` key → use that as the item
// 2. If payload has `items` array → process each as an item
// 3. Otherwise → the entire payload (minus workflowUpdate) IS the item
//
// Workflow controls (multiple options, in order of precedence):
// Option 1: Headers (cleanest for external services)
//   - X-Expected-Count: number - Set expected item count
//   - X-Workflow-Complete: "true" - Signal that no more items will be sent
// Option 2: In payload (namespaced to avoid conflicts with external payloads)
//   - workflowUpdate.complete: boolean - Signal that no more items will be sent
//   - workflowUpdate.total: number - Set/update expected item count
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

    // Check for header-based workflow controls
    const expectedCountHeader = req.headers['x-expected-count'] as string | undefined;
    const completeHeader = req.headers['x-workflow-complete'] as string | undefined;

    // Start with the payload
    const payload = { ...req.body };

    // Merge header-based controls into payload.workflowUpdate (headers take precedence)
    if (expectedCountHeader || completeHeader) {
      const existingUpdate = (payload.workflowUpdate as Record<string, unknown>) || {};
      payload.workflowUpdate = {
        ...existingUpdate,
        // Headers override payload values
        ...(expectedCountHeader ? { total: parseInt(expectedCountHeader, 10) } : {}),
        ...(completeHeader === 'true' ? { complete: true } : {}),
      };
    }

    // Build request info for logging
    const requestInfo = {
      url: req.originalUrl,
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['x-workflow-secret', 'authorization'].includes(key.toLowerCase()))
          .map(([key, value]) => [key, String(value)])
      ),
      receivedAt: new Date(),
    };

    const result = await workflowExecutionService.handleCallback(id, stepId, payload, secret, requestInfo);

    res.json(result);
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process callback';

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
// Legacy Foreach Item Callback (DEPRECATED - use /callback/:stepId instead)
// POST /api/workflow-runs/:id/foreach/:stepId/item
// Kept for backward compatibility - internally redirects to unified handler
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

    // Convert legacy format to unified format
    const { item, expectedCount, complete } = req.body;
    const unifiedPayload: Record<string, unknown> = {};

    if (item !== undefined) {
      unifiedPayload.item = item;
    }
    if (expectedCount !== undefined || complete !== undefined) {
      unifiedPayload.workflowUpdate = {
        total: expectedCount,
        complete: complete,
      };
    }

    // Build request info for logging
    const requestInfo = {
      url: req.originalUrl,
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['x-workflow-secret', 'authorization'].includes(key.toLowerCase()))
          .map(([key, value]) => [key, String(value)])
      ),
      receivedAt: new Date(),
    };

    const result = await workflowExecutionService.handleCallback(id, stepId, unifiedPayload, secret, requestInfo);

    // Return legacy response format for backward compatibility
    res.json({
      acknowledged: result.acknowledged,
      foreachTaskId: result.taskId,
      childTaskId: result.childTaskIds[0],
      receivedCount: result.receivedCount,
      expectedCount: result.expectedCount,
      isComplete: result.isComplete,
    });
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

export default router;
