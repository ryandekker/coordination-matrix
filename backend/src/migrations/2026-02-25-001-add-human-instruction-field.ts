/**
 * Migration: Add humanInstruction field to tasks and workflow_runs
 *
 * Adds the humanInstruction field which carries the original human request
 * through all tasks in a workflow run or daemon follow-up chain.
 *
 * Changes:
 * - Updates tasks collection validator to allow humanInstruction string field
 * - Adds sparse index on tasks.humanInstruction for searchability
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

// Full validator matching the latest schema plus humanInstruction
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
      humanInstruction: {
        bsonType: ['string', 'null'],
        description: 'Original human request/goal — propagated unchanged to all child tasks',
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
        enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', 'subflow', 'findDocument', 'code', null],
        description: 'Type of task for workflow execution',
      },
      executionMode: {
        bsonType: ['string', 'null'],
        enum: ['manual', 'automated', 'immediate', null],
        description: 'How the task should be executed',
      },
      groupId: {
        bsonType: ['objectId', 'null'],
        description: 'Group this task belongs to',
      },
      projectId: {
        bsonType: ['objectId', 'null'],
        description: 'Project within the group',
      },
    },
    additionalProperties: true,
  },
};

export const migration: Migration = {
  id: '2026-02-25-001',
  name: 'add-human-instruction-field',
  description: 'Add humanInstruction field to tasks validator and sparse index for searchability',

  async up(db: Db): Promise<void> {
    // Update tasks collection validator to include humanInstruction
    await db.command({
      collMod: 'tasks',
      validator: TASKS_VALIDATOR,
      validationLevel: 'moderate',
      validationAction: 'warn',
    });
    console.log('[Migration] Updated tasks validator to include humanInstruction field');

    // Add sparse index for searching tasks by humanInstruction
    await migrationHelpers.ensureIndex(db, 'tasks', { humanInstruction: 1 }, { sparse: true });
    console.log('[Migration] Created sparse index on tasks.humanInstruction');
  },

  async down(db: Db): Promise<void> {
    try {
      await db.collection('tasks').dropIndex('humanInstruction_1');
      console.log('[Migration] Dropped humanInstruction index');
    } catch {
      console.log('[Migration] humanInstruction index does not exist');
    }
  },
};
