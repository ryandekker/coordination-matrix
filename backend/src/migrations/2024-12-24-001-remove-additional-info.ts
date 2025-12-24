/**
 * Migration: Remove additionalInfo field from tasks collection
 *
 * The additionalInfo field has been replaced by more specific metadata types.
 * This migration:
 * - Updates the tasks collection validator to remove the field
 * - Removes the additionalInfo field from all existing task documents
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

// Updated tasks validator without additionalInfo
const TASKS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['title', 'status', 'createdAt'],
    properties: {
      title: {
        bsonType: 'string',
        description: 'Task title - required',
      },
      summary: {
        bsonType: ['string', 'null'],
        description: 'Task summary',
      },
      extraPrompt: {
        bsonType: ['string', 'null'],
        description: 'Extra prompt for AI tasks',
      },
      // additionalInfo field removed
      status: {
        bsonType: 'string',
        enum: ['pending', 'in_progress', 'on_hold', 'waiting', 'completed', 'failed', 'cancelled', 'archived'],
        description: 'Current task status',
      },
      urgency: {
        bsonType: ['string', 'null'],
        enum: ['low', 'normal', 'high', 'urgent', null],
        description: 'Task urgency level',
      },
      parentId: {
        bsonType: ['objectId', 'null'],
        description: 'Parent task ID for nested tasks',
      },
      workflowId: {
        bsonType: ['objectId', 'null'],
        description: 'Associated workflow definition',
      },
      workflowStage: {
        bsonType: ['string', 'null'],
        description: 'Current stage in workflow',
      },
      externalId: {
        bsonType: ['string', 'null'],
        description: 'External reference ID',
      },
      externalHoldDate: {
        bsonType: ['date', 'null'],
        description: 'Date when external hold expires',
      },
      assigneeId: {
        bsonType: ['objectId', 'null'],
        description: 'Assigned user ID',
      },
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'Creator user ID',
      },
      tags: {
        bsonType: ['array', 'null'],
        items: { bsonType: 'string' },
        description: 'Task tags for categorization',
      },
      createdAt: {
        bsonType: 'date',
        description: 'Creation timestamp',
      },
      updatedAt: {
        bsonType: 'date',
        description: 'Last update timestamp',
      },
      dueAt: {
        bsonType: ['date', 'null'],
        description: 'Due date for the task',
      },
      metadata: {
        bsonType: ['object', 'null'],
        description: 'Flexible metadata object for storing task outputs, results, and custom data',
      },
      workflowRunId: {
        bsonType: ['objectId', 'null'],
        description: 'Associated workflow run instance',
      },
      workflowStepId: {
        bsonType: ['string', 'null'],
        description: 'Step ID within workflow definition',
      },
      taskType: {
        bsonType: ['string', 'null'],
        enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', 'subflow', null],
        description: 'Type of task for workflow execution',
      },
      executionMode: {
        bsonType: ['string', 'null'],
        enum: ['manual', 'automated', 'immediate', 'external_callback', null],
        description: 'How the task should be executed',
      },
      expectedQuantity: {
        bsonType: ['int', 'null'],
        description: 'Expected number of subtasks/results this task will produce',
      },
      foreachConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for foreach tasks',
      },
      externalConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for external callback tasks',
      },
      webhookConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for webhook tasks (outbound HTTP calls)',
      },
      batchCounters: {
        bsonType: ['object', 'null'],
        description: 'Counters for batch/foreach operations',
      },
      joinConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for join tasks',
      },
      decisionResult: {
        bsonType: ['string', 'null'],
        description: 'Result of a decision task (selected step ID)',
      },
    },
  },
};

export const migration: Migration = {
  id: '2024-12-24-001',
  name: 'remove-additional-info',
  description: 'Remove deprecated additionalInfo field from tasks collection',
  schemaVersion: 2,

  async up(db: Db): Promise<void> {
    // Update tasks collection validator (removes additionalInfo from allowed fields)
    await migrationHelpers.updateValidator(db, 'tasks', TASKS_VALIDATOR);

    // Remove additionalInfo field from all existing tasks
    const result = await db.collection('tasks').updateMany(
      { additionalInfo: { $exists: true } },
      { $unset: { additionalInfo: '' } }
    );

    console.log(`[Migration] Removed additionalInfo from ${result.modifiedCount} tasks`);
  },

  async down(db: Db): Promise<void> {
    // Note: We cannot restore the data that was removed
    // This just adds the field back to the validator
    console.log('[Migration] Rolling back - additionalInfo field will be allowed again but data is not restored');
  },
};
