import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { Tag } from '../types/index.js';

export const tagsRouter = Router();

// GET /api/tags - Get all tags (for API consumers like daemons/agents)
tagsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive, search } = req.query;

    const filter: Record<string, unknown> = {};

    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    // Optional search filter
    if (search && typeof search === 'string') {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
      ];
    }

    const tags = await db
      .collection<Tag>('tags')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    res.json({ data: tags });
  } catch (error) {
    next(error);
  }
});

// GET /api/tags/:id - Get a single tag by ID
tagsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid tag ID', 400);
    }

    const tag = await db
      .collection<Tag>('tags')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!tag) {
      throw createError('Tag not found', 404);
    }

    res.json({ data: tag });
  } catch (error) {
    next(error);
  }
});

// POST /api/tags - Create a new tag
tagsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, displayName, color, description } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    // Normalize tag name (lowercase, trim, replace spaces with hyphens)
    const normalizedName = name.toLowerCase().trim().replace(/\s+/g, '-');

    // Check for duplicate
    const existing = await db.collection<Tag>('tags').findOne({ name: normalizedName });
    if (existing) {
      throw createError('Tag with this name already exists', 409);
    }

    const now = new Date();
    const newTag: Omit<Tag, '_id'> = {
      name: normalizedName,
      displayName: displayName || name,
      color: color || '#6B7280',
      description: description || null,
      isActive: true,
      createdById: req.user?.userId ? new ObjectId(req.user.userId) : null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<Tag>('tags').insertOne(newTag as Tag);
    const inserted = await db.collection<Tag>('tags').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tags/:id - Update a tag
tagsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid tag ID', 400);
    }

    const tagId = new ObjectId(req.params.id);
    const updates = { ...req.body };

    // Don't allow updating certain fields
    delete updates._id;
    delete updates.createdAt;
    delete updates.createdById;

    // If name is being updated, normalize it
    if (updates.name) {
      updates.name = updates.name.toLowerCase().trim().replace(/\s+/g, '-');

      // Check for duplicate with the new name
      const existing = await db.collection<Tag>('tags').findOne({
        name: updates.name,
        _id: { $ne: tagId }
      });
      if (existing) {
        throw createError('Tag with this name already exists', 409);
      }
    }

    updates.updatedAt = new Date();

    const result = await db.collection<Tag>('tags').findOneAndUpdate(
      { _id: tagId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Tag not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tags/:id - Soft delete (deactivate) a tag
tagsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid tag ID', 400);
    }

    const tagId = new ObjectId(req.params.id);

    const result = await db.collection<Tag>('tags').findOneAndUpdate(
      { _id: tagId },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Tag not found', 404);
    }

    res.json({ success: true, message: 'Tag deactivated' });
  } catch (error) {
    next(error);
  }
});

// POST /api/tags/ensure - Ensure tags exist (create if they don't)
// Useful for bulk operations and migrations
tagsRouter.post('/ensure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      throw createError('tags array is required', 400);
    }

    const results: Tag[] = [];
    const now = new Date();

    for (const tagInput of tags) {
      const name = typeof tagInput === 'string' ? tagInput : tagInput.name;
      const normalizedName = name.toLowerCase().trim().replace(/\s+/g, '-');

      // Try to find existing tag
      let tag = await db.collection<Tag>('tags').findOne({ name: normalizedName });

      if (!tag) {
        // Create new tag
        const newTag: Omit<Tag, '_id'> = {
          name: normalizedName,
          displayName: typeof tagInput === 'string' ? name : (tagInput.displayName || name),
          color: typeof tagInput === 'object' && tagInput.color ? tagInput.color : '#6B7280',
          description: typeof tagInput === 'object' ? tagInput.description : null,
          isActive: true,
          createdById: req.user?.userId ? new ObjectId(req.user.userId) : null,
          createdAt: now,
          updatedAt: now,
        };

        const result = await db.collection<Tag>('tags').insertOne(newTag as Tag);
        tag = await db.collection<Tag>('tags').findOne({ _id: result.insertedId });
      }

      if (tag) {
        results.push(tag);
      }
    }

    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});
