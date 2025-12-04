import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId, Filter } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { ExternalJob, ExternalJobStatus, Task } from '../types/index.js';

export const externalJobsRouter = Router();

// GET /api/external-jobs - List external jobs with filtering
externalJobsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      page = 1,
      limit = 50,
      status,
      type,
      taskId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter: Filter<ExternalJob> = {};

    if (status) {
      if (Array.isArray(status)) {
        filter.status = { $in: status as ExternalJobStatus[] };
      } else {
        filter.status = status as ExternalJobStatus;
      }
    }

    if (type) {
      filter.type = type as string;
    }

    if (taskId) {
      filter.taskId = new ObjectId(taskId as string);
    }

    const [jobs, total] = await Promise.all([
      db
        .collection<ExternalJob>('external_jobs')
        .find(filter)
        .sort({ [sortBy as string]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .toArray(),
      db.collection<ExternalJob>('external_jobs').countDocuments(filter),
    ]);

    res.json({
      data: jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/external-jobs/pending - Get pending jobs for external worker
externalJobsRouter.get('/pending', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { type, limit = 10 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 10));

    const filter: Filter<ExternalJob> = {
      status: 'pending',
      $or: [{ scheduledFor: null }, { scheduledFor: { $lte: new Date() } }],
    };

    if (type) {
      filter.type = type as string;
    }

    const jobs = await db
      .collection<ExternalJob>('external_jobs')
      .find(filter)
      .sort({ createdAt: 1 })
      .limit(limitNum)
      .toArray();

    res.json({ data: jobs });
  } catch (error) {
    next(error);
  }
});

// GET /api/external-jobs/:id - Get a specific external job
externalJobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);

    const job = await db.collection<ExternalJob>('external_jobs').findOne({ _id: jobId });

    if (!job) {
      throw createError('External job not found', 404);
    }

    // Get associated task
    const task = await db.collection<Task>('tasks').findOne({ _id: job.taskId });

    res.json({ data: { ...job, task } });
  } catch (error) {
    next(error);
  }
});

// POST /api/external-jobs - Create a new external job
externalJobsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { taskId, type, payload, scheduledFor, maxAttempts } = req.body;

    if (!taskId || !type) {
      throw createError('taskId and type are required', 400);
    }

    const taskOid = new ObjectId(taskId);

    // Verify task exists
    const task = await db.collection<Task>('tasks').findOne({ _id: taskOid });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();
    const newJob: Omit<ExternalJob, '_id'> = {
      taskId: taskOid,
      type,
      status: 'pending',
      payload: payload || {},
      attempts: 0,
      maxAttempts: maxAttempts || 3,
      createdAt: now,
      updatedAt: now,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    };

    const result = await db
      .collection<ExternalJob>('external_jobs')
      .insertOne(newJob as ExternalJob);

    // Update task with external job reference
    await db.collection('tasks').updateOne(
      { _id: taskOid },
      {
        $set: {
          externalJobId: result.insertedId.toString(),
          externalJobStatus: 'pending',
          updatedAt: now,
        },
      }
    );

    const inserted = await db
      .collection<ExternalJob>('external_jobs')
      .findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PUT /api/external-jobs/:id/claim - Claim a job for processing
externalJobsRouter.put('/:id/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);
    const { workerId: _workerId } = req.body;

    const now = new Date();

    // Atomically claim the job
    const result = await db.collection<ExternalJob>('external_jobs').findOneAndUpdate(
      {
        _id: jobId,
        status: 'pending',
      },
      {
        $set: {
          status: 'processing',
          startedAt: now,
          updatedAt: now,
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Job not found or already claimed', 409);
    }

    // Update task status
    await db.collection('tasks').updateOne(
      { _id: result.taskId },
      {
        $set: {
          externalJobStatus: 'processing',
          status: 'in_progress',
          updatedAt: now,
        },
      }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /api/external-jobs/:id/complete - Mark job as completed
externalJobsRouter.put('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);
    const { result: jobResult } = req.body;

    const now = new Date();

    const result = await db.collection<ExternalJob>('external_jobs').findOneAndUpdate(
      { _id: jobId, status: 'processing' },
      {
        $set: {
          status: 'completed',
          result: jobResult || {},
          completedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Job not found or not in processing state', 409);
    }

    // Update task
    await db.collection('tasks').updateOne(
      { _id: result.taskId },
      {
        $set: {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
        },
      }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /api/external-jobs/:id/fail - Mark job as failed
externalJobsRouter.put('/:id/fail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);
    const { error, retryAfter } = req.body;

    const job = await db.collection<ExternalJob>('external_jobs').findOne({ _id: jobId });

    if (!job) {
      throw createError('Job not found', 404);
    }

    const now = new Date();
    const canRetry = job.attempts < job.maxAttempts;

    const newStatus: ExternalJobStatus = canRetry ? 'pending' : 'failed';
    const scheduledFor = canRetry && retryAfter ? new Date(now.getTime() + retryAfter * 1000) : null;

    const result = await db.collection<ExternalJob>('external_jobs').findOneAndUpdate(
      { _id: jobId },
      {
        $set: {
          status: newStatus,
          error: error || 'Unknown error',
          scheduledFor,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    // Update task if job has finally failed
    if (!canRetry) {
      await db.collection('tasks').updateOne(
        { _id: job.taskId },
        {
          $set: {
            status: 'failed',
            updatedAt: now,
          },
        }
      );
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /api/external-jobs/:id/cancel - Cancel a pending job
externalJobsRouter.put('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);

    const now = new Date();

    const result = await db.collection<ExternalJob>('external_jobs').findOneAndUpdate(
      { _id: jobId, status: { $in: ['pending', 'processing'] } },
      {
        $set: {
          status: 'cancelled',
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Job not found or already completed', 409);
    }

    // Update task
    await db.collection('tasks').updateOne(
      { _id: result.taskId },
      {
        $set: {
          externalJobStatus: 'cancelled',
          status: 'cancelled',
          updatedAt: now,
        },
      }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/external-jobs/:id - Delete an external job
externalJobsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const jobId = new ObjectId(req.params.id);

    const job = await db.collection<ExternalJob>('external_jobs').findOne({ _id: jobId });

    if (!job) {
      throw createError('Job not found', 404);
    }

    if (job.status === 'processing') {
      throw createError('Cannot delete a job that is currently processing', 400);
    }

    await db.collection('external_jobs').deleteOne({ _id: jobId });

    res.json({ success: true, message: 'External job deleted' });
  } catch (error) {
    next(error);
  }
});

// GET /api/external-jobs/stats - Get job statistics
externalJobsRouter.get('/stats/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const stats = await db
      .collection<ExternalJob>('external_jobs')
      .aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const typeStats = await db
      .collection<ExternalJob>('external_jobs')
      .aggregate([
        {
          $group: {
            _id: { type: '$type', status: '$status' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    res.json({
      data: {
        byStatus: stats.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        byTypeAndStatus: typeStats,
      },
    });
  } catch (error) {
    next(error);
  }
});
