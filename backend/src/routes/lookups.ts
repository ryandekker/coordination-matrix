import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { LookupValue } from '../types/index.js';

export const lookupsRouter = Router();

// GET /api/lookups - Get all lookups grouped by type
lookupsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const lookups = await db
      .collection<LookupValue>('lookups')
      .find({ isActive: true })
      .sort({ type: 1, sortOrder: 1 })
      .toArray();

    // Group by type
    const grouped: Record<string, LookupValue[]> = {};
    for (const lookup of lookups) {
      if (!grouped[lookup.type]) {
        grouped[lookup.type] = [];
      }
      grouped[lookup.type].push(lookup);
    }

    res.json({ data: grouped });
  } catch (error) {
    next(error);
  }
});

// GET /api/lookups/types - Get list of lookup types
lookupsRouter.get('/types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const types = await db.collection('lookups').distinct('type');
    res.json({ data: types });
  } catch (error) {
    next(error);
  }
});

// GET /api/lookups/:type - Get lookups by type
lookupsRouter.get('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive } = req.query;

    const filter: Record<string, unknown> = { type: req.params.type };
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    const lookups = await db
      .collection<LookupValue>('lookups')
      .find(filter)
      .sort({ sortOrder: 1 })
      .toArray();

    res.json({ data: lookups });
  } catch (error) {
    next(error);
  }
});

// POST /api/lookups - Create a new lookup value
lookupsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { type, code, displayName, color, icon, sortOrder, metadata } = req.body;

    if (!type || !code || !displayName) {
      throw createError('type, code, and displayName are required', 400);
    }

    // Check for duplicate
    const existing = await db.collection('lookups').findOne({ type, code });
    if (existing) {
      throw createError('Lookup with this type and code already exists', 409);
    }

    const newLookup: Omit<LookupValue, '_id'> = {
      type,
      code,
      displayName,
      color: color || '#6B7280',
      icon: icon || undefined,
      sortOrder: sortOrder || 0,
      isActive: true,
      metadata: metadata || {},
    };

    const result = await db.collection<LookupValue>('lookups').insertOne(newLookup as LookupValue);
    const inserted = await db.collection<LookupValue>('lookups').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/lookups/:id - Update a lookup value
lookupsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const lookupId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.type; // Type shouldn't be changed
    delete updates.code; // Code shouldn't be changed

    const result = await db.collection<LookupValue>('lookups').findOneAndUpdate(
      { _id: lookupId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Lookup not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/lookups/:id - Soft delete (deactivate) a lookup value
lookupsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const lookupId = new ObjectId(req.params.id);

    const result = await db.collection<LookupValue>('lookups').findOneAndUpdate(
      { _id: lookupId },
      { $set: { isActive: false } },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Lookup not found', 404);
    }

    res.json({ success: true, message: 'Lookup deactivated' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/lookups/:type/reorder - Reorder lookup values
lookupsRouter.put('/:type/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { order } = req.body; // Array of { id, sortOrder }

    if (!Array.isArray(order)) {
      throw createError('order array is required', 400);
    }

    const bulkOps = order.map(({ id, sortOrder }: { id: string; sortOrder: number }) => ({
      updateOne: {
        filter: { _id: new ObjectId(id), type: req.params.type },
        update: { $set: { sortOrder } },
      },
    }));

    await db.collection('lookups').bulkWrite(bulkOps);

    const lookups = await db
      .collection<LookupValue>('lookups')
      .find({ type: req.params.type })
      .sort({ sortOrder: 1 })
      .toArray();

    res.json({ data: lookups });
  } catch (error) {
    next(error);
  }
});
