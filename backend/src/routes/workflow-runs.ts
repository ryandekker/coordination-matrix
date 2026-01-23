import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { workflowExecutionService } from '../services/workflow-execution-service.js';
import { StartWorkflowInput, WorkflowRunStatus, WorkflowRequest, WorkflowRequestActorType } from '../types/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';

// Helper to filter sensitive headers
const filterSensitiveHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
  const sensitiveHeaders = ['authorization', 'x-api-key', 'x-workflow-secret', 'cookie', 'x-csrf-token'];
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !sensitiveHeaders.includes(key.toLowerCase()))
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value || '')])
  );
};

// Helper to determine actor type from request
const getActorType = (req: Request): WorkflowRequestActorType => {
  if (req.user?.userId) return 'user';
  if (req.headers['x-api-key']) return 'api_key';
  return 'anonymous';
};

const router = Router();

// ============================================================================
// Start Workflow Run
// POST /api/workflow-runs
// Requires authentication (JWT or API key) to prevent spam
// ============================================================================
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const db = getDb();
  const receivedAt = new Date();
  const input: StartWorkflowInput = req.body;

  // Helper to log the request
  const logRequest = async (
    status: 'success' | 'failed',
    options: {
      workflowId?: ObjectId | null;
      workflowName?: string;
      workflowRunId?: ObjectId | null;
      rootTaskId?: ObjectId | null;
      error?: string;
    } = {}
  ) => {
    try {
      const workflowRequest: Omit<WorkflowRequest, '_id'> = {
        type: 'workflow_start',
        method: req.method,
        url: req.originalUrl,
        headers: filterSensitiveHeaders(req.headers as Record<string, string | string[] | undefined>),
        body: input as unknown as Record<string, unknown>,
        status,
        error: options.error,
        workflowId: options.workflowId,
        workflowName: options.workflowName,
        workflowRunId: options.workflowRunId,
        rootTaskId: options.rootTaskId,
        actorId: req.user?.userId ? new ObjectId(req.user.userId) : null,
        actorType: getActorType(req),
        source: input.source,
        externalId: input.externalId,
        receivedAt,
        processedAt: new Date(),
      };

      await db.collection('workflow_requests').insertOne(workflowRequest);
    } catch (logError) {
      console.error('[WorkflowRuns] Failed to log request:', logError);
    }
  };

  try {
    if (!input.workflowId) {
      await logRequest('failed', { error: 'workflowId is required' });
      res.status(400).json({ error: 'workflowId is required' });
      return;
    }

    if (!ObjectId.isValid(input.workflowId)) {
      await logRequest('failed', { error: 'Invalid workflowId' });
      res.status(400).json({ error: 'Invalid workflowId' });
      return;
    }

    // Get workflow name for logging
    let workflowName: string | undefined;
    try {
      const workflow = await db.collection('workflows').findOne({ _id: new ObjectId(input.workflowId) });
      workflowName = workflow?.name as string | undefined;
    } catch {
      // Ignore - workflow name is optional for logging
    }

    // Get actor ID from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : null;

    const { run, rootTask } = await workflowExecutionService.startWorkflow(input, actorId);

    // Log successful request
    await logRequest('success', {
      workflowId: new ObjectId(input.workflowId),
      workflowName,
      workflowRunId: run._id,
      rootTaskId: rootTask._id,
    });

    res.status(201).json({
      run,
      rootTask,
      message: 'Workflow started successfully',
    });
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Start error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start workflow';

    // Log failed request
    await logRequest('failed', {
      workflowId: input.workflowId && ObjectId.isValid(input.workflowId) ? new ObjectId(input.workflowId) : null,
      error: message,
    });

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
// List Workflow Requests (Inbound Request Log)
// GET /api/workflow-runs/requests
// Returns logged inbound requests that trigger or interact with workflows
// NOTE: This route MUST be defined BEFORE /:id routes to avoid path matching issues
// ============================================================================
router.get('/requests', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDb();
    const {
      type,           // 'workflow_start' | 'workflow_callback'
      status,         // 'success' | 'failed'
      workflowId,
      workflowRunId,
      limit = '50',
      offset = '0',
    } = req.query;

    // Build filter
    const filter: Record<string, unknown> = {};

    if (type) {
      filter.type = type;
    }
    if (status) {
      filter.status = status;
    }
    if (workflowId && ObjectId.isValid(workflowId as string)) {
      filter.workflowId = new ObjectId(workflowId as string);
    }
    if (workflowRunId && ObjectId.isValid(workflowRunId as string)) {
      filter.workflowRunId = new ObjectId(workflowRunId as string);
    }

    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
    const offsetNum = parseInt(offset as string, 10) || 0;

    // Get total count
    const total = await db.collection('workflow_requests').countDocuments(filter);

    // Get requests
    const requests = await db
      .collection('workflow_requests')
      .find(filter)
      .sort({ receivedAt: -1 })
      .skip(offsetNum)
      .limit(limitNum)
      .toArray();

    res.json({
      data: requests,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total,
      },
    });
  } catch (error) {
    console.error('[WorkflowRuns] List requests error:', error);
    res.status(500).json({ error: 'Failed to list workflow requests' });
  }
});

// ============================================================================
// Get Single Workflow Request
// GET /api/workflow-runs/requests/:requestId
// Returns details of a specific workflow request
// NOTE: This route MUST be defined BEFORE /:id routes to avoid path matching issues
// ============================================================================
router.get('/requests/:requestId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDb();
    const { requestId } = req.params;

    if (!ObjectId.isValid(requestId)) {
      res.status(400).json({ error: 'Invalid request ID' });
      return;
    }

    const request = await db
      .collection('workflow_requests')
      .findOne({ _id: new ObjectId(requestId) });

    if (!request) {
      res.status(404).json({ error: 'Workflow request not found' });
      return;
    }

    res.json({ data: request });
  } catch (error) {
    console.error('[WorkflowRuns] Get request error:', error);
    res.status(500).json({ error: 'Failed to get workflow request' });
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
    const includeChildCounts = req.query.includeChildCounts === 'true';

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    if (includeTasks) {
      // Parse pagination parameters
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const beforeCreatedAt = req.query.beforeCreatedAt
        ? new Date(req.query.beforeCreatedAt as string)
        : undefined;
      const afterCreatedAt = req.query.afterCreatedAt
        ? new Date(req.query.afterCreatedAt as string)
        : undefined;
      const includeDetails = req.query.includeDetails === 'true';

      const result = await workflowExecutionService.getWorkflowRunWithTasks(id, {
        limit,
        beforeCreatedAt,
        afterCreatedAt,
        includeDetails,
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
  const db = getDb();
  const receivedAt = new Date();
  const { id, stepId } = req.params;

  // Helper to log callback request
  const logCallbackRequest = async (
    status: 'success' | 'failed',
    options: {
      workflowRunId?: ObjectId | null;
      taskId?: ObjectId | null;
      error?: string;
    } = {}
  ) => {
    try {
      const workflowRequest: Omit<WorkflowRequest, '_id'> = {
        type: 'workflow_callback',
        method: req.method,
        url: req.originalUrl,
        headers: filterSensitiveHeaders(req.headers as Record<string, string | string[] | undefined>),
        body: req.body as Record<string, unknown>,
        status,
        error: options.error,
        workflowRunId: options.workflowRunId,
        stepId,
        taskId: options.taskId,
        actorId: null,
        actorType: 'anonymous', // Callbacks are typically anonymous
        receivedAt,
        processedAt: new Date(),
      };

      await db.collection('workflow_requests').insertOne(workflowRequest);
    } catch (logError) {
      console.error('[WorkflowRuns] Failed to log callback request:', logError);
    }
  };

  try {
    if (!ObjectId.isValid(id)) {
      await logCallbackRequest('failed', { error: 'Invalid workflow run ID' });
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      await logCallbackRequest('failed', {
        workflowRunId: new ObjectId(id),
        error: 'Missing X-Workflow-Secret header',
      });
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

    // Build request info for logging (to task.metadata.callbackRequests)
    const requestInfo = {
      url: req.originalUrl,
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['x-workflow-secret', 'authorization'].includes(key.toLowerCase()))
          .map(([key, value]) => [key, String(value)])
      ),
      receivedAt,
    };

    const result = await workflowExecutionService.handleCallback(id, stepId, payload, secret, requestInfo);

    // Log successful callback
    await logCallbackRequest('success', {
      workflowRunId: new ObjectId(id),
      taskId: result.taskId ? new ObjectId(result.taskId) : null,
    });

    res.json(result);
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process callback';

    // Log failed callback
    await logCallbackRequest('failed', {
      workflowRunId: ObjectId.isValid(id) ? new ObjectId(id) : null,
      error: message,
    });

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
  const db = getDb();
  const receivedAt = new Date();
  const { id, stepId } = req.params;

  // Helper to log callback request
  const logCallbackRequest = async (
    status: 'success' | 'failed',
    options: {
      workflowRunId?: ObjectId | null;
      taskId?: ObjectId | null;
      error?: string;
    } = {}
  ) => {
    try {
      const workflowRequest: Omit<WorkflowRequest, '_id'> = {
        type: 'workflow_callback',
        method: req.method,
        url: req.originalUrl,
        headers: filterSensitiveHeaders(req.headers as Record<string, string | string[] | undefined>),
        body: req.body as Record<string, unknown>,
        status,
        error: options.error,
        workflowRunId: options.workflowRunId,
        stepId,
        taskId: options.taskId,
        actorId: null,
        actorType: 'anonymous',
        receivedAt,
        processedAt: new Date(),
      };

      await db.collection('workflow_requests').insertOne(workflowRequest);
    } catch (logError) {
      console.error('[WorkflowRuns] Failed to log callback request:', logError);
    }
  };

  try {
    if (!ObjectId.isValid(id)) {
      await logCallbackRequest('failed', { error: 'Invalid workflow run ID' });
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      await logCallbackRequest('failed', {
        workflowRunId: new ObjectId(id),
        error: 'Missing X-Workflow-Secret header',
      });
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

    // Build request info for logging (to task.metadata.callbackRequests)
    const requestInfo = {
      url: req.originalUrl,
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['x-workflow-secret', 'authorization'].includes(key.toLowerCase()))
          .map(([key, value]) => [key, String(value)])
      ),
      receivedAt,
    };

    const result = await workflowExecutionService.handleCallback(id, stepId, unifiedPayload, secret, requestInfo);

    // Log successful callback
    await logCallbackRequest('success', {
      workflowRunId: new ObjectId(id),
      taskId: result.taskId ? new ObjectId(result.taskId) : null,
    });

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

    // Log failed callback
    await logCallbackRequest('failed', {
      workflowRunId: ObjectId.isValid(id) ? new ObjectId(id) : null,
      error: message,
    });

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
// Manually Execute Stuck Step
// POST /api/workflow-runs/:id/execute-step/:stepId
// Requires authentication (JWT or API key)
// Used to recover stuck workflows where step tracking advanced but task wasn't created
// ============================================================================
router.post('/:id/execute-step/:stepId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, stepId } = req.params;
    const { inputPayload } = req.body;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const result = await workflowExecutionService.manuallyExecuteStep(id, stepId, inputPayload);

    if (result.success) {
      res.json({
        message: 'Step executed successfully',
        taskId: result.taskId,
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Execute step error:', error);
    const message = error instanceof Error ? error.message : 'Failed to execute step';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Recover Stuck Flow Tasks
// POST /api/workflow-runs/recover-stuck-flows
// Requires authentication (JWT or API key)
// Checks for flow tasks stuck in in_progress and recovers them if subflow completed
// ============================================================================
router.post('/recover-stuck-flows', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await workflowExecutionService.recoverStuckFlowTasks();
    res.json({
      message: `Recovery complete: ${result.recovered}/${result.checked} tasks recovered`,
      ...result,
    });
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Recover stuck flows error:', error);
    const message = error instanceof Error ? error.message : 'Failed to recover stuck flows';
    res.status(500).json({ error: message });
  }
});

export default router;
