/**
 * Migration: Add workflow_requests collection
 *
 * Creates the workflow_requests collection to log all inbound requests
 * that trigger or interact with workflows.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

const WORKFLOW_REQUESTS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['type', 'method', 'url', 'status', 'receivedAt'],
    properties: {
      // Request type
      type: {
        bsonType: 'string',
        enum: ['workflow_start', 'workflow_callback'],
        description: 'Type of request - required',
      },

      // HTTP request details
      method: {
        bsonType: 'string',
        description: 'HTTP method - required',
      },
      url: {
        bsonType: 'string',
        description: 'Request URL - required',
      },
      headers: {
        bsonType: 'object',
        description: 'Request headers (sensitive headers filtered)',
      },
      body: {
        bsonType: ['object', 'null'],
        description: 'Request body payload',
      },

      // Processing status
      status: {
        bsonType: 'string',
        enum: ['success', 'failed'],
        description: 'Request processing status - required',
      },
      error: {
        bsonType: ['string', 'null'],
        description: 'Error message if request failed',
      },

      // Workflow correlation
      workflowId: {
        bsonType: ['objectId', 'null'],
        description: 'Workflow definition ID',
      },
      workflowName: {
        bsonType: ['string', 'null'],
        description: 'Workflow name at time of request',
      },
      workflowRunId: {
        bsonType: ['objectId', 'null'],
        description: 'Created workflow run ID (if successful)',
      },
      rootTaskId: {
        bsonType: ['objectId', 'null'],
        description: 'Created root task ID (if successful)',
      },

      // For callback requests
      stepId: {
        bsonType: ['string', 'null'],
        description: 'Workflow step ID (for callbacks)',
      },
      taskId: {
        bsonType: ['objectId', 'null'],
        description: 'Associated task ID (for callbacks)',
      },

      // Actor info
      actorId: {
        bsonType: ['objectId', 'null'],
        description: 'User who made the request (if authenticated)',
      },
      actorType: {
        bsonType: 'string',
        enum: ['user', 'api_key', 'anonymous', 'system'],
        description: 'How the request was authenticated',
      },
      source: {
        bsonType: ['string', 'null'],
        description: 'Request source identifier',
      },
      externalId: {
        bsonType: ['string', 'null'],
        description: 'External correlation ID from request',
      },

      // Timestamps
      receivedAt: {
        bsonType: 'date',
        description: 'When request was received - required',
      },
      processedAt: {
        bsonType: ['date', 'null'],
        description: 'When request processing completed',
      },
    },
  },
};

export const migration: Migration = {
  id: '2026-01-14-002',
  name: 'add-workflow-requests-collection',
  description: 'Add workflow_requests collection to log inbound workflow triggers',
  schemaVersion: 6,

  async up(db: Db): Promise<void> {
    // Create workflow_requests collection
    await migrationHelpers.createCollection(db, 'workflow_requests', WORKFLOW_REQUESTS_VALIDATOR);

    // Create indexes
    await migrationHelpers.ensureIndex(db, 'workflow_requests', { receivedAt: -1 });
    await migrationHelpers.ensureIndex(db, 'workflow_requests', { type: 1, receivedAt: -1 });
    await migrationHelpers.ensureIndex(db, 'workflow_requests', { workflowRunId: 1 });
    await migrationHelpers.ensureIndex(db, 'workflow_requests', { workflowId: 1, receivedAt: -1 });
    await migrationHelpers.ensureIndex(db, 'workflow_requests', { status: 1, receivedAt: -1 });

    console.log('[Migration] Created workflow_requests collection with indexes');
  },

  async down(db: Db): Promise<void> {
    await db.collection('workflow_requests').drop().catch(() => {
      console.log('[Migration] workflow_requests collection does not exist');
    });
    console.log('[Migration] Dropped workflow_requests collection');
  },
};
