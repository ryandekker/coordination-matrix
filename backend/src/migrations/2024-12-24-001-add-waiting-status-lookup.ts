/**
 * Migration: Add waiting status to task_status lookups
 *
 * This adds the 'waiting' status option to the lookups collection
 * for workflow tasks that are waiting for child tasks (foreach, join, flow).
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

const WAITING_LOOKUP = {
  type: 'task_status',
  code: 'waiting',
  displayName: 'Waiting',
  color: '#8B5CF6', // Purple
  icon: 'hourglass',
  sortOrder: 3, // After in_progress, before on_hold
  isActive: true,
};

export const migration: Migration = {
  id: '2024-12-24-001',
  name: 'add-waiting-status-lookup',
  description: 'Add waiting status to task_status lookups for workflow tasks',
  schemaVersion: 8,

  async up(db: Db): Promise<void> {
    // Check if waiting status already exists
    const existing = await db.collection('lookups').findOne({
      type: 'task_status',
      code: 'waiting',
    });

    if (existing) {
      console.log('[Migration] Waiting status lookup already exists');
      return;
    }

    // Insert the waiting status lookup
    await db.collection('lookups').insertOne(WAITING_LOOKUP);
    console.log('[Migration] Added waiting status lookup');
  },

  async down(db: Db): Promise<void> {
    // Remove the waiting status lookup
    await db.collection('lookups').deleteOne({
      type: 'task_status',
      code: 'waiting',
    });
    console.log('[Migration] Removed waiting status lookup');
  },
};
