import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { User, Team } from '../types/index.js';

export const usersRouter = Router();

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

// GET /api/users/:id - Get a specific user
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
usersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { email, displayName, role } = req.body;

    if (!email || !displayName) {
      throw createError('email and displayName are required', 400);
    }

    // Check for duplicate email
    const existing = await db.collection('users').findOne({ email });
    if (existing) {
      throw createError('User with this email already exists', 409);
    }

    const now = new Date();
    const newUser: Omit<User, '_id'> = {
      email,
      displayName,
      role: role || 'viewer',
      isActive: true,
      teamIds: [],
      preferences: {},
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<User>('users').insertOne(newUser as User);
    const inserted = await db.collection<User>('users').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/:id - Update a user
usersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.email; // Email shouldn't be changed
    delete updates.createdAt;
    updates.updatedAt = new Date();

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
usersRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = new ObjectId(req.params.id);

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

// ============================================================================
// Teams Routes
// ============================================================================

// GET /api/users/teams - Get all teams
usersRouter.get('/teams/list', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const teams = await db.collection<Team>('teams').find().sort({ name: 1 }).toArray();
    res.json({ data: teams });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/teams/:id - Get a specific team
usersRouter.get('/teams/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const teamId = new ObjectId(req.params.id);

    const team = await db.collection<Team>('teams').findOne({ _id: teamId });

    if (!team) {
      throw createError('Team not found', 404);
    }

    // Get team members
    const members = await db
      .collection<User>('users')
      .find({ _id: { $in: team.memberIds } })
      .toArray();

    res.json({ data: { ...team, members } });
  } catch (error) {
    next(error);
  }
});

// POST /api/users/teams - Create a new team
usersRouter.post('/teams', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, description, memberIds } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    // Check for duplicate name
    const existing = await db.collection('teams').findOne({ name });
    if (existing) {
      throw createError('Team with this name already exists', 409);
    }

    const now = new Date();
    const newTeam: Omit<Team, '_id'> = {
      name,
      description: description || '',
      memberIds: (memberIds || []).map((id: string) => new ObjectId(id)),
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<Team>('teams').insertOne(newTeam as Team);
    const inserted = await db.collection<Team>('teams').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/teams/:id - Update a team
usersRouter.patch('/teams/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const teamId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.createdAt;
    updates.updatedAt = new Date();

    if (updates.memberIds) {
      updates.memberIds = updates.memberIds.map((id: string) => new ObjectId(id));
    }

    const result = await db.collection<Team>('teams').findOneAndUpdate(
      { _id: teamId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Team not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/teams/:id - Delete a team
usersRouter.delete('/teams/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const teamId = new ObjectId(req.params.id);

    const result = await db.collection('teams').deleteOne({ _id: teamId });

    if (result.deletedCount === 0) {
      throw createError('Team not found', 404);
    }

    res.json({ success: true, message: 'Team deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/teams/:id/members - Update team members
usersRouter.put('/teams/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const teamId = new ObjectId(req.params.id);
    const { memberIds } = req.body;

    if (!Array.isArray(memberIds)) {
      throw createError('memberIds array is required', 400);
    }

    const objectIds = memberIds.map((id: string) => new ObjectId(id));

    const result = await db.collection<Team>('teams').findOneAndUpdate(
      { _id: teamId },
      { $set: { memberIds: objectIds, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Team not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});
