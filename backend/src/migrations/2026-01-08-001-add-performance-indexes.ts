/**
 * Migration: Add compound indexes for performance optimization
 *
 * Adds compound indexes identified during performance audit to optimize:
 * - Workflow step lookups with status filter
 * - Assignee-based queries with status and date sort
 *
 * Indexes added:
 * - { workflowStepId: 1, status: 1 } - For workflow step task lookups
 * - { assigneeId: 1, status: 1, createdAt: -1 } - For assignee queries with filtering/sorting
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

export const migration: Migration = {
  id: '2026-01-08-001',
  name: 'add-performance-indexes',
  description: 'Add compound indexes for performance optimization (workflowStepId+status, assigneeId+status+createdAt)',
  schemaVersion: 9,

  async up(db: Db): Promise<void> {
    // Compound index for workflow step with status filter
    // Used in workflow step lookups to find tasks at a specific step with a specific status
    await migrationHelpers.ensureIndex(db, 'tasks', { workflowStepId: 1, status: 1 });
    console.log('[Migration] Created workflowStepId + status compound index on tasks');

    // Compound index for assignee-based queries with status and date sort
    // Used for "my tasks" views, assignee dashboards, etc.
    await migrationHelpers.ensureIndex(db, 'tasks', { assigneeId: 1, status: 1, createdAt: -1 });
    console.log('[Migration] Created assigneeId + status + createdAt compound index on tasks');
  },

  async down(db: Db): Promise<void> {
    // Drop the indexes
    const tasksCollection = db.collection('tasks');

    try {
      await tasksCollection.dropIndex('workflowStepId_1_status_1');
      console.log('[Migration] Dropped workflowStepId + status index');
    } catch {
      console.log('[Migration] workflowStepId + status index does not exist');
    }

    try {
      await tasksCollection.dropIndex('assigneeId_1_status_1_createdAt_-1');
      console.log('[Migration] Dropped assigneeId + status + createdAt index');
    } catch {
      console.log('[Migration] assigneeId + status + createdAt index does not exist');
    }
  },
};
