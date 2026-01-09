import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { isAdmin } from '../middleware/authorize.js';

export const apiKeysRouter = Router();

/**
 * Helper to check if user can access an API key.
 * Users can only access their own API keys unless they are admin.
 */
async function canAccessApiKey(req: Request, keyId: ObjectId): Promise<{ allowed: boolean; key: ApiKey | null }> {
  const db = getDb();
  const key = await db.collection<ApiKey>('api_keys').findOne({ _id: keyId });

  if (!key) {
    return { allowed: false, key: null };
  }

  // Admins can access any key
  if (isAdmin(req)) {
    return { allowed: true, key };
  }

  // Users can only access keys they created
  const userId = req.user?.userId;
  if (key.createdById && key.createdById.toString() === userId) {
    return { allowed: true, key };
  }

  return { allowed: false, key };
}

export interface ApiKey {
  _id: ObjectId;
  name: string;
  description?: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  createdById: ObjectId | null;
  // User ID that this API key acts as - when set, the key inherits the user's permissions
  userId?: ObjectId | null;
  createdAt: Date;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  isActive: boolean;
}

// Generate a secure random API key
function generateApiKey(): string {
  const prefix = 'cm_ak_';
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${prefix}${randomBytes}`;
}

// Hash an API key for storage
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// GET /api/auth/api-keys - List API keys
// Non-admins can only see their own keys.
// Admins can see all keys and use filters.
// Query params (admin only):
//   - createdById: Filter by who created the key
//   - actsAsUserId: Filter by which user the key acts as (inherits permissions from)
//   - includeInactive: Include revoked/inactive keys
apiKeysRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { createdById, actsAsUserId, includeInactive } = req.query;

    const filter: Record<string, unknown> = {};

    // Non-admins can only see their own API keys
    if (!isAdmin(req)) {
      filter.createdById = new ObjectId(req.user!.userId);
    } else {
      // Admins can filter by createdById
      if (createdById) {
        filter.createdById = new ObjectId(createdById as string);
      }
    }

    if (actsAsUserId) {
      filter.userId = new ObjectId(actsAsUserId as string);
    }
    if (!includeInactive) {
      filter.isActive = true;
    }

    const apiKeys = await db
      .collection<ApiKey>('api_keys')
      .find(filter)
      .project({ keyHash: 0 }) // Never return the hash
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ data: apiKeys });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/api-keys/:id - Get a specific API key
// Users can only view their own API keys unless they are admin.
apiKeysRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const keyId = new ObjectId(req.params.id);
    const { allowed, key } = await canAccessApiKey(req, keyId);

    if (!key) {
      throw createError('API key not found', 404);
    }

    if (!allowed) {
      throw createError('You do not have permission to view this API key', 403);
    }

    // Return without keyHash
    const { keyHash: _keyHash, ...safeKey } = key;
    res.json({ data: safeKey });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/api-keys - Generate a new API key
// Only admins and operators can create API keys.
// Non-admins cannot set userId (impersonation) - only admins can create keys that act as other users.
apiKeysRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { name, description, scopes, expiresAt, userId } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    // Validate userId if provided - only admins can create keys that impersonate users
    let validatedUserId: ObjectId | null = null;
    if (userId) {
      if (!isAdmin(req)) {
        throw createError('Only admins can create API keys that act as other users', 403);
      }
      const user = await db.collection('users').findOne({
        _id: new ObjectId(userId),
        isActive: true,
      });
      if (!user) {
        throw createError('userId must reference an active user', 400);
      }
      validatedUserId = new ObjectId(userId);
    }

    // Generate the raw API key
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 10) + '...';

    const now = new Date();
    const newApiKey: Omit<ApiKey, '_id'> = {
      name,
      description: description || null,
      keyHash,
      keyPrefix,
      scopes: scopes || ['tasks:read', 'saved-searches:read'],
      createdById: new ObjectId(req.user!.userId), // Always set to current user
      userId: validatedUserId,
      createdAt: now,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      lastUsedAt: null,
      isActive: true,
    };

    const result = await db.collection<ApiKey>('api_keys').insertOne(newApiKey as ApiKey);

    // Return the full key ONLY on creation
    res.status(201).json({
      data: {
        _id: result.insertedId,
        name: newApiKey.name,
        description: newApiKey.description,
        key: rawKey, // Only returned once!
        keyPrefix: newApiKey.keyPrefix,
        scopes: newApiKey.scopes,
        createdById: newApiKey.createdById,
        userId: newApiKey.userId,
        createdAt: newApiKey.createdAt,
        expiresAt: newApiKey.expiresAt,
        isActive: newApiKey.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/auth/api-keys/:id - Update an API key
// Users can only update their own API keys unless they are admin.
// Only admins can change userId (impersonation).
apiKeysRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const keyId = new ObjectId(req.params.id);
    const updates = req.body;

    const { allowed, key: existingKey } = await canAccessApiKey(req, keyId);

    if (!existingKey) {
      throw createError('API key not found', 404);
    }

    if (!allowed) {
      throw createError('You do not have permission to update this API key', 403);
    }

    // Only allow updating certain fields
    const allowedUpdates: Partial<ApiKey> = {};
    if (updates.name !== undefined) allowedUpdates.name = updates.name;
    if (updates.description !== undefined) allowedUpdates.description = updates.description;
    if (updates.scopes !== undefined) allowedUpdates.scopes = updates.scopes;
    if (updates.expiresAt !== undefined) {
      allowedUpdates.expiresAt = updates.expiresAt ? new Date(updates.expiresAt) : null;
    }
    if (updates.isActive !== undefined) allowedUpdates.isActive = updates.isActive;

    // Allow updating userId (the user this key acts as) - ADMIN ONLY
    if (updates.userId !== undefined) {
      if (!isAdmin(req)) {
        throw createError('Only admins can change which user an API key acts as', 403);
      }
      if (updates.userId === null) {
        allowedUpdates.userId = null;
      } else {
        // Validate that the user exists and is active
        const user = await db.collection('users').findOne({
          _id: new ObjectId(updates.userId),
          isActive: true,
        });
        if (!user) {
          throw createError('userId must reference an active user', 400);
        }
        allowedUpdates.userId = new ObjectId(updates.userId);
      }
    }

    const result = await db.collection<ApiKey>('api_keys').findOneAndUpdate(
      { _id: keyId },
      { $set: allowedUpdates },
      { returnDocument: 'after', projection: { keyHash: 0 } }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/api-keys/:id - Revoke an API key
// Users can only revoke their own API keys unless they are admin.
apiKeysRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const keyId = new ObjectId(req.params.id);

    const { allowed, key: existingKey } = await canAccessApiKey(req, keyId);

    if (!existingKey) {
      throw createError('API key not found', 404);
    }

    if (!allowed) {
      throw createError('You do not have permission to revoke this API key', 403);
    }

    // Soft delete by deactivating
    await db.collection<ApiKey>('api_keys').updateOne(
      { _id: keyId },
      { $set: { isActive: false } }
    );

    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/api-keys/:id/regenerate - Regenerate an API key
// Users can only regenerate their own API keys unless they are admin.
apiKeysRouter.post('/:id/regenerate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const keyId = new ObjectId(req.params.id);

    const { allowed, key: existingKey } = await canAccessApiKey(req, keyId);

    if (!existingKey) {
      throw createError('API key not found', 404);
    }

    if (!allowed) {
      throw createError('You do not have permission to regenerate this API key', 403);
    }

    // Generate a new key
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 10) + '...';

    await db.collection<ApiKey>('api_keys').updateOne(
      { _id: keyId },
      { $set: { keyHash, keyPrefix, lastUsedAt: null } }
    );

    const updated = await db
      .collection<ApiKey>('api_keys')
      .findOne({ _id: keyId }, { projection: { keyHash: 0 } });

    res.json({
      data: {
        ...updated,
        key: rawKey, // Only returned on regeneration
      },
    });
  } catch (error) {
    next(error);
  }
});

// Middleware to validate API key (can be used by other routes)
export async function validateApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Missing or invalid authorization header', 401);
    }

    const token = authHeader.substring(7);

    // Check if it's an API key (starts with cm_ak_)
    if (!token.startsWith('cm_ak_')) {
      throw createError('Invalid API key format', 401);
    }

    const db = getDb();
    const keyHash = hashApiKey(token);

    const apiKey = await db.collection<ApiKey>('api_keys').findOne({
      keyHash,
      isActive: true
    });

    if (!apiKey) {
      throw createError('Invalid or expired API key', 401);
    }

    // Check expiration
    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      throw createError('API key has expired', 401);
    }

    // Update last used timestamp
    await db.collection<ApiKey>('api_keys').updateOne(
      { _id: apiKey._id },
      { $set: { lastUsedAt: new Date() } }
    );

    // Attach API key info to request for downstream use
    (req as Request & { apiKey?: ApiKey }).apiKey = apiKey;

    next();
  } catch (error) {
    next(error);
  }
}
