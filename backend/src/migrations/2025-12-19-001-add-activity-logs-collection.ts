/**
 * Migration: Add activity_logs collection
 *
 * Creates the activity_logs collection with validator and indexes
 * for tracking task activity and comment history.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

const ACTIVITY_LOGS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['taskId', 'eventType', 'actorType', 'timestamp'],
    properties: {
      taskId: {
        bsonType: 'objectId',
        description: 'Task this activity relates to - required',
      },
      eventType: {
        bsonType: 'string',
        enum: [
          'task.created',
          'task.updated',
          'task.deleted',
          'task.status.changed',
          'task.assignee.changed',
          'task.priority.changed',
          'task.metadata.changed',
          'task.moved',
          'task.comment.added',
        ],
        description: 'Type of event',
      },
      actorId: {
        bsonType: ['objectId', 'null'],
        description: 'User or system that triggered the event',
      },
      actorType: {
        bsonType: 'string',
        enum: ['user', 'system', 'daemon'],
        description: 'Type of actor',
      },
      changes: {
        bsonType: ['array', 'null'],
        description: 'Field changes made',
      },
      comment: {
        bsonType: ['string', 'null'],
        description: 'Optional comment or note',
      },
      timestamp: {
        bsonType: 'date',
        description: 'When the event occurred',
      },
      metadata: {
        bsonType: ['object', 'null'],
        description: 'Additional event metadata',
      },
    },
  },
};

export const migration: Migration = {
  id: '2025-12-19-001',
  name: 'add-activity-logs-collection',
  description: 'Add activity_logs collection with validator and indexes',
  schemaVersion: 4,

  async up(db: Db): Promise<void> {
    // Create collection with validator (handles permission errors gracefully)
    await migrationHelpers.createCollection(db, 'activity_logs', ACTIVITY_LOGS_VALIDATOR);

    // Create indexes
    await migrationHelpers.ensureIndex(db, 'activity_logs', { taskId: 1, timestamp: -1 });
    await migrationHelpers.ensureIndex(db, 'activity_logs', { actorId: 1 });
    await migrationHelpers.ensureIndex(db, 'activity_logs', { eventType: 1 });
    await migrationHelpers.ensureIndex(db, 'activity_logs', { timestamp: -1 });

    console.log('[Migration] Created activity_logs indexes');
  },

  async down(db: Db): Promise<void> {
    // Drop the collection (careful - this deletes data!)
    await db.collection('activity_logs').drop().catch(() => {
      console.log('[Migration] activity_logs collection does not exist');
    });
    console.log('[Migration] Dropped activity_logs collection');
  },
};
