/**
 * Migration: Add workflow columns to default views
 *
 * This adds workflowId and workflowStage columns to the default "All Tasks" view
 * so users can see which workflow and stage a task belongs to.
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

export const migration: Migration = {
  id: '2024-12-15-001',
  name: 'add-workflow-columns-to-views',
  description: 'Add workflowId and workflowStage columns to default views',

  async up(db: Db): Promise<void> {
    // Update the "All Tasks" view to include workflow columns
    const result = await db.collection('views').updateOne(
      { name: 'All Tasks', collectionName: 'tasks' },
      {
        $addToSet: {
          visibleColumns: { $each: ['workflowId', 'workflowStage'] }
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log('[Migration] Added workflow columns to "All Tasks" view');
    } else {
      console.log('[Migration] "All Tasks" view not found or already has workflow columns');
    }

    // Also update field configs to make workflow columns visible by default
    await db.collection('field_configs').updateOne(
      { collectionName: 'tasks', fieldPath: 'workflowId' },
      { $set: { defaultVisible: true } }
    );

    await db.collection('field_configs').updateOne(
      { collectionName: 'tasks', fieldPath: 'workflowStage' },
      { $set: { defaultVisible: true } }
    );

    console.log('[Migration] Updated field configs for workflow columns');
  },

  async down(db: Db): Promise<void> {
    // Remove workflow columns from "All Tasks" view
    await db.collection('views').updateOne(
      { name: 'All Tasks', collectionName: 'tasks' },
      {
        $pull: {
          visibleColumns: { $in: ['workflowId', 'workflowStage'] }
        }
      }
    );

    // Revert field configs
    await db.collection('field_configs').updateOne(
      { collectionName: 'tasks', fieldPath: 'workflowId' },
      { $set: { defaultVisible: false } }
    );

    await db.collection('field_configs').updateOne(
      { collectionName: 'tasks', fieldPath: 'workflowStage' },
      { $set: { defaultVisible: false } }
    );

    console.log('[Migration] Reverted workflow column changes');
  },
};
