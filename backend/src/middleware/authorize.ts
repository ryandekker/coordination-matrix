import { Request, Response, NextFunction } from 'express';

/**
 * Role hierarchy for the application.
 * Higher roles inherit permissions from lower roles.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  reviewer: 2,
  operator: 3,
  api: 3, // API keys have operator-level access by default
  admin: 4,
};

/**
 * Middleware to require specific roles for route access.
 * Checks if the authenticated user has one of the allowed roles.
 *
 * @param allowedRoles - Roles that are permitted to access the route
 * @returns Express middleware
 *
 * @example
 * // Only admins can access
 * router.delete('/users/:id', requireRole('admin'), deleteUser);
 *
 * // Admins and operators can access
 * router.post('/tasks', requireRole('admin', 'operator'), createTask);
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRole = req.user.role;

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require minimum role level (using hierarchy).
 * Users with higher-level roles can access lower-level resources.
 *
 * @param minRole - Minimum role required
 * @returns Express middleware
 *
 * @example
 * // Operators and above can access
 * router.post('/tasks', requireMinRole('operator'), createTask);
 */
export function requireMinRole(minRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

    if (userRoleLevel < requiredLevel) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires at least ${minRole} role`,
      });
      return;
    }

    next();
  };
}

/**
 * Scope definitions for API key access control.
 * Format: 'resource:action' (e.g., 'tasks:read', 'tasks:write')
 */
export const SCOPES = {
  // Task scopes
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  TASKS_DELETE: 'tasks:delete',

  // User scopes
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',

  // Workflow scopes
  WORKFLOWS_READ: 'workflows:read',
  WORKFLOWS_WRITE: 'workflows:write',
  WORKFLOWS_EXECUTE: 'workflows:execute',

  // View/saved search scopes
  VIEWS_READ: 'saved-searches:read',
  VIEWS_WRITE: 'saved-searches:write',

  // Document scopes
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_WRITE: 'documents:write',

  // Webhook scopes
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',

  // API key management (admin only)
  API_KEYS_READ: 'api-keys:read',
  API_KEYS_WRITE: 'api-keys:write',

  // Admin scopes
  ADMIN: 'admin:*',
} as const;

/**
 * Scope definitions with metadata for UI display.
 * Single source of truth for available API key scopes.
 */
export const SCOPE_DEFINITIONS = [
  // Task scopes
  { value: 'tasks:read', label: 'Read Tasks', description: 'View tasks and task details', category: 'Tasks' },
  { value: 'tasks:write', label: 'Write Tasks', description: 'Create and update tasks', category: 'Tasks' },
  { value: 'tasks:delete', label: 'Delete Tasks', description: 'Delete tasks', category: 'Tasks' },

  // User scopes
  { value: 'users:read', label: 'Read Users', description: 'View user information', category: 'Users' },
  { value: 'users:write', label: 'Write Users', description: 'Create and update users', category: 'Users' },
  { value: 'users:delete', label: 'Delete Users', description: 'Delete users', category: 'Users' },

  // Workflow scopes
  { value: 'workflows:read', label: 'Read Workflows', description: 'View workflows and workflow runs', category: 'Workflows' },
  { value: 'workflows:write', label: 'Write Workflows', description: 'Create and update workflows', category: 'Workflows' },
  { value: 'workflows:execute', label: 'Execute Workflows', description: 'Start and manage workflow runs', category: 'Workflows' },

  // View/saved search scopes
  { value: 'saved-searches:read', label: 'Read Saved Searches', description: 'Access saved searches/views', category: 'Views' },
  { value: 'saved-searches:write', label: 'Write Saved Searches', description: 'Create and modify saved searches', category: 'Views' },

  // Document scopes
  { value: 'documents:read', label: 'Read Documents', description: 'View documents and attachments', category: 'Documents' },
  { value: 'documents:write', label: 'Write Documents', description: 'Upload and modify documents', category: 'Documents' },

  // Webhook scopes
  { value: 'webhooks:read', label: 'Read Webhooks', description: 'View webhook configurations', category: 'Webhooks' },
  { value: 'webhooks:write', label: 'Write Webhooks', description: 'Create and update webhooks', category: 'Webhooks' },

  // API key management (typically admin only)
  { value: 'api-keys:read', label: 'Read API Keys', description: 'View API key information', category: 'API Keys' },
  { value: 'api-keys:write', label: 'Write API Keys', description: 'Create and manage API keys', category: 'API Keys' },

  // Admin scope
  { value: 'admin:*', label: 'Admin (All Access)', description: 'Full administrative access to all resources', category: 'Admin' },
] as const;

export type ScopeDefinition = (typeof SCOPE_DEFINITIONS)[number];

/**
 * Middleware to require specific scopes for API key access.
 * If the request is authenticated via API key, checks that the key has the required scopes.
 * If authenticated via JWT (user token), this check is bypassed (users have implicit full access
 * based on their role).
 *
 * @param requiredScopes - Scopes required to access the route
 * @returns Express middleware
 *
 * @example
 * // Requires tasks:read scope for API keys
 * router.get('/tasks', requireScope('tasks:read'), listTasks);
 *
 * // Requires multiple scopes
 * router.post('/tasks', requireScope('tasks:read', 'tasks:write'), createTask);
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If not authenticated via API key, skip scope check (JWT users use role-based access)
    if (!req.apiKey) {
      next();
      return;
    }

    const keyScopes = req.apiKey.scopes || [];

    // Check if the API key has admin scope or wildcard (grants all access)
    if (keyScopes.includes(SCOPES.ADMIN) || keyScopes.includes('*')) {
      next();
      return;
    }

    // Check for wildcard scopes (e.g., 'tasks:*' grants all task operations)
    const hasAllRequired = requiredScopes.every(required => {
      // Direct match
      if (keyScopes.includes(required)) {
        return true;
      }

      // Wildcard match (e.g., 'tasks:*' matches 'tasks:read')
      const [resource] = required.split(':');
      if (keyScopes.includes(`${resource}:*`)) {
        return true;
      }

      return false;
    });

    if (!hasAllRequired) {
      res.status(403).json({
        error: 'Insufficient API key scopes',
        required: requiredScopes,
        available: keyScopes,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require either specific roles OR specific scopes.
 * Useful for routes that can be accessed by both users and API keys with different requirements.
 *
 * @param options - Role and scope requirements
 * @returns Express middleware
 */
export function requireRoleOrScope(options: {
  roles?: string[];
  scopes?: string[];
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check role first (for JWT users)
    if (options.roles && options.roles.includes(req.user.role)) {
      next();
      return;
    }

    // Check scopes (for API key users)
    if (req.apiKey && options.scopes) {
      const keyScopes = req.apiKey.scopes || [];

      if (keyScopes.includes(SCOPES.ADMIN) || keyScopes.includes('*')) {
        next();
        return;
      }

      const hasRequiredScopes = options.scopes.every(required => {
        if (keyScopes.includes(required)) return true;
        const [resource] = required.split(':');
        return keyScopes.includes(`${resource}:*`);
      });

      if (hasRequiredScopes) {
        next();
        return;
      }
    }

    res.status(403).json({
      error: 'Forbidden',
      message: 'Insufficient permissions for this action',
    });
  };
}

/**
 * Middleware to check resource ownership.
 * Allows access if the user owns the resource OR has admin role.
 * Must be used after requireAuth middleware.
 *
 * @param getOwnerId - Function to extract owner ID from request (async supported)
 * @returns Express middleware
 *
 * @example
 * // Check if user owns the API key being modified
 * router.patch('/api-keys/:id', requireOwnership(async (req) => {
 *   const key = await db.collection('api_keys').findOne({ _id: new ObjectId(req.params.id) });
 *   return key?.createdById?.toString();
 * }), updateApiKey);
 */
export function requireOwnership(
  getOwnerId: (req: Request) => Promise<string | null | undefined> | string | null | undefined
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admins can access any resource
    if (req.user.role === 'admin') {
      next();
      return;
    }

    try {
      const ownerId = await getOwnerId(req);

      if (!ownerId) {
        // Resource not found or no owner - let the route handler deal with 404
        next();
        return;
      }

      if (ownerId !== req.user.userId) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check if user is admin (utility function for use in route handlers).
 */
export function isAdmin(req: Request): boolean {
  return req.user?.role === 'admin';
}

/**
 * Check if user has minimum role level (utility function for use in route handlers).
 */
export function hasMinRole(req: Request, minRole: string): boolean {
  if (!req.user) return false;
  const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
  return userRoleLevel >= requiredLevel;
}
