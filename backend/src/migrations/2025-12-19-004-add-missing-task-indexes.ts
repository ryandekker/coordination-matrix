/**
 * Migration: Add missing task indexes
 *
 * Adds indexes that are in the init script but may not exist in production:
 * - workflowStepId index (for join step lookups)
 * - taskType index (for filtering by task type)
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

export const migration: Migration = {
  id: '2025-12-19-004',
  name: 'add-missing-task-indexes',
  description: 'Add workflowStepId and taskType indexes to tasks collection',
  schemaVersion: 7,

  async up(db: Db): Promise<void> {
    // Add index for workflowStepId (used for join step lookups)
    await migrationHelpers.ensureIndex(db, 'tasks', { workflowStepId: 1 });
    console.log('[Migration] Created workflowStepId index on tasks');

    // Add index for taskType (used for filtering by task type)
    await migrationHelpers.ensureIndex(db, 'tasks', { taskType: 1 });
    console.log('[Migration] Created taskType index on tasks');
  },

  async down(db: Db): Promise<void> {
    // Drop the indexes
    try {
      await db.collection('tasks').dropIndex('workflowStepId_1');
      console.log('[Migration] Dropped workflowStepId index');
    } catch {
      console.log('[Migration] workflowStepId index does not exist');
    }

    try {
      await db.collection('tasks').dropIndex('taskType_1');
      console.log('[Migration] Dropped taskType index');
    } catch {
      console.log('[Migration] taskType index does not exist');
    }
  },
};
