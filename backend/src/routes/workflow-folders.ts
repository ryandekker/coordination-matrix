import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { WorkflowFolder, Workflow } from '../types/index.js';

export const workflowFoldersRouter = Router();

// GET /api/workflow-folders - Get all workflow folders
workflowFoldersRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();

    const folders = await db
      .collection<WorkflowFolder>('workflow_folders')
      .find({})
      .sort({ sortOrder: 1, name: 1 })
      .toArray();

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflow-folders/:id - Get a specific folder
workflowFoldersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);

    const folder = await db.collection<WorkflowFolder>('workflow_folders').findOne({ _id: folderId });

    if (!folder) {
      throw createError('Folder not found', 404);
    }

    res.json({ data: folder });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflow-folders - Create a new folder
workflowFoldersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderData = req.body;

    if (!folderData.name) {
      throw createError('name is required', 400);
    }

    // Get next sort order
    const lastFolder = await db
      .collection<WorkflowFolder>('workflow_folders')
      .findOne({}, { sort: { sortOrder: -1 } });
    const nextSortOrder = (lastFolder?.sortOrder ?? -1) + 1;

    const now = new Date();
    const newFolder: Omit<WorkflowFolder, '_id'> = {
      name: folderData.name,
      description: folderData.description || undefined,
      sortOrder: folderData.sortOrder ?? nextSortOrder,
      isExpanded: folderData.isExpanded ?? true,
      createdById: folderData.createdById ? new ObjectId(folderData.createdById) : null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<WorkflowFolder>('workflow_folders').insertOne(newFolder as WorkflowFolder);
    const inserted = await db.collection<WorkflowFolder>('workflow_folders').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflow-folders/:id - Update a folder
workflowFoldersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);
    const updates = req.body;

    const existingFolder = await db.collection<WorkflowFolder>('workflow_folders').findOne({ _id: folderId });
    if (!existingFolder) {
      throw createError('Folder not found', 404);
    }

    delete updates._id;
    delete updates.createdAt;
    delete updates.createdById;
    updates.updatedAt = new Date();

    const result = await db.collection<WorkflowFolder>('workflow_folders').findOneAndUpdate(
      { _id: folderId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflow-folders/:id - Delete a folder
workflowFoldersRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const folderId = new ObjectId(req.params.id);
    const { moveWorkflowsToRoot = true } = req.query;

    const folder = await db.collection<WorkflowFolder>('workflow_folders').findOne({ _id: folderId });

    if (!folder) {
      throw createError('Folder not found', 404);
    }

    // Handle workflows in this folder
    if (moveWorkflowsToRoot === 'true' || moveWorkflowsToRoot === true) {
      // Move workflows to root (set folderId to null)
      await db.collection<Workflow>('workflows').updateMany(
        { folderId },
        { $set: { folderId: null, updatedAt: new Date() } }
      );
    }

    // Delete the folder
    await db.collection('workflow_folders').deleteOne({ _id: folderId });

    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/workflow-folders/reorder - Reorder folders
workflowFoldersRouter.put('/reorder', async (req: Request, res: Response, next: NextFunction) => {
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
      await db.collection('workflow_folders').bulkWrite(bulkOps);
    }

    // Return updated folders
    const folders = await db
      .collection<WorkflowFolder>('workflow_folders')
      .find({})
      .sort({ sortOrder: 1, name: 1 })
      .toArray();

    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});
