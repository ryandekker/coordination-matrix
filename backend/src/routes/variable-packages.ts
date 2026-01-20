/**
 * Variable Packages API Routes
 *
 * Manages global variable packages with branches for credentials and configuration.
 * Secret fields are encrypted at rest and redacted in API responses.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { VariablePackage, VariableFieldSchema } from '../types/index.js';
import {
  encryptPackageBranches,
  decryptPackageBranches,
  redactPackageBranches,
  isEncryptionConfigured,
} from '../services/encryption.js';

export const variablePackagesRouter = Router();

// Helper to normalize package name (lowercase, alphanumeric and underscores only)
function normalizePackageName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
}

// Helper to validate schema
function validateSchema(schema: unknown): schema is VariableFieldSchema[] {
  if (!Array.isArray(schema)) return false;

  for (const field of schema) {
    if (!field.key || typeof field.key !== 'string') return false;
    if (!field.displayName || typeof field.displayName !== 'string') return false;
    if (!field.type || !['string', 'secret', 'number', 'boolean'].includes(field.type)) return false;
  }

  return true;
}

// GET /api/variable-packages - List all packages (secrets redacted)
variablePackagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { includeInactive, search } = req.query;

    const filter: Record<string, unknown> = {};

    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    if (search && typeof search === 'string') {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const packages = await db
      .collection<VariablePackage>('variable_packages')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    // Redact secrets in response
    const redactedPackages = packages.map((pkg) => ({
      ...pkg,
      branches: redactPackageBranches(pkg.branches, pkg.schema),
    }));

    res.json({ data: redactedPackages });
  } catch (error) {
    next(error);
  }
});

// GET /api/variable-packages/:id - Get package by ID (secrets redacted)
variablePackagesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const pkg = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!pkg) {
      throw createError('Package not found', 404);
    }

    // Redact secrets
    const redactedPackage = {
      ...pkg,
      branches: redactPackageBranches(pkg.branches, pkg.schema),
    };

    res.json({ data: redactedPackage });
  } catch (error) {
    next(error);
  }
});

// POST /api/variable-packages - Create a new package
variablePackagesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, displayName, description, schema, branches, defaultBranch } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    if (!schema || !validateSchema(schema)) {
      throw createError('Valid schema is required with key, displayName, and type for each field', 400);
    }

    // Check if any secret fields exist and encryption is configured
    const hasSecrets = schema.some((f: VariableFieldSchema) => f.type === 'secret');
    if (hasSecrets && !isEncryptionConfigured()) {
      throw createError('VARIABLE_ENCRYPTION_KEY must be configured to use secret fields', 400);
    }

    const normalizedName = normalizePackageName(name);

    // Check for duplicate
    const existing = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ name: normalizedName });
    if (existing) {
      throw createError('Package with this name already exists', 409);
    }

    const now = new Date();

    // Encrypt secrets in branches if provided
    const encryptedBranches = branches && typeof branches === 'object'
      ? encryptPackageBranches(branches, schema)
      : {};

    const newPackage: Omit<VariablePackage, '_id'> = {
      name: normalizedName,
      displayName: displayName || name,
      description: description || undefined,
      schema,
      branches: encryptedBranches,
      defaultBranch: defaultBranch || (Object.keys(encryptedBranches)[0] || undefined),
      isActive: true,
      createdById: req.user?.userId ? new ObjectId(req.user.userId) : null,
      updatedById: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .insertOne(newPackage as VariablePackage);

    const inserted = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: result.insertedId });

    // Redact secrets in response
    const redactedPackage = inserted ? {
      ...inserted,
      branches: redactPackageBranches(inserted.branches, inserted.schema),
    } : null;

    res.status(201).json({ data: redactedPackage });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/variable-packages/:id - Update a package
variablePackagesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const pkgId = new ObjectId(req.params.id);
    const updates = { ...req.body };

    // Get existing package
    const existing = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: pkgId });

    if (!existing) {
      throw createError('Package not found', 404);
    }

    // Don't allow updating certain fields
    delete updates._id;
    delete updates.createdAt;
    delete updates.createdById;

    // If name is being updated, normalize it
    if (updates.name) {
      updates.name = normalizePackageName(updates.name);

      // Check for duplicate with the new name
      const duplicate = await db
        .collection<VariablePackage>('variable_packages')
        .findOne({ name: updates.name, _id: { $ne: pkgId } });
      if (duplicate) {
        throw createError('Package with this name already exists', 409);
      }
    }

    // If schema is being updated, validate it
    if (updates.schema) {
      if (!validateSchema(updates.schema)) {
        throw createError('Valid schema is required', 400);
      }

      const hasSecrets = updates.schema.some((f: VariableFieldSchema) => f.type === 'secret');
      if (hasSecrets && !isEncryptionConfigured()) {
        throw createError('VARIABLE_ENCRYPTION_KEY must be configured to use secret fields', 400);
      }
    }

    // If branches are being updated, encrypt secrets
    if (updates.branches) {
      const schema = updates.schema || existing.schema;
      updates.branches = encryptPackageBranches(updates.branches, schema);
    }

    updates.updatedAt = new Date();
    updates.updatedById = req.user?.userId ? new ObjectId(req.user.userId) : null;

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: pkgId },
        { $set: updates },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Package not found', 404);
    }

    // Redact secrets
    const redactedPackage = {
      ...result,
      branches: redactPackageBranches(result.branches, result.schema),
    };

    res.json({ data: redactedPackage });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/variable-packages/:id - Soft delete (deactivate) a package
variablePackagesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const pkgId = new ObjectId(req.params.id);

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: pkgId },
        {
          $set: {
            isActive: false,
            updatedAt: new Date(),
            updatedById: req.user?.userId ? new ObjectId(req.user.userId) : null,
          }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Package not found', 404);
    }

    res.json({ success: true, message: 'Package deactivated' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Branch Management
// ============================================================================

// POST /api/variable-packages/:id/branches - Add a new branch
variablePackagesRouter.post('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const { name, data } = req.body;

    if (!name || typeof name !== 'string') {
      throw createError('Branch name is required', 400);
    }

    if (!data || typeof data !== 'object') {
      throw createError('Branch data is required', 400);
    }

    const branchName = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
    const pkgId = new ObjectId(req.params.id);

    const pkg = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: pkgId });

    if (!pkg) {
      throw createError('Package not found', 404);
    }

    if (pkg.branches[branchName]) {
      throw createError('Branch already exists', 409);
    }

    // Encrypt secrets in branch data
    const encryptedBranches = encryptPackageBranches({ [branchName]: data }, pkg.schema);
    const encryptedData = encryptedBranches[branchName];

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: pkgId },
        {
          $set: {
            [`branches.${branchName}`]: encryptedData,
            updatedAt: new Date(),
            updatedById: req.user?.userId ? new ObjectId(req.user.userId) : null,
          }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Failed to update package', 500);
    }

    // Redact secrets
    const redactedPackage = {
      ...result,
      branches: redactPackageBranches(result.branches, result.schema),
    };

    res.status(201).json({ data: redactedPackage });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/variable-packages/:id/branches/:branch - Update a branch
variablePackagesRouter.patch('/:id/branches/:branch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const { data } = req.body;
    const branchName = req.params.branch;
    const pkgId = new ObjectId(req.params.id);

    if (!data || typeof data !== 'object') {
      throw createError('Branch data is required', 400);
    }

    const pkg = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: pkgId });

    if (!pkg) {
      throw createError('Package not found', 404);
    }

    if (!pkg.branches[branchName]) {
      throw createError('Branch not found', 404);
    }

    // Encrypt secrets in branch data
    const encryptedBranches = encryptPackageBranches({ [branchName]: data }, pkg.schema);
    const encryptedData = encryptedBranches[branchName];

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: pkgId },
        {
          $set: {
            [`branches.${branchName}`]: encryptedData,
            updatedAt: new Date(),
            updatedById: req.user?.userId ? new ObjectId(req.user.userId) : null,
          }
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Failed to update package', 500);
    }

    // Redact secrets
    const redactedPackage = {
      ...result,
      branches: redactPackageBranches(result.branches, result.schema),
    };

    res.json({ data: redactedPackage });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/variable-packages/:id/branches/:branch - Delete a branch
variablePackagesRouter.delete('/:id/branches/:branch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const branchName = req.params.branch;
    const pkgId = new ObjectId(req.params.id);

    const pkg = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: pkgId });

    if (!pkg) {
      throw createError('Package not found', 404);
    }

    if (!pkg.branches[branchName]) {
      throw createError('Branch not found', 404);
    }

    // Don't allow deleting the last branch
    if (Object.keys(pkg.branches).length === 1) {
      throw createError('Cannot delete the last branch', 400);
    }

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: pkgId },
        {
          $unset: { [`branches.${branchName}`]: '' },
          $set: {
            updatedAt: new Date(),
            updatedById: req.user?.userId ? new ObjectId(req.user.userId) : null,
            // If deleting the default branch, set a new default
            ...(pkg.defaultBranch === branchName && {
              defaultBranch: Object.keys(pkg.branches).find(b => b !== branchName),
            }),
          },
        },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Failed to update package', 500);
    }

    res.json({ success: true, message: 'Branch deleted' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Secret Reveal (for authorized viewing)
// ============================================================================

// GET /api/variable-packages/:id/branches/:branch/reveal - Get decrypted values
variablePackagesRouter.get('/:id/branches/:branch/reveal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid package ID', 400);
    }

    const branchName = req.params.branch;
    const pkgId = new ObjectId(req.params.id);

    const pkg = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: pkgId });

    if (!pkg) {
      throw createError('Package not found', 404);
    }

    if (!pkg.branches[branchName]) {
      throw createError('Branch not found', 404);
    }

    // Decrypt secrets for this branch
    const decryptedBranches = decryptPackageBranches(
      { [branchName]: pkg.branches[branchName] },
      pkg.schema
    );

    // Log the access for audit purposes
    console.log(`[AUDIT] Secret reveal: package=${pkg.name}, branch=${branchName}, user=${req.user?.userId || 'anonymous'}, time=${new Date().toISOString()}`);

    res.json({
      data: {
        packageId: pkg._id,
        packageName: pkg.name,
        branchName,
        values: decryptedBranches[branchName],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Utility endpoint for token browser
// ============================================================================

// GET /api/variable-packages/tokens - Get all packages formatted for token browser
variablePackagesRouter.get('/tokens/list', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const packages = await db
      .collection<VariablePackage>('variable_packages')
      .find({ isActive: true })
      .sort({ name: 1 })
      .toArray();

    // Format for token browser consumption
    const tokens = packages.map((pkg) => ({
      packageId: pkg._id.toString(),
      name: pkg.name,
      displayName: pkg.displayName || pkg.name,
      description: pkg.description,
      defaultBranch: pkg.defaultBranch,
      branches: Object.keys(pkg.branches),
      fields: pkg.schema.map((f) => ({
        key: f.key,
        displayName: f.displayName,
        type: f.type,
        isSecret: f.type === 'secret',
      })),
    }));

    res.json({ data: tokens });
  } catch (error) {
    next(error);
  }
});
