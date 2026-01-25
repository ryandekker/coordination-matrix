import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../middleware/authorize.js';
import { loadUserGroups } from '../middleware/group-access.js';
import { groupService } from '../services/group-service.js';
import { projectService } from '../services/project-service.js';
import { ProjectStatus } from '../types/index.js';
import { getDb } from '../db/connection.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/projects
 * List projects the current user has access to.
 * Optional query params:
 * - groupId: Filter by group
 * - status: Filter by status (active, archived)
 */
router.get('/', loadUserGroups(), async (req: Request, res: Response) => {
  try {
    const { groupId, status } = req.query;

    // Filter by specific group
    if (groupId && typeof groupId === 'string') {
      if (!ObjectId.isValid(groupId)) {
        res.status(400).json({ error: 'Invalid groupId' });
        return;
      }

      // Check access to the group
      if (!isAdmin(req)) {
        const membership = await groupService.getMembership(groupId, req.user!.userId);
        if (!membership) {
          res.status(403).json({ error: 'Not a member of this group' });
          return;
        }
      }

      const { projects, total } = await projectService.getProjectsByGroup(groupId, {
        status: status as ProjectStatus | undefined,
      });

      res.json({
        data: projects,
        pagination: { total },
      });
      return;
    }

    // Get projects across all user's groups
    if (isAdmin(req)) {
      // Admins see all projects - we'd need to query all, let's limit this
      const { groups } = await groupService.getAllGroups({ limit: 1000 });
      const groupIds = groups.map((g) => g._id.toString());
      const { projects, total } = await projectService.getProjectsByGroups(groupIds, {
        status: status as ProjectStatus | undefined,
      });

      res.json({
        data: projects,
        pagination: { total },
      });
    } else {
      const userGroups = await groupService.getUserGroups(req.user!.userId);
      const groupIds = userGroups.map((g) => g._id.toString());
      const { projects, total } = await projectService.getProjectsByGroups(groupIds, {
        status: status as ProjectStatus | undefined,
      });

      res.json({
        data: projects,
        pagination: { total },
      });
    }
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * POST /api/projects
 * Create a new project. Requires member role in the group.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, groupId, color } = req.body;

    if (!displayName) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }

    if (!groupId) {
      res.status(400).json({ error: 'groupId is required' });
      return;
    }

    if (!ObjectId.isValid(groupId)) {
      res.status(400).json({ error: 'Invalid groupId' });
      return;
    }

    // Check group access
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(groupId, req.user!.userId);
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
      if (membership.role === 'viewer') {
        res.status(403).json({ error: 'Viewers cannot create projects' });
        return;
      }
    }

    const project = await projectService.createProject(
      { name, displayName, description, groupId, color },
      req.user!.userId
    );

    res.status(201).json(project);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * GET /api/projects/stats
 * Get task counts per project for the current group.
 * Query params:
 * - groupId: Required - get stats for projects in this group
 */
router.get('/stats', loadUserGroups(), async (req: Request, res: Response) => {
  try {
    const { groupId } = req.query;

    if (!groupId || typeof groupId !== 'string') {
      res.status(400).json({ error: 'groupId is required' });
      return;
    }

    if (!ObjectId.isValid(groupId)) {
      res.status(400).json({ error: 'Invalid groupId' });
      return;
    }

    // Check access to the group
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(groupId, req.user!.userId);
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
    }

    const db = getDb();
    const tasksCollection = db.collection('tasks');

    // Aggregate task counts by projectId
    const pipeline = [
      {
        $match: {
          groupId: new ObjectId(groupId),
          projectId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$projectId',
          totalTasks: { $sum: 1 },
          pendingTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          inProgressTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] },
          },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
        },
      },
    ];

    const stats = await tasksCollection.aggregate(pipeline).toArray();

    // Convert to a map keyed by projectId
    const statsMap: Record<string, {
      totalTasks: number;
      pendingTasks: number;
      inProgressTasks: number;
      completedTasks: number;
    }> = {};

    for (const stat of stats) {
      statsMap[stat._id.toString()] = {
        totalTasks: stat.totalTasks,
        pendingTasks: stat.pendingTasks,
        inProgressTasks: stat.inProgressTasks,
        completedTasks: stat.completedTasks,
      };
    }

    res.json({ data: statsMap });
  } catch (error) {
    console.error('Error getting project stats:', error);
    res.status(500).json({ error: 'Failed to get project stats' });
  }
});

/**
 * GET /api/projects/:projectId
 * Get a specific project.
 */
router.get('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    if (!ObjectId.isValid(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const project = await projectService.getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check group access
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(
        project.groupId.toString(),
        req.user!.userId
      );
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
    }

    res.json(project);
  } catch (error) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * PATCH /api/projects/:projectId
 * Update a project. Requires member role in the group.
 */
router.patch('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { displayName, description, status, color } = req.body;

    if (!ObjectId.isValid(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const project = await projectService.getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check group access
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(
        project.groupId.toString(),
        req.user!.userId
      );
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
      if (membership.role === 'viewer') {
        res.status(403).json({ error: 'Viewers cannot update projects' });
        return;
      }
    }

    // Validate status if provided
    if (status && !['active', 'archived'].includes(status)) {
      res.status(400).json({ error: 'status must be active or archived' });
      return;
    }

    const updated = await projectService.updateProject(projectId, {
      displayName,
      description,
      status,
      color,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /api/projects/:projectId
 * Delete a project. Requires admin role in the group.
 */
router.delete('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    if (!ObjectId.isValid(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const project = await projectService.getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check group access - require admin role
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(
        project.groupId.toString(),
        req.user!.userId
      );
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        res.status(403).json({ error: 'Requires admin role to delete projects' });
        return;
      }
    }

    const deleted = await projectService.deleteProject(projectId);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
