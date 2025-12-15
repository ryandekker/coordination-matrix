#!/usr/bin/env tsx
/**
 * Database Migration CLI
 *
 * Usage:
 *   npx tsx src/migrations/cli.ts           # Run pending migrations
 *   npx tsx src/migrations/cli.ts status    # Show migration status
 *   npx tsx src/migrations/cli.ts rollback <id>  # Rollback a migration
 */

import { MongoClient } from 'mongodb';
import { MigrationRunner } from './runner.js';
import { migrations } from './index.js';

// Default to authenticated local connection using standard dev credentials
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:adminpassword@localhost:27017';
const DB_NAME = process.env.DB_NAME || 'coordination_matrix';

async function main() {
  const command = process.argv[2] || 'run';

  console.log(`[Migration CLI] Connecting to MongoDB at ${MONGODB_URI}...`);
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const runner = new MigrationRunner(db);
    runner.registerAll(migrations);

    switch (command) {
      case 'run': {
        console.log('[Migration CLI] Running pending migrations...');
        const result = await runner.runPending();

        if (result.applied.length === 0 && result.errors.length === 0) {
          console.log('[Migration CLI] No pending migrations');
        } else if (result.errors.length > 0) {
          console.error('[Migration CLI] Errors:', result.errors);
          process.exit(1);
        } else {
          console.log(`[Migration CLI] Applied ${result.applied.length} migration(s)`);
        }
        break;
      }

      case 'status': {
        const status = await runner.status();
        console.log('\n=== Migration Status ===\n');

        console.log('Applied migrations:');
        if (status.applied.length === 0) {
          console.log('  (none)');
        } else {
          for (const m of status.applied) {
            console.log(`  ✓ ${m._id} - ${m.name} (applied ${m.appliedAt.toISOString()})`);
          }
        }

        console.log('\nPending migrations:');
        if (status.pending.length === 0) {
          console.log('  (none)');
        } else {
          for (const m of status.pending) {
            console.log(`  ○ ${m.id} - ${m.name}`);
          }
        }
        break;
      }

      case 'rollback': {
        const migrationId = process.argv[3];
        if (!migrationId) {
          console.error('Usage: cli.ts rollback <migration-id>');
          process.exit(1);
        }
        await runner.rollback(migrationId);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: cli.ts [run|status|rollback <id>]');
        process.exit(1);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[Migration CLI] Error:', err);
  process.exit(1);
});
