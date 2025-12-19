/**
 * Database Migrations Registry
 *
 * All migrations should be imported and registered here.
 * Migrations are executed in order based on their ID.
 */

import { Migration } from './runner.js';

// Import all migrations
import { migration as addWorkflowTaskFields } from './2024-12-14-001-add-workflow-task-fields.js';
import { migration as addWorkflowColumnsToViews } from './2024-12-15-001-add-workflow-columns-to-views.js';
import { migration as addArchivedStatusLookup } from './2024-12-17-001-add-archived-status-lookup.js';
import { migration as renameSubflowToFlow } from './2024-12-17-002-rename-subflow-to-flow.js';

// Register all migrations in order
export const migrations: Migration[] = [
  addWorkflowTaskFields,
  addWorkflowColumnsToViews,
  addArchivedStatusLookup,
  renameSubflowToFlow,
];
