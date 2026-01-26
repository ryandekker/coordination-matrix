import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { generateToken, requireAuth } from '../middleware/auth.js';
import { ObjectId } from 'mongodb';
import {
  loginRateLimiter,
  registrationRateLimiter,
  passwordChangeRateLimiter,
} from '../middleware/rate-limit.js';
import { groupService } from '../services/group-service.js';
import { projectService } from '../services/project-service.js';

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
// Rate limited: 5 attempts per 15 minutes per IP+email combination
router.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
// Rate limited: 3 attempts per hour per IP
router.post('/register', registrationRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
// Rate limited: 5 attempts per hour per user
router.post('/change-password', requireAuth, passwordChangeRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
// Rate limited like regular login to prevent abuse
const devLoginSchema = z.object({
  email: z.string().email(),
});

router.post('/dev-login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    // Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Dev login is not available in production' });
      return;
    }

    console.warn(`[SECURITY] Dev login used for email: ${req.body?.email} from IP: ${req.ip}`);

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

// POST /api/auth/provision - Provision a new user from SSO
// This endpoint is called by an external SSO system to create a user
// It auto-creates a personal group and project for the user
// If inviteGroupId is provided, adds the user to that group instead of creating a new one
const provisionSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  externalId: z.string().optional(), // External SSO ID
  // For invite acceptance - adds user to existing group instead of creating new one
  inviteGroupId: z.string().optional(),
  inviteRole: z.enum(['owner', 'admin', 'member', 'viewer']).optional().default('member'),
});

router.post('/provision', registrationRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = provisionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error.errors[0].message });
      return;
    }

    const { email, displayName, externalId, inviteGroupId, inviteRole } = validation.data;
    const db = getDb();
    const usersCollection = db.collection('users');
    const normalizedEmail = email.toLowerCase();

    // If accepting an invite, verify the group exists
    if (inviteGroupId) {
      const inviteGroup = await groupService.getGroupById(inviteGroupId);
      if (!inviteGroup) {
        res.status(404).json({ error: 'Invited group not found' });
        return;
      }
    }

    // Check if user already exists
    let user = await usersCollection.findOne({ email: normalizedEmail });

    if (user) {
      // User exists - just return a login token
      if (!user.isActive) {
        res.status(401).json({ error: 'Account is disabled' });
        return;
      }

      // Update last login and external ID if provided
      const updateFields: Record<string, unknown> = { lastLoginAt: new Date() };
      if (externalId && !user.externalId) {
        updateFields.externalId = externalId;
      }
      await usersCollection.updateOne({ _id: user._id }, { $set: updateFields });

      // If accepting an invite, add user to the group
      if (inviteGroupId) {
        try {
          await groupService.addMember(
            inviteGroupId,
            { userId: user._id.toString(), role: inviteRole || 'member' },
            null // System-added
          );
        } catch (err) {
          // Ignore "already a member" errors
          if (!(err instanceof Error && err.message.includes('already a member'))) {
            throw err;
          }
        }
      }

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
        isNewUser: false,
        groupId: inviteGroupId || undefined,
      });
      return;
    }

    // Create new user
    const userId = new ObjectId();
    const now = new Date();

    const newUser = {
      _id: userId,
      email: normalizedEmail,
      displayName,
      externalId: externalId || undefined,
      role: 'operator', // Default role for SSO users
      isActive: true,
      isAgent: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    await usersCollection.insertOne(newUser);

    let assignedGroupId: string;

    if (inviteGroupId) {
      // User is accepting an invite - add them to the invited group
      await groupService.addMember(
        inviteGroupId,
        { userId: userId.toString(), role: inviteRole || 'member' },
        null // System-added
      );
      assignedGroupId = inviteGroupId;
    } else {
      // Create a personal group for the user
      const groupName = `${displayName}'s Workspace`;
      const group = await groupService.createGroup(
        {
          displayName: groupName,
          description: `Personal workspace for ${displayName}`,
          visibility: 'private',
        },
        userId.toString()
      );

      // Create a default project in the group
      await projectService.createProject(
        {
          displayName: 'Default Project',
          description: 'Your first project',
          groupId: group._id.toString(),
        },
        userId.toString()
      );
      assignedGroupId = group._id.toString();
    }

    const token = generateToken({
      userId: userId.toString(),
      email: normalizedEmail,
      role: 'operator',
    });

    res.status(201).json({
      token,
      user: {
        id: userId.toString(),
        email: normalizedEmail,
        displayName,
        role: 'operator',
      },
      isNewUser: true,
      groupId: assignedGroupId,
    });
  } catch (error) {
    console.error('Provision error:', error);
    res.status(500).json({ error: 'User provisioning failed' });
  }
});

// POST /api/auth/sso-login - Login for existing SSO users
// This is a simpler endpoint that just logs in an existing user by email
// Used when the SSO system has already verified the user's identity
const ssoLoginSchema = z.object({
  email: z.string().email(),
});

router.post('/sso-login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = ssoLoginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const { email } = validation.data;
    const db = getDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      res.status(404).json({ error: 'User not found. Please complete provisioning first.' });
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
    console.error('SSO login error:', error);
    res.status(500).json({ error: 'SSO login failed' });
  }
});

export { router as authRouter };
