import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { batchJobService } from '../services/batch-job-service.js';
import {
  CreateBatchJobInput,
  BatchCallbackPayload,
  BatchJobStatus,
  ReviewDecision,
} from '../types/index.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Apply optional auth to all routes to get user ID from JWT token
router.use(optionalAuth);

// ============================================================================
// Create Batch Job
// POST /api/batch-jobs
// ============================================================================
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const input: CreateBatchJobInput = req.body;

    // Validate required fields
    if (typeof input.expectedCount !== 'number' || input.expectedCount < 0) {
      res.status(400).json({
        error: 'expectedCount is required and must be a non-negative number',
      });
      return;
    }

    // Validate items if provided
    if (input.items) {
      const itemKeys = new Set<string>();
      for (const item of input.items) {
        if (!item.itemKey) {
          res.status(400).json({ error: 'Each item must have an itemKey' });
          return;
        }
        if (itemKeys.has(item.itemKey)) {
          res.status(400).json({
            error: `Duplicate itemKey: ${item.itemKey}`,
          });
          return;
        }
        itemKeys.add(item.itemKey);
      }
    }

    // Get actor from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : null;
    const actorType = req.user ? 'user' : 'system';

    const batchJob = await batchJobService.createBatchJob(input, actorId, actorType);

    // Generate callback URL (would use actual server URL in production)
    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const callbackUrl = `${baseUrl}/api/batch-jobs/${batchJob._id}/callback`;

    res.status(201).json({
      ...batchJob,
      callbackUrl,
      // Don't expose the full secret in response, just confirm it exists
      callbackSecretHint: batchJob.callbackSecret?.substring(0, 10) + '...',
    });
  } catch (error) {
    console.error('[BatchJobs] Create error:', error);
    res.status(500).json({ error: 'Failed to create batch job' });
  }
});

// ============================================================================
// Get Batch Job
// GET /api/batch-jobs/:id
// ============================================================================
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const includeItems = req.query.includeItems === 'true';

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    if (includeItems) {
      const result = await batchJobService.getBatchJobWithItems(id);
      if (!result) {
        res.status(404).json({ error: 'Batch job not found' });
        return;
      }
      res.json(result);
    } else {
      const job = await batchJobService.getBatchJob(id);
      if (!job) {
        res.status(404).json({ error: 'Batch job not found' });
        return;
      }
      res.json(job);
    }
  } catch (error) {
    console.error('[BatchJobs] Get error:', error);
    res.status(500).json({ error: 'Failed to get batch job' });
  }
});

// ============================================================================
// List Batch Jobs
// GET /api/batch-jobs
// ============================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      status,
      type,
      workflowId,
      taskId,
      requiresManualReview,
      page = '1',
      limit = '20',
    } = req.query;

    // Parse status (can be comma-separated)
    let statusFilter: BatchJobStatus | BatchJobStatus[] | undefined;
    if (status) {
      const statuses = (status as string).split(',') as BatchJobStatus[];
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    const result = await batchJobService.listBatchJobs({
      status: statusFilter,
      type: type as string,
      workflowId: workflowId as string,
      taskId: taskId as string,
      requiresManualReview: requiresManualReview === 'true' ? true : undefined,
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });

    res.json({
      data: result.jobs,
      pagination: {
        page: parseInt(page as string, 10),
        limit: parseInt(limit as string, 10),
        total: result.total,
        totalPages: Math.ceil(result.total / parseInt(limit as string, 10)),
      },
    });
  } catch (error) {
    console.error('[BatchJobs] List error:', error);
    res.status(500).json({ error: 'Failed to list batch jobs' });
  }
});

// ============================================================================
// Start Batch Job
// POST /api/batch-jobs/:id/start
// ============================================================================
router.post('/:id/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    // Get actor from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : null;
    const actorType = req.user ? 'user' : 'system';

    const job = await batchJobService.startBatchJob(id, actorId, actorType);
    res.json(job);
  } catch (error: unknown) {
    console.error('[BatchJobs] Start error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start batch job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Callback Endpoint (Fan-in)
// POST /api/batch-jobs/:id/callback
// ============================================================================
router.post('/:id/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    // Get secret from header
    const secret = req.headers['x-batch-secret'] as string;
    if (!secret) {
      res.status(401).json({ error: 'Missing X-Batch-Secret header' });
      return;
    }

    const payload: BatchCallbackPayload = {
      jobId: id,
      itemKey: req.body.itemKey,
      externalId: req.body.externalId,
      success: req.body.success,
      result: req.body.result,
      error: req.body.error,
    };

    // Validate required fields
    if (!payload.itemKey) {
      res.status(400).json({ error: 'itemKey is required' });
      return;
    }
    if (typeof payload.success !== 'boolean') {
      res.status(400).json({ error: 'success must be a boolean' });
      return;
    }

    const result = await batchJobService.handleCallback(payload, secret);

    res.json({
      acknowledged: true,
      itemId: result.item._id,
      itemStatus: result.item.status,
      joinSatisfied: result.joinResult !== null,
      joinResult: result.joinResult,
    });
  } catch (error: unknown) {
    console.error('[BatchJobs] Callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process callback';

    if (message.includes('Invalid callback secret')) {
      res.status(401).json({ error: message });
      return;
    }
    if (message.includes('sealed')) {
      res.status(409).json({ error: message });
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
// Get Aggregate Result
// GET /api/batch-jobs/:id/aggregate
// ============================================================================
router.get('/:id/aggregate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    const result = await batchJobService.getAggregateResult(id);
    if (!result) {
      res.status(404).json({ error: 'Batch job not found' });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('[BatchJobs] Aggregate error:', error);
    res.status(500).json({ error: 'Failed to get aggregate result' });
  }
});

// ============================================================================
// Submit Review
// POST /api/batch-jobs/:id/review
// ============================================================================
router.post('/:id/review', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body as {
      decision: ReviewDecision;
      notes: string;
    };

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    // Validate decision
    const validDecisions: ReviewDecision[] = ['approved', 'rejected', 'proceed_with_partial'];
    if (!validDecisions.includes(decision)) {
      res.status(400).json({
        error: `Invalid decision. Must be one of: ${validDecisions.join(', ')}`,
      });
      return;
    }

    // Get reviewer from authenticated user (via JWT token)
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Authentication required for review' });
      return;
    }

    const job = await batchJobService.submitReview(
      id,
      decision,
      notes || '',
      new ObjectId(req.user.userId)
    );

    res.json(job);
  } catch (error: unknown) {
    console.error('[BatchJobs] Review error:', error);
    const message = error instanceof Error ? error.message : 'Failed to submit review';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Request Manual Review
// POST /api/batch-jobs/:id/request-review
// ============================================================================
router.post('/:id/request-review', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason: string };

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    const job = await batchJobService.requestManualReview(id, reason || 'Manual review requested');
    res.json(job);
  } catch (error: unknown) {
    console.error('[BatchJobs] Request review error:', error);
    const message = error instanceof Error ? error.message : 'Failed to request review';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Cancel Batch Job
// POST /api/batch-jobs/:id/cancel
// ============================================================================
router.post('/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid batch job ID' });
      return;
    }

    // Get actor from authenticated user (via JWT token)
    const actorId = req.user?.userId
      ? new ObjectId(req.user.userId)
      : null;
    const actorType = req.user ? 'user' : 'system';

    const job = await batchJobService.cancelBatchJob(id, actorId, actorType);
    res.json(job);
  } catch (error: unknown) {
    console.error('[BatchJobs] Cancel error:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel batch job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Get Statistics
// GET /api/batch-jobs/stats/summary
// ============================================================================
router.get('/stats/summary', async (_req: Request, res: Response) => {
  try {
    const stats = await batchJobService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[BatchJobs] Stats error:', error);
    res.status(500).json({ error: 'Failed to get batch job statistics' });
  }
});

// ============================================================================
// Force Deadline Check (Admin/Debug)
// POST /api/batch-jobs/admin/check-deadlines
// ============================================================================
router.post('/admin/check-deadlines', async (_req: Request, res: Response) => {
  try {
    await batchJobService.checkDeadlines();
    res.json({ success: true, message: 'Deadline check completed' });
  } catch (error) {
    console.error('[BatchJobs] Force deadline check error:', error);
    res.status(500).json({ error: 'Failed to run deadline check' });
  }
});

export default router;
