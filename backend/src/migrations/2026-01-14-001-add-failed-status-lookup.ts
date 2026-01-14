/**
 * Migration: Add failed status to task_status lookups
 *
 * This adds the 'failed' status option to the lookups collection
 * for tasks that have failed execution (distinct from on_hold).
 * Used by webhook task service, workflow execution, and batch jobs.
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

const FAILED_LOOKUP = {
  type: 'task_status',
  code: 'failed',
  displayName: 'Failed',
  color: '#EF4444', // Red
  icon: 'x-circle',
  sortOrder: 6, // After completed, before cancelled
  isActive: true,
};

export const migration: Migration = {
  id: '2026-01-14-001',
  name: 'add-failed-status-lookup',
  description: 'Add failed status to task_status lookups for error handling',
  schemaVersion: 11,

  async up(db: Db): Promise<void> {
    // Check if failed status already exists
    const existing = await db.collection('lookups').findOne({
      type: 'task_status',
      code: 'failed',
    });

    if (existing) {
      console.log('[Migration] Failed status lookup already exists');
      return;
    }

    // Insert the failed status lookup
    await db.collection('lookups').insertOne(FAILED_LOOKUP);
    console.log('[Migration] Added failed status lookup');
  },

  async down(db: Db): Promise<void> {
    // Remove the failed status lookup
    await db.collection('lookups').deleteOne({
      type: 'task_status',
      code: 'failed',
    });
    console.log('[Migration] Removed failed status lookup');
  },
};
