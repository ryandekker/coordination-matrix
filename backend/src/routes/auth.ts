import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { generateToken, requireAuth } from '../middleware/auth.js';
import { ObjectId } from 'mongodb';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid email or password format' });
      return;
    }

    const { email, password } = validation.data;
    const db = getDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.passwordHash) {
      res.status(401).json({ error: 'Account not set up for password login' });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({ error: 'Account is disabled' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } }
    );

    const token = generateToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role || 'viewer',
    });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        role: user.role || 'viewer',
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/register - Only allowed if no users exist (first user setup)
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDb();
    const usersCollection = db.collection('users');

    // Check if any users with passwords exist
    const existingUsers = await usersCollection.countDocuments({ passwordHash: { $exists: true } });

    if (existingUsers > 0) {
      res.status(403).json({ error: 'Registration is disabled. Contact an admin to create your account.' });
      return;
    }

    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error.errors[0].message });
      return;
    }

    const { email, password, displayName } = validation.data;

    // Check if email already exists
    const existingEmail = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await usersCollection.insertOne({
      email: email.toLowerCase(),
      displayName,
      passwordHash,
      role: 'admin', // First user is admin
      isActive: true,
      isAgent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken({
      userId: result.insertedId.toString(),
      email: email.toLowerCase(),
      role: 'admin',
    });

    res.status(201).json({
      token,
      user: {
        id: result.insertedId.toString(),
        email: email.toLowerCase(),
        displayName,
        role: 'admin',
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { passwordHash: 0 } }
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id.toString(),
      email: user.email,
      displayName: user.displayName,
      role: user.role || 'viewer',
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error.errors[0].message });
      return;
    }

    const { currentPassword, newPassword } = validation.data;
    const db = getDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user!.userId) });

    if (!user || !user.passwordHash) {
      res.status(400).json({ error: 'Cannot change password' });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { passwordHash: newPasswordHash, updatedAt: new Date() } }
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/auth/status - Check if setup is required
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getDb();
    const usersCollection = db.collection('users');

    const userCount = await usersCollection.countDocuments({ passwordHash: { $exists: true } });

    res.json({
      setupRequired: userCount === 0,
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// POST /api/auth/dev-login - Development-only passwordless login
// Only available when NODE_ENV !== 'production'
const devLoginSchema = z.object({
  email: z.string().email(),
});

router.post('/dev-login', async (req: Request, res: Response): Promise<void> => {
  try {
    // Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Dev login is not available in production' });
      return;
    }

    const validation = devLoginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const { email } = validation.data;
    const db = getDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({ error: 'Account is disabled' });
      return;
    }

    // Update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } }
    );

    const token = generateToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role || 'viewer',
    });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        role: user.role || 'viewer',
      },
    });
  } catch (error) {
    console.error('Dev login error:', error);
    res.status(500).json({ error: 'Dev login failed' });
  }
});

export { router as authRouter };
