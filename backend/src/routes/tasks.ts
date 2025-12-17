import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId, Filter, Sort, Document, WithId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { ReferenceResolver } from '../services/reference-resolver.js';
import { Task, TaskWithChildren, PaginatedResponse } from '../types/index.js';
import { publishTaskEvent, computeChanges, getSpecificEventTypes } from '../services/event-bus.js';
import { activityLogService } from '../services/activity-log.js';

export const tasksRouter = Router();

// Helper to parse ObjectId safely
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// Helper to resolve {{currentUserId}} placeholder
function resolveUserPlaceholder(value: string, currentUserId?: string): string {
  if (value === '{{currentUserId}}' && currentUserId) {
    return currentUserId;
  }
  return value;
}

// Helper to build filter from query params
function buildFilter(query: Record<string, unknown>, currentUserId?: string): Filter<Task> {
  const filter: Filter<Task> = {};
  const { search, filters, parentId, rootOnly, status, urgency, assigneeId, tags } = query;

  // Text search
  if (search && typeof search === 'string') {
    filter.$text = { $search: search };
  }

  // Parent filter
  if (rootOnly === 'true' || rootOnly === true) {
    filter.parentId = null;
  } else if (parentId) {
    filter.parentId = toObjectId(parentId as string);
  }

  // Status filter
  if (status) {
    if (Array.isArray(status)) {
      (filter as Record<string, unknown>).status = { $in: status };
    } else {
      (filter as Record<string, unknown>).status = status as string;
    }
  }

  // Urgency filter
  if (urgency) {
    if (Array.isArray(urgency)) {
      (filter as Record<string, unknown>).urgency = { $in: urgency };
    } else {
      (filter as Record<string, unknown>).urgency = urgency as string;
    }
  }

  // Assignee filter
  if (assigneeId) {
    const resolvedAssigneeId = resolveUserPlaceholder(assigneeId as string, currentUserId);
    // Skip if placeholder couldn't be resolved (no current user)
    if (resolvedAssigneeId !== '{{currentUserId}}') {
      filter.assigneeId = toObjectId(resolvedAssigneeId);
    }
  }

  // Tags filter
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    filter.tags = { $in: tagArray };
  }

  // Custom filters
  if (filters && typeof filters === 'object') {
    Object.entries(filters as Record<string, unknown>).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Handle ObjectId fields
        if (key.endsWith('Id') && typeof value === 'string' && ObjectId.isValid(value)) {
          (filter as Record<string, unknown>)[key] = new ObjectId(value);
        } else {
          (filter as Record<string, unknown>)[key] = value;
        }
      }
    });
  }

  return filter;
}

// GET /api/tasks - List tasks with pagination, filtering, and sorting
tasksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      resolveReferences = 'true',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = buildFilter(req.query as Record<string, unknown>, req.user?.userId);
    const sort: Sort = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    const [tasks, total] = await Promise.all([
      db.collection<Task>('tasks').find(filter).sort(sort).skip(skip).limit(limitNum).toArray(),
      db.collection<Task>('tasks').countDocuments(filter),
    ]);

    // Add child count to each task to enable expand/collapse UI
    const taskIds = tasks.map(t => t._id);
    const childCounts = await db.collection<Task>('tasks').aggregate([
      { $match: { parentId: { $in: taskIds } } },
      { $group: { _id: '$parentId', count: { $sum: 1 } } }
    ]).toArray();

    const childCountMap = new Map(childCounts.map(c => [c._id.toString(), c.count]));
    const tasksWithChildInfo = tasks.map(task => ({
      ...task,
      children: childCountMap.get(task._id.toString())
        ? Array(childCountMap.get(task._id.toString())).fill({})
        : []
    }));

    let resolvedTasks = tasksWithChildInfo;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedTasks = await resolver.resolveDocuments(tasksWithChildInfo);
    }

    const response: PaginatedResponse<Task> = {
      data: resolvedTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/tree - Get tasks as a tree structure
tasksRouter.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { rootId, maxDepth = 10, resolveReferences = 'true' } = req.query;

    let filter: Filter<Task> = {};

    if (rootId) {
      // Get all descendants of this task
      const rootOid = toObjectId(rootId as string);
      const descendants = await getDescendantIds(db, rootOid);
      filter = {
        _id: { $in: [rootOid, ...descendants] },
      };
    }

    const tasks = await db
      .collection<Task>('tasks')
      .find(filter)
      .sort({ createdAt: 1 })
      .toArray();

    let resolvedTasks = tasks;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedTasks = await resolver.resolveDocuments(tasks);
    }

    // Build tree structure
    const maxDepthNum = parseInt(maxDepth as string, 10) || 10;
    const tree = buildTaskTree(resolvedTasks, maxDepthNum);

    res.json({ data: tree });
  } catch (error) {
    next(error);
  }
});

// Helper to get all descendant IDs recursively
async function getDescendantIds(db: ReturnType<typeof getDb>, parentId: ObjectId, maxDepth = 10, currentDepth = 0): Promise<ObjectId[]> {
  if (currentDepth >= maxDepth) return [];

  const children = await db
    .collection<Task>('tasks')
    .find({ parentId })
    .project({ _id: 1 })
    .toArray();

  const childIds = children.map(c => c._id);
  const grandchildIds: ObjectId[] = [];

  for (const childId of childIds) {
    const descendants = await getDescendantIds(db, childId, maxDepth, currentDepth + 1);
    grandchildIds.push(...descendants);
  }

  return [...childIds, ...grandchildIds];
}

// GET /api/tasks/webhook-attempts - List all tasks with webhook attempts
// NOTE: This route MUST be defined before /:id to avoid "webhook-attempts" being matched as an ID
tasksRouter.get('/webhook-attempts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { status, taskStatus, taskType, assigneeId, limit = '50', offset = '0' } = req.query;

    // Find all tasks with webhookConfig that have attempts
    const filter: Record<string, unknown> = {
      'webhookConfig.attempts': { $exists: true, $ne: [] },
    };

    // Filter by webhook attempt status if provided
    if (status) {
      filter['webhookConfig.attempts.status'] = status;
    }

    // Filter by task status if provided
    if (taskStatus) {
      filter.status = taskStatus;
    }

    // Filter by task type if provided
    if (taskType) {
      filter.taskType = taskType;
    }

    // Filter by assignee if provided
    if (assigneeId) {
      filter.assigneeId = new ObjectId(assigneeId as string);
    }

    const [tasks, total] = await Promise.all([
      db
        .collection<Task>('tasks')
        .find(filter)
        .project({
          _id: 1,
          title: 1,
          status: 1,
          taskType: 1,
          webhookConfig: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ 'webhookConfig.lastAttemptAt': -1, updatedAt: -1 })
        .skip(parseInt(offset as string, 10))
        .limit(parseInt(limit as string, 10))
        .toArray(),
      db.collection('tasks').countDocuments(filter),
    ]);

    // Transform to a more useful format
    interface WebhookAttemptData {
      attemptNumber: number;
      status: string;
      httpStatus?: number;
      responseBody?: unknown;
      errorMessage?: string;
      durationMs?: number;
      startedAt?: string;
      completedAt?: string;
    }
    const webhookAttempts = tasks.flatMap((task) => {
      const attempts: WebhookAttemptData[] = task.webhookConfig?.attempts || [];
      return attempts.map((attempt: WebhookAttemptData, index: number) => ({
        _id: `${task._id}-${index}`,
        taskId: task._id,
        taskTitle: task.title,
        taskStatus: task.status,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        httpStatus: attempt.httpStatus,
        responseBody: attempt.responseBody,
        errorMessage: attempt.errorMessage,
        durationMs: attempt.durationMs,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        url: task.webhookConfig?.url,
        method: task.webhookConfig?.method,
        headers: task.webhookConfig?.headers,
        requestBody: task.metadata?.requestBody,
        maxRetries: task.webhookConfig?.maxRetries,
        nextRetryAt: task.webhookConfig?.nextRetryAt,
      }));
    });

    // Sort by startedAt descending
    webhookAttempts.sort((a, b) => {
      const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json({
      data: webhookAttempts,
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id - Get a single task
tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { resolveReferences = 'true', includeChildren = 'false' } = req.query;

    const taskId = toObjectId(req.params.id);
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });

    if (!task) {
      throw createError('Task not found', 404);
    }

    let result: Task | TaskWithChildren = task;

    // Optionally include children
    if (includeChildren === 'true') {
      const children = await db
        .collection<Task>('tasks')
        .find({ parentId: taskId })
        .sort({ createdAt: 1 })
        .toArray();
      (result as TaskWithChildren).children = children;
    }

    // Resolve references
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      const [resolved] = await resolver.resolveDocuments([result]);
      result = resolved;
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id/children - Get direct children of a task
tasksRouter.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { resolveReferences = 'true' } = req.query;

    const taskId = toObjectId(req.params.id);
    const children = await db
      .collection<Task>('tasks')
      .find({ parentId: taskId })
      .sort({ createdAt: 1 })
      .toArray();

    let resolvedChildren = children;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedChildren = await resolver.resolveDocuments(children);
    }

    res.json({ data: resolvedChildren });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id/ancestors - Get all ancestors of a task (walks up the parent chain)
tasksRouter.get('/:id/ancestors', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { resolveReferences = 'true' } = req.query;

    const taskId = toObjectId(req.params.id);
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });

    if (!task) {
      throw createError('Task not found', 404);
    }

    // Walk up the parent chain to find all ancestors
    const ancestors: Task[] = [];
    let currentParentId = task.parentId;

    while (currentParentId) {
      const parent = await db.collection<Task>('tasks').findOne({ _id: currentParentId });
      if (!parent) break;
      ancestors.push(parent);
      currentParentId = parent.parentId;
    }

    // Reverse so root is first
    ancestors.reverse();

    let resolvedAncestors = ancestors;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedAncestors = await resolver.resolveDocuments(ancestors);
    }

    res.json({ data: resolvedAncestors });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id/descendants - Get all descendants of a task (all children, grandchildren, etc.)
tasksRouter.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { resolveReferences = 'true', maxDepth = '10' } = req.query;

    const taskId = toObjectId(req.params.id);
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });

    if (!task) {
      throw createError('Task not found', 404);
    }

    const maxDepthNum = parseInt(maxDepth as string, 10) || 10;
    const descendantIds = await getDescendantIds(db, taskId, maxDepthNum);

    const descendants = await db
      .collection<Task>('tasks')
      .find({ _id: { $in: descendantIds } })
      .sort({ createdAt: 1 })
      .toArray();

    let resolvedDescendants = descendants;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedDescendants = await resolver.resolveDocuments(descendants);
    }

    res.json({ data: resolvedDescendants });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks - Create a new task
tasksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskData = req.body;
    const silent = taskData.silent === true;
    delete taskData.silent;

    // Validate required fields
    if (!taskData.title) {
      throw createError('Title is required', 400);
    }

    const now = new Date();
    let parentId: ObjectId | null = null;

    // Handle parent task relationship
    if (taskData.parentId) {
      parentId = toObjectId(taskData.parentId);
      const parent = await db.collection<Task>('tasks').findOne({ _id: parentId });

      if (!parent) {
        throw createError('Parent task not found', 404);
      }
    }

    const newTask: Document = {
      title: taskData.title,
      summary: taskData.summary || '',
      extraPrompt: taskData.extraPrompt || '',
      additionalInfo: taskData.additionalInfo || '',
      status: taskData.status || 'pending',
      urgency: taskData.urgency || 'normal',
      parentId,
      workflowId: taskData.workflowId ? toObjectId(taskData.workflowId) : null,
      workflowStage: taskData.workflowStage || '',
      externalId: taskData.externalId || '',
      externalHoldDate: taskData.externalHoldDate ? new Date(taskData.externalHoldDate) : null,
      assigneeId: taskData.assigneeId ? toObjectId(taskData.assigneeId) : null,
      createdById: taskData.createdById ? toObjectId(taskData.createdById) : null,
      tags: taskData.tags || [],
      createdAt: now,
      updatedAt: now,
      dueAt: taskData.dueAt ? new Date(taskData.dueAt) : null,
      metadata: taskData.metadata || {},
    };

    const result = await db.collection('tasks').insertOne(newTask);
    const insertedTask = await db.collection<Task>('tasks').findOne({ _id: result.insertedId });

    // Publish task.created event unless silent
    if (!silent && insertedTask) {
      await publishTaskEvent('task.created', insertedTask, {
        actorId: taskData.createdById ? toObjectId(taskData.createdById) : null,
        actorType: 'user',
      });
    }

    res.status(201).json({ data: insertedTask });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/:id - Update a task
tasksRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const updates = req.body;
    const silent = updates.silent === true;
    const actorId = updates.actorId ? toObjectId(updates.actorId) : null;
    const actorType = updates.actorType || 'user';
    delete updates.silent;
    delete updates.actorId;
    delete updates.actorType;

    // Get original task for change tracking
    const originalTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!originalTask) {
      throw createError('Task not found', 404);
    }

    // Remove fields that shouldn't be updated directly
    delete updates._id;
    delete updates.createdAt;

    // Protect workflow metadata fields from being cleared accidentally
    // These fields are set by the workflow system and shouldn't be modified via API
    const workflowProtectedFields = ['workflowRunId', 'workflowStepId'];
    for (const field of workflowProtectedFields) {
      // Only allow setting these fields if they're not already set on the original task
      // and the new value is not empty/null
      if (updates[field] !== undefined) {
        const hasExistingValue = (originalTask as Record<string, unknown>)[field];
        const newValueIsEmpty = !updates[field];

        if (hasExistingValue && newValueIsEmpty) {
          // Don't allow clearing these fields once set
          delete updates[field];
        }
      }
    }

    // Convert ID fields
    const idFields = ['parentId', 'assigneeId', 'createdById', 'workflowId', 'workflowRunId'];
    for (const field of idFields) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] ? toObjectId(updates[field]) : null;
      }
    }

    // Convert date fields
    const dateFields = ['dueAt', 'externalHoldDate'];
    for (const field of dateFields) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] ? new Date(updates[field]) : null;
      }
    }

    // Handle metadata merge: shallow merge new metadata keys with existing
    if (updates.metadata !== undefined) {
      if (updates.metadata === null) {
        // Allow explicit null to clear metadata
        updates.metadata = {};
      } else {
        // Merge with existing metadata (new keys override existing)
        updates.metadata = {
          ...(originalTask.metadata || {}),
          ...updates.metadata,
        };
      }
    }

    updates.updatedAt = new Date();

    const result = await db.collection<Task>('tasks').findOneAndUpdate(
      { _id: taskId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Task not found', 404);
    }

    // Publish task.updated event unless silent
    if (!silent) {
      const changes = computeChanges(originalTask, result);
      if (changes.length > 0) {
        // Publish main update event
        await publishTaskEvent('task.updated', result, {
          changes,
          actorId,
          actorType: actorType as 'user' | 'system' | 'daemon',
        });

        // Publish field-specific events
        const specificEvents = getSpecificEventTypes(changes);
        for (const eventType of specificEvents) {
          await publishTaskEvent(eventType, result, {
            changes: changes.filter(c => {
              if (eventType === 'task.status.changed') return c.field === 'status';
              if (eventType === 'task.assignee.changed') return c.field === 'assigneeId';
              if (eventType === 'task.priority.changed') return c.field === 'urgency';
              if (eventType === 'task.metadata.changed') return c.field === 'metadata';
              return false;
            }),
            actorId,
            actorType: actorType as 'user' | 'system' | 'daemon',
          });
        }
      }
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id/move - Move a task to a new parent
tasksRouter.put('/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { newParentId, silent, actorId: actorIdStr } = req.body;
    const actorId = actorIdStr ? toObjectId(actorIdStr) : null;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const oldParentId = task.parentId;
    const now = new Date();
    let newParent: Task | null = null;

    if (newParentId) {
      const parentOid = toObjectId(newParentId);

      // Check for circular reference - walk up the parent chain from the new parent
      let currentParentId: ObjectId | null = parentOid;
      while (currentParentId) {
        if (currentParentId.equals(taskId)) {
          throw createError('Cannot move task to one of its descendants', 400);
        }
        const ancestor: WithId<Task> | null = await db.collection<Task>('tasks').findOne({ _id: currentParentId });
        currentParentId = ancestor?.parentId || null;
      }

      newParent = await db.collection<Task>('tasks').findOne({ _id: parentOid });
      if (!newParent) {
        throw createError('New parent task not found', 404);
      }
    }

    // Update the task's parent
    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: {
          parentId: newParent ? newParent._id : null,
          updatedAt: now,
        },
      }
    );

    const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

    // Publish task.moved event unless silent
    if (!silent && updatedTask) {
      await publishTaskEvent('task.moved', updatedTask, {
        changes: [{
          field: 'parentId',
          oldValue: oldParentId,
          newValue: newParent ? newParent._id : null,
        }],
        actorId,
        actorType: 'user',
      });
    }

    res.json({ data: updatedTask });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/webhook/execute - Execute a webhook task
tasksRouter.post('/:id/webhook/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { webhookTaskService } = await import('../services/webhook-task-service.js');
    const taskId = toObjectId(req.params.id);
    const attempt = await webhookTaskService.executeWebhook(taskId);
    res.json({ data: attempt });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/webhook/retry - Retry a failed webhook task
tasksRouter.post('/:id/webhook/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { webhookTaskService } = await import('../services/webhook-task-service.js');
    const taskId = toObjectId(req.params.id);
    const attempt = await webhookTaskService.retryWebhook(taskId);
    res.json({ data: attempt });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id/webhook/status - Get webhook execution status
tasksRouter.get('/:id/webhook/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { webhookTaskService } = await import('../services/webhook-task-service.js');
    const taskId = toObjectId(req.params.id);
    const status = await webhookTaskService.getWebhookStatus(taskId);
    res.json({ data: status });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id/webhook/retry - Cancel pending webhook retry
tasksRouter.delete('/:id/webhook/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { webhookTaskService } = await import('../services/webhook-task-service.js');
    const taskId = toObjectId(req.params.id);
    webhookTaskService.cancelRetry(taskId);
    res.json({ success: true, message: 'Retry cancelled' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id - Delete a task
tasksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { deleteChildren = 'true', silent = 'false', actorId: actorIdStr } = req.query;
    const actorId = actorIdStr ? toObjectId(actorIdStr as string) : null;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();
    const deletedTaskIds: ObjectId[] = [taskId];

    if (deleteChildren === 'true') {
      // Delete all descendants recursively
      const descendantIds = await getDescendantIds(db, taskId);
      if (descendantIds.length > 0) {
        deletedTaskIds.push(...descendantIds);
        await db.collection('tasks').deleteMany({ _id: { $in: descendantIds } });
      }
    } else {
      // Move children up to parent
      await db.collection('tasks').updateMany(
        { parentId: taskId },
        {
          $set: {
            parentId: task.parentId,
            updatedAt: now,
          },
        }
      );
    }

    // Delete the task
    await db.collection('tasks').deleteOne({ _id: taskId });

    // Publish task.deleted event unless silent
    if (silent !== 'true') {
      await publishTaskEvent('task.deleted', task, {
        actorId,
        actorType: 'user',
        metadata: { deletedTaskIds: deletedTaskIds.map(id => id.toString()) },
      });
    }

    // Clean up activity logs for deleted tasks
    for (const deletedId of deletedTaskIds) {
      await activityLogService.deleteTaskActivity(deletedId);
    }

    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/bulk - Bulk operations
tasksRouter.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { operation, taskIds, updates } = req.body;

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      throw createError('taskIds array is required', 400);
    }

    const objectIds = taskIds.map((id: string) => toObjectId(id));
    const now = new Date();

    let result: Document;

    switch (operation) {
      case 'update':
        if (!updates || typeof updates !== 'object') {
          throw createError('updates object is required for update operation', 400);
        }
        delete updates._id;
        delete updates.createdAt;
        updates.updatedAt = now;

        result = await db.collection('tasks').updateMany(
          { _id: { $in: objectIds } },
          { $set: updates }
        );
        break;

      case 'delete':
        // Get all descendant IDs for all tasks being deleted
        const allIdsToDelete = new Set<string>(objectIds.map(id => id.toString()));

        for (const taskId of objectIds) {
          const descendantIds = await getDescendantIds(db, taskId);
          descendantIds.forEach(id => allIdsToDelete.add(id.toString()));
        }

        const deleteObjectIds = Array.from(allIdsToDelete).map(id => new ObjectId(id));
        await db.collection('tasks').deleteMany({ _id: { $in: deleteObjectIds } });

        result = { deletedCount: deleteObjectIds.length };
        break;

      default:
        throw createError('Invalid operation. Supported: update, delete', 400);
    }

    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
});

// Helper function to build tree structure
function buildTaskTree(tasks: Task[], _maxDepth: number, _currentDepth = 0): TaskWithChildren[] {
  const taskMap = new Map<string, TaskWithChildren>();
  const roots: TaskWithChildren[] = [];

  // First pass: create map
  for (const task of tasks) {
    taskMap.set(task._id.toString(), { ...task, children: [] });
  }

  // Second pass: build tree
  for (const task of tasks) {
    const taskNode = taskMap.get(task._id.toString())!;

    if (task.parentId) {
      const parent = taskMap.get(task.parentId.toString());
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(taskNode);
      } else {
        // Parent not in current result set, treat as root
        roots.push(taskNode);
      }
    } else {
      roots.push(taskNode);
    }
  }

  return roots;
}
