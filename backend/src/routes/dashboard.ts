import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId, Filter } from 'mongodb';
import { getDb } from '../db/connection.js';
import { ReferenceResolver } from '../services/reference-resolver.js';
import { Task } from '../types/index.js';
import { loadUserGroups } from '../middleware/group-access.js';
import { isAdmin } from '../middleware/authorize.js';

export const dashboardRouter = Router();

// Apply group loading middleware to all routes
dashboardRouter.use(loadUserGroups());

// GET /api/dashboard/kanban - Get tasks grouped into kanban columns for human-focused task management
dashboardRouter.get('/kanban', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { groupId, projectId } = req.query;

    // Build base filter: exclude archived tasks
    const baseFilter: Filter<Task> = {
      status: { $ne: 'archived' as Task['status'] },
    };

    // Apply group/project filtering
    if (groupId) {
      baseFilter.groupId = new ObjectId(groupId as string);
    } else if (req.userGroupIds && !isAdmin(req)) {
      if (req.userGroupIds.length === 0) {
        // User has no group memberships - return empty result
        res.json({
          columns: {
            needs_attention: { name: 'Needs Attention', tasks: [], count: 0 },
            questions: { name: 'Questions', tasks: [], count: 0 },
            pending: { name: 'Pending', tasks: [], count: 0 },
            in_progress: { name: 'In Progress', tasks: [], count: 0 },
            review: { name: 'Review', tasks: [], count: 0 },
            done_recent: { name: 'Done', tasks: [], count: 0 },
          },
          stats: {
            totalNeedingAttention: 0,
            questionsWaiting: 0,
            escalatedCount: 0,
          },
        });
        return;
      }
      baseFilter.groupId = { $in: req.userGroupIds };
    }

    if (projectId) {
      baseFilter.projectId = new ObjectId(projectId as string);
    }

    // Get human user IDs (not agent, not system, active)
    const humanUsers = await db.collection('users').find({
      isAgent: { $ne: true },
      isSystem: { $ne: true },
      isActive: true,
    }, { projection: { _id: 1 } }).toArray();

    const humanUserIds = humanUsers.map(u => u._id);

    // Get agent user IDs (for "in_progress" column - agent-assigned tasks)
    const agentUsers = await db.collection('users').find({
      isAgent: true,
      isActive: true,
    }, { projection: { _id: 1 } }).toArray();
    const agentUserIds = agentUsers.map(u => u._id);

    const sortAndLimit = { sort: { updatedAt: -1 } as const, limit: 50 };
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Run all 6 column queries in parallel
    const [
      needsAttentionTasks,
      questionsTasks,
      pendingTasks,
      inProgressTasks,
      reviewTasks,
      doneRecentTasks,
    ] = await Promise.all([
      // 1. needs_attention: escalated tasks OR on_hold tasks assigned to a human user
      db.collection<Task>('tasks').find({
        ...baseFilter,
        status: 'on_hold' as Task['status'],
        $or: [
          { tags: 'escalated' },
          { assigneeId: { $in: humanUserIds } },
        ],
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),

      // 2. questions: on_hold tasks with unanswered pending questions
      db.collection<Task>('tasks').find({
        ...baseFilter,
        status: 'on_hold' as Task['status'],
        'metadata.pendingQuestions': {
          $elemMatch: {
            answer: { $in: [null, '', undefined] },
          },
        },
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),

      // 3. pending: tasks with status pending, assigned to human or unassigned with creatorType human
      db.collection<Task>('tasks').find({
        ...baseFilter,
        status: 'pending' as Task['status'],
        $or: [
          { assigneeId: { $in: humanUserIds } },
          { assigneeId: null, creatorType: 'human' },
          { assigneeId: { $exists: false }, creatorType: 'human' },
        ],
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),

      // 4. in_progress: tasks actively being worked on (by humans or agents)
      db.collection<Task>('tasks').find({
        ...baseFilter,
        $or: [
          // Human-created tasks assigned to an agent (any active status)
          { creatorType: 'human', status: { $in: ['pending', 'in_progress', 'waiting'] as Task['status'][] }, assigneeId: { $in: agentUserIds } },
          // Tasks in progress assigned to a human
          { status: 'in_progress' as Task['status'], assigneeId: { $in: humanUserIds } },
        ],
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),

      // 5. review: tasks with status waiting assigned to a human user
      db.collection<Task>('tasks').find({
        ...baseFilter,
        status: 'waiting' as Task['status'],
        assigneeId: { $in: humanUserIds },
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),

      // 6. done: completed human-relevant tasks
      //    Human-created root tasks persist until archived (no time limit).
      //    Other human-assigned completions limited to last 24h.
      db.collection<Task>('tasks').find({
        ...baseFilter,
        status: 'completed' as Task['status'],
        $or: [
          { creatorType: 'human', parentId: null },
          { updatedAt: { $gte: twentyFourHoursAgo }, assigneeId: { $in: humanUserIds } },
        ],
      }).sort(sortAndLimit.sort).limit(sortAndLimit.limit).toArray(),
    ]);

    // Resolve references for all tasks
    const allTasks = [
      ...needsAttentionTasks,
      ...questionsTasks,
      ...pendingTasks,
      ...inProgressTasks,
      ...reviewTasks,
      ...doneRecentTasks,
    ];

    const resolvedMap = new Map<string, Task>();
    if (allTasks.length > 0) {
      const resolver = new ReferenceResolver();
      await resolver.loadFieldConfigs('tasks');
      const resolvedTasks = await resolver.resolveDocuments(allTasks);
      resolvedTasks.forEach((task: Task) => {
        resolvedMap.set(task._id.toString(), task);
      });
    }

    const resolve = (tasks: Task[]): Task[] =>
      tasks.map(t => resolvedMap.get(t._id.toString()) || t);

    // Count escalated tasks specifically for stats
    const escalatedCount = needsAttentionTasks.filter(
      t => t.tags?.includes('escalated')
    ).length;

    res.json({
      columns: {
        needs_attention: {
          name: 'Needs Attention',
          tasks: resolve(needsAttentionTasks),
          count: needsAttentionTasks.length,
        },
        questions: {
          name: 'Questions',
          tasks: resolve(questionsTasks),
          count: questionsTasks.length,
        },
        pending: {
          name: 'Pending',
          tasks: resolve(pendingTasks),
          count: pendingTasks.length,
        },
        in_progress: {
          name: 'In Progress',
          tasks: resolve(inProgressTasks),
          count: inProgressTasks.length,
        },
        review: {
          name: 'Review',
          tasks: resolve(reviewTasks),
          count: reviewTasks.length,
        },
        done_recent: {
          name: 'Done',
          tasks: resolve(doneRecentTasks),
          count: doneRecentTasks.length,
        },
      },
      stats: {
        totalNeedingAttention: needsAttentionTasks.length,
        questionsWaiting: questionsTasks.length,
        escalatedCount,
      },
    });
  } catch (error) {
    next(error);
  }
});
