import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { webhookService } from '../services/webhook-service.js';
import { Webhook, WebhookTrigger } from '../types/index.js';
import crypto from 'crypto';

export const webhooksRouter = Router();

// Helper to parse ObjectId safely
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// Generate a random secret
function generateSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

// Valid trigger types
const validTriggers: WebhookTrigger[] = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status.changed',
  'task.assignee.changed',
  'task.priority.changed',
  'task.entered_filter',
];

// GET /api/webhooks - List all webhooks
webhooksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { isActive, limit = '50', offset = '0' } = req.query;

    const filter: Record<string, unknown> = {};
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const [webhooks, total] = await Promise.all([
      db
        .collection<Webhook>('webhooks')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(parseInt(offset as string, 10))
        .limit(parseInt(limit as string, 10))
        .toArray(),
      db.collection('webhooks').countDocuments(filter),
    ]);

    // Hide secrets in list view (show only last 4 chars)
    const safeWebhooks = webhooks.map((w) => ({
      ...w,
      secret: `...${w.secret.slice(-4)}`,
    }));

    res.json({
      data: safeWebhooks,
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/webhooks/deliveries - Get all deliveries across all webhooks
// NOTE: This route must come BEFORE /:id to prevent 'deliveries' from being parsed as an ID
webhooksRouter.get('/deliveries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '100', offset = '0', status } = req.query;

    const result = await webhookService.getAllDeliveries({
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
      status: status as string | undefined,
    });

    res.json({
      data: result.data,
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total: result.total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/webhooks/:id - Get a single webhook
webhooksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const webhookId = toObjectId(req.params.id);

    const webhook = await db.collection<Webhook>('webhooks').findOne({ _id: webhookId });
    if (!webhook) {
      throw createError('Webhook not found', 404);
    }

    // Show full secret for single webhook view
    res.json({ data: webhook });
  } catch (error) {
    next(error);
  }
});

// POST /api/webhooks - Create a new webhook
webhooksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      name,
      url,
      triggers,
      savedSearchId,
      filterQuery,
      isActive = true,
      createdById,
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      throw createError('Name is required', 400);
    }
    if (!url || typeof url !== 'string') {
      throw createError('URL is required', 400);
    }
    if (!triggers || !Array.isArray(triggers) || triggers.length === 0) {
      throw createError('At least one trigger is required', 400);
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw createError('Invalid URL format', 400);
    }

    // Validate triggers
    const invalidTriggers = triggers.filter((t: string) => !validTriggers.includes(t as WebhookTrigger));
    if (invalidTriggers.length > 0) {
      throw createError(`Invalid triggers: ${invalidTriggers.join(', ')}`, 400);
    }

    const now = new Date();
    const webhook: Omit<Webhook, '_id'> = {
      name,
      url,
      secret: generateSecret(),
      triggers,
      savedSearchId: savedSearchId ? toObjectId(savedSearchId) : null,
      filterQuery: filterQuery || null,
      isActive,
      createdById: createdById ? toObjectId(createdById) : null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection('webhooks').insertOne(webhook);
    const insertedWebhook = await db
      .collection<Webhook>('webhooks')
      .findOne({ _id: result.insertedId });

    res.status(201).json({ data: insertedWebhook });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/webhooks/:id - Update a webhook
webhooksRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const webhookId = toObjectId(req.params.id);
    const updates = req.body;

    // Remove protected fields
    delete updates._id;
    delete updates.secret;
    delete updates.createdAt;
    delete updates.createdById;

    // Validate URL if provided
    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        throw createError('Invalid URL format', 400);
      }
    }

    // Validate triggers if provided
    if (updates.triggers) {
      if (!Array.isArray(updates.triggers) || updates.triggers.length === 0) {
        throw createError('At least one trigger is required', 400);
      }
      const invalidTriggers = updates.triggers.filter(
        (t: string) => !validTriggers.includes(t as WebhookTrigger)
      );
      if (invalidTriggers.length > 0) {
        throw createError(`Invalid triggers: ${invalidTriggers.join(', ')}`, 400);
      }
    }

    // Convert savedSearchId if provided
    if (updates.savedSearchId !== undefined) {
      updates.savedSearchId = updates.savedSearchId ? toObjectId(updates.savedSearchId) : null;
    }

    updates.updatedAt = new Date();

    const result = await db.collection<Webhook>('webhooks').findOneAndUpdate(
      { _id: webhookId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Webhook not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/webhooks/:id - Delete a webhook
webhooksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const webhookId = toObjectId(req.params.id);

    const result = await db.collection('webhooks').deleteOne({ _id: webhookId });
    if (result.deletedCount === 0) {
      throw createError('Webhook not found', 404);
    }

    // Also delete delivery history
    await db.collection('webhook_deliveries').deleteMany({ webhookId });

    res.json({ success: true, message: 'Webhook deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/webhooks/:id/rotate-secret - Rotate webhook secret
webhooksRouter.post(
  '/:id/rotate-secret',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const webhookId = toObjectId(req.params.id);

      const newSecret = generateSecret();

      const result = await db.collection<Webhook>('webhooks').findOneAndUpdate(
        { _id: webhookId },
        { $set: { secret: newSecret, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!result) {
        throw createError('Webhook not found', 404);
      }

      res.json({ data: { secret: newSecret } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/webhooks/:id/test - Test a webhook
webhooksRouter.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhookId = toObjectId(req.params.id);
    const result = await webhookService.testWebhook(webhookId);

    if (result.success) {
      res.json({ success: true, message: 'Test webhook delivered successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/webhooks/:id/deliveries - Get delivery history for a webhook
webhooksRouter.get(
  '/:id/deliveries',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = toObjectId(req.params.id);
      const { limit = '50', offset = '0' } = req.query;

      const result = await webhookService.getDeliveryHistory(webhookId, {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      });

      res.json({
        data: result.data,
        pagination: {
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
          total: result.total,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/webhooks/deliveries/:deliveryId/retry - Retry a specific delivery
webhooksRouter.post(
  '/deliveries/:deliveryId/retry',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deliveryId = toObjectId(req.params.deliveryId);
      const success = await webhookService.retryDelivery(deliveryId);

      if (success) {
        res.json({ success: true, message: 'Delivery retried successfully' });
      } else {
        res.status(400).json({ success: false, message: 'Failed to retry delivery' });
      }
    } catch (error) {
      next(error);
    }
  }
);
