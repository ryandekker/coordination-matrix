/**
 * Migration: Add webhooks and webhook_deliveries collections
 *
 * Creates the webhooks and webhook_deliveries collections with validators
 * and indexes for outbound webhook management.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

const WEBHOOKS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['name', 'url', 'secret', 'triggers', 'isActive', 'createdAt'],
    properties: {
      name: {
        bsonType: 'string',
        description: 'Webhook name - required',
      },
      url: {
        bsonType: 'string',
        description: 'Target URL - required',
      },
      secret: {
        bsonType: 'string',
        description: 'Secret key for authentication - required',
      },
      triggers: {
        bsonType: 'array',
        items: {
          bsonType: 'string',
          enum: [
            'task.created',
            'task.updated',
            'task.deleted',
            'task.status.changed',
            'task.assignee.changed',
            'task.priority.changed',
            'task.entered_filter',
          ],
        },
        description: 'Event types that trigger this webhook',
      },
      savedSearchId: {
        bsonType: ['objectId', 'null'],
        description: 'Optional saved search for filter-based triggers',
      },
      filterQuery: {
        bsonType: ['string', 'null'],
        description: 'Optional filter query string',
      },
      isActive: {
        bsonType: 'bool',
        description: 'Whether the webhook is active',
      },
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who created this webhook',
      },
      createdAt: {
        bsonType: 'date',
        description: 'Creation timestamp',
      },
      updatedAt: {
        bsonType: ['date', 'null'],
        description: 'Last update timestamp',
      },
    },
  },
};

const WEBHOOK_DELIVERIES_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['webhookId', 'eventId', 'eventType', 'payload', 'status', 'attempts', 'createdAt'],
    properties: {
      webhookId: {
        bsonType: 'objectId',
        description: 'Webhook this delivery belongs to',
      },
      eventId: {
        bsonType: 'string',
        description: 'Event ID being delivered',
      },
      eventType: {
        bsonType: 'string',
        description: 'Type of event',
      },
      payload: {
        bsonType: 'object',
        description: 'Payload sent to webhook',
      },
      status: {
        bsonType: 'string',
        enum: ['pending', 'success', 'failed', 'retrying'],
        description: 'Delivery status',
      },
      statusCode: {
        bsonType: ['int', 'null'],
        description: 'HTTP status code from response',
      },
      responseBody: {
        bsonType: ['string', 'null'],
        description: 'Response body (truncated)',
      },
      error: {
        bsonType: ['string', 'null'],
        description: 'Error message if failed',
      },
      attempts: {
        bsonType: 'int',
        minimum: 0,
        description: 'Number of delivery attempts',
      },
      maxAttempts: {
        bsonType: ['int', 'null'],
        minimum: 1,
        description: 'Maximum retry attempts',
      },
      nextRetryAt: {
        bsonType: ['date', 'null'],
        description: 'Scheduled retry time',
      },
      createdAt: {
        bsonType: 'date',
        description: 'When delivery was created',
      },
      completedAt: {
        bsonType: ['date', 'null'],
        description: 'When delivery completed',
      },
    },
  },
};

export const migration: Migration = {
  id: '2025-12-19-002',
  name: 'add-webhooks-collections',
  description: 'Add webhooks and webhook_deliveries collections with validators and indexes',
  schemaVersion: 5,

  async up(db: Db): Promise<void> {
    // Create webhooks collection
    const webhooksCollections = await db.listCollections({ name: 'webhooks' }).toArray();
    if (webhooksCollections.length === 0) {
      await db.createCollection('webhooks', { validator: WEBHOOKS_VALIDATOR });
      console.log('[Migration] Created webhooks collection');
    } else {
      await migrationHelpers.updateValidator(db, 'webhooks', WEBHOOKS_VALIDATOR);
      console.log('[Migration] Updated webhooks validator');
    }

    // Create webhooks indexes
    await migrationHelpers.ensureIndex(db, 'webhooks', { isActive: 1 });
    await migrationHelpers.ensureIndex(db, 'webhooks', { triggers: 1 });
    await migrationHelpers.ensureIndex(db, 'webhooks', { savedSearchId: 1 });
    console.log('[Migration] Created webhooks indexes');

    // Create webhook_deliveries collection
    const deliveriesCollections = await db.listCollections({ name: 'webhook_deliveries' }).toArray();
    if (deliveriesCollections.length === 0) {
      await db.createCollection('webhook_deliveries', { validator: WEBHOOK_DELIVERIES_VALIDATOR });
      console.log('[Migration] Created webhook_deliveries collection');
    } else {
      await migrationHelpers.updateValidator(db, 'webhook_deliveries', WEBHOOK_DELIVERIES_VALIDATOR);
      console.log('[Migration] Updated webhook_deliveries validator');
    }

    // Create webhook_deliveries indexes
    await migrationHelpers.ensureIndex(db, 'webhook_deliveries', { webhookId: 1, createdAt: -1 });
    await migrationHelpers.ensureIndex(db, 'webhook_deliveries', { status: 1, nextRetryAt: 1 });
    await migrationHelpers.ensureIndex(db, 'webhook_deliveries', { eventId: 1 });
    console.log('[Migration] Created webhook_deliveries indexes');
  },

  async down(db: Db): Promise<void> {
    await db.collection('webhook_deliveries').drop().catch(() => {
      console.log('[Migration] webhook_deliveries collection does not exist');
    });
    await db.collection('webhooks').drop().catch(() => {
      console.log('[Migration] webhooks collection does not exist');
    });
    console.log('[Migration] Dropped webhooks collections');
  },
};
