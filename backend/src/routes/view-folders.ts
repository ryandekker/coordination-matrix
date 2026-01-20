import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { ViewFolder, View } from '../types/index.js';

export const viewFoldersRouter = Router();

// GET /api/view-folders - Get all view folders
viewFoldersRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { collectionName } = req.query;

    const filter: Record<string, unknown> = {};
    if (collectionName) {
      filter.collectionName = collectionName;
    }

    const folders = await db
      .collection<ViewFolder>('view_folders')
      .find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .toArray();

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});

// GET /api/view-folders/:id - Get a specific folder
viewFoldersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);

    const folder = await db.collection<ViewFolder>('view_folders').findOne({ _id: folderId });

    if (!folder) {
      throw createError('Folder not found', 404);
    }

    res.json({ data: folder });
  } catch (error) {
    next(error);
  }
});

// POST /api/view-folders - Create a new folder
viewFoldersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderData = req.body;

    if (!folderData.name || !folderData.collectionName) {
      throw createError('name and collectionName are required', 400);
    }

    // Get next sort order
    const lastFolder = await db
      .collection<ViewFolder>('view_folders')
      .findOne(
        { collectionName: folderData.collectionName },
        { sort: { sortOrder: -1 } }
      );
    const nextSortOrder = (lastFolder?.sortOrder ?? -1) + 1;

    const now = new Date();
    const newFolder: Omit<ViewFolder, '_id'> = {
      name: folderData.name,
      collectionName: folderData.collectionName,
      sortOrder: folderData.sortOrder ?? nextSortOrder,
      isExpanded: folderData.isExpanded ?? true,
      createdById: folderData.createdById ? new ObjectId(folderData.createdById) : null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<ViewFolder>('view_folders').insertOne(newFolder as ViewFolder);
    const inserted = await db.collection<ViewFolder>('view_folders').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/view-folders/:id - Update a folder
viewFoldersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);
    const updates = req.body;

    const existingFolder = await db.collection<ViewFolder>('view_folders').findOne({ _id: folderId });
    if (!existingFolder) {
      throw createError('Folder not found', 404);
    }

    delete updates._id;
    delete updates.createdAt;
    delete updates.createdById;
    updates.updatedAt = new Date();

    const result = await db.collection<ViewFolder>('view_folders').findOneAndUpdate(
      { _id: folderId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/view-folders/:id - Delete a folder
viewFoldersRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);
    const { moveViewsToRoot = true } = req.query;

    const folder = await db.collection<ViewFolder>('view_folders').findOne({ _id: folderId });

    if (!folder) {
      throw createError('Folder not found', 404);
    }

    // Handle views in this folder
    if (moveViewsToRoot === 'true' || moveViewsToRoot === true) {
      // Move views to root (set folderId to null)
      await db.collection<View>('views').updateMany(
        { folderId },
        { $set: { folderId: null, updatedAt: new Date() } }
      );
    }
    // If not moving to root, views remain orphaned (or you could delete them)

    // Delete the folder
    await db.collection('view_folders').deleteOne({ _id: folderId });

    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/view-folders/reorder - Reorder folders
viewFoldersRouter.put('/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { order } = req.body;

    if (!Array.isArray(order)) {
      throw createError('order must be an array of { id, sortOrder }', 400);
    }

    const bulkOps = order.map(({ id, sortOrder }: { id: string; sortOrder: number }) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: { $set: { sortOrder, updatedAt: new Date() } },
      },
    }));

    if (bulkOps.length > 0) {
      await db.collection('view_folders').bulkWrite(bulkOps);
    }

    // Return updated folders
    const collectionName = req.body.collectionName;
    const filter: Record<string, unknown> = {};
    if (collectionName) {
      filter.collectionName = collectionName;
    }

    const folders = await db
      .collection<ViewFolder>('view_folders')
      .find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .toArray();

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});
