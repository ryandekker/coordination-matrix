/**
 * Migration: Add daemon_executions, batch_jobs, and batch_items collections
 *
 * Creates collections for tracking daemon executions and batch job coordination.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

const DAEMON_EXECUTIONS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ruleName', 'taskId', 'eventId', 'command', 'status', 'createdAt'],
    properties: {
      ruleName: {
        bsonType: 'string',
        description: 'Name of the daemon rule',
      },
      taskId: {
        bsonType: 'objectId',
        description: 'Task that triggered the execution',
      },
      eventId: {
        bsonType: 'string',
        description: 'Event that triggered the execution',
      },
      command: {
        bsonType: 'string',
        description: 'Command that was executed',
      },
      status: {
        bsonType: 'string',
        enum: ['pending', 'running', 'completed', 'failed'],
        description: 'Execution status',
      },
      output: {
        bsonType: ['string', 'null'],
        description: 'Command output',
      },
      error: {
        bsonType: ['string', 'null'],
        description: 'Error message if failed',
      },
      updatedFields: {
        bsonType: ['object', 'null'],
        description: 'Fields updated based on result',
      },
      startedAt: {
        bsonType: ['date', 'null'],
        description: 'When execution started',
      },
      completedAt: {
        bsonType: ['date', 'null'],
        description: 'When execution completed',
      },
      createdAt: {
        bsonType: 'date',
        description: 'When execution was created',
      },
    },
  },
};

const BATCH_JOBS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['status', 'expectedCount', 'createdAt'],
    properties: {
      name: {
        bsonType: ['string', 'null'],
        description: 'Human-readable batch job name',
      },
      type: {
        bsonType: ['string', 'null'],
        description: 'Batch job type (e.g., email_analysis, data_processing)',
      },
      workflowId: {
        bsonType: ['objectId', 'null'],
        description: 'Associated workflow if part of a workflow run',
      },
      workflowStepId: {
        bsonType: ['string', 'null'],
        description: 'Step ID within workflow (e.g., foreach step)',
      },
      taskId: {
        bsonType: ['objectId', 'null'],
        description: 'Parent task that initiated this batch',
      },
      callbackUrl: {
        bsonType: ['string', 'null'],
        description: 'URL where external service should POST results',
      },
      callbackSecret: {
        bsonType: ['string', 'null'],
        description: 'Secret for authenticating callbacks (whsec_ prefix)',
      },
      status: {
        bsonType: 'string',
        enum: [
          'pending',
          'processing',
          'awaiting_responses',
          'completed',
          'completed_with_warnings',
          'failed',
          'cancelled',
          'manual_review',
        ],
        description: 'Current batch job status',
      },
      expectedCount: {
        bsonType: 'int',
        minimum: 0,
        description: 'Expected number of items to process',
      },
      receivedCount: {
        bsonType: ['int', 'null'],
        minimum: 0,
        description: 'Number of callback responses received',
      },
      processedCount: {
        bsonType: ['int', 'null'],
        minimum: 0,
        description: 'Number of items successfully processed',
      },
      failedCount: {
        bsonType: ['int', 'null'],
        minimum: 0,
        description: 'Number of items that failed',
      },
      minSuccessPercent: {
        bsonType: ['double', 'null'],
        minimum: 0,
        maximum: 100,
        description: 'Minimum success percentage required (default: 100)',
      },
      deadlineAt: {
        bsonType: ['date', 'null'],
        description: 'Deadline for receiving all responses',
      },
      inputPayload: {
        bsonType: ['object', 'null'],
        description: 'Original input data sent to external service',
      },
      aggregateResult: {
        bsonType: ['object', 'null'],
        description: 'Aggregated results after join (sealed on completion)',
      },
      isResultSealed: {
        bsonType: ['bool', 'null'],
        description: 'Whether aggregate result is finalized',
      },
      requiresManualReview: {
        bsonType: ['bool', 'null'],
        description: 'Whether this job requires manual review before proceeding',
      },
      reviewedById: {
        bsonType: ['objectId', 'null'],
        description: 'User who reviewed this batch job',
      },
      reviewedAt: {
        bsonType: ['date', 'null'],
        description: 'When the job was reviewed',
      },
      reviewDecision: {
        bsonType: ['string', 'null'],
        enum: ['approved', 'rejected', 'proceed_with_partial', null],
        description: 'Manual review decision',
      },
      reviewNotes: {
        bsonType: ['string', 'null'],
        description: 'Notes from manual review',
      },
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who created this batch job',
      },
      createdAt: {
        bsonType: 'date',
        description: 'When the batch job was created',
      },
      updatedAt: {
        bsonType: ['date', 'null'],
        description: 'Last update timestamp',
      },
      startedAt: {
        bsonType: ['date', 'null'],
        description: 'When processing started',
      },
      completedAt: {
        bsonType: ['date', 'null'],
        description: 'When the batch job completed',
      },
    },
  },
};

const BATCH_ITEMS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['batchJobId', 'itemKey', 'status', 'createdAt'],
    properties: {
      batchJobId: {
        bsonType: 'objectId',
        description: 'Parent batch job',
      },
      itemKey: {
        bsonType: 'string',
        description: 'Unique key for deduplication within batch',
      },
      externalId: {
        bsonType: ['string', 'null'],
        description: 'External system ID (e.g., email_message_id)',
      },
      status: {
        bsonType: 'string',
        enum: ['pending', 'received', 'processing', 'completed', 'failed', 'skipped'],
        description: 'Item processing status',
      },
      inputData: {
        bsonType: ['object', 'null'],
        description: 'Input data for this item',
      },
      resultData: {
        bsonType: ['object', 'null'],
        description: 'Result data from processing',
      },
      error: {
        bsonType: ['string', 'null'],
        description: 'Error message if failed',
      },
      attempts: {
        bsonType: ['int', 'null'],
        minimum: 0,
        description: 'Number of processing attempts',
      },
      createdAt: {
        bsonType: 'date',
        description: 'When the item was created',
      },
      receivedAt: {
        bsonType: ['date', 'null'],
        description: 'When callback was received',
      },
      completedAt: {
        bsonType: ['date', 'null'],
        description: 'When processing completed',
      },
    },
  },
};

export const migration: Migration = {
  id: '2025-12-19-003',
  name: 'add-daemon-batch-collections',
  description: 'Add daemon_executions, batch_jobs, and batch_items collections',
  schemaVersion: 6,

  async up(db: Db): Promise<void> {
    // Create daemon_executions collection
    const daemonCollections = await db.listCollections({ name: 'daemon_executions' }).toArray();
    if (daemonCollections.length === 0) {
      await db.createCollection('daemon_executions', { validator: DAEMON_EXECUTIONS_VALIDATOR });
      console.log('[Migration] Created daemon_executions collection');
    } else {
      await migrationHelpers.updateValidator(db, 'daemon_executions', DAEMON_EXECUTIONS_VALIDATOR);
      console.log('[Migration] Updated daemon_executions validator');
    }

    // Create daemon_executions indexes
    await migrationHelpers.ensureIndex(db, 'daemon_executions', { ruleName: 1, createdAt: -1 });
    await migrationHelpers.ensureIndex(db, 'daemon_executions', { taskId: 1 });
    await migrationHelpers.ensureIndex(db, 'daemon_executions', { status: 1 });
    await migrationHelpers.ensureIndex(db, 'daemon_executions', { createdAt: -1 });
    console.log('[Migration] Created daemon_executions indexes');

    // Create batch_jobs collection
    const batchJobsCollections = await db.listCollections({ name: 'batch_jobs' }).toArray();
    if (batchJobsCollections.length === 0) {
      await db.createCollection('batch_jobs', { validator: BATCH_JOBS_VALIDATOR });
      console.log('[Migration] Created batch_jobs collection');
    } else {
      await migrationHelpers.updateValidator(db, 'batch_jobs', BATCH_JOBS_VALIDATOR);
      console.log('[Migration] Updated batch_jobs validator');
    }

    // Create batch_jobs indexes
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { status: 1, deadlineAt: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { workflowId: 1, workflowStepId: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { taskId: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { type: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { createdAt: -1 });
    await migrationHelpers.ensureIndex(db, 'batch_jobs', { status: 1, requiresManualReview: 1 });
    console.log('[Migration] Created batch_jobs indexes');

    // Create batch_items collection
    const batchItemsCollections = await db.listCollections({ name: 'batch_items' }).toArray();
    if (batchItemsCollections.length === 0) {
      await db.createCollection('batch_items', { validator: BATCH_ITEMS_VALIDATOR });
      console.log('[Migration] Created batch_items collection');
    } else {
      await migrationHelpers.updateValidator(db, 'batch_items', BATCH_ITEMS_VALIDATOR);
      console.log('[Migration] Updated batch_items validator');
    }

    // Create batch_items indexes
    await migrationHelpers.ensureIndex(db, 'batch_items', { batchJobId: 1, itemKey: 1 }, { unique: true });
    await migrationHelpers.ensureIndex(db, 'batch_items', { batchJobId: 1, status: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_items', { batchJobId: 1, createdAt: 1 });
    await migrationHelpers.ensureIndex(db, 'batch_items', { externalId: 1 });
    console.log('[Migration] Created batch_items indexes');
  },

  async down(db: Db): Promise<void> {
    await db.collection('batch_items').drop().catch(() => {
      console.log('[Migration] batch_items collection does not exist');
    });
    await db.collection('batch_jobs').drop().catch(() => {
      console.log('[Migration] batch_jobs collection does not exist');
    });
    await db.collection('daemon_executions').drop().catch(() => {
      console.log('[Migration] daemon_executions collection does not exist');
    });
    console.log('[Migration] Dropped daemon and batch collections');
  },
};
