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
  const { search, filters, parentId, rootOnly, status, urgency, assigneeId, tags, includeArchived } = query;

  // By default, exclude archived tasks unless explicitly requested
  const shouldIncludeArchived = includeArchived === 'true' || includeArchived === true;

  // Text search
  if (search && typeof search === 'string') {
    filter.$text = { $search: search };
  }

  // Check if any filters are active (meaning we should flatten the view)
  const hasActiveFilters = !!(
    search ||
    status ||
    urgency ||
    assigneeId ||
    tags ||
    (filters && typeof filters === 'object' && Object.keys(filters as object).length > 0)
  );

  // Parent filter - flow tasks should appear at root level even if they have a parent
  // When filters are active, skip rootOnly to show all matching tasks (flattened view)
  if ((rootOnly === 'true' || rootOnly === true) && !hasActiveFilters) {
    // Show root tasks OR flow tasks (flow tasks appear at both root and under parent)
    filter.$or = [
      { parentId: null },
      { taskType: 'flow', parentId: { $ne: null } }
    ];
  } else if (parentId) {
    filter.parentId = toObjectId(parentId as string);
  }

  // Status filter
  if (status) {
    // Explicit status filter provided - use it as-is
    if (Array.isArray(status)) {
      (filter as Record<string, unknown>).status = { $in: status };
    } else {
      (filter as Record<string, unknown>).status = status as string;
    }
  } else if (!shouldIncludeArchived) {
    // No explicit status filter - exclude archived by default
    (filter as Record<string, unknown>).status = { $ne: 'archived' };
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
    // Handle special __unassigned__ marker for null values
    if (assigneeId === '__unassigned__' || (Array.isArray(assigneeId) && assigneeId.includes('__unassigned__'))) {
      filter.assigneeId = { $eq: null } as unknown as ObjectId;
    } else if (Array.isArray(assigneeId)) {
      const resolvedIds = assigneeId
        .map((id) => resolveUserPlaceholder(id as string, currentUserId))
        .filter((id) => id !== '{{currentUserId}}')
        .map((id) => toObjectId(id));
      if (resolvedIds.length > 0) {
        filter.assigneeId = { $in: resolvedIds };
      }
    } else {
      const resolvedAssigneeId = resolveUserPlaceholder(assigneeId as string, currentUserId);
      // Skip if placeholder couldn't be resolved (no current user)
      if (resolvedAssigneeId !== '{{currentUserId}}') {
        filter.assigneeId = toObjectId(resolvedAssigneeId);
      }
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
        // Handle special __unassigned__ marker for null values (e.g., assigneeId: ['__unassigned__'])
        if (Array.isArray(value) && value.includes('__unassigned__')) {
          (filter as Record<string, unknown>)[key] = { $eq: null };
        // Handle arrays - convert to $in query for multi-value filters (e.g., status: ['pending', 'in_progress'])
        } else if (Array.isArray(value)) {
          (filter as Record<string, unknown>)[key] = { $in: value };
        // Handle ObjectId fields
        } else if (key.endsWith('Id') && typeof value === 'string' && ObjectId.isValid(value)) {
          (filter as Record<string, unknown>)[key] = new ObjectId(value);
        } else {
          (filter as Record<string, unknown>)[key] = value;
        }
      }
    });
  }

  // Final archived exclusion check: if we ended up with a status filter that explicitly
  // includes 'archived', remove it from the array (unless includeArchived is true)
  if (!shouldIncludeArchived) {
    const currentStatusFilter = (filter as Record<string, unknown>).status;
    if (currentStatusFilter) {
      // Status filter exists - check if it explicitly includes 'archived'
      if (typeof currentStatusFilter === 'object' && '$in' in (currentStatusFilter as object)) {
        const statusValues = (currentStatusFilter as { $in: unknown[] }).$in;
        if (Array.isArray(statusValues) && statusValues.includes('archived')) {
          // Remove 'archived' from the array
          const filteredValues = statusValues.filter(s => s !== 'archived');
          if (filteredValues.length > 0) {
            (filter as Record<string, unknown>).status = { $in: filteredValues };
          } else {
            // If no values left, use $ne: 'archived' instead
            (filter as Record<string, unknown>).status = { $ne: 'archived' };
          }
        }
      } else if (currentStatusFilter === 'archived') {
        // Single status is 'archived' but includeArchived is false - this shouldn't match anything
        // Use an impossible condition to return no results
        (filter as Record<string, unknown>).status = { $in: [] };
      }
    }
    // If no status filter at all, lines 71-73 already added $ne: 'archived'
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
    const { rootId, maxDepth = 10, resolveReferences = 'true', includeArchived } = req.query;
    const shouldIncludeArchived = includeArchived === 'true';

    const filter: Filter<Task> = {};

    if (rootId) {
      // Get all descendants of this task
      const rootOid = toObjectId(rootId as string);
      const descendants = await getDescendantIds(db, rootOid);
      (filter as Record<string, unknown>)._id = { $in: [rootOid, ...descendants] };
    }

    // By default, exclude archived tasks
    if (!shouldIncludeArchived) {
      (filter as Record<string, unknown>).status = { $ne: 'archived' };
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

    // Find all tasks with webhookConfig (either with attempts or pending)
    const filter: Record<string, unknown> = {
      'webhookConfig.url': { $exists: true },
    };

    // Filter by webhook attempt status if provided
    if (status) {
      if (status === 'pending') {
        // Pending means no attempts yet OR last attempt is pending
        filter.$or = [
          { 'webhookConfig.attempts': { $exists: false } },
          { 'webhookConfig.attempts': { $size: 0 } },
          { 'webhookConfig.attempts.status': 'pending' },
        ];
      } else {
        filter['webhookConfig.attempts.status'] = status;
      }
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

      // If no attempts yet, create a pending entry for the task
      if (attempts.length === 0) {
        return [{
          _id: `${task._id}-pending`,
          taskId: task._id,
          taskTitle: task.title,
          taskStatus: task.status,
          attemptNumber: 0,
          status: 'pending',
          httpStatus: undefined,
          responseBody: undefined,
          errorMessage: undefined,
          durationMs: undefined,
          startedAt: task.createdAt,
          completedAt: undefined,
          url: task.webhookConfig?.url,
          method: task.webhookConfig?.method,
          headers: task.webhookConfig?.headers,
          requestBody: task.metadata?.requestBody,
          maxRetries: task.webhookConfig?.maxRetries,
          nextRetryAt: task.webhookConfig?.nextRetryAt,
        }];
      }

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

    // Sort by startedAt descending (pending tasks use createdAt)
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

// GET /api/tasks/workflow-callbacks - List inbound callback requests
// NOTE: This route MUST be defined before /:id to avoid being matched as an ID
tasksRouter.get('/workflow-callbacks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { taskStatus, taskType, limit = '50', offset = '0' } = req.query;

    // Find tasks that have received callback requests
    // These are tasks where metadata.callbackRequests exists and has entries
    const filter: Record<string, unknown> = {
      'metadata.callbackRequests.0': { $exists: true },
    };

    // Filter by task status if provided
    if (taskStatus) {
      filter.status = taskStatus;
    }

    // Filter by task type if provided
    if (taskType) {
      filter.taskType = taskType;
    }

    const tasks = await db
      .collection<Task>('tasks')
      .find(filter)
      .project({
        _id: 1,
        title: 1,
        status: 1,
        taskType: 1,
        workflowRunId: 1,
        workflowStepId: 1,
        metadata: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .toArray();

    // Flatten callback requests from all tasks into individual entries
    interface CallbackRequestEntry {
      _id: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      body: unknown;
      receivedAt: string;
      status: string;
      error?: string;
      createdTaskIds?: string[];
    }

    const callbackRequests = tasks.flatMap((task) => {
      const requests = (task.metadata?.callbackRequests || []) as CallbackRequestEntry[];
      return requests.map((req) => ({
        _id: req._id,
        taskId: task._id.toString(),
        taskTitle: task.title,
        taskStatus: task.status,
        taskType: task.taskType,
        workflowRunId: task.workflowRunId?.toString(),
        workflowStepId: task.workflowStepId,
        // Request details
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        receivedAt: req.receivedAt,
        status: req.status,
        // Error message if failed
        error: req.error,
        // Created tasks from this callback
        createdTaskIds: req.createdTaskIds,
      }));
    });

    // Sort by receivedAt descending
    callbackRequests.sort((a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );

    // Apply pagination to flattened results
    const paginatedRequests = callbackRequests.slice(
      parseInt(offset as string, 10),
      parseInt(offset as string, 10) + parseInt(limit as string, 10)
    );

    res.json({
      data: paginatedRequests,
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total: callbackRequests.length,
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

// GET /api/tasks/:id/children - Get direct children of a task with pagination
tasksRouter.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      resolveReferences = 'true',
      includeArchived,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'asc',
    } = req.query;

    const shouldIncludeArchived = includeArchived === 'true';
    const taskId = toObjectId(req.params.id);

    // Parse pagination params
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const sort: Sort = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    // Build filter
    const filter: Filter<Task> = { parentId: taskId };

    // By default, exclude archived children
    if (!shouldIncludeArchived) {
      (filter as Record<string, unknown>).status = { $ne: 'archived' };
    }

    // Get children with pagination and total count
    const [children, total] = await Promise.all([
      db
        .collection<Task>('tasks')
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .toArray(),
      db.collection<Task>('tasks').countDocuments(filter),
    ]);

    // Add child count to each task to enable expand/collapse UI
    const taskIds = children.map(t => t._id);
    const childCounts = await db.collection<Task>('tasks').aggregate([
      { $match: { parentId: { $in: taskIds } } },
      { $group: { _id: '$parentId', count: { $sum: 1 } } }
    ]).toArray();

    const childCountMap = new Map(childCounts.map(c => [c._id.toString(), c.count]));
    const childrenWithChildInfo = children.map(task => ({
      ...task,
      children: childCountMap.get(task._id.toString())
        ? Array(childCountMap.get(task._id.toString())).fill({})
        : []
    }));

    let resolvedChildren = childrenWithChildInfo;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedChildren = await resolver.resolveDocuments(childrenWithChildInfo);
    }

    res.json({
      data: resolvedChildren,
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
      // Task type and execution fields
      ...(taskData.taskType && { taskType: taskData.taskType }),
      ...(taskData.executionMode && { executionMode: taskData.executionMode }),
      ...(taskData.webhookConfig && { webhookConfig: taskData.webhookConfig }),
      ...(taskData.foreachConfig && { foreachConfig: taskData.foreachConfig }),
      ...(taskData.joinConfig && { joinConfig: taskData.joinConfig }),
      ...(taskData.externalConfig && { externalConfig: taskData.externalConfig }),
    };

    const result = await db.collection('tasks').insertOne(newTask);
    const insertedTask = await db.collection<Task>('tasks').findOne({ _id: result.insertedId });

    // Publish task.created event unless silent
    if (!silent && insertedTask) {
      // Get actor from request body, or fall back to authenticated user
      const actorId = taskData.createdById
        ? toObjectId(taskData.createdById)
        : req.user?.userId
          ? toObjectId(req.user.userId)
          : null;

      await publishTaskEvent('task.created', insertedTask, {
        actorId,
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
    // Get actor from request body, or fall back to authenticated user
    const actorId = updates.actorId
      ? toObjectId(updates.actorId)
      : req.user?.userId
        ? toObjectId(req.user.userId)
        : null;
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

    // Handle joinConfig merge: shallow merge new joinConfig keys with existing
    if (updates.joinConfig !== undefined) {
      if (updates.joinConfig === null) {
        // Allow explicit null to clear joinConfig
        updates.joinConfig = {};
      } else {
        // Merge with existing joinConfig (new keys override existing)
        updates.joinConfig = {
          ...(originalTask.joinConfig || {}),
          ...updates.joinConfig,
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
        // Fields that have their own specific events
        const fieldsWithSpecificEvents = ['status', 'assigneeId', 'urgency', 'metadata'];

        // Separate changes into those with specific events and those without
        const genericChanges = changes.filter(c => !fieldsWithSpecificEvents.includes(c.field));
        const specificEventChanges = changes.filter(c => fieldsWithSpecificEvents.includes(c.field));

        // Publish task.updated only for changes that don't have specific events
        if (genericChanges.length > 0) {
          await publishTaskEvent('task.updated', result, {
            changes: genericChanges,
            actorId,
            actorType: actorType as 'user' | 'system' | 'daemon',
          });
        }

        // Publish field-specific events
        if (specificEventChanges.length > 0) {
          const specificEvents = getSpecificEventTypes(specificEventChanges);
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
    // Get actor from request body, or fall back to authenticated user
    const actorId = actorIdStr
      ? toObjectId(actorIdStr)
      : req.user?.userId
        ? toObjectId(req.user.userId)
        : null;

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

// POST /api/tasks/:id/rerun - Rerun a task (reset to pending and clear output)
tasksRouter.post('/:id/rerun', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { clearMetadata = false, preserveInput = true } = req.body;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();

    // Build the update object
    const updateFields: Record<string, unknown> = {
      status: 'pending',
      updatedAt: now,
    };

    // Clear webhook attempts if task has webhook config
    if (task.webhookConfig) {
      updateFields['webhookConfig.attempts'] = [];
      updateFields['webhookConfig.lastAttemptAt'] = null;
      updateFields['webhookConfig.nextRetryAt'] = null;
    }

    // Clear batch counters for foreach/join tasks
    if (task.taskType === 'foreach' && task.batchCounters) {
      updateFields['batchCounters.processedCount'] = 0;
      updateFields['batchCounters.failedCount'] = 0;
      updateFields['batchCounters.receivedCount'] = 0;
    }

    // Clear or preserve metadata based on options
    if (clearMetadata) {
      // Clear all metadata except input-related fields if preserveInput is true
      if (preserveInput && task.metadata) {
        const inputFields = ['input', 'inputPayload', 'triggerPayload'];
        const preservedMetadata: Record<string, unknown> = {};
        for (const field of inputFields) {
          if (task.metadata[field] !== undefined) {
            preservedMetadata[field] = task.metadata[field];
          }
        }
        updateFields.metadata = preservedMetadata;
      } else {
        updateFields.metadata = {};
      }
    } else {
      // Clear only output-related metadata fields
      const outputFields = [
        'output', 'result', 'error', 'aggregatedResults',
        'successCount', 'failedCount', 'successPercent',
        'statusReason', 'completedAt'
      ];
      const $unset: Record<string, string> = {};
      for (const field of outputFields) {
        if (task.metadata?.[field] !== undefined) {
          $unset[`metadata.${field}`] = '';
        }
      }
      if (Object.keys($unset).length > 0) {
        await db.collection('tasks').updateOne(
          { _id: taskId },
          { $unset }
        );
      }
    }

    const result = await db.collection<Task>('tasks').findOneAndUpdate(
      { _id: taskId },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Task not found', 404);
    }

    // Get actor from request
    const actorId = req.user?.userId ? toObjectId(req.user.userId) : null;

    // Publish task.status.changed event
    await publishTaskEvent('task.status.changed', result, {
      changes: [{ field: 'status', oldValue: task.status, newValue: 'pending' }],
      actorId,
      actorType: 'user',
    });

    res.json({ data: result, message: 'Task reset to pending' });
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
    // Get actor from query params, or fall back to authenticated user
    const actorId = actorIdStr
      ? toObjectId(actorIdStr as string)
      : req.user?.userId
        ? toObjectId(req.user.userId)
        : null;

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

// POST /api/tasks/:id/force-complete-join - Force complete a join task with available results
tasksRouter.post('/:id/force-complete-join', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);

    // Get the join task
    const joinTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!joinTask) {
      throw createError('Task not found', 404);
    }

    if (joinTask.taskType !== 'join') {
      throw createError('Task is not a join task', 400);
    }

    if (joinTask.status === 'completed') {
      throw createError('Join task is already completed', 400);
    }

    // Find the associated foreach task
    const foreachTaskId = joinTask.metadata?.awaitingForeachTask ||
      (joinTask.joinConfig?.awaitTaskId ? joinTask.joinConfig.awaitTaskId.toString() : null);

    if (!foreachTaskId) {
      throw createError('Cannot find associated foreach task for this join', 400);
    }

    const foreachTask = await db.collection<Task>('tasks').findOne({
      _id: toObjectId(foreachTaskId),
    });

    if (!foreachTask) {
      throw createError('Foreach task not found', 404);
    }

    // Get all children of the foreach task
    const children = await db.collection<Task>('tasks').find({
      parentId: foreachTask._id,
    }).toArray();

    const completedCount = children.filter(c => c.status === 'completed').length;
    const failedCount = children.filter(c => c.status === 'failed').length;
    const totalDone = completedCount + failedCount;
    const expectedCount = joinTask.joinConfig?.expectedCount ?? foreachTask.batchCounters?.expectedCount ?? children.length;
    const currentSuccessPercent = expectedCount > 0 ? (completedCount / expectedCount) * 100 : 0;

    // Aggregate results from completed tasks
    const results = children
      .filter(c => c.status === 'completed')
      .map(c => c.metadata);

    const now = new Date();
    const statusReason = `Force-completed: ${completedCount}/${expectedCount} tasks succeeded (${currentSuccessPercent.toFixed(1)}%)`;

    // Update the join task
    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'completed',
          updatedAt: now,
          'metadata.aggregatedResults': results,
          'metadata.successCount': completedCount,
          'metadata.failedCount': failedCount,
          'metadata.expectedCount': expectedCount,
          'metadata.successPercent': currentSuccessPercent,
          'metadata.statusReason': statusReason,
          'metadata.forceCompleted': true,
          'metadata.forceCompletedAt': now,
        },
      }
    );

    // Update foreach batchCounters
    await db.collection('tasks').updateOne(
      { _id: foreachTask._id },
      {
        $set: {
          status: 'completed',
          updatedAt: now,
          'batchCounters.processedCount': completedCount,
          'batchCounters.failedCount': failedCount,
        },
      }
    );

    // Get the updated join task
    const updatedJoinTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

    // Publish event
    await publishTaskEvent('task.updated', updatedJoinTask!, {
      actorId: (req as Request & { userId?: string }).userId,
      actorType: 'user',
      changes: { status: { from: joinTask.status, to: 'completed' } },
    });

    // Note: Workflow advancement happens automatically via the event bus
    // The publishTaskEvent call above triggers workflow-execution-service's
    // subscription to task.updated events, which handles advancing the workflow

    res.json({
      success: true,
      message: statusReason,
      task: updatedJoinTask,
      aggregatedResults: results.length,
    });
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

        console.log(`[Bulk Update] Updating ${taskIds.length} tasks with:`, updates);
        result = await db.collection('tasks').updateMany(
          { _id: { $in: objectIds } },
          { $set: updates }
        );
        console.log(`[Bulk Update] Result: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
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
