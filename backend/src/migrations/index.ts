/**
 * Database Migrations Registry
 *
 * All migrations should be imported and registered here.
 * Migrations are executed in order based on their ID.
 */

import { Migration } from './runner.js';

// Import all migrations
import { migration as addWorkflowTaskFields } from './2024-12-14-001-add-workflow-task-fields.js';

// Register all migrations in order
export const migrations: Migration[] = [
  addWorkflowTaskFields,
];
