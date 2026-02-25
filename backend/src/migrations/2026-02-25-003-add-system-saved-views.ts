/**
 * Migration: Add System Saved Views for Task Segmentation
 *
 * Creates pre-configured saved views for common task filtering patterns:
 * - Human Tasks: Tasks created by humans
 * - Agent Tasks: Tasks created by agents or system
 * - Escalated: Tasks escalated to human attention
 * - Background Processing: Active agent/system tasks
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

export const migration: Migration = {
  id: '2026-02-25-003',
  name: 'add-system-saved-views',
  description: 'Add system saved views for task segmentation (human, agent, escalated, background)',

  async up(db: Db): Promise<void> {
    const viewsCollection = db.collection('views');
    const viewFoldersCollection = db.collection('view_folders');

    // Create a "System Views" folder
    const existingFolder = await viewFoldersCollection.findOne({ name: 'System Views' });
    let folderId = existingFolder?._id;

    if (!existingFolder) {
      const folderResult = await viewFoldersCollection.insertOne({
        name: 'System Views',
        collectionName: 'tasks',
        sortOrder: 100,
        isExpanded: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      folderId = folderResult.insertedId;
      console.log('[Migration] Created "System Views" folder');
    }

    const systemViews = [
      {
        name: 'Human Tasks',
        collectionName: 'tasks',
        isDefault: false,
        isSystem: true,
        filters: { creatorType: ['human'] },
        sorting: [{ field: 'createdAt', direction: 'desc' }],
        visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'projectId', 'createdById', 'tags', 'createdAt'],
        folderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Agent Tasks',
        collectionName: 'tasks',
        isDefault: false,
        isSystem: true,
        filters: { creatorType: ['agent', 'system'] },
        sorting: [{ field: 'createdAt', direction: 'desc' }],
        visibleColumns: ['title', 'status', 'assigneeId', 'creatorType', 'workflowId', 'workflowStage', 'tags', 'createdAt'],
        folderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Escalated',
        collectionName: 'tasks',
        isDefault: false,
        isSystem: true,
        filters: { status: ['on_hold'], tags: ['escalated'] },
        sorting: [{ field: 'updatedAt', direction: 'desc' }],
        visibleColumns: ['title', 'status', 'urgency', 'createdById', 'tags', 'updatedAt'],
        folderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Background Processing',
        collectionName: 'tasks',
        isDefault: false,
        isSystem: true,
        filters: { creatorType: ['agent', 'system'], status: ['pending', 'in_progress', 'waiting'] },
        sorting: [{ field: 'updatedAt', direction: 'desc' }],
        visibleColumns: ['title', 'status', 'assigneeId', 'workflowId', 'workflowStage', 'updatedAt'],
        folderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    for (const view of systemViews) {
      const existing = await viewsCollection.findOne({
        name: view.name,
        isSystem: true,
      });
      if (!existing) {
        await viewsCollection.insertOne(view);
        console.log(`[Migration] Created system view: ${view.name}`);
      } else {
        console.log(`[Migration] System view already exists: ${view.name}`);
      }
    }
  },

  async down(db: Db): Promise<void> {
    const viewsCollection = db.collection('views');
    const viewFoldersCollection = db.collection('view_folders');

    const viewNames = ['Human Tasks', 'Agent Tasks', 'Escalated', 'Background Processing'];
    for (const name of viewNames) {
      await viewsCollection.deleteOne({ name, isSystem: true });
    }
    console.log('[Migration] Removed system views');

    await viewFoldersCollection.deleteOne({ name: 'System Views' });
    console.log('[Migration] Removed System Views folder');
  },
};
