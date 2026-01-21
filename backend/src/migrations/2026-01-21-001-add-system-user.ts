/**
 * Migration: Add System User
 *
 * Creates the System pseudo-user for automated workflow tasks.
 * This user is assigned to tasks that are executed by the system
 * (webhooks, external calls, joins, decisions, triggers, flows).
 *
 * Also backfills existing system-executed tasks with no assignee
 * to be assigned to the System user.
 */

import { Db, ObjectId } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

// Well-known System User ID (matches frontend/backend constants)
const SYSTEM_USER_ID = new ObjectId('000000000000000000000001');

// Task types that are executed by the system (not humans)
const SYSTEM_EXECUTED_TASK_TYPES = [
  'webhook',
  'external',
  'join',
  'decision',
  'trigger',
  'flow',
];

export const migration: Migration = {
  id: '2026-01-21-001',
  name: 'add-system-user',
  description: 'Add System pseudo-user for automated workflow tasks',

  async up(db: Db): Promise<void> {
    const usersCollection = db.collection('users');
    const tasksCollection = db.collection('tasks');

    // 1. Create or update the System user
    const existingSystemUser = await usersCollection.findOne({ _id: SYSTEM_USER_ID });

    if (existingSystemUser) {
      // Update existing user to ensure it has isSystem flag
      if (!existingSystemUser.isSystem) {
        await usersCollection.updateOne(
          { _id: SYSTEM_USER_ID },
          {
            $set: {
              isSystem: true,
              displayName: 'System',
              isActive: true,
              updatedAt: new Date(),
            },
          }
        );
        console.log('[Migration] Updated existing System user with isSystem flag');
      } else {
        console.log('[Migration] System user already exists with isSystem flag');
      }
    } else {
      // Create the System user
      await usersCollection.insertOne({
        _id: SYSTEM_USER_ID,
        displayName: 'System',
        role: 'operator',
        isActive: true,
        isSystem: true,
        botColor: '#6B7280',
        teamIds: [],
        preferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('[Migration] Created System user');
    }

    // 2. Create index for isSystem field (if not exists)
    await migrationHelpers.ensureIndex(db, 'users', { isSystem: 1 }, { sparse: true });
    console.log('[Migration] Ensured isSystem index on users collection');

    // 3. Backfill existing system-executed tasks with no assignee
    const backfillResult = await tasksCollection.updateMany(
      {
        taskType: { $in: SYSTEM_EXECUTED_TASK_TYPES },
        assigneeId: null,
      },
      {
        $set: {
          assigneeId: SYSTEM_USER_ID,
          updatedAt: new Date(),
        },
      }
    );

    if (backfillResult.modifiedCount > 0) {
      console.log(`[Migration] Backfilled ${backfillResult.modifiedCount} unassigned system-executed tasks`);
    } else {
      console.log('[Migration] No unassigned system-executed tasks to backfill');
    }

    // 4. Report on tasks that already have the System user assigned
    const alreadyAssignedCount = await tasksCollection.countDocuments({
      assigneeId: SYSTEM_USER_ID,
    });
    console.log(`[Migration] Total tasks assigned to System user: ${alreadyAssignedCount}`);
  },

  async down(db: Db): Promise<void> {
    const usersCollection = db.collection('users');
    const tasksCollection = db.collection('tasks');

    // 1. Remove System user assignment from tasks (set to null)
    const unassignResult = await tasksCollection.updateMany(
      { assigneeId: SYSTEM_USER_ID },
      { $set: { assigneeId: null, updatedAt: new Date() } }
    );
    console.log(`[Migration] Unassigned ${unassignResult.modifiedCount} tasks from System user`);

    // 2. Delete the System user
    const deleteResult = await usersCollection.deleteOne({ _id: SYSTEM_USER_ID });
    if (deleteResult.deletedCount > 0) {
      console.log('[Migration] Deleted System user');
    } else {
      console.log('[Migration] System user was not found');
    }
  },
};
