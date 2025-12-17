import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

export interface ApiKey {
  _id: unknown;
  name: string;
  description?: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  createdById: unknown;
  createdAt: Date;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  isActive: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: ApiKey;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export function generateToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  // Try API key authentication first (via X-API-Key header)
  if (apiKeyHeader) {
    try {
      const db = getDb();
      const keyHash = hashApiKey(apiKeyHeader);

      const apiKey = await db.collection<ApiKey>('api_keys').findOne({
        keyHash,
        isActive: true,
      });

      if (!apiKey) {
        res.status(401).json({ error: 'Invalid or revoked API key' });
        return;
      }

      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        res.status(401).json({ error: 'API key expired' });
        return;
      }

      // Update last used timestamp (non-blocking)
      db.collection<ApiKey>('api_keys').updateOne(
        { _id: apiKey._id },
        { $set: { lastUsedAt: new Date() } }
      ).catch(() => { /* ignore errors */ });

      req.apiKey = apiKey;
      // Create a synthetic user for API key auth
      req.user = {
        userId: apiKey.createdById?.toString() || 'api-key-user',
        email: `api-key-${apiKey.keyPrefix}@system`,
        role: 'api',
      };
      next();
      return;
    } catch (error) {
      res.status(500).json({ error: 'API key validation failed' });
      return;
    }
  }

  // Fall back to JWT Bearer token authentication
  // Also support token via query param for SSE (EventSource doesn't support custom headers)
  const queryToken = req.query.token as string | undefined;

  if (!authHeader && !queryToken) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  const token = queryToken || (authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader) || '';

  const user = verifyToken(token);

  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = user;
  next();
}

// Optional auth - doesn't fail if no token, but populates user if valid
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const user = verifyToken(token);
    if (user) {
      req.user = user;
    }
  }

  next();
}
