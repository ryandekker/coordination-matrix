/**
 * Migration: Add workflow execution fields to tasks collection
 *
 * This adds the necessary fields for workflow task execution:
 * - workflowRunId: Links task to a workflow run instance
 * - workflowStepId: The step within the workflow
 * - taskType: Type of task (flow, agent, trigger, manual, decision, foreach, join, external, webhook, subflow)
 * - executionMode: How the task executes (manual, automated, immediate, external_callback)
 * - foreachConfig: Configuration for foreach tasks
 * - externalConfig: Configuration for external callback tasks
 * - batchCounters: Counters for batch/foreach operations
 * - joinConfig: Configuration for join tasks
 * - decisionResult: Result of a decision task
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
      // NEW: Workflow execution fields
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
      foreachConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for foreach tasks',
      },
      externalConfig: {
        bsonType: ['object', 'null'],
        description: 'Configuration for external callback tasks',
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

const WORKFLOW_RUNS_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['workflowId', 'status', 'createdAt'],
    properties: {
      workflowId: {
        bsonType: 'objectId',
        description: 'Reference to workflow definition',
      },
      workflowVersion: {
        bsonType: ['int', 'null'],
        description: 'Snapshot version of workflow at run time',
      },
      status: {
        bsonType: 'string',
        enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
        description: 'Current run status',
      },
      rootTaskId: {
        bsonType: ['objectId', 'null'],
        description: 'Root task created for this run',
      },
      currentStepIds: {
        bsonType: ['array', 'null'],
        items: { bsonType: 'string' },
        description: 'Currently active step IDs (supports parallel execution)',
      },
      completedStepIds: {
        bsonType: ['array', 'null'],
        items: { bsonType: 'string' },
        description: 'Steps that have completed',
      },
      inputPayload: {
        bsonType: ['object', 'null'],
        description: 'Initial input data for the workflow',
      },
      outputPayload: {
        bsonType: ['object', 'null'],
        description: 'Final aggregated output from the workflow',
      },
      error: {
        bsonType: ['string', 'null'],
        description: 'Error message if failed',
      },
      failedStepId: {
        bsonType: ['string', 'null'],
        description: 'Step ID where failure occurred',
      },
      callbackSecret: {
        bsonType: ['string', 'null'],
        description: 'Secret for authenticating external callbacks',
      },
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who triggered this run',
      },
      // NEW: Task defaults and execution options
      taskDefaults: {
        bsonType: ['object', 'null'],
        description: 'Default values for tasks created in this run',
      },
      executionOptions: {
        bsonType: ['object', 'null'],
        description: 'Options controlling workflow execution',
      },
      externalId: {
        bsonType: ['string', 'null'],
        description: 'External system reference ID',
      },
      source: {
        bsonType: ['string', 'null'],
        description: 'Source system that triggered this run',
      },
      createdAt: {
        bsonType: 'date',
        description: 'When the run was created',
      },
      startedAt: {
        bsonType: ['date', 'null'],
        description: 'When execution started',
      },
      completedAt: {
        bsonType: ['date', 'null'],
        description: 'When execution completed',
      },
    },
  },
};

export const migration: Migration = {
  id: '2024-12-14-001',
  name: 'add-workflow-task-fields',
  description: 'Add workflow execution fields to tasks and workflow_runs collections',
  schemaVersion: 1,

  async up(db: Db): Promise<void> {
    // Update tasks collection validator
    await migrationHelpers.updateValidator(db, 'tasks', TASKS_VALIDATOR);

    // Add index for workflowRunId
    await migrationHelpers.ensureIndex(db, 'tasks', { workflowRunId: 1 });

    // Update workflow_runs collection validator
    await migrationHelpers.updateValidator(db, 'workflow_runs', WORKFLOW_RUNS_VALIDATOR);

    console.log('[Migration] Updated tasks and workflow_runs validators');
  },

  async down(_db: Db): Promise<void> {
    // Note: We don't remove fields from documents, just revert the validator
    // This allows rollback without data loss
    console.log('[Migration] Rolling back - validator changes only');
  },
};
