import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole, isAdmin } from '../middleware/authorize.js';
import { requireGroupAccess } from '../middleware/group-access.js';
import { groupService } from '../services/group-service.js';
import { GroupRole } from '../types/index.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/groups
 * List groups the current user is a member of.
 * Admins can see all groups with ?all=true
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const showAll = req.query.all === 'true' && isAdmin(req);
    const visibility = req.query.visibility as 'private' | 'internal' | undefined;

    if (showAll) {
      const { groups, total } = await groupService.getAllGroups({ visibility });
      res.json({
        data: groups,
        pagination: { total },
      });
    } else {
      const groups = await groupService.getUserGroups(req.user!.userId);
      res.json({
        data: groups,
        pagination: { total: groups.length },
      });
    }
  } catch (error) {
    console.error('Error listing groups:', error);
    res.status(500).json({ error: 'Failed to list groups' });
  }
});

/**
 * POST /api/groups
 * Create a new group. User becomes the owner.
 */
router.post('/', requireMinRole('operator'), async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, visibility } = req.body;

    if (!displayName) {
      res.status(400).json({ error: 'displayName is required' });
      return;
    }

    const group = await groupService.createGroup(
      { name, displayName, description, visibility },
      req.user!.userId
    );

    res.status(201).json(group);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/**
 * GET /api/groups/:groupId
 * Get a specific group. Must be a member or admin.
 */
router.get('/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    if (!ObjectId.isValid(groupId)) {
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }

    const group = await groupService.getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Check access
    if (!isAdmin(req)) {
      const membership = await groupService.getMembership(groupId, req.user!.userId);
      if (!membership && group.visibility !== 'internal') {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
    }

    res.json(group);
  } catch (error) {
    console.error('Error getting group:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
});

/**
 * PATCH /api/groups/:groupId
 * Update a group. Requires admin role in the group.
 */
router.patch(
  '/:groupId',
  requireGroupAccess('admin'),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { displayName, description, visibility } = req.body;

      const group = await groupService.updateGroup(groupId, {
        displayName,
        description,
        visibility,
      });

      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.json(group);
    } catch (error) {
      console.error('Error updating group:', error);
      res.status(500).json({ error: 'Failed to update group' });
    }
  }
);

/**
 * DELETE /api/groups/:groupId
 * Delete a group. Requires owner role in the group.
 */
router.delete(
  '/:groupId',
  requireGroupAccess('owner'),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;

      const deleted = await groupService.deleteGroup(groupId);
      if (!deleted) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting group:', error);
      res.status(500).json({ error: 'Failed to delete group' });
    }
  }
);

/**
 * GET /api/groups/:groupId/members
 * List members of a group.
 */
router.get(
  '/:groupId/members',
  requireGroupAccess('viewer'),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;

      const group = await groupService.getGroupById(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.json({
        data: group.members,
        pagination: { total: group.members.length },
      });
    } catch (error) {
      console.error('Error listing members:', error);
      res.status(500).json({ error: 'Failed to list members' });
    }
  }
);

/**
 * POST /api/groups/:groupId/members
 * Add a member to a group. Requires admin role.
 */
router.post(
  '/:groupId/members',
  requireGroupAccess('admin'),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { userId, role } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      if (!ObjectId.isValid(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }

      const validRoles: GroupRole[] = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
        return;
      }

      // Non-owners can't add owners
      if (role === 'owner' && req.groupMembership?.role !== 'owner' && !isAdmin(req)) {
        res.status(403).json({ error: 'Only owners can add other owners' });
        return;
      }

      const group = await groupService.addMember(
        groupId,
        { userId, role },
        req.user!.userId
      );

      res.status(201).json(group);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already a member')) {
        res.status(409).json({ error: error.message });
        return;
      }
      console.error('Error adding member:', error);
      res.status(500).json({ error: 'Failed to add member' });
    }
  }
);

/**
 * PATCH /api/groups/:groupId/members/:userId
 * Update a member's role. Requires admin role.
 */
router.patch(
  '/:groupId/members/:userId',
  requireGroupAccess('admin'),
  async (req: Request, res: Response) => {
    try {
      const { groupId, userId } = req.params;
      const { role } = req.body;

      if (!ObjectId.isValid(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }

      const validRoles: GroupRole[] = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
        return;
      }

      // Get current membership of the target user
      const targetMembership = await groupService.getMembership(groupId, userId);
      if (!targetMembership) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Non-owners can't modify owners
      if (
        targetMembership.role === 'owner' &&
        req.groupMembership?.role !== 'owner' &&
        !isAdmin(req)
      ) {
        res.status(403).json({ error: 'Only owners can modify other owners' });
        return;
      }

      // Non-owners can't promote to owner
      if (role === 'owner' && req.groupMembership?.role !== 'owner' && !isAdmin(req)) {
        res.status(403).json({ error: 'Only owners can promote to owner' });
        return;
      }

      const group = await groupService.updateMemberRole(groupId, userId, role);

      if (!group) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      res.json(group);
    } catch (error) {
      console.error('Error updating member:', error);
      res.status(500).json({ error: 'Failed to update member' });
    }
  }
);

/**
 * DELETE /api/groups/:groupId/members/:userId
 * Remove a member from a group. Requires admin role.
 */
router.delete(
  '/:groupId/members/:userId',
  requireGroupAccess('admin'),
  async (req: Request, res: Response) => {
    try {
      const { groupId, userId } = req.params;

      if (!ObjectId.isValid(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }

      // Get current membership of the target user
      const targetMembership = await groupService.getMembership(groupId, userId);
      if (!targetMembership) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Non-owners can't remove owners
      if (
        targetMembership.role === 'owner' &&
        req.groupMembership?.role !== 'owner' &&
        !isAdmin(req)
      ) {
        res.status(403).json({ error: 'Only owners can remove other owners' });
        return;
      }

      // Prevent removing the last owner
      if (targetMembership.role === 'owner') {
        const owners = await groupService.getOwners(groupId);
        if (owners.length === 1) {
          res.status(400).json({
            error: 'Cannot remove the last owner. Transfer ownership first.',
          });
          return;
        }
      }

      const group = await groupService.removeMember(groupId, userId);

      if (!group) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error removing member:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

export default router;
