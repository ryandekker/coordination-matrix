/**
 * Variables API Routes
 *
 * Manages global variables for use in workflows and templates.
 * Variables can store simple strings or JSON/YAML objects.
 * When encrypted=true, the entire value is encrypted at rest.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { VariablePackage } from '../types/index.js';
import {
  encrypt,
  decrypt,
  isEncrypted,
  isEncryptionConfigured,
} from '../services/encryption.js';
import {
  getVariableManifest,
  resolveOpaqueReferences,
  resolveOpaqueReferencesInObject,
  getSecretValues,
} from '../services/workflow/variable-safety.js';
import YAML from 'yaml';

export const variablePackagesRouter = Router();

// Helper to normalize variable name (lowercase, alphanumeric and underscores only)
function normalizeVariableName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
}

// Helper to parse value as JSON or YAML (returns null if not valid)
function tryParseValue(value: string): unknown | null {
  // First try JSON
  try {
    return JSON.parse(value);
  } catch {
    // Then try YAML
    try {
      const parsed = YAML.parse(value);
      // YAML.parse returns the string itself for plain strings, only return if it's an object
      if (parsed !== null && typeof parsed === 'object') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
}

// Helper to recursively extract all paths and values from an object
interface KeyValuePath {
  path: string;  // e.g., "user.profile.name"
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
}

function extractAllPaths(obj: unknown, parentPath: string = ''): KeyValuePath[] {
  const results: KeyValuePath[] = [];

  if (obj === null) {
    return [{ path: parentPath, value: null, type: 'null' }];
  }

  if (Array.isArray(obj)) {
    // For arrays, add the array itself and each item
    results.push({ path: parentPath, value: obj, type: 'array' });
    obj.forEach((item, index) => {
      const itemPath = parentPath ? `${parentPath}[${index}]` : `[${index}]`;
      results.push(...extractAllPaths(item, itemPath));
    });
    return results;
  }

  if (typeof obj === 'object') {
    // For objects, add the object itself (if has a path) and recurse into children
    if (parentPath) {
      results.push({ path: parentPath, value: obj, type: 'object' });
    }
    for (const [key, value] of Object.entries(obj)) {
      const childPath = parentPath ? `${parentPath}.${key}` : key;
      results.push(...extractAllPaths(value, childPath));
    }
    return results;
  }

  // Primitive values
  const type = typeof obj as 'string' | 'number' | 'boolean';
  return [{ path: parentPath, value: obj, type }];
}

// ============================================================================
// Token browser endpoint (must be before /:id routes)
// ============================================================================

// GET /api/variable-packages/tokens/list - Get all variables formatted for token browser
variablePackagesRouter.get('/tokens/list', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const variables = await db
      .collection<VariablePackage>('variable_packages')
      .find({ isActive: true })
      .sort({ name: 1 })
      .toArray();

    // Format for token browser consumption
    const tokens = variables.map((v) => {
      // Try to parse as JSON or YAML to detect structure
      let parsedValue: unknown = null;
      let rawValue: string | null = null;

      if (v.encrypted) {
        // For encrypted values, show placeholder
        rawValue = '••••••••';
      } else {
        rawValue = v.value;
        parsedValue = tryParseValue(v.value);
      }

      // Extract all paths and values recursively
      const paths: KeyValuePath[] = parsedValue !== null
        ? extractAllPaths(parsedValue)
        : [];

      return {
        variableId: v._id.toString(),
        name: v.name,
        description: v.description,
        encrypted: v.encrypted,
        isObject: parsedValue !== null && typeof parsedValue === 'object',
        // For simple values, include the raw value
        value: parsedValue === null ? rawValue : null,
        // For objects, include all paths with their values
        paths,
      };
    });

    res.json({ data: tokens });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Variable Safety endpoints (must be before /:id routes)
// ============================================================================

// GET /api/variable-packages/manifest - Get variable names + sensitivity (NO values)
// Safe for daemon/agent consumption — tells agents what variables exist without revealing values
variablePackagesRouter.get('/manifest', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const manifest = await getVariableManifest();
    res.json({ data: manifest });
  } catch (error) {
    next(error);
  }
});

// POST /api/variable-packages/resolve - Resolve $VAR{name} references server-side
// Used by the daemon to resolve opaque variable references in agent responses
variablePackagesRouter.post('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, fields } = req.body;

    if (!text && !fields) {
      throw createError('Either "text" or "fields" is required', 400);
    }

    const result: Record<string, unknown> = {};

    if (text && typeof text === 'string') {
      result.text = await resolveOpaqueReferences(text);
    }

    if (fields && typeof fields === 'object') {
      result.fields = await resolveOpaqueReferencesInObject(fields);
    }

    // Audit log
    const varRefs = (JSON.stringify(req.body).match(/\$VAR\{([^}]+)\}/g) || []);
    if (varRefs.length > 0) {
      console.log(`[AUDIT] Variable resolve: refs=${varRefs.join(',')}, user=${req.user?.userId || 'api-key'}, time=${new Date().toISOString()}`);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// GET /api/variable-packages/secret-patterns - Get decrypted secret values for sanitization
// Used by the daemon to scrub secrets from prompts and conversation logs
// Returns actual decrypted values — ADMIN/API-KEY only
variablePackagesRouter.get('/secret-patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secrets = await getSecretValues();

    // Audit log
    console.log(`[AUDIT] Secret patterns requested: count=${secrets.length}, user=${req.user?.userId || 'api-key'}, time=${new Date().toISOString()}`);

    res.json({ data: { patterns: secrets, count: secrets.length } });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// CRUD endpoints
// ============================================================================

// GET /api/variable-packages - List all variables (encrypted values redacted)
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

    const variables = await db
      .collection<VariablePackage>('variable_packages')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    // Redact encrypted values in response
    const redactedVariables = variables.map((v) => ({
      ...v,
      value: v.encrypted ? '••••••••' : v.value,
    }));

    res.json({ data: redactedVariables });
  } catch (error) {
    next(error);
  }
});

// GET /api/variable-packages/:id - Get variable by ID (encrypted value redacted)
variablePackagesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid variable ID', 400);
    }

    const variable = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!variable) {
      throw createError('Variable not found', 404);
    }

    // Redact encrypted value
    const redactedVariable = {
      ...variable,
      value: variable.encrypted ? '••••••••' : variable.value,
    };

    res.json({ data: redactedVariable });
  } catch (error) {
    next(error);
  }
});

// POST /api/variable-packages - Create a new variable
variablePackagesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, displayName, description, value, encrypted, sensitivity } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    if (value === undefined || value === null) {
      throw createError('value is required', 400);
    }

    // Convert value to string if it's an object
    let valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

    // Check encryption requirement
    const shouldEncrypt = encrypted === true;
    if (shouldEncrypt && !isEncryptionConfigured()) {
      throw createError('VARIABLE_ENCRYPTION_KEY must be configured to use encryption', 400);
    }

    const normalizedName = normalizeVariableName(name);

    // Check for duplicate
    const existing = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ name: normalizedName });
    if (existing) {
      throw createError('Variable with this name already exists', 409);
    }

    // Encrypt if requested
    if (shouldEncrypt) {
      valueStr = encrypt(valueStr);
    }

    const now = new Date();

    // Validate sensitivity if provided
    const validSensitivities = ['secret', 'safe'];
    if (sensitivity && !validSensitivities.includes(sensitivity)) {
      throw createError(`sensitivity must be one of: ${validSensitivities.join(', ')}`, 400);
    }

    const newVariable: Omit<VariablePackage, '_id'> = {
      name: normalizedName,
      displayName: displayName || name,
      description: description || undefined,
      value: valueStr,
      encrypted: shouldEncrypt,
      sensitivity: sensitivity || (shouldEncrypt ? 'secret' : 'safe'),
      isActive: true,
      createdById: req.user?.userId ? new ObjectId(req.user.userId) : null,
      updatedById: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .insertOne(newVariable as VariablePackage);

    const inserted = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: result.insertedId });

    // Redact encrypted value in response
    const redactedVariable = inserted ? {
      ...inserted,
      value: inserted.encrypted ? '••••••••' : inserted.value,
    } : null;

    res.status(201).json({ data: redactedVariable });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/variable-packages/:id - Update a variable
variablePackagesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid variable ID', 400);
    }

    const varId = new ObjectId(req.params.id);
    const updates = { ...req.body };

    // Get existing variable
    const existing = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: varId });

    if (!existing) {
      throw createError('Variable not found', 404);
    }

    // Don't allow updating certain fields
    delete updates._id;
    delete updates.createdAt;
    delete updates.createdById;

    // If name is being updated, normalize it
    if (updates.name) {
      updates.name = normalizeVariableName(updates.name);

      // Check for duplicate with the new name
      const duplicate = await db
        .collection<VariablePackage>('variable_packages')
        .findOne({ name: updates.name, _id: { $ne: varId } });
      if (duplicate) {
        throw createError('Variable with this name already exists', 409);
      }
    }

    // Validate sensitivity if provided
    if (updates.sensitivity !== undefined) {
      const validSensitivities = ['secret', 'safe'];
      if (!validSensitivities.includes(updates.sensitivity)) {
        throw createError(`sensitivity must be one of: ${validSensitivities.join(', ')}`, 400);
      }
    }

    // Handle value and encryption changes
    if (updates.value !== undefined || updates.encrypted !== undefined) {
      const newEncrypted = updates.encrypted !== undefined ? updates.encrypted === true : existing.encrypted;
      let newValue = updates.value !== undefined ? updates.value : existing.value;

      // If value was passed as object, stringify it
      if (typeof newValue !== 'string') {
        newValue = JSON.stringify(newValue, null, 2);
      }

      // Check encryption requirement
      if (newEncrypted && !isEncryptionConfigured()) {
        throw createError('VARIABLE_ENCRYPTION_KEY must be configured to use encryption', 400);
      }

      // Handle encryption state changes
      if (updates.value !== undefined) {
        // New value provided - encrypt if needed
        if (newEncrypted && !isEncrypted(newValue)) {
          newValue = encrypt(newValue);
        }
      } else if (updates.encrypted !== undefined && updates.encrypted !== existing.encrypted) {
        // Encryption flag changed without new value
        if (newEncrypted) {
          // Turning encryption ON - encrypt current value
          newValue = encrypt(existing.value);
        } else {
          // Turning encryption OFF - decrypt current value
          if (isEncrypted(existing.value)) {
            newValue = decrypt(existing.value);
          }
        }
      }

      updates.value = newValue;
      updates.encrypted = newEncrypted;
    }

    updates.updatedAt = new Date();
    updates.updatedById = req.user?.userId ? new ObjectId(req.user.userId) : null;

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: varId },
        { $set: updates },
        { returnDocument: 'after' }
      );

    if (!result) {
      throw createError('Variable not found', 404);
    }

    // Redact encrypted value
    const redactedVariable = {
      ...result,
      value: result.encrypted ? '••••••••' : result.value,
    };

    res.json({ data: redactedVariable });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/variable-packages/:id - Soft delete (deactivate) a variable
variablePackagesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid variable ID', 400);
    }

    const varId = new ObjectId(req.params.id);

    const result = await db
      .collection<VariablePackage>('variable_packages')
      .findOneAndUpdate(
        { _id: varId },
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
      throw createError('Variable not found', 404);
    }

    res.json({ success: true, message: 'Variable deactivated' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Value Reveal (for authorized viewing)
// ============================================================================

// GET /api/variable-packages/:id/reveal - Get decrypted value
variablePackagesRouter.get('/:id/reveal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid variable ID', 400);
    }

    const varId = new ObjectId(req.params.id);

    const variable = await db
      .collection<VariablePackage>('variable_packages')
      .findOne({ _id: varId });

    if (!variable) {
      throw createError('Variable not found', 404);
    }

    // Decrypt if encrypted
    let decryptedValue = variable.value;
    if (variable.encrypted && isEncrypted(variable.value)) {
      decryptedValue = decrypt(variable.value);
    }

    // Log the access for audit purposes
    console.log(`[AUDIT] Variable reveal: name=${variable.name}, user=${req.user?.userId || 'anonymous'}, time=${new Date().toISOString()}`);

    res.json({
      data: {
        variableId: variable._id,
        variableName: variable.name,
        value: decryptedValue,
        encrypted: variable.encrypted,
      },
    });
  } catch (error) {
    next(error);
  }
});
