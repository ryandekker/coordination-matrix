/**
 * Migration: Add Creator Type and Project Column
 *
 * 1. Adds `creatorType` denormalized field to tasks for efficient filtering
 * 2. Backfills existing tasks with the correct creatorType based on creator user flags
 * 3. Adds `projectId` FieldConfig so projects appear as a table column
 * 4. Adds `creatorType` FieldConfig and lookup values
 * 5. Adds indexes for new fields
 */

import { Db, ObjectId } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

const SYSTEM_USER_ID = new ObjectId('000000000000000000000001');

// Task types that are system-executed (not humans or agents)
const SYSTEM_EXECUTED_TASK_TYPES = [
  'webhook',
  'external',
  'join',
  'decision',
  'trigger',
  'flow',
];

export const migration: Migration = {
  id: '2026-02-25-002',
  name: 'add-creator-type-and-project-column',
  description: 'Add creatorType field to tasks, projectId FieldConfig, and creator_type lookups',

  async up(db: Db): Promise<void> {
    const tasksCollection = db.collection('tasks');
    const usersCollection = db.collection('users');
    const fieldConfigsCollection = db.collection('field_configs');
    const lookupsCollection = db.collection('lookups');

    // 1. Add indexes
    await migrationHelpers.ensureIndex(db, 'tasks', { createdById: 1 });
    console.log('[Migration] Ensured createdById index on tasks');

    await migrationHelpers.ensureIndex(db, 'tasks', { creatorType: 1 });
    console.log('[Migration] Ensured creatorType index on tasks');

    // Compound index for dashboard/kanban queries
    await migrationHelpers.ensureIndex(db, 'tasks', { creatorType: 1, status: 1, assigneeId: 1 });
    console.log('[Migration] Ensured compound index (creatorType, status, assigneeId) on tasks');

    // 2. Backfill creatorType for existing tasks

    // 2a. System-executed task types → 'system'
    const systemTypeResult = await tasksCollection.updateMany(
      {
        taskType: { $in: SYSTEM_EXECUTED_TASK_TYPES },
        creatorType: { $exists: false },
      },
      {
        $set: { creatorType: 'system', updatedAt: new Date() },
      }
    );
    if (systemTypeResult.modifiedCount > 0) {
      console.log(`[Migration] Set creatorType='system' on ${systemTypeResult.modifiedCount} system-executed tasks`);
    }

    // 2b. Tasks created by system user → 'system'
    const systemCreatorResult = await tasksCollection.updateMany(
      {
        createdById: SYSTEM_USER_ID,
        creatorType: { $exists: false },
      },
      {
        $set: { creatorType: 'system', updatedAt: new Date() },
      }
    );
    if (systemCreatorResult.modifiedCount > 0) {
      console.log(`[Migration] Set creatorType='system' on ${systemCreatorResult.modifiedCount} tasks created by System user`);
    }

    // 2c. Tasks created by agent users → 'agent'
    const agentUsers = await usersCollection.find(
      { isAgent: true },
      { projection: { _id: 1 } }
    ).toArray();
    const agentUserIds = agentUsers.map(u => u._id);

    if (agentUserIds.length > 0) {
      const agentCreatorResult = await tasksCollection.updateMany(
        {
          createdById: { $in: agentUserIds },
          creatorType: { $exists: false },
        },
        {
          $set: { creatorType: 'agent', updatedAt: new Date() },
        }
      );
      if (agentCreatorResult.modifiedCount > 0) {
        console.log(`[Migration] Set creatorType='agent' on ${agentCreatorResult.modifiedCount} tasks created by agents`);
      }
    }

    // 2d. Tasks with daemon output metadata but no creatorType → 'agent'
    // These are tasks that were processed by the daemon (have output in metadata)
    // and have an agent assignee, suggesting they were daemon-created
    const daemonProcessedResult = await tasksCollection.updateMany(
      {
        'metadata.output': { $exists: true },
        creatorType: { $exists: false },
        assigneeId: { $in: agentUserIds },
      },
      {
        $set: { creatorType: 'agent', updatedAt: new Date() },
      }
    );
    if (daemonProcessedResult.modifiedCount > 0) {
      console.log(`[Migration] Set creatorType='agent' on ${daemonProcessedResult.modifiedCount} daemon-processed tasks`);
    }

    // 2e. Backfill createdById from assigneeId for agent tasks that had null createdById
    const agentNullCreatorResult = await tasksCollection.updateMany(
      {
        creatorType: 'agent',
        createdById: null,
        assigneeId: { $ne: null },
      },
      [
        {
          $set: {
            createdById: '$assigneeId',
            updatedAt: new Date(),
          },
        },
      ]
    );
    if (agentNullCreatorResult.modifiedCount > 0) {
      console.log(`[Migration] Backfilled createdById from assigneeId on ${agentNullCreatorResult.modifiedCount} agent tasks`);
    }

    // 2f. All remaining tasks without creatorType → 'human' (default assumption)
    const humanDefaultResult = await tasksCollection.updateMany(
      { creatorType: { $exists: false } },
      { $set: { creatorType: 'human', updatedAt: new Date() } }
    );
    if (humanDefaultResult.modifiedCount > 0) {
      console.log(`[Migration] Set creatorType='human' on ${humanDefaultResult.modifiedCount} remaining tasks`);
    }

    // 3. Add projectId FieldConfig
    const existingProjectField = await fieldConfigsCollection.findOne({
      collectionName: 'tasks',
      fieldPath: 'projectId',
    });
    if (!existingProjectField) {
      await fieldConfigsCollection.insertOne({
        collectionName: 'tasks',
        fieldPath: 'projectId',
        displayName: 'Project',
        fieldType: 'reference',
        isRequired: false,
        isEditable: true,
        isSearchable: false,
        isSortable: true,
        isFilterable: true,
        displayOrder: 4,
        width: 180,
        referenceCollection: 'projects',
        referenceDisplayField: 'displayName',
        defaultVisible: false,
      });
      console.log('[Migration] Added projectId FieldConfig');
    }

    // 4. Add creatorType FieldConfig
    const existingCreatorTypeField = await fieldConfigsCollection.findOne({
      collectionName: 'tasks',
      fieldPath: 'creatorType',
    });
    if (!existingCreatorTypeField) {
      await fieldConfigsCollection.insertOne({
        collectionName: 'tasks',
        fieldPath: 'creatorType',
        displayName: 'Creator Type',
        fieldType: 'select',
        lookupType: 'creator_type',
        isRequired: false,
        isEditable: false,
        isSearchable: false,
        isSortable: true,
        isFilterable: true,
        displayOrder: 13,
        width: 140,
        defaultVisible: false,
      });
      console.log('[Migration] Added creatorType FieldConfig');
    }

    // 5. Add creator_type lookup values
    const existingLookups = await lookupsCollection.findOne({ type: 'creator_type' });
    if (!existingLookups) {
      await lookupsCollection.insertMany([
        { type: 'creator_type', code: 'human', displayName: 'Human', color: '#3B82F6', icon: 'user', sortOrder: 1, isActive: true },
        { type: 'creator_type', code: 'agent', displayName: 'Agent', color: '#8B5CF6', icon: 'bot', sortOrder: 2, isActive: true },
        { type: 'creator_type', code: 'system', displayName: 'System', color: '#6B7280', icon: 'settings', sortOrder: 3, isActive: true },
      ]);
      console.log('[Migration] Added creator_type lookup values');
    }

    // Report totals
    const typeCounts = await tasksCollection.aggregate([
      { $group: { _id: '$creatorType', count: { $sum: 1 } } },
    ]).toArray();
    console.log('[Migration] CreatorType distribution:', typeCounts.map(t => `${t._id}: ${t.count}`).join(', '));
  },

  async down(db: Db): Promise<void> {
    const tasksCollection = db.collection('tasks');
    const fieldConfigsCollection = db.collection('field_configs');
    const lookupsCollection = db.collection('lookups');

    // Remove creatorType field from all tasks
    await tasksCollection.updateMany(
      {},
      { $unset: { creatorType: '' } }
    );
    console.log('[Migration] Removed creatorType from all tasks');

    // Remove FieldConfigs
    await fieldConfigsCollection.deleteOne({ collectionName: 'tasks', fieldPath: 'projectId' });
    await fieldConfigsCollection.deleteOne({ collectionName: 'tasks', fieldPath: 'creatorType' });
    console.log('[Migration] Removed projectId and creatorType FieldConfigs');

    // Remove lookup values
    await lookupsCollection.deleteMany({ type: 'creator_type' });
    console.log('[Migration] Removed creator_type lookup values');
  },
};
