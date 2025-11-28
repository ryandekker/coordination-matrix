import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId, Filter, Sort, Document } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { ReferenceResolver } from '../services/reference-resolver.js';
import { Task, TaskWithChildren, PaginatedResponse } from '../types/index.js';

export const tasksRouter = Router();

// Helper to parse ObjectId safely
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// Helper to build filter from query params
function buildFilter(query: Record<string, unknown>): Filter<Task> {
  const filter: Filter<Task> = {};
  const { search, filters, parentId, rootOnly, hitlPending, status, priority, assigneeId, tags } = query;

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

  // Priority filter
  if (priority) {
    if (Array.isArray(priority)) {
      (filter as Record<string, unknown>).priority = { $in: priority };
    } else {
      (filter as Record<string, unknown>).priority = priority as string;
    }
  }

  // HITL pending filter
  if (hitlPending === 'true' || hitlPending === true) {
    filter.hitlRequired = true;
    filter.hitlStatus = { $in: ['pending', 'in_review'] };
  }

  // Assignee filter
  if (assigneeId) {
    filter.assigneeId = toObjectId(assigneeId as string);
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

    const filter = buildFilter(req.query as Record<string, unknown>);
    const sort: Sort = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    const [tasks, total] = await Promise.all([
      db.collection<Task>('tasks').find(filter).sort(sort).skip(skip).limit(limitNum).toArray(),
      db.collection<Task>('tasks').countDocuments(filter),
    ]);

    let resolvedTasks = tasks;
    if (resolveReferences === 'true') {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      resolvedTasks = await resolver.resolveDocuments(tasks);
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
      // Get specific tree
      const rootOid = toObjectId(rootId as string);
      filter = {
        $or: [{ _id: rootOid }, { rootId: rootOid }],
      };
    } else {
      // Get all root tasks and their children
      filter = {}; // Get all tasks, build tree in memory
    }

    const tasks = await db
      .collection<Task>('tasks')
      .find(filter)
      .sort({ depth: 1, createdAt: 1 })
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

// GET /api/tasks/:id/ancestors - Get all ancestors of a task
tasksRouter.get('/:id/ancestors', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { resolveReferences = 'true' } = req.query;

    const taskId = toObjectId(req.params.id);
    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });

    if (!task) {
      throw createError('Task not found', 404);
    }

    if (!task.path || task.path.length === 0) {
      res.json({ data: [] });
      return;
    }

    const ancestors = await db
      .collection<Task>('tasks')
      .find({ _id: { $in: task.path } })
      .toArray();

    // Sort by path order
    const pathOrder = new Map(task.path.map((id, index) => [id.toString(), index]));
    ancestors.sort((a, b) => {
      return (pathOrder.get(a._id.toString()) || 0) - (pathOrder.get(b._id.toString()) || 0);
    });

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

// POST /api/tasks - Create a new task
tasksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskData = req.body;

    // Validate required fields
    if (!taskData.title) {
      throw createError('Title is required', 400);
    }

    const now = new Date();
    const newTask: Omit<Task, '_id'> = {
      title: taskData.title,
      description: taskData.description || '',
      status: taskData.status || 'pending',
      priority: taskData.priority || 'medium',
      parentId: null,
      rootId: null,
      depth: 0,
      path: [],
      childCount: 0,
      hitlRequired: taskData.hitlRequired || false,
      hitlPhase: taskData.hitlPhase || 'none',
      hitlStatus: taskData.hitlRequired ? 'pending' : 'not_required',
      hitlAssigneeId: taskData.hitlAssigneeId ? toObjectId(taskData.hitlAssigneeId) : null,
      hitlNotes: taskData.hitlNotes || '',
      workflowId: taskData.workflowId ? toObjectId(taskData.workflowId) : null,
      workflowStepIndex: taskData.workflowStepIndex,
      externalJobId: taskData.externalJobId,
      externalJobStatus: taskData.externalJobStatus,
      assigneeId: taskData.assigneeId ? toObjectId(taskData.assigneeId) : null,
      createdById: taskData.createdById ? toObjectId(taskData.createdById) : null,
      teamId: taskData.teamId ? toObjectId(taskData.teamId) : null,
      metadata: taskData.metadata || {},
      tags: taskData.tags || [],
      createdAt: now,
      updatedAt: now,
      dueAt: taskData.dueAt ? new Date(taskData.dueAt) : null,
    };

    // Handle parent task relationship
    if (taskData.parentId) {
      const parentId = toObjectId(taskData.parentId);
      const parent = await db.collection<Task>('tasks').findOne({ _id: parentId });

      if (!parent) {
        throw createError('Parent task not found', 404);
      }

      newTask.parentId = parentId;
      newTask.rootId = parent.rootId || parent._id;
      newTask.depth = parent.depth + 1;
      newTask.path = [...parent.path, parentId];

      // Increment parent's child count
      await db.collection('tasks').updateOne(
        { _id: parentId },
        { $inc: { childCount: 1 }, $set: { updatedAt: now } }
      );
    }

    const result = await db.collection<Task>('tasks').insertOne(newTask as Task);
    const insertedTask = await db.collection<Task>('tasks').findOne({ _id: result.insertedId });

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

    // Remove fields that shouldn't be updated directly
    delete updates._id;
    delete updates.createdAt;
    delete updates.path;
    delete updates.depth;
    delete updates.rootId;
    delete updates.childCount;

    // Convert ID fields
    const idFields = ['parentId', 'assigneeId', 'createdById', 'teamId', 'hitlAssigneeId', 'workflowId'];
    for (const field of idFields) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] ? toObjectId(updates[field]) : null;
      }
    }

    // Convert date fields
    const dateFields = ['dueAt', 'startedAt', 'completedAt'];
    for (const field of dateFields) {
      if (updates[field] !== undefined) {
        updates[field] = updates[field] ? new Date(updates[field]) : null;
      }
    }

    updates.updatedAt = new Date();

    // Handle HITL status changes
    if (updates.hitlRequired === false) {
      updates.hitlStatus = 'not_required';
    }

    // Handle status changes
    if (updates.status === 'completed') {
      updates.completedAt = updates.completedAt || new Date();
    } else if (updates.status === 'in_progress' && !updates.startedAt) {
      updates.startedAt = new Date();
    }

    const result = await db.collection<Task>('tasks').findOneAndUpdate(
      { _id: taskId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Task not found', 404);
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
    const { newParentId } = req.body;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();
    let newPath: ObjectId[] = [];
    let newDepth = 0;
    let newRootId: ObjectId | null = null;
    let newParent: Task | null = null;

    if (newParentId) {
      const parentOid = toObjectId(newParentId);

      // Check for circular reference
      if (task.path && task.path.some((id) => id.equals(parentOid))) {
        throw createError('Cannot move task to one of its descendants', 400);
      }

      newParent = await db.collection<Task>('tasks').findOne({ _id: parentOid });
      if (!newParent) {
        throw createError('New parent task not found', 404);
      }

      newPath = [...newParent.path, parentOid];
      newDepth = newParent.depth + 1;
      newRootId = newParent.rootId || newParent._id;
    }

    // Update old parent's child count
    if (task.parentId) {
      await db.collection('tasks').updateOne(
        { _id: task.parentId },
        { $inc: { childCount: -1 }, $set: { updatedAt: now } }
      );
    }

    // Update new parent's child count
    if (newParent) {
      await db.collection('tasks').updateOne(
        { _id: newParent._id },
        { $inc: { childCount: 1 }, $set: { updatedAt: now } }
      );
    }

    // Update the task itself
    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: {
          parentId: newParent ? newParent._id : null,
          path: newPath,
          depth: newDepth,
          rootId: newRootId,
          updatedAt: now,
        },
      }
    );

    // Update all descendants' paths
    if (task.childCount > 0) {
      const descendants = await db
        .collection<Task>('tasks')
        .find({ path: taskId })
        .toArray();

      for (const desc of descendants) {
        const taskIndex = desc.path.findIndex((id) => id.equals(taskId));
        const newDescPath = [...newPath, taskId, ...desc.path.slice(taskIndex + 1)];
        const newDescDepth = newDepth + (desc.depth - task.depth);

        await db.collection('tasks').updateOne(
          { _id: desc._id },
          {
            $set: {
              path: newDescPath,
              depth: newDescDepth,
              rootId: newRootId || taskId,
              updatedAt: now,
            },
          }
        );
      }
    }

    const updatedTask = await db.collection<Task>('tasks').findOne({ _id: taskId });
    res.json({ data: updatedTask });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id - Delete a task
tasksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const taskId = toObjectId(req.params.id);
    const { deleteChildren = 'true' } = req.query;

    const task = await db.collection<Task>('tasks').findOne({ _id: taskId });
    if (!task) {
      throw createError('Task not found', 404);
    }

    const now = new Date();

    // Update parent's child count
    if (task.parentId) {
      await db.collection('tasks').updateOne(
        { _id: task.parentId },
        { $inc: { childCount: -1 }, $set: { updatedAt: now } }
      );
    }

    if (deleteChildren === 'true' && task.childCount > 0) {
      // Delete all descendants
      await db.collection('tasks').deleteMany({ path: taskId });
    } else if (task.childCount > 0) {
      // Move children up to parent
      await db.collection('tasks').updateMany(
        { parentId: taskId },
        {
          $set: {
            parentId: task.parentId,
            depth: task.depth,
            path: task.path,
            rootId: task.parentId ? task.rootId : null,
            updatedAt: now,
          },
        }
      );

      // Update parent's child count with new children
      if (task.parentId) {
        await db.collection('tasks').updateOne(
          { _id: task.parentId },
          { $inc: { childCount: task.childCount } }
        );
      }
    }

    // Delete the task
    await db.collection('tasks').deleteOne({ _id: taskId });

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
        // First, get all tasks to update parent counts
        const tasksToDelete = await db
          .collection<Task>('tasks')
          .find({ _id: { $in: objectIds } })
          .toArray();

        // Update parent counts
        const parentUpdates = new Map<string, number>();
        for (const task of tasksToDelete) {
          if (task.parentId) {
            const key = task.parentId.toString();
            parentUpdates.set(key, (parentUpdates.get(key) || 0) - 1);
          }
        }

        for (const [parentId, delta] of parentUpdates) {
          await db.collection('tasks').updateOne(
            { _id: new ObjectId(parentId) },
            { $inc: { childCount: delta }, $set: { updatedAt: now } }
          );
        }

        // Also delete children
        await db.collection('tasks').deleteMany({
          $or: [{ _id: { $in: objectIds } }, { path: { $in: objectIds } }],
        });

        result = { deletedCount: tasksToDelete.length };
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
function buildTaskTree(tasks: Task[], maxDepth: number): TaskWithChildren[] {
  const taskMap = new Map<string, TaskWithChildren>();
  const roots: TaskWithChildren[] = [];

  // First pass: create map
  for (const task of tasks) {
    taskMap.set(task._id.toString(), { ...task, children: [] });
  }

  // Second pass: build tree
  for (const task of tasks) {
    const taskNode = taskMap.get(task._id.toString())!;

    if (task.parentId && task.depth <= maxDepth) {
      const parent = taskMap.get(task.parentId.toString());
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(taskNode);
      } else {
        // Parent not in current result set, treat as root
        roots.push(taskNode);
      }
    } else if (!task.parentId) {
      roots.push(taskNode);
    }
  }

  return roots;
}
