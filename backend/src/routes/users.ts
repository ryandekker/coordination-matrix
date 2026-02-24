import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { User } from '../types/index.js';
import { requireRole, isAdmin } from '../middleware/authorize.js';

export const usersRouter = Router();

/**
 * Helper to check if user can modify another user.
 * - Admins can modify anyone
 * - Users can only modify themselves
 * - Users cannot change their own role
 */
function canModifyUser(req: Request, targetUserId: string): { allowed: boolean; selfUpdate: boolean } {
  if (!req.user) {
    return { allowed: false, selfUpdate: false };
  }

  const selfUpdate = req.user.userId === targetUserId;

  // Admins can modify anyone
  if (isAdmin(req)) {
    return { allowed: true, selfUpdate };
  }

  // Users can only modify themselves
  return { allowed: selfUpdate, selfUpdate };
}

// GET /api/users - Get all users
usersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { isActive, role, search } = req.query;

    const filter: Record<string, unknown> = {};

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    if (role) {
      filter.role = role;
    }

    if (search && typeof search === 'string') {
      filter.$or = [
        { displayName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await db
      .collection<User>('users')
      .find(filter)
      .sort({ displayName: 1 })
      .toArray();

    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/agents - Get all agent users
usersRouter.get('/agents', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const agents = await db
      .collection<User>('users')
      .find({ isAgent: true, isActive: true })
      .sort({ displayName: 1 })
      .toArray();

    res.json({ data: agents });
  } catch (error) {
    next(error);
  }
});

// POST /api/users/agents/ensure/:agentId - Get or create a default agent by ID
// Used by workflows to reference agents that may not exist yet
usersRouter.post('/agents/ensure/:agentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { agentId } = req.params;

    // Try to find existing agent by ID or displayName
    const orConditions: Record<string, unknown>[] = [
      { displayName: agentId, isAgent: true },
    ];
    if (ObjectId.isValid(agentId)) {
      orConditions.unshift({ _id: new ObjectId(agentId) });
    }
    let agent = await db.collection<User>('users').findOne({
      $or: orConditions,
    });

    if (!agent) {
      // Create default agent
      // Convert agentId to display name: "code-reviewer" -> "Code Reviewer"
      const displayName = agentId
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      const now = new Date();
      const newAgent: Omit<User, '_id'> = {
        displayName,
        role: 'operator',
        isActive: true,
        isAgent: true,
        agentPrompt: '', // Empty - uses base daemon prompt only
        preferences: {},
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection<User>('users').insertOne(newAgent as User);
      agent = await db.collection<User>('users').findOne({ _id: result.insertedId });
    }

    res.json({ data: agent });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id - Get a specific user
// Note: API keys with a linked userId can always access their own user data,
// even without users:read scope. This enables daemon agents to fetch their own
// agentPrompt without requiring elevated permissions.
usersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = new ObjectId(req.params.id);

    const user = await db.collection<User>('users').findOne({ _id: userId });

    if (!user) {
      throw createError('User not found', 404);
    }

    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

// POST /api/users - Create a new user
// Only admins can create users.
usersRouter.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { email, displayName, role, isAgent, isSystem, agentPrompt, agentComplexity, profilePicture, botColor } = req.body;

    if (!displayName) {
      throw createError('displayName is required', 400);
    }

    // Email is required for non-agent, non-system users
    if (!isAgent && !isSystem && !email) {
      throw createError('email is required for non-agent users', 400);
    }

    // Check for duplicate email (only if email provided)
    if (email) {
      const existing = await db.collection('users').findOne({ email });
      if (existing) {
        throw createError('User with this email already exists', 409);
      }
    }

    const now = new Date();
    const newUser: Omit<User, '_id'> = {
      displayName,
      role: role || 'viewer',
      isActive: true,
      preferences: {},
      createdAt: now,
      updatedAt: now,
    };

    // Only set email if provided
    if (email) {
      newUser.email = email;
    }

    // Set profile picture for human users
    if (profilePicture && !isAgent) {
      newUser.profilePicture = profilePicture;
    }

    // Set agent fields if this is an agent user
    if (isAgent) {
      newUser.isAgent = true;
      if (agentPrompt) {
        newUser.agentPrompt = agentPrompt;
      }
      // Set agent complexity (1=basic/haiku, 2=intermediate/sonnet, 3=advanced/opus)
      if (agentComplexity && [1, 2, 3].includes(agentComplexity)) {
        newUser.agentComplexity = agentComplexity;
      } else {
        newUser.agentComplexity = 2; // Default to intermediate
      }
      // Set bot color for agent users
      if (botColor) {
        newUser.botColor = botColor;
      }
    }

    // Set system user fields
    if (isSystem) {
      newUser.isSystem = true;
      // System users can have a custom color
      if (botColor) {
        newUser.botColor = botColor;
      }
    }

    const result = await db.collection<User>('users').insertOne(newUser as User);
    const inserted = await db.collection<User>('users').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/:id - Update a user
// Users can update themselves. Admins can update anyone.
// Only admins can change user roles.
usersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = new ObjectId(req.params.id);
    const updates = req.body;

    // Check authorization
    const { allowed } = canModifyUser(req, req.params.id);
    if (!allowed) {
      throw createError('You do not have permission to update this user', 403);
    }

    delete updates._id;
    delete updates.email; // Email shouldn't be changed after creation
    delete updates.createdAt;
    updates.updatedAt = new Date();

    // Only admins can change roles
    if (updates.role !== undefined && !isAdmin(req)) {
      throw createError('Only admins can change user roles', 403);
    }

    // Only admins can change isActive status
    if (updates.isActive !== undefined && !isAdmin(req)) {
      throw createError('Only admins can change user active status', 403);
    }

    // Handle agent-specific fields
    // isAgent, agentPrompt, agentComplexity, and botColor can be updated
    // If isAgent is being set to false/undefined, clear agent fields
    if (updates.isAgent === false) {
      updates.agentPrompt = null;
      updates.agentComplexity = null;
      updates.botColor = null;
    }
    // If isAgent is being set to true, clear human-specific fields
    if (updates.isAgent === true) {
      updates.profilePicture = null;
      // Set default complexity if not provided
      if (!updates.agentComplexity) {
        updates.agentComplexity = 2; // Default to intermediate
      }
    }
    // Validate agentComplexity if provided
    if (updates.agentComplexity !== undefined && updates.agentComplexity !== null) {
      if (![1, 2, 3].includes(updates.agentComplexity)) {
        throw createError('agentComplexity must be 1, 2, or 3', 400);
      }
    }

    const result = await db.collection<User>('users').findOneAndUpdate(
      { _id: userId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('User not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id - Deactivate a user
// Only admins can deactivate users.
usersRouter.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = new ObjectId(req.params.id);

    // Prevent admin from deactivating themselves
    if (req.user?.userId === req.params.id) {
      throw createError('You cannot deactivate your own account', 400);
    }

    const result = await db.collection<User>('users').findOneAndUpdate(
      { _id: userId },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('User not found', 404);
    }

    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    next(error);
  }
});

// Note: Teams functionality has been replaced by Groups.
// See /api/groups for group-based access control.
