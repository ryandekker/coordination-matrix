/**
 * Migration: Add sensitivity field to variable_packages
 *
 * Adds LLM safety classification to variables:
 * - 'secret': Never expose to LLMs (default for encrypted variables)
 * - 'safe': Can appear in LLM prompts (default for unencrypted variables)
 *
 * Also updates the collection validator to match the current data model
 * (value/encrypted fields instead of the old branches/schema model).
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

// Current variable_packages validator matching the actual data model
const VARIABLE_PACKAGES_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['name', 'createdAt', 'isActive'],
    properties: {
      name: {
        bsonType: 'string',
        description: 'Variable name (unique, used in templates) - required',
      },
      displayName: {
        bsonType: ['string', 'null'],
        description: 'Human-readable display name',
      },
      description: {
        bsonType: ['string', 'null'],
        description: 'Variable description',
      },
      // Current model: single value with optional encryption
      value: {
        bsonType: 'string',
        description: 'Variable value (may be encrypted with enc: prefix)',
      },
      encrypted: {
        bsonType: 'bool',
        description: 'Whether the value is encrypted at rest',
      },
      // Legacy model: branch-based storage (kept for backward compat)
      branches: {
        bsonType: 'object',
        description: 'Map of branch name -> branch data (legacy)',
      },
      defaultBranch: {
        bsonType: 'string',
        description: 'Default branch name (legacy)',
      },
      schema: {
        bsonType: 'array',
        description: 'Field schema for the package (legacy)',
      },
      // LLM safety classification
      sensitivity: {
        bsonType: 'string',
        enum: ['secret', 'safe'],
        description: 'LLM safety: secret=never expose to LLMs, safe=can appear in prompts',
      },
      // Ownership and audit
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who created this variable',
      },
      updatedById: {
        bsonType: ['objectId', 'null'],
        description: 'User who last updated this variable',
      },
      isActive: {
        bsonType: 'bool',
        description: 'Whether the variable is active',
      },
      createdAt: {
        bsonType: 'date',
        description: 'Creation timestamp',
      },
      updatedAt: {
        bsonType: 'date',
        description: 'Last update timestamp',
      },
    },
  },
};

export const migration: Migration = {
  id: '2026-03-15-001',
  name: 'add-variable-sensitivity',
  description: 'Add sensitivity field to variable_packages and sync collection validator',

  async up(db: Db): Promise<void> {
    const collection = db.collection('variable_packages');

    // Set sensitivity='secret' on encrypted variables
    const encryptedResult = await collection.updateMany(
      { encrypted: true, sensitivity: { $exists: false } },
      { $set: { sensitivity: 'secret' } }
    );
    console.log(`[Migration] Set sensitivity=secret on ${encryptedResult.modifiedCount} encrypted variables`);

    // Set sensitivity='safe' on unencrypted variables
    const unencryptedResult = await collection.updateMany(
      { $or: [{ encrypted: false }, { encrypted: { $exists: false } }], sensitivity: { $exists: false } },
      { $set: { sensitivity: 'safe' } }
    );
    console.log(`[Migration] Set sensitivity=safe on ${unencryptedResult.modifiedCount} unencrypted variables`);

    // Update collection validator to match current data model
    try {
      await db.command({
        collMod: 'variable_packages',
        validator: VARIABLE_PACKAGES_VALIDATOR,
        validationLevel: 'moderate',
      });
      console.log('[Migration] ✓ Updated variable_packages collection validator');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('not allowed') || errorMsg.includes('AtlasError') || errorMsg.includes('Unauthorized')) {
        console.log('[Migration] ⚠ Skipping validator update (insufficient permissions). Application will still work.');
        return;
      }
      throw error;
    }
  },

  async down(db: Db): Promise<void> {
    const collection = db.collection('variable_packages');
    await collection.updateMany(
      {},
      { $unset: { sensitivity: '' } }
    );
    console.log('[Migration] Removed sensitivity field from all variables');
  },
};
