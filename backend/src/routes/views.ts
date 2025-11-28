import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { View, UserPreference } from '../types/index.js';

export const viewsRouter = Router();

// GET /api/views - Get all views
viewsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { collectionName, userId } = req.query;

    const filter: Record<string, unknown> = {};
    if (collectionName) {
      filter.collectionName = collectionName;
    }

    const views = await db
      .collection<View>('views')
      .find(filter)
      .sort({ isSystem: -1, isDefault: -1, name: 1 })
      .toArray();

    // If userId provided, merge with user preferences
    if (userId) {
      const userPrefs = await db
        .collection<UserPreference>('user_preferences')
        .find({ userId: new ObjectId(userId as string) })
        .toArray();

      const prefsMap = new Map(userPrefs.map((p) => [p.viewId.toString(), p]));

      const viewsWithPrefs = views.map((view) => {
        const pref = prefsMap.get(view._id.toString());
        if (pref) {
          return {
            ...view,
            userPreference: {
              visibleColumns: pref.visibleColumns,
              columnWidths: pref.columnWidths,
              columnOrder: pref.columnOrder,
            },
          };
        }
        return view;
      });

      return res.json({ data: viewsWithPrefs });
    }

    res.json({ data: views });
  } catch (error) {
    next(error);
  }
});

// GET /api/views/:id - Get a specific view
viewsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const viewId = new ObjectId(req.params.id);
    const { userId } = req.query;

    const view = await db.collection<View>('views').findOne({ _id: viewId });

    if (!view) {
      throw createError('View not found', 404);
    }

    // Merge with user preference if provided
    if (userId) {
      const userPref = await db.collection<UserPreference>('user_preferences').findOne({
        userId: new ObjectId(userId as string),
        viewId,
      });

      if (userPref) {
        return res.json({
          data: {
            ...view,
            userPreference: {
              visibleColumns: userPref.visibleColumns,
              columnWidths: userPref.columnWidths,
              columnOrder: userPref.columnOrder,
            },
          },
        });
      }
    }

    res.json({ data: view });
  } catch (error) {
    next(error);
  }
});

// POST /api/views - Create a new view
viewsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const viewData = req.body;

    if (!viewData.name || !viewData.collectionName) {
      throw createError('name and collectionName are required', 400);
    }

    const now = new Date();
    const newView: Omit<View, '_id'> = {
      name: viewData.name,
      collectionName: viewData.collectionName,
      isDefault: viewData.isDefault || false,
      isSystem: false, // User-created views are never system views
      filters: viewData.filters || {},
      sorting: viewData.sorting || [],
      visibleColumns: viewData.visibleColumns || [],
      columnWidths: viewData.columnWidths,
      createdById: viewData.createdById ? new ObjectId(viewData.createdById) : null,
      createdAt: now,
      updatedAt: now,
    };

    // If setting as default, unset other defaults
    if (newView.isDefault) {
      await db.collection('views').updateMany(
        { collectionName: viewData.collectionName, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const result = await db.collection<View>('views').insertOne(newView as View);
    const inserted = await db.collection<View>('views').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/views/:id - Update a view
viewsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const viewId = new ObjectId(req.params.id);
    const updates = req.body;

    // Check if it's a system view
    const existingView = await db.collection<View>('views').findOne({ _id: viewId });
    if (!existingView) {
      throw createError('View not found', 404);
    }

    if (existingView.isSystem) {
      // Only allow updating certain fields on system views
      const allowedFields = ['visibleColumns', 'columnWidths', 'sorting'];
      for (const key of Object.keys(updates)) {
        if (!allowedFields.includes(key)) {
          delete updates[key];
        }
      }
    }

    delete updates._id;
    delete updates.createdAt;
    delete updates.isSystem;
    updates.updatedAt = new Date();

    // Handle default flag
    if (updates.isDefault === true) {
      await db.collection('views').updateMany(
        { collectionName: existingView.collectionName, isDefault: true, _id: { $ne: viewId } },
        { $set: { isDefault: false } }
      );
    }

    const result = await db.collection<View>('views').findOneAndUpdate(
      { _id: viewId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/views/:id - Delete a view
viewsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const viewId = new ObjectId(req.params.id);

    const view = await db.collection<View>('views').findOne({ _id: viewId });

    if (!view) {
      throw createError('View not found', 404);
    }

    if (view.isSystem) {
      throw createError('Cannot delete system views', 403);
    }

    // Delete associated user preferences
    await db.collection('user_preferences').deleteMany({ viewId });

    // Delete the view
    await db.collection('views').deleteOne({ _id: viewId });

    res.json({ success: true, message: 'View deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/views/:id/preferences - Save user preferences for a view
viewsRouter.put('/:id/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const viewId = new ObjectId(req.params.id);
    const { userId, visibleColumns, columnWidths, columnOrder } = req.body;

    if (!userId) {
      throw createError('userId is required', 400);
    }

    const userOid = new ObjectId(userId);

    const preference: Omit<UserPreference, '_id'> = {
      userId: userOid,
      viewId,
      visibleColumns,
      columnWidths,
      columnOrder,
    };

    await db.collection<UserPreference>('user_preferences').updateOne(
      { userId: userOid, viewId },
      { $set: preference },
      { upsert: true }
    );

    res.json({ success: true, message: 'Preferences saved' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/views/:id/preferences/:userId - Reset user preferences for a view
viewsRouter.delete(
  '/:id/preferences/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const viewId = new ObjectId(req.params.id);
      const userId = new ObjectId(req.params.userId);

      await db.collection('user_preferences').deleteOne({ userId, viewId });

      res.json({ success: true, message: 'Preferences reset' });
    } catch (error) {
      next(error);
    }
  }
);
