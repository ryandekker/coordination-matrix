/**
 * Database Migration Runner
 *
 * This system allows safe, incremental schema updates without data loss.
 * Migrations are tracked in a _migrations collection and only run once.
 * Schema version is tracked in a _schema_info collection.
 *
 * Usage:
 *   npm run db:migrate        # Run pending migrations
 *   npm run db:migrate:status # Show migration status
 */

import { Db } from 'mongodb';

export interface Migration {
  id: string;
  name: string;
  description?: string;
  schemaVersion?: number; // Schema version this migration brings the DB to
  up: (db: Db) => Promise<void>;
  down?: (db: Db) => Promise<void>;
}

interface MigrationRecord {
  _id: string;
  name: string;
  appliedAt: Date;
  durationMs: number;
  schemaVersion?: number;
}

interface SchemaInfo {
  _id: 'schema_version';
  version: number;
  updatedAt: Date;
  lastMigrationId: string;
}

export class MigrationRunner {
  private db: Db;
  private migrations: Migration[] = [];

  constructor(db: Db) {
    this.db = db;
  }

  register(migration: Migration): void {
    this.migrations.push(migration);
  }

  registerAll(migrations: Migration[]): void {
    migrations.forEach((m) => this.register(m));
  }

  private get migrationsCollection() {
    return this.db.collection<MigrationRecord>('_migrations');
  }

  private get schemaInfoCollection() {
    return this.db.collection<SchemaInfo>('_schema_info');
  }

  async getSchemaVersion(): Promise<number> {
    const info = await this.schemaInfoCollection.findOne({ _id: 'schema_version' });
    return info?.version ?? 0;
  }

  private async updateSchemaVersion(version: number, migrationId: string): Promise<void> {
    await this.schemaInfoCollection.updateOne(
      { _id: 'schema_version' },
      {
        $set: {
          version,
          updatedAt: new Date(),
          lastMigrationId: migrationId,
        },
      },
      { upsert: true }
    );
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    return this.migrationsCollection.find().sort({ appliedAt: 1 }).toArray();
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const applied = await this.getAppliedMigrations();
    const appliedIds = new Set(applied.map((m) => m._id));
    return this.migrations
      .filter((m) => !appliedIds.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async runPending(): Promise<{ applied: string[]; errors: string[]; schemaVersion: number }> {
    const pending = await this.getPendingMigrations();
    const applied: string[] = [];
    const errors: string[] = [];
    let currentSchemaVersion = await this.getSchemaVersion();

    for (const migration of pending) {
      const startTime = Date.now();
      try {
        console.log(`[Migration] Running: ${migration.id} - ${migration.name}`);
        await migration.up(this.db);

        // Update schema version if migration specifies one
        if (migration.schemaVersion !== undefined) {
          currentSchemaVersion = migration.schemaVersion;
          await this.updateSchemaVersion(currentSchemaVersion, migration.id);
        }

        await this.migrationsCollection.insertOne({
          _id: migration.id,
          name: migration.name,
          appliedAt: new Date(),
          durationMs: Date.now() - startTime,
          schemaVersion: migration.schemaVersion,
        });

        applied.push(migration.id);
        console.log(`[Migration] ✓ Completed: ${migration.id} (${Date.now() - startTime}ms)${migration.schemaVersion ? ` [Schema v${migration.schemaVersion}]` : ''}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${migration.id}: ${errorMsg}`);
        console.error(`[Migration] ✗ Failed: ${migration.id}`, error);
        break; // Stop on first error
      }
    }

    return { applied, errors, schemaVersion: currentSchemaVersion };
  }

  async status(): Promise<{
    applied: MigrationRecord[];
    pending: Migration[];
    schemaVersion: number;
  }> {
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();
    const schemaVersion = await this.getSchemaVersion();
    return { applied, pending, schemaVersion };
  }

  async rollback(migrationId: string): Promise<void> {
    const migration = this.migrations.find((m) => m.id === migrationId);
    if (!migration) {
      throw new Error(`Migration ${migrationId} not found`);
    }
    if (!migration.down) {
      throw new Error(`Migration ${migrationId} does not have a down function`);
    }

    const record = await this.migrationsCollection.findOne({ _id: migrationId });
    if (!record) {
      throw new Error(`Migration ${migrationId} has not been applied`);
    }

    console.log(`[Migration] Rolling back: ${migrationId}`);
    await migration.down(this.db);
    await this.migrationsCollection.deleteOne({ _id: migrationId });

    // Recalculate schema version from remaining migrations
    const remaining = await this.getAppliedMigrations();
    const lastWithVersion = [...remaining].reverse().find((m) => m.schemaVersion !== undefined);
    if (lastWithVersion) {
      await this.updateSchemaVersion(lastWithVersion.schemaVersion!, lastWithVersion._id);
    } else {
      // No migrations with version remain, reset to 0
      await this.schemaInfoCollection.deleteOne({ _id: 'schema_version' });
    }

    console.log(`[Migration] ✓ Rolled back: ${migrationId}`);
  }
}

// Helper functions for common migration operations
export const migrationHelpers = {
  /**
   * Create a collection with optional validator
   * On MongoDB Atlas without dbAdmin role, creates without validator and logs warning
   */
  async createCollection(
    db: Db,
    collectionName: string,
    validator?: object
  ): Promise<void> {
    // Check if collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length > 0) {
      console.log(`[Migration] Collection ${collectionName} already exists`);
      return;
    }

    if (validator) {
      try {
        await db.createCollection(collectionName, { validator });
        console.log(`[Migration] Created ${collectionName} collection with validator`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('not allowed') || errorMsg.includes('AtlasError')) {
          console.log(`[Migration] ⚠ Cannot create ${collectionName} with validator (permission denied), creating without`);
          await db.createCollection(collectionName);
        } else {
          throw error;
        }
      }
    } else {
      await db.createCollection(collectionName);
      console.log(`[Migration] Created ${collectionName} collection`);
    }
  },

  /**
   * Update a collection's JSON Schema validator
   * This preserves existing data while updating validation rules
   * Note: On MongoDB Atlas, this requires dbAdmin role. If permission is denied,
   * the function will log a warning but not fail (validators are optional).
   */
  async updateValidator(
    db: Db,
    collectionName: string,
    validator: object
  ): Promise<void> {
    // Check if collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
      // Collection doesn't exist, create it with the validator
      try {
        await db.createCollection(collectionName, { validator });
      } catch (error) {
        // If we can't create with validator, create without
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('not allowed') || errorMsg.includes('AtlasError')) {
          console.log(`[Migration] ⚠ Cannot set validator on ${collectionName} (permission denied), creating without validator`);
          await db.createCollection(collectionName);
        } else {
          throw error;
        }
      }
      return;
    }

    // Update existing collection's validator
    try {
      await db.command({
        collMod: collectionName,
        validator,
        validationLevel: 'moderate', // Allow existing invalid docs, validate new ones
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Skip permission errors on Atlas - validators are optional
      if (errorMsg.includes('not allowed') || errorMsg.includes('AtlasError')) {
        console.log(`[Migration] ⚠ Cannot update validator on ${collectionName} (permission denied), skipping`);
      } else {
        throw error;
      }
    }
  },

  /**
   * Create an index if it doesn't exist
   */
  async ensureIndex(
    db: Db,
    collectionName: string,
    keys: Record<string, 1 | -1 | 'text'>,
    options?: { unique?: boolean; sparse?: boolean; name?: string }
  ): Promise<void> {
    const collection = db.collection(collectionName);
    try {
      await collection.createIndex(keys, options);
    } catch (error) {
      // Index might already exist with different options, that's OK
      if ((error as Error).message?.includes('already exists')) {
        console.log(`[Migration] Index already exists on ${collectionName}`);
      } else {
        throw error;
      }
    }
  },

  /**
   * Add a field to all documents if it doesn't exist
   */
  async addFieldIfMissing(
    db: Db,
    collectionName: string,
    fieldPath: string,
    defaultValue: unknown
  ): Promise<number> {
    const result = await db.collection(collectionName).updateMany(
      { [fieldPath]: { $exists: false } },
      { $set: { [fieldPath]: defaultValue } }
    );
    return result.modifiedCount;
  },
};
