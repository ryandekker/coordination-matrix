import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import {
  BatchJob,
  BatchItem,
  BatchJobStatus,
  BatchItemStatus,
  BatchJobEvent,
  BatchJobEventType,
  JoinConditionResult,
  CreateBatchJobInput,
  BatchCallbackPayload,
  ReviewDecision,
} from '../types/index.js';

type BatchJobEventHandler = (event: BatchJobEvent) => void | Promise<void>;

/**
 * BatchJobService handles fan-out/fan-in workflow coordination.
 *
 * Key concepts:
 * - Batch Job: A coordination unit that tracks multiple parallel operations
 * - Batch Item: An individual operation within a batch (e.g., one email to analyze)
 * - Join Barrier: Blocks downstream steps until completion condition is met
 * - Aggregation: Combines results from all items into a single report
 */
class BatchJobService {
  private initialized = false;
  private handlers: Map<string, Set<BatchJobEventHandler>> = new Map();
  private deadlineCheckInterval: NodeJS.Timeout | null = null;

  initialize(): void {
    if (this.initialized) return;

    // Start deadline checker (runs every 30 seconds)
    this.startDeadlineChecker();

    this.initialized = true;
    console.log('[BatchJobService] Initialized and listening');
  }

  private get batchJobs() {
    return getDb().collection<BatchJob>('batch_jobs');
  }

  private get batchItems() {
    return getDb().collection<BatchItem>('batch_items');
  }

  // ============================================================================
  // Event System
  // ============================================================================

  subscribe(eventType: BatchJobEventType | '*', handler: BatchJobEventHandler): void {
    const handlers = this.handlers.get(eventType) || new Set();
    handlers.add(handler);
    this.handlers.set(eventType, handlers);
  }

  unsubscribe(eventType: BatchJobEventType | '*', handler: BatchJobEventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private async publish(event: BatchJobEvent): Promise<void> {
    // Notify wildcard handlers
    const wildcardHandlers = this.handlers.get('*') || new Set();
    for (const handler of wildcardHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[BatchJobService] Handler error for ${event.type}:`, error);
      }
    }

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(event.type) || new Set();
    for (const handler of typeHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[BatchJobService] Handler error for ${event.type}:`, error);
      }
    }
  }

  private generateEventId(): string {
    return `bevt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  // ============================================================================
  // Batch Job CRUD
  // ============================================================================

  async createBatchJob(
    input: CreateBatchJobInput,
    actorId?: ObjectId | null,
    actorType: 'user' | 'system' | 'daemon' = 'system'
  ): Promise<BatchJob> {
    const now = new Date();
    const callbackSecret = this.generateSecret();

    const batchJob: Omit<BatchJob, '_id'> = {
      name: input.name,
      type: input.type,
      workflowId: input.workflowId ? new ObjectId(input.workflowId) : null,
      workflowStepId: input.workflowStepId,
      taskId: input.taskId ? new ObjectId(input.taskId) : null,
      callbackSecret,
      status: 'pending',
      expectedCount: input.expectedCount,
      receivedCount: 0,
      processedCount: 0,
      failedCount: 0,
      minSuccessPercent: input.minSuccessPercent ?? 100,
      deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
      inputPayload: input.inputPayload,
      isResultSealed: false,
      requiresManualReview: false,
      createdById: actorId,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.batchJobs.insertOne(batchJob as BatchJob);
    const created = { ...batchJob, _id: result.insertedId } as BatchJob;

    // Create initial batch items if provided
    if (input.items && input.items.length > 0) {
      const items: Omit<BatchItem, '_id'>[] = input.items.map((item) => ({
        batchJobId: result.insertedId,
        itemKey: item.itemKey,
        externalId: item.externalId,
        status: 'pending' as BatchItemStatus,
        inputData: item.inputData,
        attempts: 0,
        createdAt: now,
      }));

      await this.batchItems.insertMany(items as BatchItem[]);
    }

    // Publish event
    await this.publish({
      id: this.generateEventId(),
      type: 'batch.created',
      batchJobId: result.insertedId,
      batchJob: created,
      actorId,
      actorType,
      timestamp: now,
    });

    return created;
  }

  async getBatchJob(jobId: string | ObjectId): Promise<BatchJob | null> {
    const _id = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    return this.batchJobs.findOne({ _id });
  }

  async getBatchJobWithItems(jobId: string | ObjectId): Promise<{
    job: BatchJob;
    items: BatchItem[];
  } | null> {
    const job = await this.getBatchJob(jobId);
    if (!job) return null;

    const items = await this.batchItems
      .find({ batchJobId: job._id })
      .sort({ createdAt: 1 })
      .toArray();

    return { job, items };
  }

  async listBatchJobs(options: {
    status?: BatchJobStatus | BatchJobStatus[];
    type?: string;
    workflowId?: string;
    taskId?: string;
    requiresManualReview?: boolean;
    taskStatus?: string;
    taskType?: string;
    assigneeId?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ jobs: BatchJob[]; total: number }> {
    const { page = 1, limit = 20 } = options;

    // Check if we need task-based filtering
    const needsTaskLookup = options.taskStatus || options.taskType || options.assigneeId;

    if (needsTaskLookup) {
      // Use aggregation with $lookup for task-based filters
      const pipeline: object[] = [];

      // Initial match for batch job filters
      const jobMatch: Record<string, unknown> = {};
      if (options.status) {
        jobMatch.status = Array.isArray(options.status)
          ? { $in: options.status }
          : options.status;
      }
      if (options.type) jobMatch.type = options.type;
      if (options.workflowId) jobMatch.workflowId = new ObjectId(options.workflowId);
      if (options.taskId) jobMatch.taskId = new ObjectId(options.taskId);
      if (options.requiresManualReview !== undefined) {
        jobMatch.requiresManualReview = options.requiresManualReview;
      }
      if (Object.keys(jobMatch).length > 0) {
        pipeline.push({ $match: jobMatch });
      }

      // Lookup tasks
      pipeline.push({
        $lookup: {
          from: 'tasks',
          localField: 'taskId',
          foreignField: '_id',
          as: 'task',
        },
      });
      pipeline.push({ $unwind: { path: '$task', preserveNullAndEmptyArrays: true } });

      // Match task filters
      const taskMatch: Record<string, unknown> = {};
      if (options.taskStatus) {
        taskMatch['task.status'] = options.taskStatus;
      }
      if (options.taskType) {
        taskMatch['task.taskType'] = options.taskType;
      }
      if (options.assigneeId) {
        taskMatch['task.assigneeId'] = new ObjectId(options.assigneeId);
      }
      if (Object.keys(taskMatch).length > 0) {
        pipeline.push({ $match: taskMatch });
      }

      // Count total before pagination
      const countPipeline = [...pipeline, { $count: 'total' }];
      const countResult = await this.batchJobs.aggregate(countPipeline).toArray();
      const total = countResult[0]?.total || 0;

      // Sort, skip, limit
      pipeline.push({ $sort: { createdAt: -1 } });
      pipeline.push({ $skip: (page - 1) * limit });
      pipeline.push({ $limit: limit });

      // Remove task field from output
      pipeline.push({ $project: { task: 0 } });

      const jobs = await this.batchJobs.aggregate<BatchJob>(pipeline).toArray();

      return { jobs, total };
    } else {
      // Original simple query (no task lookup needed)
      const filter: Record<string, unknown> = {};

      if (options.status) {
        filter.status = Array.isArray(options.status)
          ? { $in: options.status }
          : options.status;
      }
      if (options.type) filter.type = options.type;
      if (options.workflowId) filter.workflowId = new ObjectId(options.workflowId);
      if (options.taskId) filter.taskId = new ObjectId(options.taskId);
      if (options.requiresManualReview !== undefined) {
        filter.requiresManualReview = options.requiresManualReview;
      }

      const [jobs, total] = await Promise.all([
        this.batchJobs
          .find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        this.batchJobs.countDocuments(filter),
      ]);

      return { jobs, total };
    }
  }

  // ============================================================================
  // Batch Job Lifecycle
  // ============================================================================

  async startBatchJob(
    jobId: string | ObjectId,
    actorId?: ObjectId | null,
    actorType: 'user' | 'system' | 'daemon' = 'system'
  ): Promise<BatchJob> {
    const _id = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    const now = new Date();

    const result = await this.batchJobs.findOneAndUpdate(
      { _id, status: 'pending' },
      {
        $set: {
          status: 'awaiting_responses',
          startedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Batch job ${jobId} not found or not in pending status`);
    }

    await this.publish({
      id: this.generateEventId(),
      type: 'batch.started',
      batchJobId: _id,
      batchJob: result,
      actorId,
      actorType,
      timestamp: now,
    });

    return result;
  }

  async cancelBatchJob(
    jobId: string | ObjectId,
    _actorId?: ObjectId | null,
    _actorType: 'user' | 'system' | 'daemon' = 'system'
  ): Promise<BatchJob> {
    const _id = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    const now = new Date();

    const result = await this.batchJobs.findOneAndUpdate(
      { _id, status: { $nin: ['completed', 'completed_with_warnings', 'failed', 'cancelled'] } },
      {
        $set: {
          status: 'cancelled',
          completedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Batch job ${jobId} not found or already in terminal state`);
    }

    // TODO: Consider publishing a batch.cancelled event here
    return result;
  }

  // ============================================================================
  // Callback Handling (Fan-in)
  // ============================================================================

  async handleCallback(
    payload: BatchCallbackPayload,
    secret: string
  ): Promise<{ item: BatchItem; joinResult: JoinConditionResult | null }> {
    const jobId = new ObjectId(payload.jobId);
    const now = new Date();

    // Verify secret
    const job = await this.batchJobs.findOne({ _id: jobId });
    if (!job) {
      throw new Error(`Batch job ${payload.jobId} not found`);
    }

    if (job.callbackSecret !== secret) {
      throw new Error('Invalid callback secret');
    }

    if (job.isResultSealed) {
      throw new Error('Batch job results are already sealed');
    }

    // Upsert batch item (idempotent)
    const itemStatus: BatchItemStatus = payload.success ? 'completed' : 'failed';
    const updateResult = await this.batchItems.findOneAndUpdate(
      { batchJobId: jobId, itemKey: payload.itemKey },
      {
        $set: {
          externalId: payload.externalId,
          status: itemStatus,
          resultData: payload.result,
          error: payload.error,
          receivedAt: now,
          completedAt: now,
        },
        $inc: { attempts: 1 },
        $setOnInsert: {
          batchJobId: jobId,
          itemKey: payload.itemKey,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const item = updateResult!;

    // Update batch job counters atomically
    const counterUpdates: Record<string, number> = {
      receivedCount: 1,
    };

    if (payload.success) {
      counterUpdates.processedCount = 1;
    } else {
      counterUpdates.failedCount = 1;
    }

    await this.batchJobs.updateOne(
      { _id: jobId },
      {
        $inc: counterUpdates,
        $set: { updatedAt: now },
      }
    );

    // Publish item event
    const eventType: BatchJobEventType = payload.success
      ? 'batch.item.completed'
      : 'batch.item.failed';

    await this.publish({
      id: this.generateEventId(),
      type: eventType,
      batchJobId: jobId,
      batchJob: job,
      itemId: item._id,
      item,
      actorId: null,
      actorType: 'system',
      timestamp: now,
    });

    // Check join condition
    const updatedJob = await this.batchJobs.findOne({ _id: jobId });
    if (!updatedJob) {
      throw new Error(`Batch job ${payload.jobId} disappeared`);
    }

    const joinResult = this.evaluateJoinCondition(updatedJob);

    if (joinResult.isSatisfied) {
      await this.completeJoin(updatedJob, joinResult);
    }

    return { item, joinResult: joinResult.isSatisfied ? joinResult : null };
  }

  // ============================================================================
  // Join Barrier Logic
  // ============================================================================

  evaluateJoinCondition(job: BatchJob): JoinConditionResult {
    const now = new Date();
    const isDeadlinePassed = job.deadlineAt ? now >= job.deadlineAt : false;
    const successPercent = job.expectedCount > 0
      ? (job.processedCount / job.expectedCount) * 100
      : 0;

    const details = {
      expectedCount: job.expectedCount,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
      minSuccessPercent: job.minSuccessPercent,
      deadlineAt: job.deadlineAt,
      isDeadlinePassed,
    };

    // Case 1: All items processed successfully
    if (job.processedCount >= job.expectedCount) {
      return {
        isSatisfied: true,
        reason: 'count_met',
        successPercent,
        details,
      };
    }

    // Case 2: Threshold met AND deadline passed
    if (successPercent >= job.minSuccessPercent && isDeadlinePassed) {
      return {
        isSatisfied: true,
        reason: 'threshold_met_with_deadline',
        successPercent,
        details,
      };
    }

    // Case 3: Deadline passed but threshold not met (needs manual review)
    if (isDeadlinePassed) {
      return {
        isSatisfied: false,
        reason: 'deadline_passed',
        successPercent,
        details,
      };
    }

    // Case 4: Still waiting
    return {
      isSatisfied: false,
      reason: 'not_satisfied',
      successPercent,
      details,
    };
  }

  private async completeJoin(job: BatchJob, joinResult: JoinConditionResult): Promise<void> {
    const now = new Date();
    const jobId = job._id;

    // Determine final status
    let status: BatchJobStatus;
    let requiresManualReview = false;

    if (joinResult.reason === 'count_met' && job.failedCount === 0) {
      status = 'completed';
    } else if (joinResult.reason === 'count_met' || joinResult.reason === 'threshold_met_with_deadline') {
      status = 'completed_with_warnings';
    } else {
      // Should not reach here, but handle edge cases
      status = 'completed_with_warnings';
      requiresManualReview = true;
    }

    // Aggregate results
    const aggregateResult = await this.aggregateResults(jobId);

    // Seal the results
    await this.batchJobs.updateOne(
      { _id: jobId },
      {
        $set: {
          status,
          aggregateResult,
          isResultSealed: true,
          requiresManualReview,
          completedAt: now,
          updatedAt: now,
        },
      }
    );

    const updatedJob = await this.batchJobs.findOne({ _id: jobId });
    if (!updatedJob) return;

    // Publish join satisfied event
    await this.publish({
      id: this.generateEventId(),
      type: 'batch.join.satisfied',
      batchJobId: jobId,
      batchJob: updatedJob,
      joinResult,
      actorId: null,
      actorType: 'system',
      timestamp: now,
    });

    // Publish completion event
    const completionEventType: BatchJobEventType = status === 'completed'
      ? 'batch.completed'
      : 'batch.completed_with_warnings';

    await this.publish({
      id: this.generateEventId(),
      type: completionEventType,
      batchJobId: jobId,
      batchJob: updatedJob,
      joinResult,
      actorId: null,
      actorType: 'system',
      timestamp: now,
    });
  }

  // ============================================================================
  // Aggregation
  // ============================================================================

  async aggregateResults(jobId: ObjectId): Promise<Record<string, unknown>> {
    const items = await this.batchItems
      .find({ batchJobId: jobId })
      .toArray();

    const successful = items.filter((i) => i.status === 'completed');
    const failed = items.filter((i) => i.status === 'failed');

    return {
      totalItems: items.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      successRate: items.length > 0 ? (successful.length / items.length) * 100 : 0,
      results: successful.map((i) => ({
        itemKey: i.itemKey,
        externalId: i.externalId,
        data: i.resultData,
      })),
      errors: failed.map((i) => ({
        itemKey: i.itemKey,
        externalId: i.externalId,
        error: i.error,
      })),
      aggregatedAt: new Date(),
    };
  }

  async getAggregateResult(jobId: string | ObjectId): Promise<Record<string, unknown> | null> {
    const job = await this.getBatchJob(jobId);
    if (!job) return null;

    if (job.isResultSealed && job.aggregateResult) {
      return job.aggregateResult;
    }

    // Generate live aggregate if not sealed
    return this.aggregateResults(job._id);
  }

  // ============================================================================
  // Manual Review
  // ============================================================================

  async submitReview(
    jobId: string | ObjectId,
    decision: ReviewDecision,
    notes: string,
    reviewerId: ObjectId
  ): Promise<BatchJob> {
    const _id = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    const now = new Date();

    // Determine new status based on decision
    let newStatus: BatchJobStatus;
    switch (decision) {
      case 'approved':
        newStatus = 'completed';
        break;
      case 'proceed_with_partial':
        newStatus = 'completed_with_warnings';
        break;
      case 'rejected':
        newStatus = 'failed';
        break;
    }

    // If proceeding, aggregate and seal results
    let aggregateResult: Record<string, unknown> | undefined;
    if (decision !== 'rejected') {
      aggregateResult = await this.aggregateResults(_id);
    }

    const result = await this.batchJobs.findOneAndUpdate(
      { _id, status: 'manual_review' },
      {
        $set: {
          status: newStatus,
          reviewedById: reviewerId,
          reviewedAt: now,
          reviewDecision: decision,
          reviewNotes: notes,
          ...(aggregateResult && { aggregateResult }),
          isResultSealed: true,
          completedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Batch job ${jobId} not found or not in manual_review status`);
    }

    await this.publish({
      id: this.generateEventId(),
      type: 'batch.reviewed',
      batchJobId: _id,
      batchJob: result,
      actorId: reviewerId,
      actorType: 'user',
      timestamp: now,
      metadata: { decision, notes },
    });

    return result;
  }

  async requestManualReview(
    jobId: string | ObjectId,
    reason: string
  ): Promise<BatchJob> {
    const _id = typeof jobId === 'string' ? new ObjectId(jobId) : jobId;
    const now = new Date();

    const result = await this.batchJobs.findOneAndUpdate(
      { _id, status: { $in: ['awaiting_responses', 'completed_with_warnings'] } },
      {
        $set: {
          status: 'manual_review',
          requiresManualReview: true,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Batch job ${jobId} not found or not in reviewable state`);
    }

    await this.publish({
      id: this.generateEventId(),
      type: 'batch.manual_review_required',
      batchJobId: _id,
      batchJob: result,
      actorId: null,
      actorType: 'system',
      timestamp: now,
      metadata: { reason },
    });

    return result;
  }

  // ============================================================================
  // Deadline Checker
  // ============================================================================

  private startDeadlineChecker(): void {
    // Check every 30 seconds
    this.deadlineCheckInterval = setInterval(async () => {
      try {
        await this.checkDeadlines();
      } catch (error) {
        console.error('[BatchJobService] Deadline check error:', error);
      }
    }, 30000);
  }

  async checkDeadlines(): Promise<void> {
    const now = new Date();

    // Find jobs that have passed their deadline
    const expiredJobs = await this.batchJobs
      .find({
        status: 'awaiting_responses',
        deadlineAt: { $lte: now },
        isResultSealed: false,
      })
      .toArray();

    for (const job of expiredJobs) {
      const joinResult = this.evaluateJoinCondition(job);

      if (joinResult.isSatisfied) {
        // Threshold met, complete normally
        await this.completeJoin(job, joinResult);
      } else {
        // Threshold not met, route to manual review
        await this.requestManualReview(
          job._id,
          `Deadline passed with only ${joinResult.successPercent.toFixed(1)}% success rate ` +
            `(required: ${job.minSuccessPercent}%)`
        );
      }
    }

    if (expiredJobs.length > 0) {
      console.log(`[BatchJobService] Processed ${expiredJobs.length} expired batch jobs`);
    }
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  async getStats(): Promise<{
    total: number;
    byStatus: Record<BatchJobStatus, number>;
    pendingReview: number;
    avgSuccessRate: number;
  }> {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ],
          pendingReview: [
            { $match: { status: 'manual_review' } },
            { $count: 'count' },
          ],
          successRates: [
            { $match: { isResultSealed: true } },
            {
              $project: {
                successRate: {
                  $cond: {
                    if: { $gt: ['$expectedCount', 0] },
                    then: { $divide: ['$processedCount', '$expectedCount'] },
                    else: 0,
                  },
                },
              },
            },
            { $group: { _id: null, avg: { $avg: '$successRate' } } },
          ],
        },
      },
    ];

    const [result] = await this.batchJobs.aggregate(pipeline).toArray();

    const byStatus: Record<string, number> = {};
    for (const item of result.byStatus) {
      byStatus[item._id] = item.count;
    }

    return {
      total: result.total[0]?.count || 0,
      byStatus: byStatus as Record<BatchJobStatus, number>,
      pendingReview: result.pendingReview[0]?.count || 0,
      avgSuccessRate: (result.successRates[0]?.avg || 0) * 100,
    };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  async shutdown(): Promise<void> {
    if (this.deadlineCheckInterval) {
      clearInterval(this.deadlineCheckInterval);
      this.deadlineCheckInterval = null;
    }
    console.log('[BatchJobService] Shutdown complete');
  }
}

// Singleton instance
export const batchJobService = new BatchJobService();
