/**
 * Database Migration Runner
 *
 * This system allows safe, incremental schema updates without data loss.
 * Migrations are tracked in a _migrations collection and only run once.
 *
 * Usage:
 *   npm run db:migrate        # Run pending migrations
 *   npm run db:migrate:status # Show migration status
 */

import { Db, MongoClient } from 'mongodb';

export interface Migration {
  id: string;
  name: string;
  description?: string;
  up: (db: Db) => Promise<void>;
  down?: (db: Db) => Promise<void>;
}

interface MigrationRecord {
  _id: string;
  name: string;
  appliedAt: Date;
  durationMs: number;
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

  async runPending(): Promise<{ applied: string[]; errors: string[] }> {
    const pending = await this.getPendingMigrations();
    const applied: string[] = [];
    const errors: string[] = [];

    for (const migration of pending) {
      const startTime = Date.now();
      try {
        console.log(`[Migration] Running: ${migration.id} - ${migration.name}`);
        await migration.up(this.db);

        await this.migrationsCollection.insertOne({
          _id: migration.id,
          name: migration.name,
          appliedAt: new Date(),
          durationMs: Date.now() - startTime,
        });

        applied.push(migration.id);
        console.log(`[Migration] ✓ Completed: ${migration.id} (${Date.now() - startTime}ms)`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${migration.id}: ${errorMsg}`);
        console.error(`[Migration] ✗ Failed: ${migration.id}`, error);
        break; // Stop on first error
      }
    }

    return { applied, errors };
  }

  async status(): Promise<{
    applied: MigrationRecord[];
    pending: Migration[];
  }> {
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();
    return { applied, pending };
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
    console.log(`[Migration] ✓ Rolled back: ${migrationId}`);
  }
}

// Helper functions for common migration operations
export const migrationHelpers = {
  /**
   * Update a collection's JSON Schema validator
   * This preserves existing data while updating validation rules
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
      await db.createCollection(collectionName, { validator });
      return;
    }

    // Update existing collection's validator
    await db.command({
      collMod: collectionName,
      validator,
      validationLevel: 'moderate', // Allow existing invalid docs, validate new ones
    });
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
