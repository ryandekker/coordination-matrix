/**
 * Migration: Add archived status to task_status lookups
 *
 * This adds the 'archived' status option to the lookups collection
 * so users can archive completed/old tasks.
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

const ARCHIVED_LOOKUP = {
  type: 'task_status',
  code: 'archived',
  displayName: 'Archived',
  color: '#64748B', // Slate gray
  icon: 'archive',
  sortOrder: 8,
  isActive: true,
};

export const migration: Migration = {
  id: '2024-12-17-001',
  name: 'add-archived-status-lookup',
  description: 'Add archived status to task_status lookups',
  schemaVersion: 3,

  async up(db: Db): Promise<void> {
    // Check if archived status already exists
    const existing = await db.collection('lookups').findOne({
      type: 'task_status',
      code: 'archived',
    });

    if (existing) {
      console.log('[Migration] Archived status lookup already exists');
      return;
    }

    // Insert the archived status lookup
    await db.collection('lookups').insertOne(ARCHIVED_LOOKUP);
    console.log('[Migration] Added archived status lookup');
  },

  async down(db: Db): Promise<void> {
    // Remove the archived status lookup
    await db.collection('lookups').deleteOne({
      type: 'task_status',
      code: 'archived',
    });
    console.log('[Migration] Removed archived status lookup');
  },
};
