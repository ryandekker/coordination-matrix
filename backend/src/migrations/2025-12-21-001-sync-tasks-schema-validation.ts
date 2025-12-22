/**
 * Migration: Sync tasks collection schema validation
 *
 * This migration updates the tasks collection validator to be consistent
 * with the current schema requirements. The key changes:
 * - Ensure optional fields accept null values (bsonType: ['type', 'null'])
 * - This prevents "Document failed validation" errors when inserting
 *   documents with null/undefined optional fields
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

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
      additionalInfo: {
        bsonType: ['string', 'null'],
        description: 'Additional information',
      },
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
      // Workflow execution fields
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
  id: '2025-12-21-001',
  name: 'sync-tasks-schema-validation',
  description: 'Update tasks collection validator to accept null for optional fields',
  schemaVersion: 2,

  async up(db: Db): Promise<void> {
    await migrationHelpers.updateValidator(db, 'tasks', TASKS_VALIDATOR);
    console.log('[Migration] Updated tasks collection validator to accept null for optional fields');
  },

  async down(_db: Db): Promise<void> {
    console.log('[Migration] Rolling back - validator changes only');
  },
};
