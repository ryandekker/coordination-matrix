/**
 * Migration: Add compound indexes for task sorting
 *
 * Adds compound indexes to prevent MongoDB blocking in-memory sorts that exceed
 * the 32MB memory limit. This is critical for:
 * - GET /api/workflow-runs/:id?includeTasks=true with large task sets
 * - Queries filtering by parentId and sorting by createdAt
 *
 * Indexes added:
 * - { workflowRunId: 1, createdAt: 1 } - For workflow run task listings
 * - { workflowRunId: 1, status: 1 } - For status filtering within workflow runs
 * - { parentId: 1, createdAt: 1 } - For subtask listings
 * - { parentId: 1, status: 1, createdAt: 1 } - For filtered subtask listings
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

export const migration: Migration = {
  id: '2025-12-25-001',
  name: 'add-task-sort-indexes',
  description: 'Add compound indexes for task sorting to prevent memory limit errors',
  schemaVersion: 8,

  async up(db: Db): Promise<void> {
    // Compound index for workflow run task queries (filter + sort)
    await migrationHelpers.ensureIndex(db, 'tasks', { workflowRunId: 1, createdAt: 1 });
    console.log('[Migration] Created workflowRunId + createdAt compound index on tasks');

    // Compound index for workflow run status filtering
    await migrationHelpers.ensureIndex(db, 'tasks', { workflowRunId: 1, status: 1 });
    console.log('[Migration] Created workflowRunId + status compound index on tasks');

    // Compound index for subtask queries (filter by parent + sort)
    await migrationHelpers.ensureIndex(db, 'tasks', { parentId: 1, createdAt: 1 });
    console.log('[Migration] Created parentId + createdAt compound index on tasks');

    // Compound index for filtered subtask queries (parent + status + sort)
    await migrationHelpers.ensureIndex(db, 'tasks', { parentId: 1, status: 1, createdAt: 1 });
    console.log('[Migration] Created parentId + status + createdAt compound index on tasks');
  },

  async down(db: Db): Promise<void> {
    // Drop the indexes
    const tasksCollection = db.collection('tasks');

    try {
      await tasksCollection.dropIndex('workflowRunId_1_createdAt_1');
      console.log('[Migration] Dropped workflowRunId + createdAt index');
    } catch {
      console.log('[Migration] workflowRunId + createdAt index does not exist');
    }

    try {
      await tasksCollection.dropIndex('workflowRunId_1_status_1');
      console.log('[Migration] Dropped workflowRunId + status index');
    } catch {
      console.log('[Migration] workflowRunId + status index does not exist');
    }

    try {
      await tasksCollection.dropIndex('parentId_1_createdAt_1');
      console.log('[Migration] Dropped parentId + createdAt index');
    } catch {
      console.log('[Migration] parentId + createdAt index does not exist');
    }

    try {
      await tasksCollection.dropIndex('parentId_1_status_1_createdAt_1');
      console.log('[Migration] Dropped parentId + status + createdAt index');
    } catch {
      console.log('[Migration] parentId + status + createdAt index does not exist');
    }
  },
};
