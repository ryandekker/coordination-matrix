/**
 * Migration: Rename 'subflow' taskType to 'flow'
 *
 * This migration:
 * 1. Updates all tasks with taskType: 'subflow' to taskType: 'flow'
 * 2. Updates the tasks collection validator to use 'flow' instead of 'subflow'
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
      workflowRunId: {
        bsonType: ['objectId', 'null'],
        description: 'Associated workflow run instance',
      },
      workflowStepId: {
        bsonType: ['string', 'null'],
        description: 'Step ID within workflow definition',
      },
      // Updated: 'subflow' renamed to 'flow'
      taskType: {
        bsonType: ['string', 'null'],
        enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', null],
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
  id: '2024-12-17-002',
  name: 'rename-subflow-to-flow',
  description: 'Rename taskType "subflow" to "flow" for consistency',
  schemaVersion: 2,

  async up(db: Db): Promise<void> {
    // Convert all existing 'subflow' tasks to 'flow'
    const result = await db.collection('tasks').updateMany(
      { taskType: 'subflow' },
      { $set: { taskType: 'flow' } }
    );
    console.log(`[Migration] Updated ${result.modifiedCount} tasks from subflow to flow`);

    // Update tasks collection validator with new enum values
    await migrationHelpers.updateValidator(db, 'tasks', TASKS_VALIDATOR);
    console.log('[Migration] Updated tasks validator with flow taskType');
  },

  async down(db: Db): Promise<void> {
    // Revert 'flow' back to 'subflow'
    const result = await db.collection('tasks').updateMany(
      { taskType: 'flow' },
      { $set: { taskType: 'subflow' } }
    );
    console.log(`[Migration] Reverted ${result.modifiedCount} tasks from flow to subflow`);
  },
};
