import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { groupService } from '../services/group-service.js';
import { GroupRole, GROUP_ROLE_HIERARCHY, GroupMember } from '../types/index.js';
import { isAdmin } from './authorize.js';
import { createError } from './error-handler.js';

// Extend Express Request to include group context
declare global {
  namespace Express {
    interface Request {
      groupMembership?: GroupMember;
      userGroupIds?: ObjectId[];
    }
  }
}

/**
 * Extract group ID from various parts of the request
 */
function extractGroupId(req: Request): string | null {
  // From URL params (e.g., /api/groups/:groupId)
  if (req.params.groupId) {
    return req.params.groupId;
  }
  // From query params (e.g., ?groupId=xxx)
  if (typeof req.query.groupId === 'string') {
    return req.query.groupId;
  }
  // From request body
  if (req.body?.groupId) {
    return req.body.groupId;
  }
  return null;
}

/**
 * Middleware to require membership in a group with a minimum role.
 * Admins bypass group membership checks.
 *
 * @param minRole - Minimum role required within the group
 * @returns Express middleware
 *
 * @example
 * // Requires at least member role in the group
 * router.post('/projects', requireGroupAccess('member'), createProject);
 */
export function requireGroupAccess(minRole: GroupRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admins bypass group access checks
    if (isAdmin(req)) {
      next();
      return;
    }

    const groupId = extractGroupId(req);
    if (!groupId) {
      res.status(400).json({ error: 'Group ID required' });
      return;
    }

    try {
      // Check API key group scoping first
      if (req.apiKey?.groupId) {
        const apiKeyGroupId = req.apiKey.groupId.toString();
        if (apiKeyGroupId !== groupId) {
          res.status(403).json({
            error: 'API key is scoped to a different group',
          });
          return;
        }
      }

      const membership = await groupService.getMembership(groupId, req.user.userId);
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }

      if (GROUP_ROLE_HIERARCHY[membership.role] < GROUP_ROLE_HIERARCHY[minRole]) {
        res.status(403).json({
          error: `Requires at least ${minRole} role in this group`,
          currentRole: membership.role,
        });
        return;
      }

      // Attach membership to request for use in route handlers
      req.groupMembership = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to load user's group IDs into the request.
 * Useful for filtering queries by accessible groups.
 * Admins get all groups loaded.
 *
 * @returns Express middleware
 */
export function loadUserGroups() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next();
      return;
    }

    try {
      // Check API key group scoping
      if (req.apiKey?.groupId) {
        // API key is scoped to a single group
        req.userGroupIds = [req.apiKey.groupId as ObjectId];
      } else if (isAdmin(req)) {
        // Admins can see all groups - we'll handle this in the query building
        req.userGroupIds = undefined; // undefined means "all groups"
      } else {
        // Regular users - get their group memberships
        req.userGroupIds = await groupService.getUserGroupIds(req.user.userId);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Build a filter for querying resources with group access control.
 * Returns a filter that includes:
 * - Resources with no groupId (admin-only, returns empty for non-admins)
 * - Resources in groups the user is a member of
 *
 * @param req - Express request with loaded user groups
 * @param baseFilter - Optional base filter to extend
 * @returns MongoDB filter with group access conditions
 */
export function buildGroupAccessFilter(
  req: Request,
  baseFilter: Record<string, unknown> = {}
): Record<string, unknown> {
  // Admins see everything
  if (isAdmin(req)) {
    return baseFilter;
  }

  const userGroupIds = req.userGroupIds || [];

  // Non-admin users can only see resources in their groups
  // Resources with groupId: null are admin-only
  if (userGroupIds.length === 0) {
    // User has no group memberships - can't see anything with a group
    // Return a filter that matches nothing (impossible condition)
    return {
      ...baseFilter,
      _id: { $exists: false }, // This will never match anything
    };
  }

  return {
    ...baseFilter,
    groupId: { $in: userGroupIds },
  };
}

/**
 * Check if the user has access to a specific resource by its groupId.
 * Returns true if:
 * - User is an admin
 * - Resource has no groupId and user is admin
 * - Resource's groupId is in user's groups
 *
 * @param req - Express request with user info
 * @param resourceGroupId - The groupId of the resource (can be null)
 * @returns Whether the user has access
 */
export async function hasResourceAccess(
  req: Request,
  resourceGroupId: ObjectId | string | null | undefined
): Promise<boolean> {
  if (!req.user) {
    console.log('[hasResourceAccess] No user on request');
    return false;
  }

  // Admins can access everything
  if (isAdmin(req)) {
    console.log('[hasResourceAccess] User is admin, granting access');
    return true;
  }

  // Resources without a group are admin-only
  if (!resourceGroupId) {
    console.log('[hasResourceAccess] Resource has no group, denying non-admin');
    return false;
  }

  const groupIdStr = resourceGroupId.toString();

  // Check API key group scoping
  if (req.apiKey?.groupId) {
    const matches = req.apiKey.groupId.toString() === groupIdStr;
    console.log(`[hasResourceAccess] API key group scoping: apiKeyGroup=${req.apiKey.groupId}, resourceGroup=${groupIdStr}, matches=${matches}`);
    return matches;
  }

  // Check user group membership
  console.log(`[hasResourceAccess] Checking membership for user=${req.user.userId} in group=${groupIdStr}`);
  const membership = await groupService.getMembership(groupIdStr, req.user.userId);
  console.log(`[hasResourceAccess] Membership result: ${membership ? `role=${membership.role}` : 'null'}`);
  return membership !== null;
}

/**
 * Middleware to check access to a resource by its groupId.
 * Used for routes that operate on a single resource.
 *
 * @param getResourceGroupId - Function to extract the resource's groupId
 * @returns Express middleware
 *
 * @example
 * router.patch('/tasks/:id', requireResourceAccess(async (req) => {
 *   const task = await db.collection('tasks').findOne({ _id: new ObjectId(req.params.id) });
 *   return task?.groupId;
 * }), updateTask);
 */
export function requireResourceAccess(
  getResourceGroupId: (req: Request) => Promise<ObjectId | string | null | undefined>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const groupId = await getResourceGroupId(req);

      // Resource not found - let the route handler deal with 404
      if (groupId === undefined) {
        next();
        return;
      }

      const hasAccess = await hasResourceAccess(req, groupId);
      if (!hasAccess) {
        // If resource has no groupId and user is not admin
        if (!groupId) {
          res.status(403).json({
            error: 'This resource requires admin access',
          });
        } else {
          res.status(403).json({
            error: 'You do not have access to this group',
          });
        }
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate that a groupId is provided and the user has access to it.
 * For use in create operations where groupId is required.
 *
 * @param minRole - Minimum role required in the group (default: member)
 * @returns Express middleware
 */
export function requireGroupIdInBody(minRole: GroupRole = 'member') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const groupId = req.body?.groupId;

    // Admins can create resources without a groupId (admin-only resources)
    if (!groupId && isAdmin(req)) {
      next();
      return;
    }

    if (!groupId) {
      res.status(400).json({ error: 'groupId is required' });
      return;
    }

    // Check API key group scoping
    if (req.apiKey?.groupId) {
      if (req.apiKey.groupId.toString() !== groupId) {
        res.status(403).json({
          error: 'API key is scoped to a different group',
        });
        return;
      }
    }

    // Admins bypass membership checks
    if (isAdmin(req)) {
      next();
      return;
    }

    try {
      const membership = await groupService.getMembership(groupId, req.user.userId);
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }

      if (GROUP_ROLE_HIERARCHY[membership.role] < GROUP_ROLE_HIERARCHY[minRole]) {
        res.status(403).json({
          error: `Requires at least ${minRole} role to create resources in this group`,
          currentRole: membership.role,
        });
        return;
      }

      req.groupMembership = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Resolve a required groupId for resource creation.
 * Resolution priority:
 *   1. Explicit groupId from request body
 *   2. API key's scoped groupId
 *   3. User's sole group membership (if exactly one)
 *
 * Throws an informative 400 error if no groupId can be resolved.
 * Also validates that the user has access to the resolved group.
 *
 * @param req - Express request with user/auth info and loaded userGroupIds
 * @returns Resolved ObjectId for the group
 */
export async function resolveRequiredGroupId(req: Request): Promise<ObjectId> {
  const bodyGroupId = req.body?.groupId;

  // 1. Explicit groupId from body
  if (bodyGroupId && ObjectId.isValid(bodyGroupId)) {
    const groupId = new ObjectId(bodyGroupId);
    const hasAccess = await hasResourceAccess(req, groupId);
    if (!hasAccess) {
      throw createError('You do not have access to this group', 403);
    }
    return groupId;
  }

  // 2. API key scoped to a group
  if (req.apiKey?.groupId) {
    return new ObjectId(req.apiKey.groupId.toString());
  }

  // 3. User belongs to exactly one group
  const userGroups = req.userGroupIds
    || (req.user ? await groupService.getUserGroupIds(req.user.userId) : []);
  if (userGroups.length === 1) {
    return new ObjectId(userGroups[0].toString());
  }

  // Build informative error message
  const hints: string[] = [
    'Provide groupId in the request body',
  ];
  if (req.apiKey && !req.apiKey.groupId) {
    hints.push('scope your API key to a group');
  }
  if (userGroups.length > 1) {
    hints.push(`your account belongs to ${userGroups.length} groups — specify which one`);
  }

  throw createError(
    `groupId is required. ${hints.join(', or ')}.`,
    400
  );
}
