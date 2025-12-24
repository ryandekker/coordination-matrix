/**
 * Migration: Add "Unassigned" system view
 *
 * This adds a new default system view that shows tasks that have no assignee
 * and are in an active status (pending, in_progress, waiting, on_hold).
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

export const migration: Migration = {
  id: '2024-12-24-003',
  name: 'add-unassigned-view',
  description: 'Add "Unassigned" system view for tasks without an assignee',
  schemaVersion: 2,

  async up(db: Db): Promise<void> {
    // Check if view already exists
    const existing = await db.collection('views').findOne({
      name: 'Unassigned',
      collectionName: 'tasks',
      isSystem: true,
    });

    if (existing) {
      console.log('[Migration] "Unassigned" view already exists, skipping');
      return;
    }

    // Insert the new view
    await db.collection('views').insertOne({
      name: 'Unassigned',
      collectionName: 'tasks',
      isDefault: false,
      isSystem: true,
      filters: {
        assigneeId: ['__unassigned__'],
        status: ['pending', 'in_progress', 'waiting', 'on_hold'],
      },
      sorting: [
        { field: 'urgency', direction: 'desc' },
        { field: 'createdAt', direction: 'asc' },
      ],
      visibleColumns: [
        'title',
        'status',
        'urgency',
        'workflowId',
        'workflowStage',
        'dueAt',
        'createdAt',
      ],
      createdAt: new Date(),
    });

    console.log('[Migration] Added "Unassigned" system view');
  },

  async down(db: Db): Promise<void> {
    // Remove the view
    const result = await db.collection('views').deleteOne({
      name: 'Unassigned',
      collectionName: 'tasks',
      isSystem: true,
    });

    if (result.deletedCount > 0) {
      console.log('[Migration] Removed "Unassigned" system view');
    } else {
      console.log('[Migration] "Unassigned" view not found');
    }
  },
};
