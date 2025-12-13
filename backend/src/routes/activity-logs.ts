import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { createError } from '../middleware/error-handler.js';
import { activityLogService } from '../services/activity-log.js';

export const activityLogsRouter = Router();

// Helper to parse ObjectId safely
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// GET /api/activity-logs/task/:taskId - Get activity for a specific task
activityLogsRouter.get(
  '/task/:taskId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = toObjectId(req.params.taskId);
      const {
        limit = '50',
        offset = '0',
        eventTypes,
      } = req.query;

      const result = await activityLogService.getTaskActivity(taskId, {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        eventTypes: eventTypes
          ? (Array.isArray(eventTypes) ? eventTypes : [eventTypes]) as string[]
          : undefined,
      });

      res.json({
        data: result.data,
        pagination: {
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
          total: result.total,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/activity-logs/recent - Get recent activity across all tasks
activityLogsRouter.get(
  '/recent',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        limit = '50',
        offset = '0',
        eventTypes,
        actorId,
      } = req.query;

      const result = await activityLogService.getRecentActivity({
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        eventTypes: eventTypes
          ? (Array.isArray(eventTypes) ? eventTypes : [eventTypes]) as string[]
          : undefined,
        actorId: actorId ? toObjectId(actorId as string) : undefined,
      });

      res.json({
        data: result.data,
        pagination: {
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
          total: result.total,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/activity-logs/task/:taskId/comments - Add a comment to a task
activityLogsRouter.post(
  '/task/:taskId/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = toObjectId(req.params.taskId);
      const { comment, actorId, actorType = 'user' } = req.body;

      if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        throw createError('Comment is required', 400);
      }

      const entry = await activityLogService.addComment(
        taskId,
        comment.trim(),
        actorId ? toObjectId(actorId) : null,
        actorType as 'user' | 'system' | 'daemon'
      );

      if (!entry) {
        throw createError('Failed to add comment', 500);
      }

      res.status(201).json({ data: entry });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/activity-logs/cleanup - Trigger cleanup of orphaned logs
activityLogsRouter.post(
  '/cleanup',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const deletedCount = await activityLogService.cleanupOrphanedLogs();
      res.json({
        success: true,
        message: `Cleaned up ${deletedCount} orphaned activity logs`,
        deletedCount,
      });
    } catch (error) {
      next(error);
    }
  }
);
