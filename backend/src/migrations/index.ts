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
import { migration as addActivityLogsCollection } from './2025-12-19-001-add-activity-logs-collection.js';
import { migration as addWebhooksCollections } from './2025-12-19-002-add-webhooks-collections.js';
import { migration as addDaemonBatchCollections } from './2025-12-19-003-add-daemon-batch-collections.js';
import { migration as addMissingTaskIndexes } from './2025-12-19-004-add-missing-task-indexes.js';
import { migration as removeAdditionalInfo } from './2024-12-24-001-remove-additional-info.js';
import { migration as addWaitingStatusLookup } from './2024-12-24-002-add-waiting-status-lookup.js';
import { migration as addUnassignedView } from './2024-12-24-003-add-unassigned-view.js';
import { migration as addTaskSortIndexes } from './2025-12-25-001-add-task-sort-indexes.js';

// Register all migrations in order
export const migrations: Migration[] = [
  addWorkflowTaskFields,
  addWorkflowColumnsToViews,
  addArchivedStatusLookup,
  renameSubflowToFlow,
  addActivityLogsCollection,
  addWebhooksCollections,
  addDaemonBatchCollections,
  addMissingTaskIndexes,
  removeAdditionalInfo,
  addWaitingStatusLookup,
  addUnassignedView,
  addTaskSortIndexes,
];
