import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { createError } from '../middleware/error-handler.js';
import { getDb } from '../db/connection.js';

export const conversationRecordsRouter = Router();

// Helper to parse ObjectId safely
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// Collection name
const COLLECTION = 'conversation_records';

// GET /api/conversation-records - List conversation records with filtering
conversationRecordsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const {
        taskId,
        sessionId,
        jobName,
        status,
        model,
        limit = '50',
        offset = '0',
        sortBy = 'startedAt',
        sortOrder = 'desc',
      } = req.query;

      // Build filter
      const filter: Record<string, unknown> = {};

      if (taskId && typeof taskId === 'string') {
        filter.taskId = toObjectId(taskId);
      }
      if (sessionId && typeof sessionId === 'string') {
        filter.sessionId = sessionId;
      }
      if (jobName && typeof jobName === 'string') {
        filter.jobName = jobName;
      }
      if (status && typeof status === 'string') {
        filter.status = status;
      }
      if (model && typeof model === 'string') {
        filter.model = model;
      }

      // Build sort
      const sortField = typeof sortBy === 'string' ? sortBy : 'startedAt';
      const sortDir = sortOrder === 'asc' ? 1 : -1;

      const limitNum = Math.min(parseInt(limit as string, 10), 100);
      const offsetNum = parseInt(offset as string, 10);

      // Get total count
      const total = await db.collection(COLLECTION).countDocuments(filter);

      // Get records (exclude large fields for list view)
      const records = await db
        .collection(COLLECTION)
        .find(filter)
        .project({
          messages: 0, // Exclude messages array for list view
          stderr: 0,
        })
        .sort({ [sortField]: sortDir })
        .skip(offsetNum)
        .limit(limitNum)
        .toArray();

      res.json({
        data: records,
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/conversation-records/:id - Get a specific conversation record with full details
conversationRecordsRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const id = req.params.id;

      // Support lookup by _id or sessionId
      let filter: Record<string, unknown>;
      if (ObjectId.isValid(id)) {
        filter = { $or: [{ _id: new ObjectId(id) }, { sessionId: id }] };
      } else {
        filter = { sessionId: id };
      }

      const record = await db.collection(COLLECTION).findOne(filter);

      if (!record) {
        throw createError('Conversation record not found', 404);
      }

      res.json({ data: record });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/conversation-records/task/:taskId - Get all conversations for a task
conversationRecordsRouter.get(
  '/task/:taskId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const taskId = toObjectId(req.params.taskId);

      const records = await db
        .collection(COLLECTION)
        .find({ taskId })
        .project({
          messages: 0, // Exclude messages for list view
          stderr: 0,
        })
        .sort({ startedAt: -1 })
        .toArray();

      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/conversation-records - Create a new conversation record (used by daemon)
conversationRecordsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const {
        taskId,
        sessionId,
        jobName,
        model,
        execCommand,
        status = 'running',
        messages = [],
        result,
        parsedResult,
        usage,
        permissionDenials,
        error,
        stderr,
        exitCode,
        numTurns,
        durationMs,
        durationApiMs,
        startedAt,
        completedAt,
      } = req.body;

      if (!taskId || !sessionId) {
        throw createError('taskId and sessionId are required', 400);
      }

      const record = {
        taskId: toObjectId(taskId),
        sessionId,
        jobName,
        model,
        execCommand,
        status,
        messages,
        result,
        parsedResult,
        usage,
        permissionDenials,
        error,
        stderr,
        exitCode,
        numTurns,
        durationMs,
        durationApiMs,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        completedAt: completedAt ? new Date(completedAt) : null,
      };

      const result2 = await db.collection(COLLECTION).insertOne(record);

      res.status(201).json({
        data: {
          _id: result2.insertedId,
          ...record,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/conversation-records/:id - Update a conversation record
conversationRecordsRouter.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const id = toObjectId(req.params.id);

      const allowedFields = [
        'status',
        'messages',
        'result',
        'parsedResult',
        'usage',
        'permissionDenials',
        'error',
        'stderr',
        'exitCode',
        'numTurns',
        'durationMs',
        'durationApiMs',
        'completedAt',
      ];

      const updates: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          if (field === 'completedAt' && req.body[field]) {
            updates[field] = new Date(req.body[field]);
          } else {
            updates[field] = req.body[field];
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        throw createError('No valid fields to update', 400);
      }

      const result = await db
        .collection(COLLECTION)
        .findOneAndUpdate(
          { _id: id },
          { $set: updates },
          { returnDocument: 'after' }
        );

      if (!result) {
        throw createError('Conversation record not found', 404);
      }

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/conversation-records/:id/messages - Append messages to a conversation
conversationRecordsRouter.post(
  '/:id/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const id = toObjectId(req.params.id);
      const { messages } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        throw createError('messages array is required', 400);
      }

      const result = await db
        .collection(COLLECTION)
        .findOneAndUpdate(
          { _id: id },
          { $push: { messages: { $each: messages } } } as unknown as Record<string, unknown>,
          { returnDocument: 'after' }
        );

      if (!result) {
        throw createError('Conversation record not found', 404);
      }

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/conversation-records/:id - Delete a conversation record
conversationRecordsRouter.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const id = toObjectId(req.params.id);

      const result = await db.collection(COLLECTION).deleteOne({ _id: id });

      if (result.deletedCount === 0) {
        throw createError('Conversation record not found', 404);
      }

      res.json({ success: true, message: 'Conversation record deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/conversation-records/stats/summary - Get aggregate statistics
conversationRecordsRouter.get(
  '/stats/summary',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = await getDb();
      const { jobName, since } = req.query;

      const match: Record<string, unknown> = {};
      if (jobName && typeof jobName === 'string') {
        match.jobName = jobName;
      }
      if (since && typeof since === 'string') {
        match.startedAt = { $gte: new Date(since) };
      }

      const stats = await db
        .collection(COLLECTION)
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              totalConversations: { $sum: 1 },
              completedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
              },
              failedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
              totalCostUsd: { $sum: '$usage.totalCostUsd' },
              totalInputTokens: { $sum: '$usage.inputTokens' },
              totalOutputTokens: { $sum: '$usage.outputTokens' },
              avgDurationMs: { $avg: '$durationMs' },
              avgTurns: { $avg: '$numTurns' },
              totalToolCalls: {
                $sum: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$messages', []] },
                      cond: { $eq: ['$$this.type', 'tool_use'] },
                    },
                  },
                },
              },
            },
          },
        ])
        .toArray();

      const summary = stats[0] || {
        totalConversations: 0,
        completedCount: 0,
        failedCount: 0,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        avgDurationMs: 0,
        avgTurns: 0,
        totalToolCalls: 0,
      };

      // Get breakdown by job
      const byJob = await db
        .collection(COLLECTION)
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$jobName',
              count: { $sum: 1 },
              totalCostUsd: { $sum: '$usage.totalCostUsd' },
              avgDurationMs: { $avg: '$durationMs' },
            },
          },
          { $sort: { count: -1 } },
        ])
        .toArray();

      // Get breakdown by status
      const byStatus = await db
        .collection(COLLECTION)
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      res.json({
        data: {
          summary,
          byJob,
          byStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
