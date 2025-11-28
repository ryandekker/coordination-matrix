import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { FieldConfig } from '../types/index.js';

export const fieldConfigsRouter = Router();

// GET /api/field-configs - Get all field configurations
fieldConfigsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();
    const { collectionName } = req.query;

    const filter: Record<string, unknown> = {};
    if (collectionName) {
      filter.collectionName = collectionName;
    }

    const configs = await db
      .collection<FieldConfig>('field_configs')
      .find(filter)
      .sort({ collectionName: 1, displayOrder: 1 })
      .toArray();

    // Group by collection if no specific collection requested
    if (!collectionName) {
      const grouped: Record<string, FieldConfig[]> = {};
      for (const config of configs) {
        if (!grouped[config.collectionName]) {
          grouped[config.collectionName] = [];
        }
        grouped[config.collectionName].push(config);
      }
      res.json({ data: grouped });
      return;
    }

    res.json({ data: configs });
  } catch (error) {
    next(error);
  }
});

// GET /api/field-configs/:collection - Get field configurations for a collection
fieldConfigsRouter.get('/:collection', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { editableOnly, visibleOnly } = req.query;

    const filter: Record<string, unknown> = { collectionName: req.params.collection };

    if (editableOnly === 'true') {
      filter.isEditable = true;
    }

    if (visibleOnly === 'true') {
      filter.defaultVisible = true;
    }

    const configs = await db
      .collection<FieldConfig>('field_configs')
      .find(filter)
      .sort({ displayOrder: 1 })
      .toArray();

    res.json({ data: configs });
  } catch (error) {
    next(error);
  }
});

// GET /api/field-configs/:collection/:fieldPath - Get a specific field configuration
fieldConfigsRouter.get(
  '/:collection/:fieldPath',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const config = await db.collection<FieldConfig>('field_configs').findOne({
        collectionName: req.params.collection,
        fieldPath: req.params.fieldPath,
      });

      if (!config) {
        throw createError('Field configuration not found', 404);
      }

      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/field-configs - Create a new field configuration
fieldConfigsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const configData = req.body;

    if (!configData.collectionName || !configData.fieldPath || !configData.displayName) {
      throw createError('collectionName, fieldPath, and displayName are required', 400);
    }

    // Check for duplicate
    const existing = await db.collection('field_configs').findOne({
      collectionName: configData.collectionName,
      fieldPath: configData.fieldPath,
    });

    if (existing) {
      throw createError('Field configuration already exists for this collection and field', 409);
    }

    const newConfig: Omit<FieldConfig, '_id'> = {
      collectionName: configData.collectionName,
      fieldPath: configData.fieldPath,
      displayName: configData.displayName,
      fieldType: configData.fieldType || 'text',
      isRequired: configData.isRequired || false,
      isEditable: configData.isEditable ?? true,
      isSearchable: configData.isSearchable || false,
      isSortable: configData.isSortable ?? true,
      isFilterable: configData.isFilterable || false,
      displayOrder: configData.displayOrder || 0,
      width: configData.width,
      minWidth: configData.minWidth,
      lookupType: configData.lookupType,
      options: configData.options,
      referenceCollection: configData.referenceCollection,
      referenceDisplayField: configData.referenceDisplayField || 'displayName',
      defaultValue: configData.defaultValue,
      defaultVisible: configData.defaultVisible ?? true,
      renderAs: configData.renderAs || 'text',
      validation: configData.validation,
    };

    const result = await db
      .collection<FieldConfig>('field_configs')
      .insertOne(newConfig as FieldConfig);
    const inserted = await db
      .collection<FieldConfig>('field_configs')
      .findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/field-configs/:id - Update a field configuration
fieldConfigsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const configId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.collectionName; // Shouldn't change
    delete updates.fieldPath; // Shouldn't change

    const result = await db.collection<FieldConfig>('field_configs').findOneAndUpdate(
      { _id: configId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Field configuration not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/field-configs/:id - Delete a field configuration
fieldConfigsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const configId = new ObjectId(req.params.id);

    const result = await db.collection('field_configs').deleteOne({ _id: configId });

    if (result.deletedCount === 0) {
      throw createError('Field configuration not found', 404);
    }

    res.json({ success: true, message: 'Field configuration deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/field-configs/:collection/reorder - Reorder field configurations
fieldConfigsRouter.put(
  '/:collection/reorder',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const { order } = req.body; // Array of { fieldPath, displayOrder }

      if (!Array.isArray(order)) {
        throw createError('order array is required', 400);
      }

      const bulkOps = order.map(
        ({ fieldPath, displayOrder }: { fieldPath: string; displayOrder: number }) => ({
          updateOne: {
            filter: { collectionName: req.params.collection, fieldPath },
            update: { $set: { displayOrder } },
          },
        })
      );

      await db.collection('field_configs').bulkWrite(bulkOps);

      const configs = await db
        .collection<FieldConfig>('field_configs')
        .find({ collectionName: req.params.collection })
        .sort({ displayOrder: 1 })
        .toArray();

      res.json({ data: configs });
    } catch (error) {
      next(error);
    }
  }
);
