import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId, Filter, Sort, Document } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { ReferenceResolver } from '../services/reference-resolver.js';
import { Task, TaskWithChildren, PaginatedResponse, Document as AppDocument, ChildStatusSummary, Project } from '../types/index.js';
import { publishTaskEvent, computeChanges, getSpecificEventTypes } from '../services/event-bus.js';
import { activityLogService } from '../services/activity-log.js';
import { workflowExecutionService } from '../services/workflow-execution-service.js';
import { loadUserGroups, hasResourceAccess } from '../middleware/group-access.js';

// Import helpers from tasks module
import { toObjectId, buildFilter } from './tasks/index.js';

export const tasksRouter = Router();

// Apply group loading middleware to all routes
tasksRouter.use(loadUserGroups());

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

    // Pass request context to buildFilter for group access filtering
    const filter = buildFilter(req.query as Record<string, unknown>, req.user?.userId, req);
    const sort: Sort = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    const [tasks, total] = await Promise.all([
      db.collection<Task>('tasks').find(filter).sort(sort).skip(skip).limit(limitNum).toArray(),
      db.collection<Task>('tasks').countDocuments(filter),
    ]);

    // Add child count and status summary to each task to enable expand/collapse UI
    // Use a single aggregation query to get counts and status breakdowns
    const taskIds = tasks.map(t => t._id);
    const childStats = await db.collection<Task>('tasks').aggregate([
      { $match: { parentId: { $in: taskIds } } },
      {
        $group: {
          _id: '$parentId',
          count: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          in_progress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          waiting: { $sum: { $cond: [{ $eq: ['$status', 'waiting'] }, 1, 0] } },
          on_hold: { $sum: { $cond: [{ $eq: ['$status', 'on_hold'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        }
      }
    ]).toArray();

    const childStatsMap = new Map(childStats.map(c => [c._id.toString(), c]));
    // Return childCount and childStatusSummary for parent tasks
    const tasksWithChildInfo = tasks.map(task => {
      const stats = childStatsMap.get(task._id.toString());
      const childCount = stats?.count || 0;
      return {
        ...task,
        childCount,
        // Keep empty children array for backward compatibility (UI expects it)
        children: [],
        // Include status summary only if there are children
        ...(childCount > 0 && stats ? {
          childStatusSummary: {
            total: stats.count,
            pending: stats.pending,
            in_progress: stats.in_progress,
            waiting: stats.waiting,
            on_hold: stats.on_hold,
            completed: stats.completed,
            failed: stats.failed,
            cancelled: stats.cancelled,
          } as ChildStatusSummary
        } : {})
      };
    });

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

// Helper to get all descendant IDs using $graphLookup (single query instead of N+1)
async function getDescendantIds(db: ReturnType<typeof getDb>, parentId: ObjectId, maxDepth = 10): Promise<ObjectId[]> {
  const result = await db.collection<Task>('tasks').aggregate([
    { $match: { _id: parentId } },
    {
      $graphLookup: {
        from: 'tasks',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'parentId',
        as: 'descendants',
        maxDepth: maxDepth - 1, // graphLookup maxDepth is 0-indexed
        depthField: 'depth'
      }
    },
    { $project: { descendants: '$descendants._id' } }
  ]).toArray();

  return result[0]?.descendants || [];
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
      // Resolved request details (from execution)
      requestUrl?: string;
      requestMethod?: string;
      requestHeaders?: Record<string, string>;
      requestBody?: string;
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
          // For pending, show the template values (not yet resolved)
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
        // Use resolved request values from attempt, fallback to template values for backward compat
        url: attempt.requestUrl || task.webhookConfig?.url,
        method: attempt.requestMethod || task.webhookConfig?.method,
        headers: attempt.requestHeaders || task.webhookConfig?.headers,
        requestBody: attempt.requestBody || task.metadata?.requestBody,
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

    // Check group access
    const hasAccess = await hasResourceAccess(req, task.groupId);
    if (!hasAccess) {
      throw createError('You do not have access to this task', 403);
    }

    let result: Task | TaskWithChildren = task;

    // Get child count and status summary
    const childStats = await db.collection<Task>('tasks').aggregate([
      { $match: { parentId: taskId } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          in_progress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          waiting: { $sum: { $cond: [{ $eq: ['$status', 'waiting'] }, 1, 0] } },
          on_hold: { $sum: { $cond: [{ $eq: ['$status', 'on_hold'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        }
      }
    ]).toArray();

    const stats = childStats[0];
    if (stats) {
      (result as TaskWithChildren).childCount = stats.count;
      (result as TaskWithChildren).childStatusSummary = {
        total: stats.count,
        pending: stats.pending,
        in_progress: stats.in_progress,
        waiting: stats.waiting,
        on_hold: stats.on_hold,
        completed: stats.completed,
        failed: stats.failed,
        cancelled: stats.cancelled,
      };
    } else {
      (result as TaskWithChildren).childCount = 0;
    }

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
    // Return childCount as a number instead of creating wasteful placeholder arrays
    const childrenWithChildInfo = children.map(task => ({
      ...task,
      childCount: childCountMap.get(task._id.toString()) || 0,
      // Keep empty children array for backward compatibility
      children: []
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

// GET /api/tasks/:id/ancestors - Get all ancestors of a task using $graphLookup (single query)
tasksRouter.get('/:id/ancestors', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { resolveReferences = 'true' } = req.query;

    const taskId = toObjectId(req.params.id);

    // Use $graphLookup to fetch all ancestors in a single query
    const result = await db.collection<Task>('tasks').aggregate([
      { $match: { _id: taskId } },
      {
        $graphLookup: {
          from: 'tasks',
          startWith: '$parentId',
          connectFromField: 'parentId',
          connectToField: '_id',
          as: 'ancestors',
          maxDepth: 50, // Reasonable max depth for task hierarchies
          depthField: 'depth'
        }
      }
    ]).toArray();

    if (result.length === 0) {
      throw createError('Task not found', 404);
    }

    // Sort ancestors by depth descending (root first) and remove depth field
    const ancestors = (result[0].ancestors || [])
      .sort((a: Task & { depth: number }, b: Task & { depth: number }) => b.depth - a.depth)
      .map(({ depth, ...task }: Task & { depth: number }) => task as Task);

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
    let groupId: ObjectId | null = null;
    let projectId: ObjectId | null = null;

    // Handle parent task relationship
    if (taskData.parentId) {
      parentId = toObjectId(taskData.parentId);
      const parent = await db.collection<Task>('tasks').findOne({ _id: parentId });

      if (!parent) {
        throw createError('Parent task not found', 404);
      }

      // Inherit groupId and projectId from parent if not explicitly set
      if (!taskData.groupId && parent.groupId) {
        groupId = parent.groupId;
      }
      if (!taskData.projectId && parent.projectId) {
        projectId = parent.projectId;
      }
      // Inherit humanInstruction from parent if not explicitly set
      if (!taskData.humanInstruction && parent.humanInstruction) {
        taskData.humanInstruction = parent.humanInstruction;
      }
    }

    // Handle explicit groupId and projectId
    if (taskData.groupId) {
      groupId = toObjectId(taskData.groupId);
      // Validate user has access to this group
      const hasAccess = await hasResourceAccess(req, groupId);
      if (!hasAccess) {
        throw createError('You do not have access to this group', 403);
      }
    }
    if (taskData.projectId) {
      projectId = toObjectId(taskData.projectId);
    }

    // Fallback: ensure groupId and projectId are always set
    if (!groupId && req.userGroupIds && req.userGroupIds.length > 0) {
      groupId = req.userGroupIds[0];
    }
    if (!projectId && groupId) {
      const defaultProject = await db.collection<Project>('projects').findOne(
        { groupId, status: 'active', name: 'default' }
      );
      if (defaultProject) {
        projectId = defaultProject._id;
      } else {
        // No default project found, use the first active project in the group
        const firstProject = await db.collection<Project>('projects').findOne(
          { groupId, status: 'active' },
          { sort: { createdAt: 1 } }
        );
        if (firstProject) {
          projectId = firstProject._id;
        }
      }
    }

    // Capture triggerWorkflowId for flow tasks
    const triggerWorkflowId = taskData.triggerWorkflowId ? toObjectId(taskData.triggerWorkflowId) : null;

    // Resolve createdById: explicit > authenticated user > null
    const createdById = taskData.createdById
      ? toObjectId(taskData.createdById)
      : req.user?.userId
        ? toObjectId(req.user.userId)
        : null;

    // Compute creatorType from the creator user's flags
    let creatorType: 'human' | 'agent' | 'system' = 'human';
    if (taskData.creatorType) {
      // Allow explicit override (e.g., from daemon/workflow engine)
      creatorType = taskData.creatorType;
    } else if (createdById) {
      const creatorUser = await db.collection('users').findOne(
        { _id: createdById },
        { projection: { isAgent: 1, isSystem: 1 } }
      );
      if (creatorUser?.isSystem) {
        creatorType = 'system';
      } else if (creatorUser?.isAgent) {
        creatorType = 'agent';
      }
    }

    // Auto-derive humanInstruction for human-created root tasks.
    // If a human creates a root task (no parent) without explicit humanInstruction,
    // use summary (or title if no summary) so the human's goal propagates through
    // all workflow steps and follow-up tasks.
    if (!taskData.humanInstruction && !parentId && creatorType === 'human') {
      const derived = (taskData.summary && taskData.summary.trim()) || taskData.title;
      if (derived) {
        taskData.humanInstruction = derived;
      }
    }

    const newTask: Document = {
      title: taskData.title,
      summary: taskData.summary || '',
      extraPrompt: taskData.extraPrompt || '',
      ...(taskData.humanInstruction && { humanInstruction: taskData.humanInstruction }),
      status: taskData.status || 'pending',
      urgency: taskData.urgency || 'normal',
      groupId,
      projectId,
      parentId,
      workflowId: taskData.workflowId ? toObjectId(taskData.workflowId) : null,
      workflowStage: taskData.workflowStage || '',
      externalId: taskData.externalId || '',
      externalHoldDate: taskData.externalHoldDate ? new Date(taskData.externalHoldDate) : null,
      assigneeId: taskData.assigneeId ? toObjectId(taskData.assigneeId) : null,
      createdById,
      creatorType,
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
    let insertedTask = await db.collection<Task>('tasks').findOne({ _id: result.insertedId });

    // Actor is the resolved createdById (already computed above)
    const actorId = createdById;

    // Publish task.created event unless silent
    if (!silent && insertedTask) {
      await publishTaskEvent('task.created', insertedTask, {
        actorId,
        actorType: 'user',
      });
    }

    // Handle workflow trigger for flow tasks: if triggerWorkflowId was set, start that workflow
    if (triggerWorkflowId && insertedTask) {
      try {
        console.log(`[Tasks] Creating flow task ${insertedTask._id} - triggering workflow ${triggerWorkflowId}`);

        // Build input payload from task metadata (which contains flowInputPayloadTemplate resolved values)
        // or fallback to task title/summary
        const inputPayload: Record<string, unknown> = {
          title: insertedTask.title,
          summary: insertedTask.summary,
        };

        // If flowInputPayloadTemplate was stored in metadata, try to parse it as the input payload
        if (insertedTask.metadata?.flowInputPayloadTemplate) {
          try {
            // The template should have been resolved before saving, but if it's still a string, try to parse it
            const templateStr = insertedTask.metadata.flowInputPayloadTemplate as string;
            const parsed = JSON.parse(templateStr);
            Object.assign(inputPayload, parsed);
          } catch {
            // If parsing fails, just use title/summary
            console.log(`[Tasks] Could not parse flowInputPayloadTemplate, using defaults`);
          }
        }

        // Start the workflow with this task as the trigger
        const { run } = await workflowExecutionService.startWorkflow(
          {
            workflowId: triggerWorkflowId.toString(),
            triggerTaskId: insertedTask._id.toString(),
            triggerContext: {
              taskTitle: insertedTask.title,
              taskSummary: insertedTask.summary,
              ...(insertedTask.metadata || {}),
            },
            inputPayload,
            ...(insertedTask.humanInstruction && { humanInstruction: insertedTask.humanInstruction }),
          },
          actorId
        );

        console.log(`[Tasks] Started workflow run ${run._id} from flow task ${insertedTask._id}`);

        // Update the task with the spawned workflow run ID
        await db.collection<Task>('tasks').updateOne(
          { _id: insertedTask._id },
          { $set: { spawnedWorkflowRunId: run._id } }
        );

        // Refresh the task to include the spawnedWorkflowRunId
        insertedTask = await db.collection<Task>('tasks').findOne({ _id: result.insertedId });
      } catch (workflowError) {
        console.error(`[Tasks] Failed to trigger workflow ${triggerWorkflowId} from flow task ${result.insertedId}:`, workflowError);
        // Don't fail the task creation, just log the error
      }
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

    // Check group access
    const hasAccess = await hasResourceAccess(req, originalTask.groupId);
    if (!hasAccess) {
      throw createError('You do not have access to this task', 403);
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
    const idFields = ['parentId', 'assigneeId', 'createdById', 'workflowId', 'workflowRunId', 'triggerWorkflowId', 'groupId', 'projectId'];
    for (const field of idFields) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] ? toObjectId(updates[field]) : null;
      }
    }

    // If groupId is being changed, validate access to the new group
    if (updates.groupId && updates.groupId.toString() !== originalTask.groupId?.toString()) {
      const hasAccess = await hasResourceAccess(req, updates.groupId);
      if (!hasAccess) {
        throw createError('You do not have access to the target group', 403);
      }
    }

    // Capture triggerWorkflowId before the update (it will be cleared after triggering)
    const triggerWorkflowId = updates.triggerWorkflowId as ObjectId | null | undefined;

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

    // Auto-complete parent task when all subtasks finish (decomposition join)
    if (result.status === 'completed' && result.parentId) {
      try {
        const parent = await db.collection<Task>('tasks').findOne({ _id: result.parentId });
        if (parent && parent.status === 'waiting') {
          // Count incomplete sibling tasks (excluding this one)
          const incompleteCount = await db.collection('tasks').countDocuments({
            parentId: result.parentId,
            _id: { $ne: result._id },
            status: { $nin: ['completed', 'cancelled', 'archived'] },
            taskType: { $ne: 'join' },  // Don't count join tasks as blockers
          });

          if (incompleteCount === 0) {
            // All subtasks done - auto-complete the parent
            const parentResult = await db.collection<Task>('tasks').findOneAndUpdate(
              { _id: result.parentId, status: 'waiting' },
              { $set: { status: 'completed', updatedAt: new Date() } },
              { returnDocument: 'after' }
            );
            if (parentResult) {
              console.log(`[Tasks] Auto-completed parent task ${result.parentId} (all subtasks done)`);
              await publishTaskEvent('task.status.changed', parentResult, {
                changes: [{ field: 'status', oldValue: 'waiting', newValue: 'completed' }],
                actorId: null,
                actorType: 'system',
              });

              // Also complete any join tasks under this parent
              await db.collection('tasks').updateMany(
                { parentId: result.parentId, taskType: 'join', status: 'waiting' },
                { $set: { status: 'completed', updatedAt: new Date() } }
              );
            }
          }
        }
      } catch (autoCompleteError) {
        console.error(`[Tasks] Error in parent auto-completion:`, autoCompleteError);
        // Don't fail the original update
      }
    }

    // Handle workflow trigger: if triggerWorkflowId was set, start that workflow
    if (triggerWorkflowId && result) {
      try {
        console.log(`[Tasks] Triggering workflow ${triggerWorkflowId} from task ${taskId}`);

        // Build trigger context from task metadata and title
        const triggerContext: Record<string, unknown> = {
          taskTitle: result.title,
          taskSummary: result.summary,
          ...(result.metadata || {}),
        };

        // Start the workflow with this task as the trigger
        // Include title and summary in inputPayload so they're available to workflow steps
        const { run } = await workflowExecutionService.startWorkflow(
          {
            workflowId: triggerWorkflowId.toString(),
            triggerTaskId: taskId.toString(),
            triggerContext,
            inputPayload: {
              title: result.title,
              summary: result.summary,
              ...(result.metadata || {}),
            },
          },
          actorId
        );

        console.log(`[Tasks] Started workflow run ${run._id} from task ${taskId}`);

        // Clear the triggerWorkflowId field (it's a one-time trigger)
        await db.collection<Task>('tasks').updateOne(
          { _id: taskId },
          { $unset: { triggerWorkflowId: '' } }
        );

        // Update the result to reflect the cleared field and spawned workflow
        result.triggerWorkflowId = null;
      } catch (workflowError) {
        console.error(`[Tasks] Failed to trigger workflow ${triggerWorkflowId} from task ${taskId}:`, workflowError);
        // Don't fail the task update, just log the error
        // The spawnedWorkflowRunId won't be set, indicating the trigger failed
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

      // Check for circular reference using $graphLookup (single query instead of N+1)
      const ancestorCheck = await db.collection<Task>('tasks').aggregate([
        { $match: { _id: parentOid } },
        {
          $graphLookup: {
            from: 'tasks',
            startWith: '$parentId',
            connectFromField: 'parentId',
            connectToField: '_id',
            as: 'ancestors',
            maxDepth: 50
          }
        },
        {
          $project: {
            _id: 1,
            parentId: 1,
            title: 1,
            status: 1,
            urgency: 1,
            tags: 1,
            assigneeId: 1,
            workflowId: 1,
            workflowRunId: 1,
            workflowStepId: 1,
            taskType: 1,
            createdAt: 1,
            updatedAt: 1,
            metadata: 1,
            isCircular: {
              $in: [taskId, { $concatArrays: [['$_id'], '$ancestors._id'] }]
            }
          }
        }
      ]).toArray();

      if (ancestorCheck.length === 0) {
        throw createError('New parent task not found', 404);
      }

      if (ancestorCheck[0].isCircular) {
        throw createError('Cannot move task to one of its descendants', 400);
      }

      newParent = ancestorCheck[0] as unknown as Task;
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

// ============================================================================
// Flow Task Endpoints (for subflow/nested workflow execution)
// ============================================================================

// POST /api/tasks/:id/flow/execute - Execute (or re-execute) a flow task's subflow
tasksRouter.post('/:id/flow/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const { inputPayload } = req.body;
    const result = await workflowExecutionService.executeFlowTask(taskId, inputPayload);
    if (!result.success) {
      throw createError(result.error || 'Failed to execute flow task', 400);
    }
    res.json({ data: result.attempt });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/flow/retry - Retry a failed flow task
tasksRouter.post('/:id/flow/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const { inputPayload } = req.body;
    const result = await workflowExecutionService.retryFlowTask(taskId, inputPayload);
    if (!result.success) {
      throw createError(result.error || 'Failed to retry flow task', 400);
    }
    res.json({ data: result.attempt });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id/flow/status - Get flow task execution status and history
tasksRouter.get('/:id/flow/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const result = await workflowExecutionService.getFlowTaskStatus(taskId);
    if (!result.success) {
      throw createError(result.error || 'Failed to get flow task status', 404);
    }
    res.json({ data: result.status });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/rerun - Rerun a task with step-type-specific behavior
tasksRouter.post('/:id/rerun', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const {
      clearMetadata = false,
      preserveInput = true,
      rerunChildren = true,  // For foreach tasks: also rerun child tasks
      refreshInput = true,   // Refresh input from previous step
    } = req.body;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();
    const actorId = req.user?.userId ? toObjectId(req.user.userId) : null;
    const MAX_RESULT_HISTORY = 10;

    // Helper: Archive current taskResult to history
    const archiveCurrentResult = async (taskToUpdate: Task) => {
      if (taskToUpdate.taskResult?.current) {
        const history = taskToUpdate.taskResult.history || [];
        history.unshift(taskToUpdate.taskResult.current);
        // Keep only last N results
        const trimmedHistory = history.slice(0, MAX_RESULT_HISTORY);
        await db.collection('tasks').updateOne(
          { _id: taskToUpdate._id },
          {
            $set: { 'taskResult.history': trimmedHistory },
            $unset: { 'taskResult.current': '' }
          }
        );
      }
    };

    // Helper: Refresh input from previous step
    const getRefreshedInput = async (t: Task): Promise<Record<string, unknown> | undefined> => {
      if (!refreshInput || !t.workflowRunId || !t.workflowStepId) return undefined;

      try {
        const workflow = t.workflowId
          ? await db.collection('workflows').findOne({ _id: t.workflowId })
          : null;

        if (workflow?.steps) {
          const currentStepIndex = workflow.steps.findIndex((s: { id: string }) => s.id === t.workflowStepId);
          if (currentStepIndex > 0) {
            const prevStep = workflow.steps[currentStepIndex - 1];
            const prevTask = await db.collection<Task>('tasks').findOne({
              workflowRunId: t.workflowRunId,
              workflowStepId: prevStep.id,
              status: 'completed'
            });

            if (prevTask?.metadata) {
              const prevOutput = prevTask.taskResult?.current?.output
                || prevTask.metadata.aggregatedResults
                || prevTask.metadata.output
                || prevTask.metadata;

              return {
                ...t.metadata?.inputPayload as Record<string, unknown>,
                output: prevOutput,
                _refreshedFrom: prevTask._id.toString(),
                _refreshedAt: now.toISOString(),
              };
            }
          }
        }
      } catch (err) {
        console.error('[Tasks] Rerun: failed to refresh input:', err);
      }
      return undefined;
    };

    // Helper: Clear output-related metadata
    const clearOutputMetadata = async (t: Task) => {
      const outputFields = [
        'output', 'result', 'error', 'aggregatedResults',
        'successCount', 'failedCount', 'successPercent',
        'statusReason', 'completedAt'
      ];
      const $unset: Record<string, string> = {};
      for (const field of outputFields) {
        if (t.metadata?.[field] !== undefined) {
          $unset[`metadata.${field}`] = '';
        }
      }
      if (Object.keys($unset).length > 0) {
        await db.collection('tasks').updateOne({ _id: t._id }, { $unset });
      }
    };

    // =========================================================================
    // Step-type-specific rerun logic
    // =========================================================================

    // JOIN: Re-aggregate without resetting children
    if (task.taskType === 'join') {
      console.log(`[Tasks] Rerun: re-aggregating join task ${taskId}`);
      await archiveCurrentResult(task);
      const rerunResult = await workflowExecutionService.rerunJoinTask(taskId);
      const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

      if (updatedTask) {
        res.json({
          data: updatedTask,
          message: rerunResult.error
            ? `Re-aggregation failed: ${rerunResult.error}`
            : rerunResult.success
              ? 'Join task re-aggregated successfully'
              : 'Join task is waiting for child tasks to complete',
          error: rerunResult.error || undefined,
          debug: rerunResult.debug
        });
        return;
      }
    }

    // FOREACH: Reset and optionally rerun children
    if (task.taskType === 'foreach') {
      console.log(`[Tasks] Rerun: resetting foreach task ${taskId}, rerunChildren=${rerunChildren}`);
      await archiveCurrentResult(task);

      if (rerunChildren) {
        // Find and rerun all child tasks
        const childTasks = await db.collection<Task>('tasks')
          .find({ parentId: taskId })
          .toArray();

        for (const child of childTasks) {
          await archiveCurrentResult(child);
          await clearOutputMetadata(child);
          const childInput = await getRefreshedInput(child);
          await db.collection('tasks').updateOne(
            { _id: child._id },
            {
              $set: {
                status: 'pending',
                updatedAt: now,
                ...(childInput && { 'metadata.inputPayload': childInput }),
              }
            }
          );
          await publishTaskEvent('task.status.changed', { ...child, status: 'pending' } as Task, {
            changes: [{ field: 'status', oldValue: child.status, newValue: 'pending' }],
            actorId,
            actorType: 'user',
          });
        }

        console.log(`[Tasks] Rerun: reset ${childTasks.length} child tasks`);
      }

      // Reset foreach counters
      const updateFields: Record<string, unknown> = {
        status: 'waiting',
        updatedAt: now,
        'batchCounters.processedCount': 0,
        'batchCounters.failedCount': 0,
      };

      const result = await db.collection<Task>('tasks').findOneAndUpdate(
        { _id: taskId },
        { $set: updateFields },
        { returnDocument: 'after' }
      );

      await publishTaskEvent('task.status.changed', result as Task, {
        changes: [{ field: 'status', oldValue: task.status, newValue: 'waiting' }],
        actorId,
        actorType: 'user',
      });

      res.json({
        data: result,
        message: rerunChildren
          ? `Foreach task reset to waiting, ${(await db.collection<Task>('tasks').countDocuments({ parentId: taskId }))} child tasks rerun`
          : 'Foreach task reset to waiting'
      });
      return;
    }

    // WEBHOOK/EXTERNAL: Clear attempts and re-execute
    if (task.taskType === 'webhook' || (task.taskType === 'external' && task.webhookConfig?.url)) {
      console.log(`[Tasks] Rerun: re-executing webhook task ${taskId}`);
      await archiveCurrentResult(task);

      // Clear attempts and reset status
      await db.collection('tasks').updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'pending',
            updatedAt: now,
            'webhookConfig.attempts': [],
            'webhookConfig.lastAttemptAt': null,
            'webhookConfig.nextRetryAt': null,
          }
        }
      );

      // Publish event to trigger webhook execution
      const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
      await publishTaskEvent('task.status.changed', updatedTask as Task, {
        changes: [{ field: 'status', oldValue: task.status, newValue: 'pending' }],
        actorId,
        actorType: 'user',
      });

      res.json({
        data: updatedTask,
        message: 'Webhook task reset and queued for re-execution'
      });
      return;
    }

    // EXTERNAL (callback mode): Reset for new callback
    if (task.taskType === 'external') {
      console.log(`[Tasks] Rerun: resetting external task ${taskId} for callback`);
      await archiveCurrentResult(task);

      const result = await db.collection<Task>('tasks').findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            status: 'in_progress',
            updatedAt: now,
          }
        },
        { returnDocument: 'after' }
      );

      await publishTaskEvent('task.status.changed', result as Task, {
        changes: [{ field: 'status', oldValue: task.status, newValue: 'in_progress' }],
        actorId,
        actorType: 'user',
      });

      res.json({
        data: result,
        message: 'External task reset to in_progress, waiting for callback'
      });
      return;
    }

    // FLOW: Reset and immediately execute the subflow
    if (task.taskType === 'flow') {
      console.log(`[Tasks] Rerun: re-executing flow task ${taskId}`);
      await archiveCurrentResult(task);
      await clearOutputMetadata(task);

      // Refresh input if available
      const refreshedInput = await getRefreshedInput(task);

      // Reset task to pending first
      await db.collection('tasks').updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'pending',
            updatedAt: now,
            ...(refreshedInput && { 'metadata.inputPayload': refreshedInput }),
          }
        }
      );

      await publishTaskEvent('task.status.changed', { ...task, status: 'pending' } as Task, {
        changes: [{ field: 'status', oldValue: task.status, newValue: 'pending' }],
        actorId,
        actorType: 'user',
      });

      // Now execute the flow immediately
      const executeResult = await workflowExecutionService.executeFlowTask(
        taskId.toString(),
        refreshedInput || (task.metadata?.inputPayload as Record<string, unknown> | undefined)
      );

      if (!executeResult.success) {
        // Even if execution fails, the task was reset - return the error
        const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
        res.json({
          data: updatedTask,
          message: `Flow task reset but execution failed: ${executeResult.error}`,
          error: executeResult.error
        });
        return;
      }

      const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
      res.json({
        data: updatedTask,
        message: 'Flow task reset and re-executed',
        attempt: executeResult.attempt
      });
      return;
    }

    // =========================================================================
    // Default rerun: agent, manual, trigger
    // Note: code, findDocument, and decision tasks auto-execute via event bus
    // when set to pending, so they also use this default handler.
    // =========================================================================
    console.log(`[Tasks] Rerun: resetting ${task.taskType || 'standard'} task ${taskId}`);
    await archiveCurrentResult(task);

    // Refresh input if available
    const refreshedInput = await getRefreshedInput(task);

    // Build the update object
    const updateFields: Record<string, unknown> = {
      status: 'pending',
      updatedAt: now,
    };

    // Clear or preserve metadata based on options
    if (clearMetadata) {
      if (preserveInput && task.metadata) {
        const inputFields = ['input', 'inputPayload', 'triggerPayload', 'stepId', 'stepType'];
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
      await clearOutputMetadata(task);
    }

    // Apply refreshed input
    if (refreshedInput) {
      updateFields['metadata.inputPayload'] = refreshedInput;
    }

    const result = await db.collection<Task>('tasks').findOneAndUpdate(
      { _id: taskId },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Task not found', 404);
    }

    await publishTaskEvent('task.status.changed', result, {
      changes: [{ field: 'status', oldValue: task.status, newValue: 'pending' }],
      actorId,
      actorType: 'user',
    });

    const message = refreshedInput
      ? 'Task reset to pending with refreshed input from previous step'
      : 'Task reset to pending';
    res.json({ data: result, message });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/retry - Retry a failed or on_hold task (simpler than full rerun)
// This endpoint is optimized for resolving issues and retrying tasks
// It also resumes the parent workflow if the task was the failed step
tasksRouter.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = toObjectId(req.params.id);
    const { clearError = true } = req.body;
    const actorId = req.user?.userId ? toObjectId(req.user.userId) : undefined;

    const result = await workflowExecutionService.retryFailedTask(taskId, {
      actorId,
      clearError,
    });

    if (!result.success) {
      res.status(400).json({ error: result.error, message: result.message });
      return;
    }

    // Get the updated task
    const db = getDb();
    const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

    res.json({
      data: updatedTask,
      message: result.message,
      workflowResumed: result.workflowResumed,
    });
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

    // Check group access
    const hasAccess = await hasResourceAccess(req, task.groupId);
    if (!hasAccess) {
      throw createError('You do not have access to this task', 403);
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

// POST /api/tasks/:id/force-decision - Force a decision task to a specific branch
tasksRouter.post('/:id/force-decision', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { targetStepId } = req.body;

    if (!targetStepId) {
      throw createError('targetStepId is required', 400);
    }

    // Get the decision task
    const decisionTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!decisionTask) {
      throw createError('Task not found', 404);
    }

    if (decisionTask.taskType !== 'decision') {
      throw createError('Task is not a decision task', 400);
    }

    // Verify the target is a valid option
    const stepConfig = decisionTask.stepConfig;
    const connections = stepConfig?.connections || [];
    const defaultConnection = stepConfig?.defaultConnection;

    const validTargets = connections.map(c => c.targetStepId);
    if (defaultConnection && !validTargets.includes(defaultConnection)) {
      validTargets.push(defaultConnection);
    }

    if (!validTargets.includes(targetStepId)) {
      throw createError(
        `Invalid targetStepId. Valid options: ${validTargets.join(', ')}`,
        400
      );
    }

    const selectedConnection = connections.find(c => c.targetStepId === targetStepId) ||
      { targetStepId, condition: null, label: undefined };

    const now = new Date();
    const actorId = req.user?.userId ? toObjectId(req.user.userId) : null;

    // Update the decision task
    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'completed',
          decisionResult: targetStepId,
          updatedAt: now,
          'metadata.selectedPath': targetStepId,
          'metadata.condition': selectedConnection.condition || 'forced',
          'metadata.forcedDecision': true,
          'metadata.forcedAt': now,
          'metadata.forcedBy': actorId?.toString() || 'unknown',
        },
        $unset: {
          'metadata.error': '',
        },
      }
    );

    // Get the updated task
    const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

    // Publish event - this will trigger onTaskStatusChanged which will call advanceToNextStep
    // The advanceToNextStep method uses metadata.selectedPath for decision tasks
    await publishTaskEvent('task.status.changed', updatedTask!, {
      actorId,
      actorType: 'user',
      changes: [{ field: 'status', oldValue: decisionTask.status, newValue: 'completed' }],
    });

    // Note: We no longer call advanceFromForcedDecision here because:
    // 1. The task.status.changed event triggers onTaskStatusChanged
    // 2. onTaskStatusChanged calls advanceToNextStep
    // 3. advanceToNextStep now uses metadata.selectedPath for decision tasks
    // This prevents duplicate task creation

    res.json({
      success: true,
      message: `Decision forced to: ${selectedConnection.label || targetStepId}`,
      task: updatedTask,
    });
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
    const foreachTaskIdRaw = joinTask.metadata?.awaitingForeachTask ||
      (joinTask.joinConfig?.awaitTaskId ? joinTask.joinConfig.awaitTaskId.toString() : null);

    if (!foreachTaskIdRaw || typeof foreachTaskIdRaw !== 'string') {
      throw createError('Cannot find associated foreach task for this join', 400);
    }

    const foreachTask = await db.collection<Task>('tasks').findOne({
      _id: toObjectId(foreachTaskIdRaw),
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
    const userId = (req as Request & { userId?: string }).userId;
    await publishTaskEvent('task.updated', updatedJoinTask!, {
      actorId: userId ? toObjectId(userId) : null,
      actorType: 'user',
      changes: [{ field: 'status', oldValue: joinTask.status, newValue: 'completed' }],
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

        // Convert ID fields to ObjectIds
        if (updates.groupId !== undefined) {
          updates.groupId = updates.groupId ? toObjectId(updates.groupId) : null;
        }
        if (updates.projectId !== undefined) {
          updates.projectId = updates.projectId ? toObjectId(updates.projectId) : null;
        }
        if (updates.assigneeId !== undefined) {
          updates.assigneeId = updates.assigneeId ? toObjectId(updates.assigneeId) : null;
        }

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

// ============================================================================
// Task Documents Endpoints
// ============================================================================

// GET /api/tasks/:id/documents - List documents attached to a task
tasksRouter.get('/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid task ID', 400);
    }

    const taskId = new ObjectId(req.params.id);

    // Verify task exists
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    // Find documents that have this task in relatedTaskIds
    const documents = await db.collection<AppDocument>('documents')
      .find({ relatedTaskIds: taskId })
      .sort({ updatedAt: -1 })
      .toArray();

    // Resolve creator references
    const resolvedDocuments = await Promise.all(
      documents.map(async (doc) => {
        const resolved: Record<string, unknown> = {};

        if (doc.createdById) {
          const user = await db.collection('users').findOne(
            { _id: new ObjectId(doc.createdById) },
            { projection: { displayName: 1 } }
          );
          if (user) {
            resolved.createdBy = { _id: doc.createdById.toString(), displayName: user.displayName };
          }
        }

        return {
          ...doc,
          _resolved: Object.keys(resolved).length > 0 ? resolved : undefined,
        };
      })
    );

    res.json({ data: resolvedDocuments });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/documents - Attach a document to a task
// Supports two modes:
// 1. Link existing document: { documentId: "existing-doc-id" }
// 2. Create new document: { title: "...", content: "...", type?: "output", status?: "draft" }
tasksRouter.post('/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid task ID', 400);
    }

    const taskId = new ObjectId(req.params.id);

    // Verify task exists
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const { documentId, title, content, type = 'output', status = 'draft', summary, tags, metadata } = req.body;

    let document: AppDocument;

    if (documentId) {
      // Mode 1: Link existing document
      if (!ObjectId.isValid(documentId)) {
        throw createError('Invalid document ID', 400);
      }

      const docId = new ObjectId(documentId);
      const existingDoc = await db.collection<AppDocument>('documents').findOne({ _id: docId });

      if (!existingDoc) {
        throw createError('Document not found', 404);
      }

      // Check if already linked
      if (existingDoc.relatedTaskIds?.some(id => id.toString() === taskId.toString())) {
        throw createError('Document is already attached to this task', 400);
      }

      // Add task to document's relatedTaskIds
      await db.collection<AppDocument>('documents').updateOne(
        { _id: docId },
        {
          $addToSet: { relatedTaskIds: taskId },
          $set: { updatedAt: new Date() },
        }
      );

      document = { ...existingDoc, relatedTaskIds: [...(existingDoc.relatedTaskIds || []), taskId] };
    } else {
      // Mode 2: Create new document
      if (!title) {
        throw createError('Title is required when creating a new document', 400);
      }
      if (!content) {
        throw createError('Content is required when creating a new document', 400);
      }

      const validTypes = ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'];
      const validStatuses = ['draft', 'review', 'approved', 'archived'];

      if (!validTypes.includes(type)) {
        throw createError(`Invalid document type. Valid types: ${validTypes.join(', ')}`, 400);
      }
      if (!validStatuses.includes(status)) {
        throw createError(`Invalid document status. Valid statuses: ${validStatuses.join(', ')}`, 400);
      }

      const now = new Date();
      const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;

      const newDocument: Omit<AppDocument, '_id'> = {
        title,
        content,
        summary: summary || undefined,
        type: type as AppDocument['type'],
        status: status as AppDocument['status'],
        tags: tags || [],
        createdById: userId,
        lastModifiedById: userId,
        relatedTaskIds: [taskId],
        workflowRunId: task.workflowRunId || null,
        version: 1,
        metadata: metadata || {},
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection<AppDocument>('documents').insertOne(newDocument as AppDocument);
      document = { ...newDocument, _id: result.insertedId } as AppDocument;
    }

    // Publish event for real-time updates (activity logging happens via event bus subscription)
    await publishTaskEvent('task.updated', task, {
      actorId: req.user?.userId ? new ObjectId(req.user.userId) : null,
      actorType: req.user ? 'user' : 'system',
      metadata: {
        documentAttached: document._id.toString(),
        documentTitle: document.title,
      },
    });

    res.status(201).json({
      success: true,
      message: documentId ? 'Document linked to task' : 'Document created and attached to task',
      document,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id/documents/:documentId - Detach a document from a task
tasksRouter.delete('/:id/documents/:documentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid task ID', 400);
    }
    if (!ObjectId.isValid(req.params.documentId)) {
      throw createError('Invalid document ID', 400);
    }

    const taskId = new ObjectId(req.params.id);
    const documentId = new ObjectId(req.params.documentId);

    // Verify task exists
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    // Verify document exists and is linked to this task
    const document = await db.collection<AppDocument>('documents').findOne({ _id: documentId });
    if (!document) {
      throw createError('Document not found', 404);
    }

    if (!document.relatedTaskIds?.some(id => id.toString() === taskId.toString())) {
      throw createError('Document is not attached to this task', 400);
    }

    // Remove task from document's relatedTaskIds
    await db.collection<AppDocument>('documents').updateOne(
      { _id: documentId },
      {
        $pull: { relatedTaskIds: taskId },
        $set: { updatedAt: new Date() },
      }
    );

    // Publish event for real-time updates (activity logging happens via event bus subscription)
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;
    await publishTaskEvent('task.updated', task, {
      actorId: userId,
      actorType: req.user ? 'user' : 'system',
      metadata: {
        documentDetached: documentId.toString(),
        documentTitle: document.title,
      },
    });

    res.json({ success: true, message: 'Document detached from task' });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/rollback - Rollback a manual review task to the previous step
tasksRouter.post('/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = toObjectId(req.params.id);
    const { comment } = req.body as { comment?: string };

    const db = getDb();
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });

    if (!task) {
      throw createError('Task not found', 404);
    }

    if (task.taskType !== 'manual') {
      throw createError('Only manual tasks can be rolled back', 400);
    }

    if (!task.workflowRunId || !task.workflowStepId) {
      throw createError('Task is not part of a workflow', 400);
    }

    // Call the workflow execution service to perform the rollback
    const result = await workflowExecutionService.rollbackToPreviousStep(
      taskId.toString(),
      comment
    );

    if (!result.success) {
      throw createError(result.error || 'Failed to rollback task', 400);
    }

    // Publish event for real-time updates
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;
    await publishTaskEvent('task.updated', task, {
      actorId: userId,
      actorType: req.user ? 'user' : 'system',
      metadata: {
        action: 'rollback',
        reviewComment: comment,
        newTaskId: result.newTaskId,
      },
    });

    res.json({
      success: true,
      message: 'Task rolled back to previous step',
      newTaskId: result.newTaskId,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Agent Questions Endpoints
// ============================================================================

// POST /api/tasks/:id/answer-questions - Submit answers to agent questions
tasksRouter.post('/:id/answer-questions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      throw createError('answers array is required', 400);
    }

    // Get the task
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    // Verify task has questions pending
    const metadata = task.metadata as Record<string, unknown> | undefined;
    const output = metadata?.output as Record<string, unknown> | undefined;
    const questionsData = output?.questions as { questions?: unknown[]; context?: string } | undefined;

    if (!questionsData?.questions || !Array.isArray(questionsData.questions) || questionsData.questions.length === 0) {
      throw createError('Task does not have pending questions', 400);
    }

    // Verify task is on_hold with ASK action
    if (task.status !== 'on_hold' || output?.action !== 'ASK') {
      throw createError('Task is not waiting for question answers', 400);
    }

    const now = new Date();
    const actorId = req.user?.userId ? toObjectId(req.user.userId) : null;

    // Update the questions data with answers
    const updatedQuestionsData = {
      ...questionsData,
      answers,
      answeredAt: now.toISOString(),
      answeredById: actorId?.toString() || null,
    };

    // Update the task metadata
    const updatedOutput = {
      ...output,
      questions: updatedQuestionsData,
    };

    const updatedMetadata = {
      ...metadata,
      output: updatedOutput,
    };

    // Update task - set status back to pending so daemon can re-process
    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'pending',
          metadata: updatedMetadata,
          updatedAt: now,
        },
      }
    );

    // Get the updated task
    const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });

    // Add comment to activity feed
    const questionCount = questionsData.questions.length;
    const comment = `Answered ${questionCount} question${questionCount !== 1 ? 's' : ''} from agent. Task will resume processing.`;
    await activityLogService.addComment(taskId, comment, actorId, 'user');

    // Publish event
    if (updatedTask) {
      await publishTaskEvent('task.updated', updatedTask, {
        actorId,
        actorType: req.user ? 'user' : 'system',
        metadata: {
          action: 'answered_questions',
          previousStatus: 'on_hold',
          newStatus: 'pending',
        },
      });
    }

    res.json({
      success: true,
      message: 'Answers submitted successfully. Task will resume processing.',
      data: updatedTask,
    });
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
