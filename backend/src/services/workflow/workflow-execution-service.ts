import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { eventBus, publishTaskEvent } from '../event-bus.js';
import {
  Task,
  TaskStatus,
  TaskType,
  ExecutionMode,
  Workflow,
  WorkflowStep,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunEvent,
  WorkflowRunEventType,
  WorkflowRunStepLog,
  StartWorkflowInput,
  TaskEvent,
  Document,
  TaskStepConfig,
  FlowAttempt,
  ExecutionSummary,
  ExecutionSummaryStep,
  ExecutionSummaryChildFlow,
  ExecutionSummaryError,
  ExecutionOutcome,
} from '../../types/index.js';

import { resolveTemplateWithPackages, getValueByPath, resolveTitleTemplateWithPackages, getBaseUrl, resolveTemplateValue } from './template-utils.js';
import { stripUndefined } from './mongo-utils.js';
import { searchDocuments } from '../embedding-service.js';
import { SYSTEM_USER_ID, isSystemExecutedTaskType } from '../system-user.js';
import { executeCode as executeCodeSandbox } from './code-executor.js';

type WorkflowRunEventHandler = (event: WorkflowRunEvent) => void | Promise<void>;

/**
 * WorkflowExecutionService orchestrates workflow execution.
 *
 * It listens for task events and advances workflows through their steps,
 * handling different step types (foreach, join, decision, etc.)
 */
class WorkflowExecutionService {
  private initialized = false;
  private handlers: Map<string, Set<WorkflowRunEventHandler>> = new Map();
  private processedEvents = new Set<string>();

  initialize(): void {
    if (this.initialized) return;

    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      await this.safeHandleTaskEvent(event);
    });

    eventBus.subscribe('task.updated', async (event: TaskEvent) => {
      const statusChange = event.changes?.find(c => c.field === 'status');
      if (statusChange && ['completed', 'failed'].includes(statusChange.newValue as string)) {
        await this.safeHandleTaskEvent(event);
      }
    });

    // Handle code step reruns when task is set to pending
    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      const task = event.task;
      // Only process code tasks that are part of a workflow and set to pending
      if (task.taskType === 'code' && task.workflowRunId && task.workflowStepId && task.status === 'pending') {
        console.log(`[WorkflowExecutionService] Code task ${task._id} set to pending - triggering rerun`);
        await this.rerunCodeTask(task._id);
      }
    });

    // Handle findDocument step reruns when task is set to pending
    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      const task = event.task;
      // Only process findDocument tasks that are part of a workflow and set to pending
      if (task.taskType === 'findDocument' && task.workflowRunId && task.workflowStepId && task.status === 'pending') {
        console.log(`[WorkflowExecutionService] FindDocument task ${task._id} set to pending - triggering rerun`);
        await this.rerunFindDocumentTask(task._id);
      }
    });

    // Handle decision step reruns when task is set to pending
    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      const task = event.task;
      // Only process decision tasks that are part of a workflow and set to pending
      if (task.taskType === 'decision' && task.workflowRunId && task.workflowStepId && task.status === 'pending') {
        console.log(`[WorkflowExecutionService] Decision task ${task._id} set to pending - triggering rerun`);
        await this.rerunDecisionTask(task._id);
      }
    });

    // Handle flow step auto-execution when task is set to pending (for reruns)
    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      const task = event.task;
      // Only process flow tasks that are part of a workflow and set to pending
      const isFlowTask = task.taskType === 'flow' ||
        task.stepConfig?.stepType === 'flow' ||
        task.flowConfig?.workflowId;

      if (isFlowTask && task.workflowRunId && task.status === 'pending') {
        // Check if this flow task has never been executed (no attempts yet)
        const hasNoAttempts = !task.flowConfig?.attempts || task.flowConfig.attempts.length === 0;

        if (hasNoAttempts) {
          console.log(`[WorkflowExecutionService] Flow task ${task._id} set to pending with no previous attempts - auto-executing`);
          try {
            await this.executeFlowTask(task._id.toString());
          } catch (error) {
            console.error(`[WorkflowExecutionService] Failed to auto-execute flow task ${task._id}:`, error);
          }
        }
      }
    });

    // Handle flow step auto-execution when task is created with pending status
    // This catches cases where flow tasks are created but executeFlow wasn't called
    eventBus.subscribe('task.created', async (event: TaskEvent) => {
      const task = event.task;
      // Only process flow tasks that are part of a workflow and created with pending status
      const isFlowTask = task.taskType === 'flow' ||
        task.stepConfig?.stepType === 'flow';

      if (isFlowTask && task.workflowRunId && task.status === 'pending') {
        // Small delay to allow the normal execution flow to complete first
        // This prevents double-execution when executeFlow is called directly after task creation
        setTimeout(async () => {
          // Re-fetch the task to check if it's still pending (not already executing)
          const currentTask = await this.tasks.findOne({ _id: task._id });
          if (currentTask && currentTask.status === 'pending') {
            const hasNoAttempts = !currentTask.flowConfig?.attempts || currentTask.flowConfig.attempts.length === 0;
            if (hasNoAttempts) {
              console.log(`[WorkflowExecutionService] Flow task ${task._id} created but not executed - auto-executing`);
              try {
                await this.executeFlowTask(task._id.toString());
              } catch (error) {
                console.error(`[WorkflowExecutionService] Failed to auto-execute newly created flow task ${task._id}:`, error);
              }
            }
          }
        }, 500); // 500ms delay to allow normal execution to complete
      }
    });

    setInterval(() => {
      this.processedEvents.clear();
    }, 5 * 60 * 1000);

    this.initialized = true;
    console.log('[WorkflowExecutionService] Initialized and listening for task events');
  }

  private async safeHandleTaskEvent(event: TaskEvent): Promise<void> {
    // Use event.id if available, otherwise generate a key from task data with millisecond precision
    // This prevents race conditions where multiple events for the same task are processed simultaneously
    const eventKey = event.id ||
      `${event.task._id}-${event.task.status}-${new Date(event.task.updatedAt).getTime()}`;

    if (this.processedEvents.has(eventKey)) {
      console.log(`[WorkflowExecutionService] Skipping duplicate event for task ${event.task._id} (key: ${eventKey})`);
      return;
    }
    this.processedEvents.add(eventKey);

    try {
      await this.onTaskStatusChanged(event);
    } catch (error) {
      console.error('[WorkflowExecutionService] Error handling task status change:', error);
      console.error('[WorkflowExecutionService] Task details:', {
        taskId: event.task._id,
        status: event.task.status,
        workflowRunId: event.task.workflowRunId,
        workflowStepId: event.task.workflowStepId,
      });
    }
  }

  // ============================================================================
  // Collection Accessors
  // ============================================================================

  private get workflowRuns() {
    return getDb().collection<WorkflowRun>('workflow_runs');
  }

  private get workflows() {
    return getDb().collection<Workflow>('workflows');
  }

  private get tasks() {
    return getDb().collection<Task>('tasks');
  }

  private get documents() {
    return getDb().collection<Document>('documents');
  }

  // ============================================================================
  // Prompt Library Helpers
  // ============================================================================

  /**
   * Fetch and combine prompt documents for a step.
   * Returns the combined content of all prompt documents in order.
   */
  private async getExpandedPrompt(step: WorkflowStep): Promise<string> {
    const parts: string[] = [];

    // Fetch prompt documents if specified
    if (step.promptDocumentIds && step.promptDocumentIds.length > 0) {
      const promptDocs = await this.documents.find({
        _id: { $in: step.promptDocumentIds.map(id => new ObjectId(id)) },
        type: 'workflow-prompt',
      }).toArray();

      // Sort by the order in promptDocumentIds
      const orderedDocs = step.promptDocumentIds
        .map(id => promptDocs.find(doc => doc._id.toString() === id))
        .filter((doc): doc is Document => doc !== undefined);

      for (const doc of orderedDocs) {
        if (doc.content) {
          parts.push(doc.content);
        }
      }
    }

    // Add step-specific additional instructions
    if (step.additionalInstructions) {
      parts.push(step.additionalInstructions);
    }

    return parts.join('\n\n');
  }

  // ============================================================================
  // Event System
  // ============================================================================

  subscribe(eventType: WorkflowRunEventType | '*', handler: WorkflowRunEventHandler): void {
    const handlers = this.handlers.get(eventType) || new Set();
    handlers.add(handler);
    this.handlers.set(eventType, handlers);
  }

  private async publish(event: WorkflowRunEvent): Promise<void> {
    const wildcardHandlers = this.handlers.get('*') || new Set();
    for (const handler of wildcardHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[WorkflowExecutionService] Handler error for ${event.type}:`, error);
      }
    }

    const typeHandlers = this.handlers.get(event.type) || new Set();
    for (const handler of typeHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[WorkflowExecutionService] Handler error for ${event.type}:`, error);
      }
    }

    try {
      await eventBus.publishWorkflowRunEvent(event);
    } catch (error) {
      console.error(`[WorkflowExecutionService] Error publishing to event bus:`, error);
    }
  }

  private generateEventId(): string {
    return `wevt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateSecret(): string {
    return `wfsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  // ============================================================================
  // Step Logging - Execution Trace
  // ============================================================================

  /**
   * Append a step log entry to the workflow run's stepLog array.
   * Truncates input/output summaries to prevent document bloat.
   */
  private async appendStepLog(
    runId: ObjectId,
    entry: WorkflowRunStepLog
  ): Promise<void> {
    try {
      await this.workflowRuns.updateOne(
        { _id: runId },
        { $push: { stepLog: entry } as any }
      );
    } catch (error) {
      console.error(`[WorkflowExecutionService] Failed to append step log for run ${runId}:`, error);
    }
  }

  /** Truncate an object to a summary suitable for logging (max ~2KB) */
  private truncateForLog(obj: unknown): Record<string, unknown> | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    try {
      const str = JSON.stringify(obj);
      if (str.length <= 2048) return obj as Record<string, unknown>;
      // Truncate by keeping only top-level keys with shortened values
      const summary: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 200) {
          summary[key] = value.substring(0, 200) + '...';
        } else if (Array.isArray(value)) {
          summary[key] = `[Array(${value.length})]`;
        } else if (typeof value === 'object' && value !== null) {
          summary[key] = `{Object(${Object.keys(value).length} keys)}`;
        } else {
          summary[key] = value;
        }
      }
      return summary;
    } catch {
      return { _truncated: true };
    }
  }

  // ============================================================================
  // Start Workflow
  // ============================================================================

  async startWorkflow(
    input: StartWorkflowInput,
    actorId?: ObjectId | null
  ): Promise<{ run: WorkflowRun; rootTask: Task }> {
    const workflowId = new ObjectId(input.workflowId);
    const now = new Date();

    const workflow = await this.workflows.findOne({ _id: workflowId });
    if (!workflow) {
      throw new Error(`Workflow ${input.workflowId} not found`);
    }

    if (!workflow.isActive) {
      throw new Error(`Workflow ${workflow.name} is not active`);
    }

    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error(`Workflow ${workflow.name} has no steps`);
    }

    const taskDefaults = input.taskDefaults ? {
      assigneeId: input.taskDefaults.assigneeId
        ? new ObjectId(input.taskDefaults.assigneeId)
        : undefined,
      urgency: input.taskDefaults.urgency,
      tags: input.taskDefaults.tags,
      dueOffsetHours: input.taskDefaults.dueOffsetHours,
    } : undefined;

    const triggerTaskId = input.triggerTaskId ? new ObjectId(input.triggerTaskId) : null;

    // Resolve humanInstruction: use explicit value, or inherit from trigger task
    let humanInstruction = input.humanInstruction;
    if (!humanInstruction && triggerTaskId) {
      const triggerTask = await this.tasks.findOne({ _id: triggerTaskId });
      if (triggerTask?.humanInstruction) {
        humanInstruction = triggerTask.humanInstruction;
      }
    }

    const run: Omit<WorkflowRun, '_id'> = {
      workflowId,
      status: 'running',
      currentStepIds: [],
      completedStepIds: [],
      callbackSecret: this.generateSecret(),
      createdById: actorId ?? null,
      createdAt: now,
      startedAt: now,
      // Inherit group and project from the workflow for access control
      ...(workflow.groupId && { groupId: workflow.groupId }),
      ...(workflow.projectId && { projectId: workflow.projectId }),
      ...(input.inputPayload && { inputPayload: input.inputPayload }),
      ...(humanInstruction && { humanInstruction }),
      ...(taskDefaults && { taskDefaults }),
      ...(input.executionOptions && { executionOptions: input.executionOptions }),
      ...(input.externalId && { externalId: input.externalId }),
      ...(input.source && { source: input.source }),
      ...(triggerTaskId && { triggerTaskId }),
      ...(input.triggerContext && { triggerContext: input.triggerContext }),
    };

    const runResult = await this.workflowRuns.insertOne(run as WorkflowRun);
    const createdRun = { ...run, _id: runResult.insertedId } as WorkflowRun;

    // Always create a separate root task for the workflow run
    // Subflow root tasks are top-level (parentId: null), linked via spawnedWorkflowRunId on the flow step
    const rootTask = await this.createRootTask(createdRun, workflow, actorId);

    await this.workflowRuns.updateOne(
      { _id: createdRun._id },
      { $set: { rootTaskId: rootTask._id } }
    );
    createdRun.rootTaskId = rootTask._id;

    if (triggerTaskId) {
      // Link the trigger task (flow step) to the spawned workflow run
      // The flow step stores a reference - clicking it should navigate/highlight the subflow root task
      await this.tasks.updateOne(
        { _id: triggerTaskId },
        {
          $set: {
            spawnedWorkflowRunId: createdRun._id,
            'metadata.spawnedRootTaskId': rootTask._id.toString(),
            updatedAt: now,
          }
        }
      );
      console.log(`[WorkflowExecutionService] Linked flow step ${triggerTaskId} to subflow root task ${rootTask._id}`);
    }

    await this.publish({
      id: this.generateEventId(),
      type: 'workflow.run.started',
      workflowRunId: createdRun._id,
      workflowRun: createdRun,
      actorId,
      actorType: 'user',
      timestamp: now,
    });

    const firstStep = workflow.steps[0];
    await this.executeStep(createdRun, workflow, firstStep, rootTask, input.inputPayload);

    return { run: createdRun, rootTask };
  }

  private async createRootTask(
    run: WorkflowRun,
    workflow: Workflow,
    actorId?: ObjectId | null
  ): Promise<Task> {
    const now = new Date();

    const defaultTitle = `Workflow: ${workflow.name}`;
    let taskTitle = defaultTitle;
    if (workflow.rootTaskTitleTemplate) {
      // Use async version that supports variables with nested interpolation
      taskTitle = await resolveTitleTemplateWithPackages(workflow.rootTaskTitleTemplate, run.inputPayload, defaultTitle);
    }

    // Root tasks always have no parent - they appear at the top level
    // For subflows, the flow step task links to this root via spawnedRootTaskId
    const task: Omit<Task, '_id'> = {
      title: taskTitle,
      status: 'in_progress',
      parentId: null,
      workflowId: workflow._id,
      workflowRunId: run._id,
      taskType: 'flow',
      executionMode: 'automated',
      createdById: actorId ?? null,
      createdAt: now,
      updatedAt: now,
      ...(run.humanInstruction && { humanInstruction: run.humanInstruction }),
      metadata: {
        workflowRunId: run._id.toString(),
        ...(run.inputPayload && { inputPayload: run.inputPayload }),
        ...(run.externalId && { externalId: run.externalId }),
        ...(run.source && { source: run.source }),
        // For subflows, store the triggering flow step task ID for back-navigation
        ...(run.triggerTaskId && { triggerTaskId: run.triggerTaskId.toString() }),
      },
      ...this.applyTaskDefaults(run, now),
    };

    if (workflow.description) {
      task.summary = workflow.description;
    }

    const cleanTask = stripUndefined(task as unknown as Record<string, unknown>) as unknown as Task;
    const result = await this.tasks.insertOne(cleanTask);
    const createdTask = { ...cleanTask, _id: result.insertedId } as Task;

    await publishTaskEvent('task.created', createdTask, { actorType: 'system' });

    return createdTask;
  }

  private applyTaskDefaults(run: WorkflowRun, now: Date): Partial<Task> {
    const defaults: Partial<Task> = {};

    // Inherit groupId and projectId from the workflow run for access control
    // This ensures tasks are visible to users with access to the parent workflow
    if (run.groupId) {
      defaults.groupId = run.groupId;
    }
    if (run.projectId) {
      defaults.projectId = run.projectId;
    }

    if (run.taskDefaults) {
      if (run.taskDefaults.assigneeId) {
        defaults.assigneeId = run.taskDefaults.assigneeId;
      }
      if (run.taskDefaults.urgency) {
        defaults.urgency = run.taskDefaults.urgency;
      }
      if (run.taskDefaults.tags && run.taskDefaults.tags.length > 0) {
        defaults.tags = run.taskDefaults.tags;
      }
      if (run.taskDefaults.dueOffsetHours) {
        defaults.dueAt = new Date(now.getTime() + run.taskDefaults.dueOffsetHours * 60 * 60 * 1000);
      }
    }

    return defaults;
  }

  // ============================================================================
  // Step Execution
  // ============================================================================

  private async executeStep(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    parentTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<Task> {
    console.log(`[WorkflowExecutionService] Executing step: ${step.name} (${step.stepType})`);

    await this.workflowRuns.updateOne(
      { _id: run._id },
      { $addToSet: { currentStepIds: step.id } }
    );

    const task = await this.createTaskForStep(run, workflow, step, parentTask, inputPayload);

    // Log step started to execution trace
    await this.appendStepLog(run._id, {
      stepId: step.id,
      stepName: step.name,
      stepType: step.stepType,
      taskId: task._id.toString(),
      status: 'started',
      startedAt: new Date(),
      inputSummary: this.truncateForLog(inputPayload),
    });

    await this.publish({
      id: this.generateEventId(),
      type: 'workflow.run.step.started',
      workflowRunId: run._id,
      workflowRun: run,
      stepId: step.id,
      taskId: task._id,
      actorId: null,
      actorType: 'system',
      timestamp: new Date(),
    });

    switch (step.stepType) {
      case 'trigger': {
        // Mark trigger task as completed and publish event to advance workflow
        // Pass through the inputPayload as the trigger's output so subsequent steps can access it
        const triggerOutput = this.buildStepOutput(inputPayload || {}, {
          summary: 'Workflow triggered',
        });
        await this.tasks.updateOne(
          { _id: task._id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              updatedAt: new Date(),
              stepOutput: triggerOutput,
            }
          }
        );
        const updatedTriggerTask = await this.tasks.findOne({ _id: task._id });
        if (updatedTriggerTask) {
          await eventBus.publish({
            type: 'task.status.changed',
            taskId: updatedTriggerTask._id,
            task: updatedTriggerTask,
            changes: [{ field: 'status', oldValue: 'pending', newValue: 'completed' }],
            actorId: null,
            actorType: 'system',
          });
          console.log(`[WorkflowExecutionService] Published task.status.changed for trigger task ${task._id}`);
        }
        break;
      }

      case 'agent':
      case 'manual':
        break;

      case 'external':
        await this.executeExternal(run, workflow, step, task, inputPayload);
        break;

      case 'webhook':
        await this.executeWebhook(run, workflow, step, task, inputPayload);
        break;

      case 'foreach':
        await this.executeForeach(run, workflow, step, task, inputPayload);
        break;

      case 'join':
        await this.executeJoin(run, workflow, step, task);
        break;

      case 'decision':
        await this.executeDecision(run, workflow, step, task, inputPayload);
        break;

      case 'flow':
        await this.executeFlow(run, workflow, step, task, inputPayload);
        break;

      case 'findDocument':
        await this.executeFindDocument(run, workflow, step, task, inputPayload);
        break;

      case 'code':
        await this.executeCodeStep(run, workflow, step, task, inputPayload);
        break;
    }

    return task;
  }

  /**
   * Build the stepConfig from workflow step for storage on the task.
   * This preserves the original configuration for visibility and reruns.
   */
  private buildStepConfig(step: WorkflowStep): TaskStepConfig {
    const config: TaskStepConfig = {
      stepId: step.id,
      stepType: step.stepType,
      stepName: step.name,
      stepDescription: step.description,
    };

    // Agent/Manual step config
    if (step.additionalInstructions) {
      config.additionalInstructions = step.additionalInstructions;
    }
    if (step.promptDocumentIds && step.promptDocumentIds.length > 0) {
      config.promptDocumentIds = step.promptDocumentIds;
    }
    if (step.titleTemplate) {
      config.titleTemplate = step.titleTemplate;
    }
    if (step.defaultAssigneeId) {
      config.defaultAssigneeId = step.defaultAssigneeId;
    }

    // External step config
    if (step.externalConfig) {
      config.externalEndpoint = step.externalConfig.endpoint;
      config.externalMethod = step.externalConfig.method;
      config.externalHeaders = step.externalConfig.headers;
      config.externalPayloadTemplate = step.externalConfig.payloadTemplate;
      config.externalResponseMapping = step.externalConfig.responseMapping;
      config.waitForCallback = step.externalConfig.waitForCallback !== false;
    }

    // Webhook step config
    if (step.webhookConfig) {
      config.webhookUrl = step.webhookConfig.url;
      config.webhookMethod = step.webhookConfig.method;
      config.webhookHeaders = step.webhookConfig.headers;
      config.webhookBodyTemplate = step.webhookConfig.bodyTemplate;
      config.webhookMaxRetries = step.webhookConfig.maxRetries;
      config.webhookTimeoutMs = step.webhookConfig.timeoutMs;
      config.webhookSuccessStatusCodes = step.webhookConfig.successStatusCodes;
    }

    // Foreach step config
    if (step.itemsPath) {
      config.itemsPath = step.itemsPath;
    }
    if (step.itemVariable) {
      config.itemVariable = step.itemVariable;
    }
    if (step.maxItems) {
      config.maxItems = step.maxItems;
    }
    if (step.expectedCountPath) {
      config.expectedCountPath = step.expectedCountPath;
    }

    // Join step config
    if (step.awaitStepId) {
      config.awaitStepId = step.awaitStepId;
    }
    if (step.joinBoundary) {
      config.joinBoundary = step.joinBoundary;
    }
    if (step.inputPath) {
      config.joinInputPath = step.inputPath;
    }

    // Decision step config
    if (step.connections && step.connections.length > 0) {
      config.connections = step.connections;
    }
    if (step.defaultConnection) {
      config.defaultConnection = step.defaultConnection;
    }
    if (step.decisionField) {
      config.decisionField = step.decisionField;
    }

    // Flow step config (nested workflow)
    if (step.flowId) {
      config.flowId = step.flowId;
    }
    // Support both legacy inputMapping and new inputConfig.mapping
    if (step.inputMapping) {
      config.inputMapping = step.inputMapping;
    } else if (step.inputConfig?.mapping) {
      config.inputMapping = step.inputConfig.mapping;
    }
    if (step.inputConfig) {
      config.inputConfig = step.inputConfig;
    }

    // FindDocument step config
    if (step.findDocumentConfig) {
      config.findDocumentConfig = step.findDocumentConfig;
    }

    // Code step config
    if (step.codeConfig) {
      config.codeConfig = step.codeConfig;
    }

    // Input aggregation config (only inputPath is on WorkflowStep - inputSource is runtime)
    if (step.inputPath && !config.joinInputPath) {
      // Only set if not already set as joinInputPath
      config.inputPath = step.inputPath;
    }

    return config;
  }

  /**
   * Build a StepOutput object from step execution results.
   * This standardizes output storage across all step types.
   */
  private buildStepOutput(
    data: unknown,
    options: {
      summary?: string;
      durationMs?: number;
      httpResponse?: { status: number; headers?: Record<string, string>; body?: unknown };
      aggregatedResults?: Array<{ taskId: string; stepId?: string; data: unknown; status: 'success' | 'failed' }>;
      selectedBranch?: { targetStepId: string; condition?: string };
      foreachMeta?: { totalItems: number; itemsPath: string };
      logs?: string[];
      nestedWorkflow?: { runId: string; status: string; output?: unknown };
      documents?: Array<{ id: string; title: string; type: string; score?: number }>;
    } = {}
  ): {
    data: unknown;
    summary?: string;
    producedAt: Date;
    durationMs?: number;
    httpResponse?: { status: number; headers?: Record<string, string>; body?: unknown };
    aggregatedResults?: Array<{ taskId: string; stepId?: string; data: unknown; status: 'success' | 'failed' }>;
    selectedBranch?: { targetStepId: string; condition?: string };
    foreachMeta?: { totalItems: number; itemsPath: string };
    logs?: string[];
    nestedWorkflow?: { runId: string; status: string; output?: unknown };
    documents?: Array<{ id: string; title: string; type: string; score?: number }>;
  } {
    return {
      data,
      summary: options.summary,
      producedAt: new Date(),
      durationMs: options.durationMs,
      httpResponse: options.httpResponse,
      aggregatedResults: options.aggregatedResults,
      selectedBranch: options.selectedBranch,
      foreachMeta: options.foreachMeta,
      logs: options.logs,
      nestedWorkflow: options.nestedWorkflow,
      documents: options.documents,
    };
  }

  /**
   * Build an ExecutionSummary for a workflow run's root task.
   * Called at workflow completion or failure to provide a high-level
   * programmatic rollup of what happened.
   */
  private async buildExecutionSummary(
    run: WorkflowRun,
    allTasks: Task[],
    workflow: Workflow,
    outcome: ExecutionOutcome,
    failedTask?: Task
  ): Promise<ExecutionSummary> {
    const now = new Date();
    const startTime = run.startedAt || run.createdAt;
    const durationMs = startTime ? now.getTime() - new Date(startTime).getTime() : undefined;

    // Build trigger info
    const trigger: ExecutionSummary['trigger'] = {
      source: run.source || `workflow: ${workflow.name}`,
    };
    if (run.inputPayload) {
      const keys = Object.keys(run.inputPayload);
      trigger.inputSummary = keys.length > 0
        ? keys.slice(0, 5).join(', ') + (keys.length > 5 ? ` (+${keys.length - 5} more)` : '')
        : undefined;
    }

    // Build step trace from stepLog
    const steps: ExecutionSummaryStep[] = [];
    if (run.stepLog && run.stepLog.length > 0) {
      for (const entry of run.stepLog) {
        // Find the corresponding task for richer summary data
        const stepTask = allTasks.find(t => t.workflowStepId === entry.stepId);
        const stepSummary = this.extractTaskSummary(stepTask);

        steps.push({
          stepName: entry.stepName,
          stepType: entry.stepType,
          outcome: entry.status === 'completed' ? 'success'
            : entry.status === 'failed' ? 'failed'
            : 'skipped',
          summary: stepSummary || undefined,
          error: entry.error || undefined,
          durationMs: entry.durationMs || undefined,
        });
      }
    }

    // Build child flow summaries for any flow-type tasks
    const childFlowSummaries: ExecutionSummaryChildFlow[] = [];
    const flowTasks = allTasks.filter(t => t.taskType === 'flow' && t.spawnedWorkflowRunId);
    for (const flowTask of flowTasks) {
      const childSummary: ExecutionSummaryChildFlow = {
        taskId: flowTask._id.toString(),
        title: flowTask.title,
        outcome: flowTask.status === 'completed' ? 'success'
          : flowTask.status === 'failed' ? 'failed'
          : 'escalated',
      };

      // Pull from the child's own executionSummary if available
      if (flowTask.executionSummary) {
        childSummary.outcome = flowTask.executionSummary.outcome;
        // Use the child's step trace to build a brief summary
        const childSteps = flowTask.executionSummary.steps;
        if (childSteps && childSteps.length > 0) {
          const succeeded = childSteps.filter(s => s.outcome === 'success').length;
          const failed = childSteps.filter(s => s.outcome === 'failed').length;
          childSummary.summary = `${succeeded}/${childSteps.length} steps succeeded` +
            (failed > 0 ? `, ${failed} failed` : '');
        }
        if (flowTask.executionSummary.errorChain?.[0]) {
          childSummary.error = flowTask.executionSummary.errorChain[0].error;
        }
      } else {
        // Fallback: extract from workflowResult
        childSummary.summary = this.extractTaskSummary(flowTask) || undefined;
        if (flowTask.workflowResult?.error) {
          childSummary.error = flowTask.workflowResult.error;
        }
      }

      // Try to get workflow name from the flow config
      if (flowTask.flowConfig?.workflowId) {
        const childWorkflow = await this.workflows.findOne({
          _id: new ObjectId(flowTask.flowConfig.workflowId),
        });
        if (childWorkflow) {
          childSummary.workflowName = childWorkflow.name;
        }
      }

      childFlowSummaries.push(childSummary);
    }

    // Build error chain for failures
    const errorChain: ExecutionSummaryError[] = [];
    if (outcome === 'failed' && failedTask) {
      this.buildErrorChain(errorChain, failedTask, allTasks);
    }

    // Build stats for foreach parents
    let stats: ExecutionSummary['stats'] = undefined;
    const foreachTasks = allTasks.filter(t => t.taskType === 'foreach' && t.batchCounters);
    if (foreachTasks.length > 0) {
      let total = 0, succeeded = 0, failed = 0;
      for (const ft of foreachTasks) {
        const counters = ft.batchCounters!;
        total += counters.expectedCount || 0;
        succeeded += counters.processedCount || 0;
        failed += counters.failedCount || 0;
      }
      stats = {
        total,
        succeeded,
        failed,
        skipped: Math.max(0, total - succeeded - failed),
      };
    }

    return {
      outcome,
      completedAt: now,
      durationMs,
      trigger,
      steps: steps.length > 0 ? steps : undefined,
      stats,
      childFlowSummaries: childFlowSummaries.length > 0 ? childFlowSummaries : undefined,
      errorChain: errorChain.length > 0 ? errorChain : undefined,
    };
  }

  /**
   * Build an ExecutionSummary for a foreach parent task based on its children.
   */
  private buildForeachExecutionSummary(
    parentTask: Task,
    children: Task[]
  ): ExecutionSummary {
    const now = new Date();
    const succeeded = children.filter(c => c.status === 'completed').length;
    const failed = children.filter(c => c.status === 'failed').length;
    const total = children.length;
    const skipped = Math.max(0, total - succeeded - failed);

    const outcome: ExecutionOutcome = failed > 0
      ? (succeeded > 0 ? 'partial' : 'failed')
      : 'success';

    const errorChain: ExecutionSummaryError[] = [];
    if (failed > 0) {
      const failedChildren = children.filter(c => c.status === 'failed');
      for (const child of failedChildren.slice(0, 5)) {
        const errorMsg = typeof child.metadata?.error === 'string'
          ? child.metadata.error
          : this.extractTaskSummary(child) || 'Unknown error';
        errorChain.push({
          stepName: child.title,
          error: errorMsg,
          taskId: child._id.toString(),
        });
      }
    }

    const startTime = parentTask.createdAt;
    const durationMs = startTime ? now.getTime() - new Date(startTime).getTime() : undefined;

    return {
      outcome,
      completedAt: now,
      durationMs,
      stats: { total, succeeded, failed, skipped },
      errorChain: errorChain.length > 0 ? errorChain : undefined,
    };
  }

  /**
   * Extract a human-readable summary string from a task's output data.
   */
  private extractTaskSummary(task: Task | null | undefined): string | null {
    if (!task) return null;
    // Prefer stepOutput.summary
    if (task.stepOutput?.summary) return task.stepOutput.summary;
    // Then daemon output summary
    const meta = task.metadata as Record<string, unknown> | undefined;
    if (meta?.output && typeof meta.output === 'object') {
      const output = meta.output as Record<string, unknown>;
      if (typeof output.summary === 'string') return output.summary;
    }
    if (typeof meta?.summary === 'string') return meta.summary;
    // TaskResult summary
    if (task.taskResult?.current?.summary) return task.taskResult.current.summary;
    return null;
  }

  /**
   * Build an error chain by tracing the failure through nested tasks.
   * Most specific error first (the leaf task that actually failed).
   */
  private buildErrorChain(
    chain: ExecutionSummaryError[],
    failedTask: Task,
    _allTasks: Task[]
  ): void {
    // Start with the immediate failed task
    const errorMsg = typeof failedTask.metadata?.error === 'string'
      ? failedTask.metadata.error
      : typeof failedTask.metadata?.nextActionReason === 'string'
        ? failedTask.metadata.nextActionReason
        : failedTask.workflowResult?.error
          || `Step "${failedTask.title}" failed`;

    chain.push({
      stepName: failedTask.title,
      error: errorMsg,
      taskId: failedTask._id.toString(),
    });

    // If this is a flow task with a spawned workflow, look for the child's failed task
    if (failedTask.taskType === 'flow' && failedTask.executionSummary?.errorChain) {
      // Append the child's error chain (already ordered most-specific-first)
      chain.push(...failedTask.executionSummary.errorChain);
    }
  }

  private async createTaskForStep(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    parentTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<Task> {
    const now = new Date();

    const taskType = this.mapStepTypeToTaskType(step.stepType);
    const executionMode = this.mapStepTypeToExecutionMode(step);

    let initialStatus: TaskStatus = 'pending';
    if (step.stepType === 'foreach' || step.stepType === 'join') {
      initialStatus = 'waiting';
    } else if (step.stepType === 'decision') {
      initialStatus = 'in_progress';
    }

    const runDefaults = this.applyTaskDefaults(run, now);

    let taskTitle = step.name || `Step ${step.id || 'Unknown'}`;
    if (step.titleTemplate) {
      // Use async version that supports variables with nested interpolation
      taskTitle = await resolveTitleTemplateWithPackages(step.titleTemplate, inputPayload, step.name);
    }

    // Build stepConfig to preserve original workflow step configuration
    const stepConfig = this.buildStepConfig(step);

    // Determine assignee:
    // 1. If step has explicit defaultAssigneeId, use that
    // 2. If run has taskDefaults.assigneeId, use that
    // 3. If task type is system-executed (webhook, join, etc.), assign to system user
    // 4. Otherwise leave null (unassigned - awaiting human assignment)
    let assigneeId: ObjectId | null = null;
    if (step.defaultAssigneeId) {
      assigneeId = new ObjectId(step.defaultAssigneeId);
    } else if (runDefaults.assigneeId) {
      assigneeId = runDefaults.assigneeId;
    } else if (isSystemExecutedTaskType(taskType)) {
      // System-executed task types default to system user when unassigned
      assigneeId = SYSTEM_USER_ID;
    }

    const task: Omit<Task, '_id'> = {
      title: taskTitle,
      status: initialStatus,
      parentId: parentTask._id,
      workflowId: workflow._id,
      workflowRunId: run._id,
      taskType,
      executionMode,
      stepConfig,
      ...runDefaults,
      assigneeId,
      createdAt: now,
      updatedAt: now,
      ...(run.humanInstruction && { humanInstruction: run.humanInstruction }),
      // New unified step input field
      stepInput: inputPayload,
      metadata: {
        stepId: step.id,
        stepType: step.stepType,
        // Keep inputPayload in metadata for backward compatibility during transition
        inputPayload,
      },
    };

    if (step.id) {
      task.workflowStepId = step.id;
    }
    if (step.name) {
      task.workflowStage = step.name;
    }
    if (step.description) {
      task.summary = step.description;
    }

    // Expand prompt library documents + additional instructions
    const expandedPrompt = await this.getExpandedPrompt(step);
    if (expandedPrompt) {
      task.extraPrompt = expandedPrompt;
    }

    if (step.stepType === 'foreach' && step.itemsPath) {
      task.foreachConfig = {
        itemsSource: 'previous_step',
        itemsPath: step.itemsPath,
        maxItems: step.maxItems || 100,
      };
      task.batchCounters = {
        expectedCount: 0,
        receivedCount: 0,
        processedCount: 0,
        failedCount: 0,
      };
    }

    if (step.stepType === 'external') {
      task.externalConfig = {
        callbackSecret: this.generateSecret(),
      };
      const webhookUrl = step.webhookConfig?.url || step.externalConfig?.endpoint;
      if (webhookUrl) {
        task.webhookConfig = {
          url: webhookUrl,
          method: step.webhookConfig?.method || step.externalConfig?.method || 'POST',
          headers: step.webhookConfig?.headers || step.externalConfig?.headers || {},
          body: step.webhookConfig?.bodyTemplate || step.externalConfig?.payloadTemplate,
          maxRetries: step.webhookConfig?.maxRetries ?? 3,
          retryDelayMs: 1000,
          timeoutMs: step.webhookConfig?.timeoutMs ?? 30000,
          successStatusCodes: step.webhookConfig?.successStatusCodes || [200, 201, 202, 204],
          attempts: [],
          workflowManaged: true,
        };
      }
    }

    const cleanTask = stripUndefined(task as unknown as Record<string, unknown>) as unknown as Task;
    const result = await this.tasks.insertOne(cleanTask);
    const createdTask = { ...cleanTask, _id: result.insertedId } as Task;

    await publishTaskEvent('task.created', createdTask, { actorType: 'system' });

    // For manual (review) steps, auto-attach document if input contains draft content
    if (step.stepType === 'manual' && inputPayload) {
      await this.autoAttachDocumentFromInput(createdTask, inputPayload);
    }

    return createdTask;
  }

  /**
   * Auto-attach a document to a task if the input payload contains document content.
   * This is useful for manual review steps that need to display generated content
   * from the previous step (e.g., a draft created by an agent step).
   *
   * Looks for content in these paths (in order):
   * - output.result.draft - Primary path for generated document content
   * - output.result.content - Alternative content path
   * - output.result.document - Alternative document path
   *
   * The document is created with status "review" to indicate it needs approval.
   */
  private async autoAttachDocumentFromInput(
    task: Task,
    inputPayload: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = getDb();

      // Look for document content in various paths
      const output = inputPayload.output as Record<string, unknown> | undefined;
      if (!output) return;

      const result = output.result as Record<string, unknown> | undefined;
      if (!result) return;

      // Find the content - check multiple possible paths
      const content = (result.draft || result.content || result.document) as string | undefined;
      if (!content || typeof content !== 'string') return;

      // Get title from result, or derive from summary/task title
      const title = (result.title as string)
        || (output.summary as string)
        || `Draft for ${task.title}`;

      // Get summary if available
      const summary = (result.summary as string) || (output.summary as string) || undefined;

      const now = new Date();

      // Create the document with review status
      const newDocument: Omit<Document, '_id'> = {
        title,
        content,
        summary,
        type: 'output',
        status: 'review',
        tags: [],
        groupId: task.groupId || null,
        projectId: task.projectId || null,
        createdById: null, // System-generated
        lastModifiedById: null,
        relatedTaskIds: [task._id],
        workflowRunId: task.workflowRunId || null,
        version: 1,
        metadata: {
          autoGenerated: true,
          sourceStepId: (inputPayload.stepId as string) || undefined,
          sourceTaskId: (inputPayload.taskId as string) || undefined,
        },
        createdAt: now,
        updatedAt: now,
      };

      const docResult = await db.collection<Document>('documents').insertOne(newDocument as Document);

      console.log(
        `WorkflowExecutionService: Auto-attached document "${title}" (${docResult.insertedId}) to task ${task._id}`
      );

      // Publish event for activity logging
      await publishTaskEvent('task.updated', task, {
        actorType: 'system',
        metadata: {
          documentAttached: docResult.insertedId.toString(),
          documentTitle: title,
          autoGenerated: true,
        },
      });
    } catch (error) {
      // Log but don't fail task creation
      console.error('WorkflowExecutionService: Error auto-attaching document:', error);
    }
  }

  private mapStepTypeToTaskType(stepType: string): TaskType {
    const mapping: Record<string, TaskType> = {
      'trigger': 'trigger',
      'agent': 'agent',
      'manual': 'manual',
      'external': 'external',
      'webhook': 'webhook',
      'decision': 'decision',
      'foreach': 'foreach',
      'join': 'join',
      'flow': 'flow',
      'findDocument': 'findDocument',
      'code': 'code',
    };
    return mapping[stepType] || 'agent';
  }

  private mapStepTypeToExecutionMode(step: WorkflowStep): ExecutionMode {
    // For external steps, check waitForCallback to determine execution mode
    // When waitForCallback is false, it operates as fire-and-forget (automated)
    // When waitForCallback is true (default), it waits for callback (external_callback)
    if (step.stepType === 'external') {
      const waitForCallback = step.externalConfig?.waitForCallback !== false;
      return waitForCallback ? 'external_callback' : 'automated';
    }

    const mapping: Record<string, ExecutionMode> = {
      'trigger': 'immediate',
      'agent': 'automated',
      'manual': 'manual',
      'webhook': 'automated',
      'decision': 'immediate',
      'foreach': 'immediate',
      'join': 'immediate',
      'flow': 'automated',
      'findDocument': 'immediate',
      'code': 'immediate',  // Code executes immediately in sandbox
    };
    return mapping[step.stepType] || 'automated';
  }

  // ============================================================================
  // External Step Execution
  // ============================================================================

  private async executeExternal(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    externalTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const webhookUrl = step.webhookConfig?.url || step.externalConfig?.endpoint;
    if (webhookUrl) {
      await this.executeExternalAsWebhook(run, workflow, step, externalTask, inputPayload);
      return;
    }

    const config = step.externalConfig;
    const callbackSecret = externalTask.externalConfig?.callbackSecret || this.generateSecret();

    await this.tasks.updateOne(
      { _id: externalTask._id },
      {
        $set: {
          status: 'in_progress' as TaskStatus,
          'externalConfig.callbackSecret': callbackSecret,
          'metadata.externalCallInitiated': false,
        },
      }
    );

    if (!config?.endpoint) {
      console.log(`[WorkflowExecutionService] External step ${step.id} has no endpoint - waiting for manual callback`);
      return;
    }

    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: externalTask._id,
      callbackSecret,
      inputPayload,
    };

    const endpoint = await resolveTemplateWithPackages(config.endpoint, templateContext);

    let requestBody: Record<string, unknown> = {};
    if (config.payloadTemplate) {
      try {
        const resolvedPayload = await resolveTemplateWithPackages(config.payloadTemplate, templateContext);
        requestBody = JSON.parse(resolvedPayload);
      } catch (e) {
        console.error(`[WorkflowExecutionService] Failed to parse payload template:`, e);
        requestBody = { ...inputPayload };
      }
    } else {
      requestBody = {
        ...inputPayload,
        _callback: {
          url: `${getBaseUrl()}/api/workflows/callback`,
          workflowRunId: run._id.toString(),
          stepId: step.id,
          secret: callbackSecret,
        },
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        headers[key] = await resolveTemplateWithPackages(value, templateContext);
      }
    }

    console.log(`[WorkflowExecutionService] Making external HTTP call to ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: config.method || 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      const responseData = await response.json().catch(() => ({})) as Record<string, unknown>;

      await this.tasks.updateOne(
        { _id: externalTask._id },
        {
          $set: {
            'metadata.externalCallInitiated': true,
            'metadata.externalCallStatus': response.status,
            'metadata.externalCallResponse': responseData,
          },
        }
      );

      if (!response.ok) {
        console.error(`[WorkflowExecutionService] External call failed with status ${response.status}:`, responseData);
      } else {
        console.log(`[WorkflowExecutionService] External call succeeded, waiting for callback`);

        if (config.responseMapping) {
          const mappedData: Record<string, unknown> = {};
          for (const [targetPath, sourcePath] of Object.entries(config.responseMapping)) {
            const value = getValueByPath(responseData, sourcePath);
            if (value !== undefined) {
              mappedData[targetPath] = value;
            }
          }
          await this.tasks.updateOne(
            { _id: externalTask._id },
            { $set: { 'metadata.mappedResponse': mappedData } }
          );
        }
      }
    } catch (error) {
      console.error(`[WorkflowExecutionService] External call error:`, error);
      await this.tasks.updateOne(
        { _id: externalTask._id },
        {
          $set: {
            'metadata.externalCallInitiated': true,
            'metadata.externalCallError': String(error),
          },
        }
      );
    }
  }

  private async executeExternalAsWebhook(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    externalTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const webhookCfg = step.webhookConfig;
    const externalCfg = step.externalConfig;

    const url = webhookCfg?.url || externalCfg?.endpoint;
    const method = webhookCfg?.method || externalCfg?.method || 'POST';
    const headers = webhookCfg?.headers || externalCfg?.headers || {};
    const bodyTemplate = webhookCfg?.bodyTemplate || externalCfg?.payloadTemplate;
    const timeoutMs = webhookCfg?.timeoutMs || 30000;
    const successStatusCodes = webhookCfg?.successStatusCodes || [200, 201, 202, 204];

    console.log(`[WorkflowExecutionService] Executing external step as webhook: ${method} ${url}`);

    let nextForeachStepId: string | undefined;
    const nextStepIds = step.connections?.map(c => c.targetStepId) || [];
    if (nextStepIds.length === 0) {
      const currentIndex = workflow.steps.findIndex(s => s.id === step.id);
      const nextStep = workflow.steps[currentIndex + 1];
      if (nextStep) {
        nextStepIds.push(nextStep.id);
      }
    }
    for (const nextStepId of nextStepIds) {
      const nextStep = workflow.steps.find(s => s.id === nextStepId);
      if (nextStep?.stepType === 'foreach') {
        nextForeachStepId = nextStep.id;
        console.log(`[WorkflowExecutionService] Found next foreach step: ${nextStep.name} (${nextStep.id})`);
        break;
      }
    }

    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: externalTask._id,
      callbackSecret: externalTask.externalConfig?.callbackSecret || run.callbackSecret,
      inputPayload,
      nextForeachStepId,
    };

    const resolvedUrl = await resolveTemplateWithPackages(url!, templateContext);
    let resolvedBody: string | undefined;

    if (bodyTemplate) {
      resolvedBody = await resolveTemplateWithPackages(bodyTemplate, templateContext);
    } else if (inputPayload) {
      resolvedBody = JSON.stringify(inputPayload);
    }

    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    for (const [key, value] of Object.entries(resolvedHeaders)) {
      resolvedHeaders[key] = await resolveTemplateWithPackages(value, templateContext);
    }

    const startTime = Date.now();

    try {
      const response = await fetch(resolvedUrl, {
        method,
        headers: resolvedHeaders,
        body: resolvedBody,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text();
      let parsedResponse: unknown;
      try {
        parsedResponse = JSON.parse(responseBody);
      } catch {
        parsedResponse = responseBody;
      }

      const isSuccess = successStatusCodes.includes(response.status);

      const attempt = {
        attemptNumber: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        status: isSuccess ? 'success' : 'failed',
        requestUrl: resolvedUrl,
        requestMethod: method,
        requestHeaders: resolvedHeaders,
        requestBody: resolvedBody,
        httpStatus: response.status,
        responseBody: parsedResponse,
        durationMs,
      };

      if (isSuccess) {
        await this.tasks.updateOne(
          { _id: externalTask._id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              'webhookConfig.attempts': [attempt],
              'webhookConfig.lastAttemptAt': new Date(),
              'metadata.response': parsedResponse,
              'metadata.requestUrl': resolvedUrl,
              'metadata.requestMethod': method,
              'metadata.requestHeaders': resolvedHeaders,
              'metadata.requestBody': resolvedBody,
            },
          }
        );
        console.log(`[WorkflowExecutionService] External webhook completed successfully: ${response.status}`);

        const updatedTask = await this.tasks.findOne({ _id: externalTask._id });
        if (updatedTask) {
          await eventBus.publish({
            type: 'task.status.changed',
            taskId: updatedTask._id,
            task: updatedTask,
            changes: [{
              field: 'status',
              oldValue: 'in_progress',
              newValue: 'completed',
            }],
            actorId: null,
            actorType: 'system',
          });
          console.log(`[WorkflowExecutionService] Published task.status.changed event for task ${updatedTask._id}`);
        }
      } else {
        await this.tasks.updateOne(
          { _id: externalTask._id },
          {
            $set: {
              status: 'failed' as TaskStatus,
              'webhookConfig.attempts': [attempt],
              'webhookConfig.lastAttemptAt': new Date(),
              'metadata.error': `HTTP ${response.status}: ${responseBody}`,
              'metadata.requestUrl': resolvedUrl,
              'metadata.requestMethod': method,
              'metadata.requestHeaders': resolvedHeaders,
              'metadata.requestBody': resolvedBody,
            },
          }
        );
        console.error(`[WorkflowExecutionService] External webhook failed: ${response.status}`);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[WorkflowExecutionService] External webhook execution error:`, error);

      const attempt = {
        attemptNumber: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        status: 'failed' as const,
        requestUrl: resolvedUrl,
        requestMethod: method,
        requestHeaders: resolvedHeaders,
        requestBody: resolvedBody,
        errorMessage: String(error),
        durationMs,
      };

      await this.tasks.updateOne(
        { _id: externalTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'webhookConfig.attempts': [attempt],
            'webhookConfig.lastAttemptAt': new Date(),
            'metadata.error': String(error),
            'metadata.requestUrl': resolvedUrl,
            'metadata.requestMethod': method,
            'metadata.requestHeaders': resolvedHeaders,
            'metadata.requestBody': resolvedBody,
          },
        }
      );
    }
  }

  // ============================================================================
  // Webhook Step Execution
  // ============================================================================

  private async executeWebhook(
    run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    webhookTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const config = step.webhookConfig;

    if (!config?.url) {
      console.error(`[WorkflowExecutionService] Webhook step ${step.id} has no URL configured`);
      await this.tasks.updateOne(
        { _id: webhookTask._id },
        { $set: { status: 'failed' as TaskStatus, 'metadata.error': 'No webhook URL configured' } }
      );
      return;
    }

    const webhookConfig = {
      url: config.url,
      method: config.method || 'POST',
      headers: config.headers || {},
      body: config.bodyTemplate,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: 1000,
      timeoutMs: config.timeoutMs ?? 30000,
      successStatusCodes: config.successStatusCodes || [200, 201, 202, 204],
      attempts: [],
    };

    await this.tasks.updateOne(
      { _id: webhookTask._id },
      {
        $set: {
          status: 'in_progress' as TaskStatus,
          webhookConfig,
          'metadata.inputPayload': inputPayload,
        },
      }
    );

    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: webhookTask._id,
      inputPayload,
    };

    try {
      const resolvedUrl = await resolveTemplateWithPackages(config.url, templateContext);
      let resolvedBody: string | undefined;

      if (config.bodyTemplate) {
        resolvedBody = await resolveTemplateWithPackages(config.bodyTemplate, templateContext);
      } else if (inputPayload) {
        resolvedBody = JSON.stringify(inputPayload);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      for (const [key, value] of Object.entries(headers)) {
        headers[key] = await resolveTemplateWithPackages(value, templateContext);
      }

      console.log(`[WorkflowExecutionService] Executing webhook: ${config.method || 'POST'} ${resolvedUrl}`);

      const response = await fetch(resolvedUrl, {
        method: config.method || 'POST',
        headers,
        body: resolvedBody,
        signal: AbortSignal.timeout(config.timeoutMs || 30000),
      });

      const responseBody = await response.text();
      let parsedResponse: unknown;
      try {
        parsedResponse = JSON.parse(responseBody);
      } catch {
        parsedResponse = responseBody;
      }

      const isSuccess = (config.successStatusCodes || [200, 201, 202, 204]).includes(response.status);

      const attempt = {
        attemptNumber: 1,
        startedAt: new Date(),
        completedAt: new Date(),
        status: isSuccess ? 'success' : 'failed',
        httpStatus: response.status,
        responseBody: parsedResponse,
      };

      if (isSuccess) {
        await this.tasks.updateOne(
          { _id: webhookTask._id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              'webhookConfig.attempts': [attempt],
              'webhookConfig.lastAttemptAt': new Date(),
              'metadata.response': parsedResponse,
            },
          }
        );
        console.log(`[WorkflowExecutionService] Webhook completed successfully: ${response.status}`);
      } else {
        await this.tasks.updateOne(
          { _id: webhookTask._id },
          {
            $set: {
              status: 'failed' as TaskStatus,
              'webhookConfig.attempts': [attempt],
              'webhookConfig.lastAttemptAt': new Date(),
              'metadata.error': `HTTP ${response.status}: ${responseBody}`,
            },
          }
        );
        console.error(`[WorkflowExecutionService] Webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error(`[WorkflowExecutionService] Webhook execution error:`, error);
      await this.tasks.updateOne(
        { _id: webhookTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': String(error),
          },
        }
      );
    }
  }

  // ============================================================================
  // Foreach Execution
  // ============================================================================

  private async executeForeach(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    foreachTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    console.log(`[WorkflowExecutionService] executeForeach called for step ${step.id}`);
    console.log(`[WorkflowExecutionService] inputPayload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
    console.log(`[WorkflowExecutionService] inputPayload: ${JSON.stringify(inputPayload, null, 2).substring(0, 1000)}`);
    if (step.expectedCountPath) {
      console.log(`[WorkflowExecutionService] step.expectedCountPath: ${step.expectedCountPath}`);
      const testValue = getValueByPath(inputPayload, step.expectedCountPath);
      console.log(`[WorkflowExecutionService] getValueByPath(inputPayload, "${step.expectedCountPath}") = ${testValue} (type: ${typeof testValue})`);
    }

    const getExpectedCountFromStepConfig = (): number => {
      if (step.expectedCountPath) {
        const pathValue = getValueByPath(inputPayload, step.expectedCountPath);
        if (typeof pathValue === 'number' && pathValue >= 0) {
          console.log(`[WorkflowExecutionService] Using expectedCountPath "${step.expectedCountPath}" = ${pathValue}`);
          return pathValue;
        }

        const alternates = ['output.count', 'response.count', 'count', 'output.total', 'response.total', 'total'];
        const foundAlternates: string[] = [];
        for (const alt of alternates) {
          const altValue = getValueByPath(inputPayload, alt);
          if (typeof altValue === 'number') {
            foundAlternates.push(`${alt}=${altValue}`);
          }
        }

        console.warn(`[WorkflowExecutionService] expectedCountPath "${step.expectedCountPath}" did not resolve to a number.`);
        console.warn(`[WorkflowExecutionService] Input payload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
        if (foundAlternates.length > 0) {
          console.warn(`[WorkflowExecutionService] Found numeric values at: ${foundAlternates.join(', ')}. Consider updating expectedCountPath.`);
        }
        console.warn(`[WorkflowExecutionService] Input payload structure: ${JSON.stringify(inputPayload, null, 2).substring(0, 500)}`);
      }
      return 0;
    };

    if (!step.itemsPath) {
      console.log(`[WorkflowExecutionService] Foreach step ${step.id} has no itemsPath - waiting for callback items`);
      const expectedCount = getExpectedCountFromStepConfig();
      await this.tasks.updateOne(
        { _id: foreachTask._id },
        {
          $set: {
            status: 'waiting' as TaskStatus,
            expectedQuantity: expectedCount,
            'batchCounters.expectedCount': expectedCount,
            'metadata.waitingReason': 'No itemsPath configured. Waiting for items via callback.',
          }
        }
      );
      console.log(`[WorkflowExecutionService] Foreach task ${foreachTask._id} set to waiting for callbacks (expectedCount: ${expectedCount})`);
      return;
    }

    const items = getValueByPath(inputPayload, step.itemsPath);

    if (!Array.isArray(items)) {
      console.warn(`[WorkflowExecutionService] Items at ${step.itemsPath} is not an array. Input payload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
      const expectedCount = getExpectedCountFromStepConfig();
      await this.tasks.updateOne(
        { _id: foreachTask._id },
        {
          $set: {
            status: 'waiting' as TaskStatus,
            expectedQuantity: expectedCount,
            'batchCounters.expectedCount': expectedCount,
            'metadata.waitingReason': `Items not found at path: ${step.itemsPath}. Waiting for external data.`,
          }
        }
      );
      console.log(`[WorkflowExecutionService] Foreach task ${foreachTask._id} set to waiting - items not found at path (expectedCount: ${expectedCount})`);
      return;
    }

    if (items.length === 0) {
      console.warn(`[WorkflowExecutionService] Items array at ${step.itemsPath} is empty`);
      const expectedCount = getExpectedCountFromStepConfig();
      await this.tasks.updateOne(
        { _id: foreachTask._id },
        {
          $set: {
            status: 'waiting' as TaskStatus,
            expectedQuantity: expectedCount,
            'batchCounters.expectedCount': expectedCount,
            'metadata.waitingReason': `Items array at path ${step.itemsPath} is empty. Waiting for external data.`,
          }
        }
      );
      console.log(`[WorkflowExecutionService] Foreach task ${foreachTask._id} set to waiting - empty items array (expectedCount: ${expectedCount})`);
      return;
    }

    const maxItems = step.maxItems || 100;
    const itemsToProcess = items.slice(0, maxItems);

    let expectedCount = itemsToProcess.length;
    if (step.expectedCountPath) {
      const pathValue = getValueByPath(inputPayload, step.expectedCountPath);
      if (typeof pathValue === 'number' && pathValue >= 0) {
        expectedCount = pathValue;
        console.log(`[WorkflowExecutionService] Using expectedCountPath "${step.expectedCountPath}" = ${expectedCount}`);
      } else {
        const alternates = ['output.count', 'response.count', 'count', 'output.total', 'response.total', 'total'];
        const foundAlternates: string[] = [];
        for (const alt of alternates) {
          const altValue = getValueByPath(inputPayload, alt);
          if (typeof altValue === 'number') {
            foundAlternates.push(`${alt}=${altValue}`);
          }
        }
        console.warn(`[WorkflowExecutionService] expectedCountPath "${step.expectedCountPath}" did not yield a valid number (got: ${pathValue}), falling back to items.length=${itemsToProcess.length}`);
        console.warn(`[WorkflowExecutionService] Input payload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
        if (foundAlternates.length > 0) {
          console.warn(`[WorkflowExecutionService] Found numeric values at: ${foundAlternates.join(', ')}. Consider updating expectedCountPath.`);
        }
      }
    }

    await this.tasks.updateOne(
      { _id: foreachTask._id },
      {
        $set: {
          expectedQuantity: expectedCount,
          'batchCounters.expectedCount': expectedCount,
          'metadata.itemCount': itemsToProcess.length,
        },
      }
    );

    const nextStepId = step.connections?.[0]?.targetStepId;
    const nextStep = nextStepId ? workflow.steps.find(s => s.id === nextStepId) : null;

    if (!nextStep) {
      console.warn(`[WorkflowExecutionService] Foreach step ${step.id} has no connected steps`);
      return;
    }

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      const itemPayload = {
        ...inputPayload,
        [step.itemVariable || 'item']: item,
        _index: i,
        _total: itemsToProcess.length,
      };

      await this.createTaskForStep(run, workflow, nextStep, foreachTask, itemPayload);
    }

    console.log(`[WorkflowExecutionService] Created ${itemsToProcess.length} child tasks for foreach`);
  }

  // ============================================================================
  // Join Execution
  // ============================================================================

  private async executeJoin(
    run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    joinTask: Task
  ): Promise<void> {
    let foreachTask: Task | null = null;

    if (step.awaitStepId) {
      foreachTask = await this.tasks.findOne({
        workflowRunId: run._id,
        workflowStepId: step.awaitStepId,
      });
      console.log(`[WorkflowExecutionService] Join using awaitStepId: ${step.awaitStepId}`);
    } else {
      foreachTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'foreach',
        status: { $in: ['waiting', 'in_progress'] },
      });
    }

    let expectedCount: number | undefined;

    if (step.expectedCountPath) {
      const externalTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'external',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (externalTask?.metadata) {
        const mappedResponse = externalTask.metadata.mappedResponse as Record<string, unknown> | undefined;
        const callbackPayload = externalTask.metadata.callbackPayload as Record<string, unknown> | undefined;
        const externalResponse = externalTask.metadata.externalCallResponse as Record<string, unknown> | undefined;

        const countFromMapped = mappedResponse ? getValueByPath(mappedResponse, step.expectedCountPath) : undefined;
        const countFromCallback = callbackPayload ? getValueByPath(callbackPayload, step.expectedCountPath) : undefined;
        const countFromResponse = externalResponse ? getValueByPath(externalResponse, step.expectedCountPath) : undefined;

        const countValue = countFromMapped ?? countFromCallback ?? countFromResponse;
        if (typeof countValue === 'number') {
          expectedCount = countValue;
          console.log(`[WorkflowExecutionService] Got expectedCount ${expectedCount} from path ${step.expectedCountPath}`);
        }
      }
    }

    if (!foreachTask) {
      console.log('[WorkflowExecutionService] No foreach task to join on');
      await this.tasks.updateOne(
        { _id: joinTask._id },
        { $set: { status: 'completed' as TaskStatus } }
      );
      return;
    }

    const minSuccessPercent = step.joinBoundary?.minPercent ?? step.minSuccessPercent ?? 100;
    const scope = step.awaitStepId ? 'step_tasks' : 'children';

    await this.tasks.updateOne(
      { _id: joinTask._id },
      {
        $set: {
          'joinConfig.awaitStepId': step.awaitStepId,
          'joinConfig.awaitTaskId': foreachTask._id,
          'joinConfig.scope': scope,
          'joinConfig.minSuccessPercent': minSuccessPercent,
          'joinConfig.expectedCount': expectedCount,
          'joinConfig.inputPath': step.inputPath,
          'joinConfig.boundary': step.joinBoundary ? {
            minCount: step.joinBoundary.minCount,
            minPercent: step.joinBoundary.minPercent ?? minSuccessPercent,
            maxWaitMs: step.joinBoundary.maxWaitMs,
            failOnTimeout: step.joinBoundary.failOnTimeout ?? true,
          } : undefined,
          'metadata.awaitingForeachTask': foreachTask._id.toString(),
          'metadata.awaitStepId': step.awaitStepId,
          'metadata.minSuccessPercent': minSuccessPercent,
        },
      }
    );

    await this.checkJoinCondition(joinTask._id, foreachTask._id);
  }

  private async checkJoinCondition(joinTaskId: ObjectId, foreachTaskId: ObjectId): Promise<boolean> {
    const foreachTask = await this.tasks.findOne({ _id: foreachTaskId });
    if (!foreachTask) {
      console.log(`[WorkflowExecutionService] checkJoinCondition: foreach task ${foreachTaskId} not found`);
      return false;
    }

    const joinTask = await this.tasks.findOne({ _id: joinTaskId });
    if (!joinTask) {
      console.log(`[WorkflowExecutionService] checkJoinCondition: join task ${joinTaskId} not found`);
      return false;
    }

    const children = await this.tasks.find({ parentId: foreachTaskId }).toArray();
    console.log(`[WorkflowExecutionService] checkJoinCondition: found ${children.length} children of foreach ${foreachTaskId}`);

    const completedCount = children.filter(c => c.status === 'completed').length;
    const failedCount = children.filter(c => c.status === 'failed').length;
    const totalDone = completedCount + failedCount;

    await this.tasks.updateOne(
      { _id: foreachTaskId },
      {
        $set: {
          'batchCounters.processedCount': completedCount,
          'batchCounters.failedCount': failedCount,
        },
      }
    );

    const expectedCount = joinTask.joinConfig?.expectedCount
      ?? foreachTask.batchCounters?.expectedCount
      ?? children.length;

    const minSuccessPercent = joinTask.joinConfig?.minSuccessPercent ?? 100;
    const maxWaitMs = joinTask.joinConfig?.boundary?.maxWaitMs;
    const requiredSuccessCount = Math.ceil((expectedCount * minSuccessPercent) / 100);
    const currentSuccessPercent = expectedCount > 0 ? (completedCount / expectedCount) * 100 : 0;

    let isTimedOut = false;
    if (maxWaitMs && joinTask.createdAt) {
      const waitingMs = Date.now() - new Date(joinTask.createdAt).getTime();
      isTimedOut = waitingMs >= maxWaitMs;
      if (isTimedOut) {
        console.log(`[WorkflowExecutionService] Join timeout: waited ${waitingMs}ms >= ${maxWaitMs}ms`);
      }
    }

    console.log(`[WorkflowExecutionService] Join check: ${completedCount}/${expectedCount} completed (${currentSuccessPercent.toFixed(1)}%), need ${minSuccessPercent}% (${requiredSuccessCount} tasks)${isTimedOut ? ' [TIMEOUT]' : ''}`);

    const thresholdMet = completedCount >= requiredSuccessCount;
    const allDone = totalDone >= expectedCount;
    const timeoutWithMinMet = isTimedOut && thresholdMet;
    const timeoutWithMinNotMet = isTimedOut && !thresholdMet;

    if (thresholdMet || allDone || isTimedOut) {
      let inputPath = joinTask.joinConfig?.inputPath;

      if (!inputPath && joinTask.workflowStepId && joinTask.workflowRunId) {
        const run = await this.workflowRuns.findOne({ _id: joinTask.workflowRunId });
        if (run) {
          const workflow = await this.workflows.findOne({ _id: run.workflowId });
          const step = workflow?.steps.find(s => s.id === joinTask.workflowStepId);
          if (step?.inputPath) {
            inputPath = step.inputPath;
            console.log(`[WorkflowExecutionService] Join aggregation: using inputPath from workflow step definition: ${inputPath}`);
          }
        }
      }
      const results = children
        .filter(c => c.status === 'completed')
        .map(c => {
          if (inputPath && c.metadata) {
            const extracted = getValueByPath(c.metadata, inputPath);
            if (extracted === undefined) {
              console.log(`[WorkflowExecutionService] Join aggregation: path "${inputPath}" not found in task ${c._id}, metadata keys: ${Object.keys(c.metadata).join(', ')}`);
            }
            return extracted;
          }
          return c.metadata;
        })
        .filter(r => r !== undefined);

      console.log(`[WorkflowExecutionService] Join aggregation: inputPath=${inputPath || '(full metadata)'}, collected ${results.length} results from ${children.filter(c => c.status === 'completed').length} completed tasks`);

      const joinStatus: TaskStatus = thresholdMet ? 'completed' : 'failed';

      let statusReason: string;
      if (timeoutWithMinMet) {
        statusReason = `Timeout with success: ${currentSuccessPercent.toFixed(1)}% >= ${minSuccessPercent}% (waited ${maxWaitMs}ms)`;
      } else if (timeoutWithMinNotMet) {
        statusReason = `Timeout without success: ${currentSuccessPercent.toFixed(1)}% < ${minSuccessPercent}% (waited ${maxWaitMs}ms)`;
      } else if (thresholdMet) {
        statusReason = `Success threshold met: ${currentSuccessPercent.toFixed(1)}% >= ${minSuccessPercent}%`;
      } else {
        statusReason = `Success threshold not met: ${currentSuccessPercent.toFixed(1)}% < ${minSuccessPercent}%`;
      }

      // Build stepOutput for join task so next steps can access aggregated results via stepOutput.data
      const joinStepOutput = this.buildStepOutput(
        { aggregatedResults: results },
        {
          summary: statusReason,
          aggregatedResults: results.map((r, i) => ({
            taskId: children.filter(c => c.status === 'completed')[i]?._id?.toString() || '',
            stepId: children.filter(c => c.status === 'completed')[i]?.workflowStepId,
            data: r,
            status: 'success' as const,
          })),
        }
      );

      await this.tasks.updateOne(
        { _id: joinTaskId },
        {
          $set: {
            status: joinStatus,
            stepOutput: joinStepOutput,
            'metadata.aggregatedResults': results,
            'metadata.successCount': completedCount,
            'metadata.failedCount': failedCount,
            'metadata.expectedCount': expectedCount,
            'metadata.successPercent': currentSuccessPercent,
            'metadata.requiredPercent': minSuccessPercent,
            'metadata.statusReason': statusReason,
          },
        }
      );

      // Build execution summary for the foreach parent task
      const foreachTask = await this.tasks.findOne({ _id: foreachTaskId });
      const foreachSummary = foreachTask
        ? this.buildForeachExecutionSummary(foreachTask, children)
        : undefined;

      await this.tasks.updateOne(
        { _id: foreachTaskId },
        { $set: {
          status: 'completed' as TaskStatus,
          ...(foreachSummary && { executionSummary: foreachSummary }),
        } }
      );

      console.log(`[WorkflowExecutionService] Join ${joinStatus}: ${statusReason}`);
      return joinStatus === 'completed';
    }

    return false;
  }

  // ============================================================================
  // Decision Execution
  // ============================================================================

  private async executeDecision(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    decisionTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    // For decision steps, use decisionField if set, otherwise fall back to inputPath
    // This allows users to configure the decision field path using either property
    const effectiveDecisionField = step.decisionField || step.inputPath;

    console.log(`[WorkflowExecutionService] executeDecision: step=${step.id}, decisionField=${step.decisionField}, inputPath=${step.inputPath}, effective=${effectiveDecisionField}`);
    console.log(`[WorkflowExecutionService] executeDecision: inputPayload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
    console.log(`[WorkflowExecutionService] executeDecision: inputPayload.output keys: ${Object.keys((inputPayload?.output as Record<string, unknown>) || {}).join(', ')}`);

    // Debug: show the actual value at the decision field path
    if (effectiveDecisionField && inputPayload) {
      const actualValue = this.resolveDecisionFieldValue(effectiveDecisionField, inputPayload, run);
      console.log(`[WorkflowExecutionService] executeDecision: value at path "${effectiveDecisionField}" = "${actualValue}" (${typeof actualValue})`);
    }
    console.log(`[WorkflowExecutionService] executeDecision: full inputPayload: ${JSON.stringify(inputPayload, null, 2).substring(0, 1000)}`);

    let selectedConnection = step.connections?.find(conn => {
      if (!conn.condition) return false;
      const result = this.evaluateCondition(conn.condition, inputPayload, effectiveDecisionField, run);
      console.log(`[WorkflowExecutionService] executeDecision: condition "${conn.condition}" -> ${result}`);
      return result;
    });

    if (!selectedConnection && step.defaultConnection) {
      selectedConnection = { targetStepId: step.defaultConnection };
    }

    if (!selectedConnection) {
      selectedConnection = step.connections?.find(conn => !conn.condition);
    }

    if (!selectedConnection) {
      console.warn(`[WorkflowExecutionService] Decision step ${step.id} has no valid path`);
      await this.tasks.updateOne(
        { _id: decisionTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': 'No valid decision path',
          }
        }
      );
      return;
    }

    // Determine the matched value for display
    // If using decisionField, the condition IS the matched value
    // Otherwise, extract the value part from "field:value" format
    let matchedValue = selectedConnection.condition || '';
    if (!effectiveDecisionField && matchedValue.includes(':')) {
      matchedValue = matchedValue.split(':').slice(1).join(':');
    }

    console.log(`[WorkflowExecutionService] executeDecision: selected path=${selectedConnection.targetStepId}, condition=${selectedConnection.condition}, matchedValue=${matchedValue}`);

    // Check if targetStepId is null/empty - this means the branch ends the workflow
    // or was misconfigured. Handle both cases gracefully.
    const targetStepId = selectedConnection.targetStepId;
    const isEndBranch = !targetStepId || targetStepId === '' || targetStepId === 'END';

    // Validate target step exists (unless it's an end branch)
    const nextStep = !isEndBranch ? workflow.steps.find(s => s.id === targetStepId) : null;
    if (!isEndBranch && !nextStep) {
      console.error(`[WorkflowExecutionService] Decision step ${step.id} has invalid targetStepId: "${targetStepId}" - step not found in workflow`);
      await this.tasks.updateOne(
        { _id: decisionTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': `Invalid target step: "${targetStepId}" not found in workflow`,
          }
        }
      );
      return;
    }

    // Build stepOutput for decision task so next steps can access decision data via stepOutput.data
    // Pass through the input payload as output, plus the decision metadata
    const decisionOutput = {
      ...inputPayload,
      _decision: {
        selectedPath: isEndBranch ? 'END' : targetStepId,
        condition: selectedConnection.condition,
        matchedValue,
        decisionField: effectiveDecisionField,
        isEndBranch,
      },
    };
    const decisionStepOutput = this.buildStepOutput(decisionOutput, {
      summary: isEndBranch
        ? `Decision: ${matchedValue || 'END'} (workflow ends)`
        : `Decision: ${matchedValue || targetStepId}`,
      selectedBranch: {
        targetStepId: isEndBranch ? 'END' : targetStepId,
        condition: selectedConnection.condition || undefined,
      },
    });

    await this.tasks.updateOne(
      { _id: decisionTask._id },
      {
        $set: {
          status: 'completed' as TaskStatus,
          stepOutput: decisionStepOutput,
          decisionResult: matchedValue || (isEndBranch ? 'END' : targetStepId),
          'metadata.selectedPath': isEndBranch ? 'END' : targetStepId,
          'metadata.condition': selectedConnection.condition,
          'metadata.matchedValue': matchedValue,
          'metadata.decisionField': effectiveDecisionField,
          'metadata.isEndBranch': isEndBranch,
        },
      }
    );

    // If this is an end branch, don't create next task - workflow branch terminates here
    if (isEndBranch) {
      console.log(`[WorkflowExecutionService] Decision step ${step.id} selected END branch - workflow branch terminates`);
      return;
    }

    // Execute next step (nextStep is already validated above)
    const parentTask = await this.tasks.findOne({ _id: decisionTask.parentId! });
    if (parentTask) {
      await this.executeStep(run, workflow, nextStep!, parentTask, inputPayload);
    }
  }

  /**
   * Resolves a decision field path to its value.
   * Supports special paths like:
   * - trigger.payload.* - references the original workflow trigger payload
   * - output.* - references the step's input payload (standard path)
   * - Any other path is looked up directly in the inputPayload
   */
  private resolveDecisionFieldValue(
    field: string,
    inputPayload: Record<string, unknown>,
    run: WorkflowRun
  ): unknown {
    // Handle trigger.payload.* paths - look up from workflow run's inputPayload
    if (field.startsWith('trigger.payload.')) {
      const triggerPath = field.substring('trigger.payload.'.length);
      const triggerPayload = run.inputPayload as Record<string, unknown> | undefined;
      if (triggerPayload) {
        const value = getValueByPath(triggerPayload, triggerPath);
        console.log(`[WorkflowExecutionService] resolveDecisionFieldValue: resolved trigger.payload.${triggerPath} = "${value}"`);
        return value;
      }
      console.log(`[WorkflowExecutionService] resolveDecisionFieldValue: no trigger payload available for path "${field}"`);
      return undefined;
    }

    // Handle trigger.payload (entire object)
    if (field === 'trigger.payload') {
      return run.inputPayload;
    }

    // Standard path lookup in inputPayload
    return getValueByPath(inputPayload, field);
  }

  private evaluateCondition(
    condition: string,
    payload?: Record<string, unknown>,
    decisionField?: string,
    run?: WorkflowRun
  ): boolean {
    if (!condition || !payload) {
      console.log(`[WorkflowExecutionService] evaluateCondition: early return - condition=${!!condition}, payload=${!!payload}`);
      return false;
    }

    let field: string;
    let values: string;

    // If decisionField is set, condition is just the value(s) to match
    // Otherwise, condition must be in "field:value" format
    if (decisionField) {
      field = decisionField;
      values = condition;
    } else {
      const parts = condition.split(':');
      if (parts.length < 2) {
        console.log(`[WorkflowExecutionService] evaluateCondition: invalid format - condition="${condition}" has no colon`);
        return false;
      }
      field = parts[0];
      values = parts.slice(1).join(':'); // Handle values that might contain colons
    }

    if (!field || !values) {
      console.log(`[WorkflowExecutionService] evaluateCondition: missing field or values - field="${field}", values="${values}"`);
      return false;
    }

    // Use resolveDecisionFieldValue if we have a run context (supports trigger.payload.* paths)
    // Otherwise fall back to direct path lookup
    const actualValue = run
      ? this.resolveDecisionFieldValue(field, payload, run)
      : getValueByPath(payload, field);

    const expectedValues = values.split(',').map(v => v.trim().toLowerCase());
    const actualValueStr = String(actualValue).toLowerCase();
    const result = expectedValues.includes(actualValueStr);

    console.log(`[WorkflowExecutionService] evaluateCondition: field="${field}", actual="${actualValue}" (${typeof actualValue}), expected=[${expectedValues.join(',')}], result=${result}`);

    // Case-insensitive comparison
    return result;
  }

  // ============================================================================
  // FindDocument Step Execution
  // ============================================================================

  private async executeFindDocument(
    run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    findDocTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const config = step.findDocumentConfig;
    console.log(`[WorkflowExecutionService] Executing findDocument step: ${step.id}`);

    // Helper to mark task complete with stepOutput and publish event for standard advanceToNextStep
    const completeFindDocTask = async (
      outputData: Record<string, unknown>,
      documents: Array<{ id: string; title: string; type: string; score?: number }>,
      metadataFields: Record<string, unknown>
    ) => {
      const stepOutput = this.buildStepOutput(outputData, {
        summary: `Found ${documents.length} document(s)`,
        documents,
      });

      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'completed' as TaskStatus,
            updatedAt: new Date(),
            stepOutput,
            'metadata.output': outputData,
            ...Object.fromEntries(
              Object.entries(metadataFields).map(([k, v]) => [`metadata.${k}`, v])
            ),
          }
        }
      );

      // Publish event to trigger standard workflow advancement
      const updatedTask = await this.tasks.findOne({ _id: findDocTask._id });
      if (updatedTask) {
        await eventBus.publish({
          type: 'task.status.changed',
          taskId: updatedTask._id,
          task: updatedTask,
          changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'completed' }],
          actorId: null,
          actorType: 'system',
        });
      }
    };

    // Helper to mark task as failed with consistent metadata structure
    const failFindDocTask = async (
      error: string,
      metadataFields: Record<string, unknown> = {}
    ) => {
      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': error,
            'metadata.output': { error, ...metadataFields },
            ...Object.fromEntries(
              Object.entries(metadataFields).map(([k, v]) => [`metadata.${k}`, v])
            ),
          }
        }
      );
    };

    if (!config) {
      console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} has no findDocumentConfig`);
      await failFindDocTask('No findDocumentConfig provided');
      return;
    }

    const storeAs = config.storeAs || 'document';
    const failIfNotFound = config.failIfNotFound ?? false;
    const mode = config.mode || 'dynamic';

    // Static mode: fetch a specific document by ID
    if (mode === 'static' && config.documentId) {
      console.log(`[WorkflowExecutionService] FindDocument static mode: fetching document ${config.documentId}`);
      try {
        const db = getDb();
        const document = await db.collection('documents').findOne({
          _id: new ObjectId(config.documentId)
        });

        if (!document) {
          if (failIfNotFound) {
            console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} - document not found`);
            await failFindDocTask(`Document ${config.documentId} not found`, {
              mode: 'static',
              documentId: config.documentId,
            });
            return;
          }
          // Not failing, just store empty and advance
          await completeFindDocTask(
            { [storeAs]: null },
            [],
            { mode: 'static', documentId: config.documentId, resultCount: 0 }
          );
          return;
        }

        // Remove embedding from response (too large)
        const { embedding, ...documentWithoutEmbedding } = document as Record<string, unknown>;
        const docResult = { document: documentWithoutEmbedding };

        await completeFindDocTask(
          { [storeAs]: docResult },
          [{ id: String(document._id), title: String(document.title || ''), type: String(document.type || ''), score: 1.0 }],
          { mode: 'static', documentId: config.documentId, resultCount: 1 }
        );
        console.log(`[WorkflowExecutionService] FindDocument step ${step.id} (static) completed successfully`);
        return;
      } catch (error) {
        console.error(`[WorkflowExecutionService] FindDocument step ${step.id} (static) failed:`, error);
        await failFindDocTask(
          error instanceof Error ? error.message : 'Failed to fetch document',
          { mode: 'static', documentId: config.documentId }
        );
        return;
      }
    }

    // Dynamic mode: semantic search
    // Resolve the search prompt with template variables from inputPayload
    const originalTemplate = config.searchPrompt || '';
    let searchPrompt = originalTemplate;
    if (searchPrompt && inputPayload) {
      const templateContext = {
        workflowRunId: run._id,
        stepId: step.id,
        taskId: findDocTask._id,
        inputPayload,
        ...inputPayload, // Allow direct access to input fields
      };
      searchPrompt = await resolveTemplateWithPackages(searchPrompt, templateContext);
    }

    if (!searchPrompt) {
      // Build diagnostic info about what keys are available for template resolution
      const availableKeys = inputPayload ? Object.keys(inputPayload) : [];
      const outputKeys = inputPayload?.output && typeof inputPayload.output === 'object'
        ? Object.keys(inputPayload.output as Record<string, unknown>)
        : [];

      console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} has no search prompt after resolution. ` +
        `Template: "${originalTemplate}", Available top-level keys: [${availableKeys.join(', ')}], ` +
        `output keys: [${outputKeys.join(', ')}]`);

      await failFindDocTask(
        `Search prompt resolved to empty. Template "${originalTemplate}" did not match any data. ` +
        `Available output keys: [${outputKeys.join(', ')}]`,
        {
          mode: 'dynamic',
          searchPromptTemplate: originalTemplate,
          availableOutputKeys: outputKeys,
          availableTopLevelKeys: availableKeys,
        }
      );
      return;
    }

    console.log(`[WorkflowExecutionService] FindDocument dynamic mode, search prompt: "${searchPrompt}"`);

    try {
      // Execute the semantic search
      const searchResults = await searchDocuments({
        prompt: searchPrompt,
        type: config.documentTypes,
        status: config.documentStatus || ['approved'],
        tags: config.tags,
        limit: config.limit || 1,
        minScore: config.minScore || 0.5,
      });

      console.log(`[WorkflowExecutionService] FindDocument found ${searchResults.length} documents`);

      if (searchResults.length === 0 && failIfNotFound) {
        console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} found no documents and failIfNotFound is true`);
        await failFindDocTask('No documents found matching search criteria', {
          mode: 'dynamic',
          searchPrompt,
          searchConfig: {
            documentTypes: config.documentTypes,
            documentStatus: config.documentStatus || ['approved'],
            tags: config.tags,
            minScore: config.minScore || 0.5,
          },
        });
        return;
      }

      // Store the result - if limit is 1, store single doc; otherwise store array
      const documentResult = config.limit === 1 && searchResults.length > 0
        ? {
            document: searchResults[0].document,
            score: searchResults[0].score,
            highlights: searchResults[0].highlights,
          }
        : searchResults.map(r => ({
            document: r.document,
            score: r.score,
            highlights: r.highlights,
          }));

      // Build documents summary for stepOutput
      const docsSummary = searchResults.map(r => ({
        id: String(r.document._id || ''),
        title: String(r.document.title || ''),
        type: String(r.document.type || ''),
        score: r.score,
      }));

      await completeFindDocTask(
        { [storeAs]: documentResult },
        docsSummary,
        { mode: 'dynamic', searchPrompt, resultCount: searchResults.length }
      );

      console.log(`[WorkflowExecutionService] FindDocument step ${step.id} (dynamic) completed successfully`);
    } catch (error) {
      console.error(`[WorkflowExecutionService] FindDocument step ${step.id} (dynamic) failed:`, error);
      await failFindDocTask(
        error instanceof Error ? error.message : 'Search failed',
        { mode: 'dynamic', searchPrompt }
      );
    }
  }

  // ============================================================================
  // Code Step Execution (Sandboxed JavaScript)
  // ============================================================================

  /**
   * Execute a code step - runs JavaScript in a sandboxed vm2 environment.
   *
   * The code receives the previous step's output as `input` and can use
   * a configurable set of npm packages (lodash, date-fns, etc.).
   */
  private async executeCodeStep(
    _run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    codeTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const config = step.codeConfig;
    console.log(`[WorkflowExecutionService] Executing code step: ${step.id}`);

    if (!config || !config.code) {
      console.warn(`[WorkflowExecutionService] Code step ${step.id} has no code to execute`);
      await this.tasks.updateOne(
        { _id: codeTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': 'No code provided in codeConfig',
          }
        }
      );
      return;
    }

    const now = new Date();
    const resultId = `code-${codeTask._id}-${Date.now()}`;

    // Build the full execution context with trigger and steps
    // This allows variable mappings like trigger._API_URL to be resolved
    const executionContext = {
      input: inputPayload || {},
      trigger: _run.inputPayload || {},
      steps: {}, // TODO: Could populate with previous step outputs if needed
    };

    try {
      // Execute the code in the sandbox
      const result = await executeCodeSandbox(
        config.code,
        executionContext,
        {
          packages: config.packages,
          variables: config.variables, // Pass variable mappings for resolution
          timeout: config.timeout,
          outputSchema: config.outputSchema,
        }
      );

      const codeExecutionResult = {
        logs: result.logs,
        executionTimeMs: result.executionTimeMs,
        packages: config.packages || [],
      };

      if (result.success) {
        // Code executed successfully
        const stepOutput = this.buildStepOutput(result.output, {
          summary: `Code executed successfully in ${result.executionTimeMs}ms`,
          durationMs: result.executionTimeMs,
          logs: result.logs,
        });

        await this.tasks.updateOne(
          { _id: codeTask._id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              updatedAt: new Date(),
              stepOutput,
              'metadata.output': result.output,
              'metadata.executionTimeMs': result.executionTimeMs,
              'metadata.logs': result.logs,
              'metadata.packages': config.packages || [],
              // Populate taskResult for UI display
              'taskResult.current': {
                id: resultId,
                status: 'success' as const,
                output: result.output,
                summary: `Code executed successfully in ${result.executionTimeMs}ms`,
                executedAt: now,
                completedAt: new Date(),
                durationMs: result.executionTimeMs,
                codeExecution: codeExecutionResult,
              },
            }
          }
        );
        console.log(`[WorkflowExecutionService] Code step ${step.id} completed successfully in ${result.executionTimeMs}ms`);

        // Publish event to trigger workflow advancement
        const updatedCodeTask = await this.tasks.findOne({ _id: codeTask._id });
        if (updatedCodeTask) {
          await eventBus.publish({
            type: 'task.status.changed',
            taskId: updatedCodeTask._id,
            task: updatedCodeTask,
            changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'completed' }],
            actorId: null,
            actorType: 'system',
          });
          console.log(`[WorkflowExecutionService] Published task.status.changed for code task ${codeTask._id}`);
        }
      } else {
        // Code execution failed
        if (config.continueOnError) {
          // Complete with error in output instead of failing
          await this.tasks.updateOne(
            { _id: codeTask._id },
            {
              $set: {
                status: 'completed' as TaskStatus,
                'metadata.output': null,
                'metadata.error': result.error,
                'metadata.executionTimeMs': result.executionTimeMs,
                'metadata.logs': result.logs,
                'metadata.packages': config.packages || [],
                // Populate taskResult for UI display
                'taskResult.current': {
                  id: resultId,
                  status: 'partial' as const,
                  output: null,
                  error: result.error,
                  summary: `Code completed with error (continueOnError=true)`,
                  executedAt: now,
                  completedAt: new Date(),
                  durationMs: result.executionTimeMs,
                  codeExecution: codeExecutionResult,
                },
              }
            }
          );
          console.log(`[WorkflowExecutionService] Code step ${step.id} completed with error (continueOnError=true): ${result.error}`);
        } else {
          // Fail the task
          await this.tasks.updateOne(
            { _id: codeTask._id },
            {
              $set: {
                status: 'failed' as TaskStatus,
                'metadata.error': result.error,
                'metadata.executionTimeMs': result.executionTimeMs,
                'metadata.logs': result.logs,
                'metadata.packages': config.packages || [],
                // Populate taskResult for UI display
                'taskResult.current': {
                  id: resultId,
                  status: 'failed' as const,
                  output: null,
                  error: result.error,
                  summary: `Code execution failed`,
                  executedAt: now,
                  completedAt: new Date(),
                  durationMs: result.executionTimeMs,
                  codeExecution: codeExecutionResult,
                },
              }
            }
          );
          console.error(`[WorkflowExecutionService] Code step ${step.id} failed: ${result.error}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error during code execution';
      console.error(`[WorkflowExecutionService] Code step ${step.id} threw unexpected error:`, error);
      await this.tasks.updateOne(
        { _id: codeTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': errorMessage,
            // Populate taskResult for UI display
            'taskResult.current': {
              id: resultId,
              status: 'failed' as const,
              output: null,
              error: errorMessage,
              summary: 'Unexpected error during code execution',
              executedAt: now,
              completedAt: new Date(),
            },
          }
        }
      );
    }
  }

  /**
   * Rerun a code task that was set back to pending.
   * Looks up the workflow run and step config to re-execute the code.
   */
  async rerunCodeTask(taskId: ObjectId | string): Promise<void> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Task ${id} not found`);
      return;
    }

    if (task.taskType !== 'code') {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Task ${id} is not a code task`);
      return;
    }

    if (!task.workflowRunId || !task.workflowStepId) {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Task ${id} is not part of a workflow`);
      return;
    }

    const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
    if (!run) {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Workflow run ${task.workflowRunId} not found`);
      return;
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Workflow ${run.workflowId} not found`);
      return;
    }

    const step = workflow.steps.find(s => s.id === task.workflowStepId);
    if (!step) {
      console.error(`[WorkflowExecutionService] rerunCodeTask: Step ${task.workflowStepId} not found in workflow`);
      return;
    }

    // Get the input payload from the task's metadata (set when task was originally created)
    const inputPayload = task.metadata?.inputPayload as Record<string, unknown> | undefined;

    console.log(`[WorkflowExecutionService] Rerunning code task ${id} for step ${step.name}`);

    // Execute the code step
    await this.executeCodeStep(run, workflow, step, task, inputPayload);
  }

  /**
   * Rerun a findDocument task that was set back to pending.
   * Looks up the workflow run and step config to re-execute the document search.
   */
  async rerunFindDocumentTask(taskId: ObjectId | string): Promise<void> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Task ${id} not found`);
      return;
    }

    if (task.taskType !== 'findDocument') {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Task ${id} is not a findDocument task`);
      return;
    }

    if (!task.workflowRunId || !task.workflowStepId) {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Task ${id} is not part of a workflow`);
      return;
    }

    const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
    if (!run) {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Workflow run ${task.workflowRunId} not found`);
      return;
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Workflow ${run.workflowId} not found`);
      return;
    }

    const step = workflow.steps.find(s => s.id === task.workflowStepId);
    if (!step) {
      console.error(`[WorkflowExecutionService] rerunFindDocumentTask: Step ${task.workflowStepId} not found in workflow`);
      return;
    }

    // Get the input payload from the task's metadata (set when task was originally created)
    const inputPayload = task.metadata?.inputPayload as Record<string, unknown> | undefined;

    console.log(`[WorkflowExecutionService] Rerunning findDocument task ${id} for step ${step.name}`);

    // Execute the findDocument step
    await this.executeFindDocument(run, workflow, step, task, inputPayload);
  }

  /**
   * Rerun a decision task that was set back to pending.
   * Looks up the workflow run and step config to re-evaluate the decision.
   */
  async rerunDecisionTask(taskId: ObjectId | string): Promise<void> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Task ${id} not found`);
      return;
    }

    if (task.taskType !== 'decision') {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Task ${id} is not a decision task`);
      return;
    }

    if (!task.workflowRunId || !task.workflowStepId) {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Task ${id} is not part of a workflow`);
      return;
    }

    const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
    if (!run) {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Workflow run ${task.workflowRunId} not found`);
      return;
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Workflow ${run.workflowId} not found`);
      return;
    }

    const step = workflow.steps.find(s => s.id === task.workflowStepId);
    if (!step) {
      console.error(`[WorkflowExecutionService] rerunDecisionTask: Step ${task.workflowStepId} not found in workflow`);
      return;
    }

    // Get the input payload from the task's metadata (set when task was originally created)
    const inputPayload = task.metadata?.inputPayload as Record<string, unknown> | undefined;

    console.log(`[WorkflowExecutionService] Rerunning decision task ${id} for step ${step.name}`);

    // Execute the decision step
    await this.executeDecision(run, workflow, step, task, inputPayload);
  }

  // ============================================================================
  // Flow (Nested Workflow) Execution
  // ============================================================================

  private async executeFlow(
    parentRun: WorkflowRun,
    _parentWorkflow: Workflow,
    step: WorkflowStep,
    flowTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    console.log(`[WorkflowExecutionService] Executing flow step: ${step.id}`);

    // Determine attempt number based on existing attempts
    const existingAttempts = flowTask.flowConfig?.attempts || [];
    const attemptNumber = existingAttempts.length + 1;

    if (!step.flowId) {
      console.error(`[WorkflowExecutionService] Flow step ${step.id} has no flowId configured`);
      const failedAttempt: FlowAttempt = {
        attemptNumber,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'failed',
        errorMessage: 'No target workflow configured for flow step',
      };
      await this.tasks.updateOne(
        { _id: flowTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': 'No target workflow configured for flow step',
            'flowConfig.workflowId': '',
            'flowConfig.lastAttemptAt': new Date(),
          },
          $push: { 'flowConfig.attempts': failedAttempt }
        }
      );
      return;
    }

    // Get the target workflow
    const targetWorkflow = await this.workflows.findOne({ _id: new ObjectId(step.flowId) });
    if (!targetWorkflow) {
      console.error(`[WorkflowExecutionService] Target workflow ${step.flowId} not found`);
      const failedAttempt: FlowAttempt = {
        attemptNumber,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'failed',
        targetWorkflowId: step.flowId,
        errorMessage: `Target workflow ${step.flowId} not found`,
      };
      await this.tasks.updateOne(
        { _id: flowTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': `Target workflow ${step.flowId} not found`,
            'flowConfig.workflowId': step.flowId,
            'flowConfig.lastAttemptAt': new Date(),
          },
          $push: { 'flowConfig.attempts': failedAttempt }
        }
      );
      return;
    }

    if (!targetWorkflow.isActive) {
      console.error(`[WorkflowExecutionService] Target workflow ${targetWorkflow.name} is not active`);
      const failedAttempt: FlowAttempt = {
        attemptNumber,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'failed',
        targetWorkflowId: step.flowId,
        targetWorkflowName: targetWorkflow.name,
        errorMessage: `Target workflow "${targetWorkflow.name}" is not active`,
      };
      await this.tasks.updateOne(
        { _id: flowTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': `Target workflow "${targetWorkflow.name}" is not active`,
            'flowConfig.workflowId': step.flowId,
            'flowConfig.lastAttemptAt': new Date(),
          },
          $push: { 'flowConfig.attempts': failedAttempt }
        }
      );
      return;
    }

    // Build the input payload for the subflow using inputMapping or inputConfig.mapping
    let subflowInputPayload: Record<string, unknown> = {};

    // Support both legacy inputMapping and new inputConfig.mapping
    const effectiveMapping = step.inputMapping || step.inputConfig?.mapping;

    if (effectiveMapping && Object.keys(effectiveMapping).length > 0) {
      // Use explicit input mapping
      console.log(`[WorkflowExecutionService] executeFlow: Using inputMapping: ${JSON.stringify(effectiveMapping)}`);

      for (const [targetField, sourceValue] of Object.entries(effectiveMapping)) {
        if (!targetField) continue; // Skip empty keys

        // Only resolve template if the value is a string
        // Non-string values (arrays, objects, numbers, booleans) are passed through as-is
        if (typeof sourceValue === 'string') {
          // Use resolveInputMappingValue which handles {{steps.*}}, {{input.*}}, and other patterns
          const resolvedValue = await this.resolveInputMappingValue(
            sourceValue,
            parentRun._id,
            step.id,
            flowTask._id,
            inputPayload
          );
          subflowInputPayload[targetField] = resolvedValue;
        } else {
          // Pass through non-string values directly
          subflowInputPayload[targetField] = sourceValue;
        }
      }
      console.log(`[WorkflowExecutionService] executeFlow: Resolved input payload: ${JSON.stringify(subflowInputPayload).substring(0, 500)}`);
    } else {
      // No explicit mapping - pass through the full input payload
      subflowInputPayload = inputPayload || {};
      console.log(`[WorkflowExecutionService] No inputMapping or inputConfig.mapping, passing through full payload`);
    }

    // Create the initial attempt record
    const now = new Date();
    const attempt: FlowAttempt = {
      attemptNumber,
      startedAt: now,
      status: 'running',
      inputPayload: subflowInputPayload,
      resolvedInputMapping: effectiveMapping,
      targetWorkflowId: step.flowId,
      targetWorkflowName: targetWorkflow.name,
    };

    // Update flow task to in_progress with initial taskResult and attempt record
    await this.tasks.updateOne(
      { _id: flowTask._id },
      {
        $set: {
          status: 'in_progress' as TaskStatus,
          'metadata.targetWorkflowId': step.flowId,
          'metadata.targetWorkflowName': targetWorkflow.name,
          'metadata.subflowInputPayload': subflowInputPayload,
          // Update flowConfig
          'flowConfig.workflowId': step.flowId,
          'flowConfig.inputMapping': effectiveMapping || {},
          'flowConfig.lastAttemptAt': now,
          // Set initial taskResult showing the flow is starting
          'taskResult.current': {
            id: `flow-${flowTask._id}-${Date.now()}`,
            status: 'running' as const,
            summary: `Starting subflow: ${targetWorkflow.name}`,
            executedAt: now,
            output: {
              targetWorkflow: {
                id: step.flowId,
                name: targetWorkflow.name,
              },
              inputMapping: effectiveMapping || {},
              inputPayload: subflowInputPayload,
              nextStep: step.connections?.[0]?.targetStepId || null,
            },
          },
        },
        $push: { 'flowConfig.attempts': attempt }
      }
    );

    try {
      // Start the subflow
      const { run: subflowRun } = await this.startWorkflow(
        {
          workflowId: step.flowId,
          inputPayload: subflowInputPayload,
          triggerTaskId: flowTask._id.toString(),
          source: `flow-step:${step.id}`,
          externalId: `${parentRun._id}:${step.id}`,
        },
        parentRun.createdById
      );

      // Link the flow task to the spawned workflow run and update taskResult + attempt
      await this.tasks.updateOne(
        { _id: flowTask._id },
        {
          $set: {
            spawnedWorkflowRunId: subflowRun._id,
            'metadata.spawnedWorkflowRunId': subflowRun._id.toString(),
            // Update taskResult with spawned workflow info
            'taskResult.current.spawnedWorkflow': {
              runId: subflowRun._id.toString(),
              status: 'running',
            },
            'taskResult.current.summary': `Subflow running: ${targetWorkflow.name}`,
            // Update the latest attempt with the spawned run ID
            [`flowConfig.attempts.${attemptNumber - 1}.spawnedWorkflowRunId`]: subflowRun._id.toString(),
          }
        }
      );

      console.log(`[WorkflowExecutionService] Started subflow ${subflowRun._id} for flow step ${step.id}`);
      console.log(`[WorkflowExecutionService] Flow task ${flowTask._id} waiting for subflow completion`);

      // The flow task remains in_progress until the subflow completes
      // The subflow completion will be handled via the triggerTaskId mechanism
      // which updates workflowResult on the flow task when complete

    } catch (error) {
      console.error(`[WorkflowExecutionService] Failed to start subflow:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start subflow';
      const failedAt = new Date();
      await this.tasks.updateOne(
        { _id: flowTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': errorMessage,
            // Update taskResult with failure info
            'taskResult.current.status': 'failed' as const,
            'taskResult.current.completedAt': failedAt,
            'taskResult.current.summary': `Failed to start subflow: ${targetWorkflow.name}`,
            'taskResult.current.error': errorMessage,
            // Update the latest attempt with failure info
            [`flowConfig.attempts.${attemptNumber - 1}.status`]: 'failed',
            [`flowConfig.attempts.${attemptNumber - 1}.completedAt`]: failedAt,
            [`flowConfig.attempts.${attemptNumber - 1}.errorMessage`]: errorMessage,
            [`flowConfig.attempts.${attemptNumber - 1}.durationMs`]: failedAt.getTime() - now.getTime(),
          }
        }
      );
    }
  }

  // ============================================================================
  // Task Event Handler
  // ============================================================================

  private async onTaskStatusChanged(event: TaskEvent): Promise<void> {
    const task = event.task;

    console.log(`[WorkflowExecutionService] onTaskStatusChanged: task=${task._id}, status=${task.status}, workflowRunId=${task.workflowRunId}, workflowStepId=${task.workflowStepId}`);

    if (!task.workflowRunId || !task.workflowStepId) {
      console.log(`[WorkflowExecutionService] Skipping - not a workflow task (missing workflowRunId or workflowStepId)`);
      return;
    }

    // Process completed, failed, and on_hold (with escalation) tasks
    // on_hold with escalation from daemon should pause/fail the workflow
    const isEscalatedHold = task.status === 'on_hold' &&
      (task.metadata?.nextAction === 'ESCALATE' || task.metadata?.nextAction === 'HOLD');

    if (task.status !== 'completed' && task.status !== 'failed' && !isEscalatedHold) {
      console.log(`[WorkflowExecutionService] Skipping - status is ${task.status}, not completed/failed/escalated`);
      return;
    }

    console.log(`[WorkflowExecutionService] Processing task ${task._id} (${task.title}) ${task.status}`);

    const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
    console.log(`[WorkflowExecutionService] Found run: ${run ? run._id : 'NOT FOUND'}, status: ${run?.status}`);
    if (!run || run.status !== 'running') {
      console.log(`[WorkflowExecutionService] Skipping - run not found or not running`);
      return;
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    console.log(`[WorkflowExecutionService] Found workflow: ${workflow ? workflow.name : 'NOT FOUND'}`);
    if (!workflow) {
      console.log(`[WorkflowExecutionService] Skipping - workflow not found`);
      return;
    }

    // Log step completion/failure to execution trace
    const stepLogEntry: Partial<WorkflowRunStepLog> = {
      stepId: task.workflowStepId!,
      stepName: task.title,
      stepType: task.taskType || 'unknown',
      taskId: task._id.toString(),
      completedAt: new Date(),
    };
    if (task.status === 'completed') {
      stepLogEntry.status = 'completed';
      stepLogEntry.outputSummary = this.truncateForLog(
        task.stepOutput?.data ?? task.metadata?.output ?? task.metadata?.response
      );
    } else if (task.status === 'failed') {
      stepLogEntry.status = 'failed';
      const errorMsg = typeof task.metadata?.error === 'string'
        ? task.metadata.error
        : task.metadata?.nextActionReason as string || `Step "${task.title}" failed`;
      stepLogEntry.error = errorMsg;
    } else if (isEscalatedHold) {
      stepLogEntry.status = 'failed';
      stepLogEntry.error = typeof task.metadata?.nextActionReason === 'string'
        ? task.metadata.nextActionReason
        : 'Task escalated - requires human intervention';
      stepLogEntry.errorCode = 'ESCALATED';
    }
    // Update the matching started entry or push a new one
    await this.workflowRuns.updateOne(
      { _id: run._id, 'stepLog.stepId': task.workflowStepId, 'stepLog.status': 'started' },
      {
        $set: {
          'stepLog.$.status': stepLogEntry.status,
          'stepLog.$.completedAt': stepLogEntry.completedAt,
          'stepLog.$.outputSummary': stepLogEntry.outputSummary,
          'stepLog.$.error': stepLogEntry.error,
          'stepLog.$.errorCode': stepLogEntry.errorCode,
        },
      }
    );

    await this.publish({
      id: this.generateEventId(),
      type: task.status === 'completed' ? 'workflow.run.step.completed' : 'workflow.run.step.failed',
      workflowRunId: run._id,
      workflowRun: run,
      stepId: task.workflowStepId,
      taskId: task._id,
      actorId: null,
      actorType: 'system',
      timestamp: new Date(),
    });

    if (task.taskType === 'foreach' || task.parentId) {
      const parentTask = task.parentId ? await this.tasks.findOne({ _id: task.parentId }) : null;

      if (parentTask?.taskType === 'foreach') {
        if (parentTask.batchCounters) {
          const children = await this.tasks.find({ parentId: parentTask._id }).toArray();
          const completedCount = children.filter(c => c.status === 'completed').length;
          const failedCount = children.filter(c => c.status === 'failed').length;

          await this.tasks.updateOne(
            { _id: parentTask._id },
            {
              $set: {
                'batchCounters.processedCount': completedCount,
                'batchCounters.failedCount': failedCount,
              },
            }
          );
          console.log(`[WorkflowExecutionService] Updated foreach ${parentTask._id} counters: ${completedCount} completed, ${failedCount} failed`);
        }

        let joinTask = await this.tasks.findOne({
          workflowRunId: run._id,
          taskType: 'join',
          status: 'waiting',
        });

        if (!joinTask) {
          const childStep = workflow.steps.find(s => s.id === task.workflowStepId);
          if (childStep) {
            let nextStepIds = childStep.connections?.map(c => c.targetStepId) || [];
            if (nextStepIds.length === 0) {
              const childIndex = workflow.steps.findIndex(s => s.id === childStep.id);
              const nextStep = workflow.steps[childIndex + 1];
              if (nextStep) {
                nextStepIds.push(nextStep.id);
              }
            }

            for (const nextStepId of nextStepIds) {
              const nextStep = workflow.steps.find(s => s.id === nextStepId);
              if (nextStep?.stepType === 'join') {
                console.log(`[WorkflowExecutionService] Creating join task for step ${nextStep.id} as it doesn't exist yet`);
                const rootTask = await this.tasks.findOne({
                  workflowRunId: run._id,
                  parentId: null,
                });
                if (rootTask) {
                  await this.executeStep(run, workflow, nextStep, rootTask);
                  joinTask = await this.tasks.findOne({
                    workflowRunId: run._id,
                    taskType: 'join',
                    status: 'waiting',
                  });
                }
                break;
              }
            }
          }
        }

        if (joinTask && joinTask.joinConfig?.awaitTaskId) {
          const joined = await this.checkJoinCondition(joinTask._id, joinTask.joinConfig.awaitTaskId);
          if (joined) {
            const updatedJoinTask = await this.tasks.findOne({ _id: joinTask._id });
            if (updatedJoinTask) {
              await this.advanceToNextStep(run, workflow, updatedJoinTask);
            }
          }
        }
        return;
      }
    }

    if (task.status === 'completed') {
      await this.advanceToNextStep(run, workflow, task);
    } else if (task.status === 'failed') {
      await this.handleStepFailure(run, workflow, task);
    } else if (task.status === 'on_hold') {
      // Task is on_hold due to escalation - pause the workflow
      // This allows the user to resolve the issue and retry
      await this.handleStepEscalation(run, workflow, task);
    }
  }

  /**
   * Handle a step that has been escalated (on_hold).
   * Unlike failure, this pauses the workflow rather than failing it,
   * giving the user a chance to resolve the issue and retry.
   */
  private async handleStepEscalation(
    run: WorkflowRun,
    _workflow: Workflow,
    escalatedTask: Task
  ): Promise<void> {
    const now = new Date();
    const rawReason = escalatedTask.metadata?.nextActionReason ||
      escalatedTask.metadata?.escalationReason;
    const escalationReason = typeof rawReason === 'string'
      ? rawReason
      : 'Task escalated - requires human intervention';

    console.log(`[WorkflowExecutionService] Handling step escalation for task ${escalatedTask._id}: ${escalationReason}`);

    // Update workflow run to paused status
    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'paused' as WorkflowRunStatus,
          error: `Step "${escalatedTask.title}" escalated: ${escalationReason}`,
          pausedStepId: escalatedTask.workflowStepId,
          pausedAt: now,
        },
      }
    );

    // Update root task to on_hold as well
    if (run.rootTaskId) {
      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        {
          $set: {
            status: 'on_hold' as TaskStatus,
            updatedAt: now,
            'metadata.pausedReason': escalationReason,
          }
        }
      );
    }

    // Publish workflow paused event
    const updatedRun = await this.workflowRuns.findOne({ _id: run._id });
    if (updatedRun) {
      await this.publish({
        id: this.generateEventId(),
        type: 'workflow.run.paused',
        workflowRunId: run._id,
        workflowRun: updatedRun,
        stepId: escalatedTask.workflowStepId,
        taskId: escalatedTask._id,
        error: escalationReason,
        actorId: null,
        actorType: 'system',
        timestamp: now,
      });
    }

    console.log(`[WorkflowExecutionService] Workflow ${run._id} paused due to escalation at step ${escalatedTask.workflowStepId}`);
  }

  private async advanceToNextStep(
    run: WorkflowRun,
    workflow: Workflow,
    completedTask: Task
  ): Promise<void> {
    console.log(`[WorkflowExecutionService] advanceToNextStep called for task ${completedTask._id}, stepId: ${completedTask.workflowStepId}`);

    const currentStep = workflow.steps.find(s => s.id === completedTask.workflowStepId);
    if (!currentStep) {
      console.log(`[WorkflowExecutionService] Current step not found in workflow steps. Available steps: ${workflow.steps.map(s => s.id).join(', ')}`);
      return;
    }

    console.log(`[WorkflowExecutionService] Current step: ${currentStep.name} (${currentStep.id})`);

    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $pull: { currentStepIds: currentStep.id },
        $addToSet: { completedStepIds: currentStep.id },
      }
    );

    // For decision steps, use the selected path from metadata instead of all connections
    // This handles both auto-evaluated decisions and forced decisions
    // Check both taskType AND stepType for robustness (taskType may be undefined for older tasks)
    let nextStepIds: string[] = [];
    const isDecisionStep = completedTask.taskType === 'decision' || currentStep.stepType === 'decision';

    if (isDecisionStep) {
      // For decision steps, we MUST use the selectedPath - never fall through to all connections
      // Re-fetch the task to ensure we have the latest metadata (event may contain stale data)
      const freshTask = await this.tasks.findOne({ _id: completedTask._id });
      const selectedPath = (freshTask?.metadata as Record<string, unknown> | undefined)?.selectedPath as string | undefined;

      if (selectedPath) {
        console.log(`[WorkflowExecutionService] Decision step - using selectedPath: ${selectedPath}`);
        nextStepIds = [selectedPath];
      } else {
        // No selected path means the decision hasn't been evaluated yet or failed
        // Don't fall through to executing all branches - that would be incorrect for a router
        console.warn(`[WorkflowExecutionService] Decision step ${currentStep.id} has no selectedPath - cannot advance`);
        console.warn(`[WorkflowExecutionService] Task taskType: ${completedTask.taskType}, Step stepType: ${currentStep.stepType}`);
        console.warn(`[WorkflowExecutionService] Task metadata: ${JSON.stringify(freshTask?.metadata || completedTask.metadata)}`);
        // Return early to prevent incorrect routing
        return;
      }
    } else {
      nextStepIds = currentStep.connections?.map(c => c.targetStepId) || [];
    }
    console.log(`[WorkflowExecutionService] Step connections: ${JSON.stringify(currentStep.connections)}`);

    if (nextStepIds.length === 0) {
      const currentIndex = workflow.steps.findIndex(s => s.id === currentStep.id);
      const nextStep = workflow.steps[currentIndex + 1];
      console.log(`[WorkflowExecutionService] No connections, checking sequential. Current index: ${currentIndex}, next step: ${nextStep?.id || 'none'}`);
      if (nextStep) {
        nextStepIds.push(nextStep.id);
      }
    }

    if (nextStepIds.length === 0 && completedTask.taskType === 'join' && completedTask.joinConfig?.awaitTaskId) {
      console.log(`[WorkflowExecutionService] Join task has no connections, checking foreach step connections`);
      const foreachTask = await this.tasks.findOne({ _id: completedTask.joinConfig.awaitTaskId });
      if (foreachTask?.workflowStepId) {
        const foreachStep = workflow.steps.find(s => s.id === foreachTask.workflowStepId);
        if (foreachStep?.connections) {
          const foreachNextIds = foreachStep.connections
            .map(c => c.targetStepId)
            .filter(id => id !== currentStep.id);
          nextStepIds.push(...foreachNextIds);
          console.log(`[WorkflowExecutionService] Using foreach step connections: ${foreachNextIds.join(', ')}`);
        }
      }
    }

    console.log(`[WorkflowExecutionService] Next step IDs to execute: ${nextStepIds.join(', ') || 'NONE'}`);

    if (nextStepIds.length === 0) {
      console.log(`[WorkflowExecutionService] No more steps - completing workflow`);
      await this.completeWorkflow(run);
      return;
    }

    const rootTask = run.rootTaskId ? await this.tasks.findOne({ _id: run.rootTaskId }) : null;
    if (!rootTask) {
      console.log(`[WorkflowExecutionService] Root task not found!`);
      return;
    }

    // Build output payload from completed task
    // Priority: stepOutput.data (new) > metadata.response (external API) > metadata.output > empty object
    const taskMetadata = completedTask.metadata || {};
    let outputData: unknown;

    if (completedTask.stepOutput?.data !== undefined) {
      // New unified stepOutput model
      outputData = completedTask.stepOutput.data;
    } else {
      // Fallback to legacy metadata fields
      outputData = taskMetadata.response || taskMetadata.output || {};
    }

    const outputPayload: Record<string, unknown> = {
      ...taskMetadata,
      output: outputData,
    };

    for (const nextStepId of nextStepIds) {
      const nextStep = workflow.steps.find(s => s.id === nextStepId);
      if (nextStep) {
        console.log(`[WorkflowExecutionService] Creating task for next step: ${nextStep.name} (${nextStep.id})`);

        // Use new unified input resolution if inputConfig is defined
        let stepInputPayload: Record<string, unknown>;
        if (nextStep.inputConfig) {
          stepInputPayload = await this.resolveStepInput(run, workflow, nextStep, outputPayload);
          console.log(`[WorkflowExecutionService] Resolved input using inputConfig`);
        } else if (nextStep.inputPath) {
          // Fallback to legacy inputPath
          const extractedInput = await this.resolveInputPath(run, nextStep.inputPath, outputPayload);
          if (extractedInput !== undefined) {
            stepInputPayload = {
              ...outputPayload,
              _extractedInput: extractedInput,
            };
            console.log(`[WorkflowExecutionService] Extracted input using legacy path ${nextStep.inputPath}`);
          } else {
            stepInputPayload = outputPayload;
          }
        } else {
          stepInputPayload = outputPayload;
        }

        await this.executeStep(run, workflow, nextStep, rootTask, stepInputPayload);
      } else {
        console.log(`[WorkflowExecutionService] WARNING: Next step ${nextStepId} not found in workflow!`);
      }
    }
  }

  private async resolveInputPath(
    run: WorkflowRun,
    inputPath: string,
    currentPayload: Record<string, unknown>
  ): Promise<unknown> {
    if (inputPath.startsWith('steps.')) {
      const pathParts = inputPath.split('.');
      const stepId = pathParts[1];
      const remainingPath = pathParts.slice(2).join('.');

      const stepTask = await this.tasks.findOne({
        workflowRunId: run._id,
        workflowStepId: stepId,
        status: 'completed',
      });

      if (stepTask?.metadata) {
        return remainingPath
          ? getValueByPath(stepTask.metadata, remainingPath)
          : stepTask.metadata;
      }
      return undefined;
    }

    if (inputPath.startsWith('join.')) {
      const remainingPath = inputPath.substring(5);
      const joinTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'join',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (joinTask?.metadata) {
        return remainingPath
          ? getValueByPath(joinTask.metadata, remainingPath)
          : joinTask.metadata;
      }
      return undefined;
    }

    if (inputPath.startsWith('external.')) {
      const remainingPath = inputPath.substring(9);
      const externalTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'external',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (externalTask?.metadata) {
        return remainingPath
          ? getValueByPath(externalTask.metadata, remainingPath)
          : externalTask.metadata;
      }
      return undefined;
    }

    if (inputPath === 'all' || inputPath === 'allResults') {
      const completedTasks = await this.tasks.find({
        workflowRunId: run._id,
        status: 'completed',
      }).toArray();

      return completedTasks.map(t => ({
        stepId: t.workflowStepId,
        taskType: t.taskType,
        metadata: t.metadata,
      }));
    }

    return getValueByPath(currentPayload, inputPath);
  }

  /**
   * Resolve an inputMapping value template.
   * Handles special patterns like:
   *   {{steps.stepId.output.field}} - Reference another step's output
   *   {{input.field}} - Reference the task's input payload
   *   {{output.field}} - Reference the task's input payload output
   *   {{trigger.payload.field}} - Reference the workflow's original trigger payload
   *   {{trigger.field}} - Reference the workflow's original trigger data
   *   Other patterns - Delegate to resolveTemplateWithPackages
   */
  private async resolveInputMappingValue(
    template: string,
    workflowRunId: ObjectId,
    stepId: string,
    taskId: ObjectId,
    inputPayload?: Record<string, unknown>
  ): Promise<unknown> {
    console.log(`[resolveInputMappingValue] CALLED with template: "${template}", workflowRunId: ${workflowRunId}`);

    // Check if the template is a simple variable reference (single {{...}})
    const simpleVarMatch = template.match(/^\{\{([^}]+)\}\}$/);
    console.log(`[resolveInputMappingValue] simpleVarMatch: ${simpleVarMatch ? 'YES' : 'NO'}`);

    if (simpleVarMatch) {
      const varPath = simpleVarMatch[1].trim();
      console.log(`[resolveInputMappingValue] varPath: "${varPath}"`);

      // Handle steps.* references - fetch from completed step task
      if (varPath.startsWith('steps.')) {
        const pathParts = varPath.split('.');
        const targetStepId = pathParts[1];
        const remainingPath = pathParts.slice(2).join('.');

        const stepTask = await this.tasks.findOne({
          workflowRunId: workflowRunId,
          workflowStepId: targetStepId,
          status: 'completed',
        });

        if (stepTask?.metadata) {
          const value = remainingPath
            ? getValueByPath(stepTask.metadata as Record<string, unknown>, remainingPath)
            : stepTask.metadata;
          console.log(`[WorkflowExecutionService] Resolved steps.${targetStepId}.${remainingPath} = ${JSON.stringify(value).substring(0, 200)}`);
          return value;
        }
        console.warn(`[WorkflowExecutionService] Could not resolve steps.${targetStepId} - no completed task found`);
        return null; // Return null instead of undefined so the field is included with null value
      }

      // Handle input.* references - fetch from workflow run's original inputPayload
      if (varPath.startsWith('input.')) {
        const inputPath = varPath.substring(6); // Remove 'input.' prefix
        // First try to get from workflow run's inputPayload (original trigger data)
        const workflowRun = await this.workflowRuns.findOne({ _id: workflowRunId });
        if (workflowRun?.inputPayload) {
          const value = getValueByPath(workflowRun.inputPayload as Record<string, unknown>, inputPath);
          if (value !== undefined) {
            console.log(`[WorkflowExecutionService] Resolved input.${inputPath} from workflow run = ${JSON.stringify(value).substring(0, 200)}`);
            return value;
          }
        }
        // Fall back to step's inputPayload if not found in workflow run
        if (inputPayload) {
          const value = getValueByPath(inputPayload, inputPath);
          if (value !== undefined) {
            console.log(`[WorkflowExecutionService] Resolved input.${inputPath} from step inputPayload = ${JSON.stringify(value).substring(0, 200)}`);
            return value;
          }
        }
        console.warn(`[WorkflowExecutionService] Could not resolve input.${inputPath} - not found in workflow run or step inputPayload`);
        return null;
      }

      // Handle output.* references (from inputPayload.output)
      if (varPath.startsWith('output.') && inputPayload) {
        const outputPath = varPath.substring(7); // Remove 'output.' prefix
        const output = inputPayload.output as Record<string, unknown> | undefined;
        const value = output ? getValueByPath(output, outputPath) : null;
        return value !== undefined ? value : null;
      }

      // Handle trigger.* references - fetch from workflow run's original inputPayload
      if (varPath.startsWith('trigger.')) {
        const triggerPath = varPath.substring(8); // Remove 'trigger.' prefix
        console.log(`[resolveInputMappingValue] Looking up trigger.* - workflowRunId: ${workflowRunId}`);
        const workflowRun = await this.workflowRuns.findOne({ _id: workflowRunId });
        console.log(`[resolveInputMappingValue] workflowRun found: ${!!workflowRun}, has inputPayload: ${!!workflowRun?.inputPayload}`);
        if (workflowRun?.inputPayload) {
          console.log(`[resolveInputMappingValue] inputPayload keys: ${Object.keys(workflowRun.inputPayload)}, has data: ${!!(workflowRun.inputPayload as Record<string, unknown>).data}`);
          // If path starts with 'payload.', the trigger data is in inputPayload directly
          // e.g., {{trigger.payload.data.field}} -> workflowRun.inputPayload.data.field
          if (triggerPath.startsWith('payload.')) {
            const payloadPath = triggerPath.substring(8); // Remove 'payload.' prefix
            const value = payloadPath
              ? getValueByPath(workflowRun.inputPayload as Record<string, unknown>, payloadPath)
              : workflowRun.inputPayload;
            console.log(`[WorkflowExecutionService] Resolved trigger.payload.${payloadPath} = ${JSON.stringify(value).substring(0, 200)}`);
            return value !== undefined ? value : null;
          }
          // For {{trigger.field}}, look directly in inputPayload
          const value = getValueByPath(workflowRun.inputPayload as Record<string, unknown>, triggerPath);
          console.log(`[WorkflowExecutionService] Resolved trigger.${triggerPath} = ${JSON.stringify(value).substring(0, 200)}`);
          return value !== undefined ? value : null;
        }
        console.warn(`[WorkflowExecutionService] Could not resolve trigger.${triggerPath} - no workflow run inputPayload found`);
        return null;
      }

      // Handle direct variable lookup from inputPayload
      if (inputPayload) {
        const value = getValueByPath(inputPayload, varPath);
        if (value !== undefined) {
          return value;
        }
      }

      // If we got here with a simple variable, it means we couldn't resolve it - return null
      console.warn(`[WorkflowExecutionService] Could not resolve simple variable: ${varPath} -> returning null`);
      return null;
    }

    // For complex templates (with multiple variables or mixed content), use standard template resolution
    const templateContext = {
      workflowRunId,
      stepId,
      taskId,
      inputPayload,
    };

    const resolvedString = await resolveTemplateWithPackages(template, templateContext);

    // If the resolved string still contains template markers, return null instead
    if (resolvedString.includes('{{') && resolvedString.includes('}}')) {
      console.warn(`[WorkflowExecutionService] Could not resolve template: ${template} -> returning null`);
      return null;
    }

    // Try to parse as JSON
    try {
      return JSON.parse(resolvedString);
    } catch {
      return resolvedString;
    }
  }

  /**
   * Resolve step input using the new unified inputConfig model.
   * Falls back to legacy inputPath/inputSource if inputConfig is not defined.
   */
  private async resolveStepInput(
    run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    previousStepOutput: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const inputConfig = step.inputConfig;

    // If no inputConfig, use the output from previous step directly
    // (legacy behavior - also check for inputPath)
    if (!inputConfig) {
      if (step.inputPath) {
        const extracted = await this.resolveInputPath(run, step.inputPath, previousStepOutput);
        if (extracted !== undefined) {
          return {
            ...previousStepOutput,
            _extractedInput: extracted,
          };
        }
      }
      return previousStepOutput;
    }

    // Determine the source data
    let sourceData: Record<string, unknown>;

    if (inputConfig.source === 'previous') {
      sourceData = previousStepOutput;
    } else if (inputConfig.source === 'trigger') {
      sourceData = run.inputPayload || {};
    } else {
      // inputConfig.source is a step ID
      const sourceTask = await this.tasks.findOne({
        workflowRunId: run._id,
        workflowStepId: inputConfig.source,
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (sourceTask?.stepOutput) {
        sourceData = { output: sourceTask.stepOutput.data, ...sourceTask.stepOutput };
      } else if (sourceTask?.metadata) {
        sourceData = sourceTask.metadata as Record<string, unknown>;
      } else {
        // Source step not found or not completed
        console.warn(`[resolveStepInput] Source step ${inputConfig.source} not found or not completed`);
        sourceData = {};
      }
    }

    // If extractPath is defined, extract that path from source
    if (inputConfig.extractPath) {
      const extracted = getValueByPath(sourceData, inputConfig.extractPath);
      return { _input: extracted, _source: sourceData };
    }

    // If mapping is defined, resolve each template
    if (inputConfig.mapping && Object.keys(inputConfig.mapping).length > 0) {
      console.log(`[resolveStepInput] Resolving mapping with ${Object.keys(inputConfig.mapping).length} entries`);
      console.log(`[resolveStepInput] run.inputPayload keys: ${run.inputPayload ? Object.keys(run.inputPayload) : 'null'}`);
      console.log(`[resolveStepInput] run.inputPayload.data: ${run.inputPayload?.data ? 'present' : 'missing'}`);
      const resolved: Record<string, unknown> = {};
      for (const [key, template] of Object.entries(inputConfig.mapping)) {
        // Resolve template variables like {{output.field}}
        const resolvedValue = await resolveTemplateValue(template, sourceData, run.inputPayload);
        console.log(`[resolveStepInput] ${key}: "${template}" -> ${JSON.stringify(resolvedValue)?.substring(0, 100)}`);
        resolved[key] = resolvedValue;
      }
      return resolved;
    }

    // No mapping or extractPath - pass entire source
    return sourceData;
  }

  private async handleStepFailure(
    run: WorkflowRun,
    workflow: Workflow,
    failedTask: Task
  ): Promise<void> {
    const now = new Date();

    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'failed' as WorkflowRunStatus,
          error: `Step "${failedTask.title}" failed`,
          failedStepId: failedTask.workflowStepId,
          completedAt: now,
        },
      }
    );

    // Re-fetch run with updated stepLog for summary building
    const updatedRunForSummary = await this.workflowRuns.findOne({ _id: run._id });
    const allTasks = await this.tasks.find({ workflowRunId: run._id }).toArray();

    // Build execution summary capturing the failure
    let executionSummary: ExecutionSummary | undefined;
    if (updatedRunForSummary) {
      try {
        executionSummary = await this.buildExecutionSummary(
          updatedRunForSummary, allTasks, workflow, 'failed', failedTask
        );
      } catch (err) {
        console.error(`[WorkflowExecutionService] Failed to build execution summary for failed run ${run._id}:`, err);
      }
    }

    if (run.rootTaskId) {
      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        { $set: {
          status: 'failed' as TaskStatus,
          ...(executionSummary && { executionSummary }),
        } }
      );
    }

    if (run.triggerTaskId) {
      const workflowResult = {
        status: 'failed' as WorkflowRunStatus,
        error: `Step "${failedTask.title}" failed`,
        completedAt: now,
      };

      // Check if the trigger task is a flow task that needs to be marked as failed
      const triggerTask = await this.tasks.findOne({ _id: run.triggerTaskId });

      // Check both taskType and stepConfig.stepType for backwards compatibility with older tasks
      // Also check if the task has a flowConfig (indicating it's a flow task)
      const isFlowTask = triggerTask?.taskType === 'flow' ||
        triggerTask?.stepConfig?.stepType === 'flow' ||
        triggerTask?.flowConfig?.workflowId;
      if (isFlowTask && triggerTask) {
        // This is a subflow failure - mark the flow task as failed

        // Find the latest running attempt to update
        const attempts = triggerTask.flowConfig?.attempts || [];
        const runningAttemptIndex = attempts.findIndex(a =>
          a.status === 'running' && a.spawnedWorkflowRunId === run._id.toString()
        );
        const attemptIndex = runningAttemptIndex >= 0 ? runningAttemptIndex : attempts.length - 1;

        // Calculate duration if we have a start time
        const startTime = attemptIndex >= 0 ? attempts[attemptIndex]?.startedAt : null;
        const durationMs = startTime ? now.getTime() - new Date(startTime).getTime() : undefined;
        const errorMessage = `Subflow failed: ${failedTask.title}`;

        const updateFields: Record<string, unknown> = {
          status: 'failed' as TaskStatus,
          workflowResult,
          'metadata.error': errorMessage,
          'metadata.subflowFailed': true,
          'metadata.subflowFailedAt': now,
          updatedAt: now,
          // Update taskResult with failed subflow info
          'taskResult.current.status': 'failed' as const,
          'taskResult.current.completedAt': now,
          'taskResult.current.summary': errorMessage,
          'taskResult.current.error': `Step "${failedTask.title}" failed`,
          'taskResult.current.spawnedWorkflow.status': 'failed',
        };

        // Propagate execution summary to the flow task for parent rollup
        if (executionSummary) {
          updateFields.executionSummary = executionSummary;
        }

        // Update the flow attempt if we have one
        if (attemptIndex >= 0) {
          updateFields[`flowConfig.attempts.${attemptIndex}.status`] = 'failed';
          updateFields[`flowConfig.attempts.${attemptIndex}.completedAt`] = now;
          updateFields[`flowConfig.attempts.${attemptIndex}.errorMessage`] = errorMessage;
          if (durationMs !== undefined) {
            updateFields[`flowConfig.attempts.${attemptIndex}.durationMs`] = durationMs;
          }
        }

        await this.tasks.updateOne(
          { _id: run.triggerTaskId },
          { $set: updateFields }
        );
        console.log(`[WorkflowExecutionService] Flow task ${run.triggerTaskId} failed with subflow error`);

        // Emit task status changed event to handle the failure in parent workflow
        const updatedTriggerTask = await this.tasks.findOne({ _id: run.triggerTaskId });
        if (updatedTriggerTask) {
          await eventBus.publish({
            type: 'task.status.changed',
            taskId: updatedTriggerTask._id,
            task: updatedTriggerTask,
            changes: [{
              field: 'status',
              oldValue: 'in_progress',
              newValue: 'failed',
            }],
            actorId: null,
            actorType: 'system',
          });
          console.log(`[WorkflowExecutionService] Published task.status.changed for failed flow task ${run.triggerTaskId}`);
        }
      } else {
        // Regular task trigger - just set workflowResult
        await this.tasks.updateOne(
          { _id: run.triggerTaskId },
          {
            $set: {
              workflowResult,
              updatedAt: now,
            }
          }
        );
        console.log(`[WorkflowExecutionService] Propagated failure result to trigger task ${run.triggerTaskId}`);
      }
    }

    const updatedRun = await this.workflowRuns.findOne({ _id: run._id });
    if (updatedRun) {
      await this.publish({
        id: this.generateEventId(),
        type: 'workflow.run.failed',
        workflowRunId: run._id,
        workflowRun: updatedRun,
        stepId: failedTask.workflowStepId,
        taskId: failedTask._id,
        error: `Step "${failedTask.title}" failed`,
        actorId: null,
        actorType: 'system',
        timestamp: now,
      });
    }
  }

  private async completeWorkflow(run: WorkflowRun): Promise<void> {
    const now = new Date();

    const allTasks = await this.tasks
      .find({ workflowRunId: run._id })
      .toArray();

    const completedTasks = allTasks.filter(t => t.status === 'completed');

    const outputPayload: Record<string, unknown> = {};
    for (const task of completedTasks) {
      if (task.metadata && task.workflowStepId) {
        outputPayload[task.workflowStepId] = task.metadata;
      }
    }

    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'completed' as WorkflowRunStatus,
          outputPayload,
          completedAt: now,
          currentStepIds: [],
        },
      }
    );

    // Re-fetch run to get the latest stepLog for summary building
    const updatedRun = await this.workflowRuns.findOne({ _id: run._id });
    const workflow = await this.workflows.findOne({ _id: run.workflowId });

    // Build execution summary for the root task
    let executionSummary: ExecutionSummary | undefined;
    if (workflow && updatedRun) {
      try {
        executionSummary = await this.buildExecutionSummary(
          updatedRun, allTasks, workflow, 'success'
        );
      } catch (err) {
        console.error(`[WorkflowExecutionService] Failed to build execution summary for run ${run._id}:`, err);
      }
    }

    if (run.rootTaskId) {
      const rootTask = await this.tasks.findOne({ _id: run.rootTaskId });
      const oldStatus = rootTask?.status || 'in_progress';

      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        {
          $set: {
            status: 'completed' as TaskStatus,
            metadata: { ...outputPayload, completedAt: now },
            ...(executionSummary && { executionSummary }),
            updatedAt: now,
          },
        }
      );

      // Emit task status changed event for the root task so UI updates in realtime
      const updatedRootTask = await this.tasks.findOne({ _id: run.rootTaskId });
      if (updatedRootTask) {
        await eventBus.publish({
          type: 'task.status.changed',
          taskId: updatedRootTask._id,
          task: updatedRootTask,
          changes: [{
            field: 'status',
            oldValue: oldStatus,
            newValue: 'completed',
          }],
          actorId: null,
          actorType: 'system',
        });
        console.log(`[WorkflowExecutionService] Published task.status.changed for root task ${run.rootTaskId}`);
      }
    }

    if (run.triggerTaskId) {
      const workflowResult = {
        status: 'completed' as WorkflowRunStatus,
        outputPayload,
        completedAt: now,
      };

      // Check if the trigger task is a flow task that needs to be completed
      const triggerTask = await this.tasks.findOne({ _id: run.triggerTaskId });

      // Check both taskType and stepConfig.stepType for backwards compatibility with older tasks
      // Also check if the task has a flowConfig (indicating it's a flow task)
      const isFlowTask = triggerTask?.taskType === 'flow' ||
        triggerTask?.stepConfig?.stepType === 'flow' ||
        triggerTask?.flowConfig?.workflowId;
      if (isFlowTask && triggerTask) {
        // This is a subflow completion - mark the flow task as completed
        // and include the output payload in metadata for the next step

        // Find the latest running attempt to update
        const attempts = triggerTask.flowConfig?.attempts || [];
        const runningAttemptIndex = attempts.findIndex(a =>
          a.status === 'running' && a.spawnedWorkflowRunId === run._id.toString()
        );
        const attemptIndex = runningAttemptIndex >= 0 ? runningAttemptIndex : attempts.length - 1;

        // Calculate duration if we have a start time
        const startTime = attemptIndex >= 0 ? attempts[attemptIndex]?.startedAt : null;
        const durationMs = startTime ? now.getTime() - new Date(startTime).getTime() : undefined;

        // Build stepOutput for flow task so next steps can access subflow output via stepOutput.data
        const flowStepOutput = this.buildStepOutput(outputPayload, {
          summary: 'Subflow completed successfully',
          durationMs,
          nestedWorkflow: {
            runId: run._id.toString(),
            status: 'completed',
            output: outputPayload,
          },
        });

        const updateFields: Record<string, unknown> = {
          status: 'completed' as TaskStatus,
          workflowResult,
          stepOutput: flowStepOutput,
          'metadata.output': outputPayload,
          'metadata.subflowCompleted': true,
          'metadata.subflowCompletedAt': now,
          updatedAt: now,
          // Update taskResult with completed subflow info
          'taskResult.current.status': 'success' as const,
          'taskResult.current.completedAt': now,
          'taskResult.current.summary': `Subflow completed successfully`,
          'taskResult.current.output.subflowOutput': outputPayload,
          'taskResult.current.spawnedWorkflow.status': 'completed',
          'taskResult.current.spawnedWorkflow.outputPayload': outputPayload,
        };

        // Propagate execution summary to the flow task for parent rollup
        if (executionSummary) {
          updateFields.executionSummary = executionSummary;
        }

        // Update the flow attempt if we have one
        if (attemptIndex >= 0) {
          updateFields[`flowConfig.attempts.${attemptIndex}.status`] = 'success';
          updateFields[`flowConfig.attempts.${attemptIndex}.completedAt`] = now;
          updateFields[`flowConfig.attempts.${attemptIndex}.outputPayload`] = outputPayload;
          if (durationMs !== undefined) {
            updateFields[`flowConfig.attempts.${attemptIndex}.durationMs`] = durationMs;
          }
        }

        await this.tasks.updateOne(
          { _id: run.triggerTaskId },
          { $set: updateFields }
        );
        console.log(`[WorkflowExecutionService] Flow task ${run.triggerTaskId} completed with subflow output`);

        // Emit task status changed event to advance the parent workflow
        const updatedTriggerTask = await this.tasks.findOne({ _id: run.triggerTaskId });
        if (updatedTriggerTask) {
          await eventBus.publish({
            type: 'task.status.changed',
            taskId: updatedTriggerTask._id,
            task: updatedTriggerTask,
            changes: [{
              field: 'status',
              oldValue: 'in_progress',
              newValue: 'completed',
            }],
            actorId: null,
            actorType: 'system',
          });
          console.log(`[WorkflowExecutionService] Published task.status.changed for flow task ${run.triggerTaskId}`);
        }
      } else {
        // Regular task trigger - just set workflowResult
        await this.tasks.updateOne(
          { _id: run.triggerTaskId },
          {
            $set: {
              workflowResult,
              updatedAt: now,
            }
          }
        );
        console.log(`[WorkflowExecutionService] Propagated success result to trigger task ${run.triggerTaskId}`);
      }
    }

    const finalRun = await this.workflowRuns.findOne({ _id: run._id });
    if (finalRun) {
      await this.publish({
        id: this.generateEventId(),
        type: 'workflow.run.completed',
        workflowRunId: run._id,
        workflowRun: finalRun,
        actorId: null,
        actorType: 'system',
        timestamp: now,
      });
    }

    console.log(`[WorkflowExecutionService] Workflow run ${run._id} completed`);
  }

  // ============================================================================
  // Unified Callback Handler
  // ============================================================================

  async handleCallback(
    runId: string,
    stepId: string,
    payload: Record<string, unknown>,
    secret: string,
    requestInfo?: {
      url: string;
      method: string;
      headers: Record<string, string>;
      receivedAt: Date;
    }
  ): Promise<{
    acknowledged: boolean;
    taskId: string;
    taskType: TaskType;
    childTaskIds: string[];
    receivedCount: number;
    expectedCount: number;
    isComplete: boolean;
  }> {
    const run = await this.workflowRuns.findOne({ _id: new ObjectId(runId) });
    if (!run) {
      throw new Error(`Workflow run ${runId} not found`);
    }

    if (run.status === 'cancelled') {
      console.log(`[WorkflowExecutionService] Rejecting callback for cancelled workflow run ${runId}`);
      throw new Error(`Workflow run ${runId} has been cancelled`);
    }

    const anyTaskForStep = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
    }, { sort: { createdAt: -1 } });

    const logCallbackRequest = async (
      taskId: ObjectId | null,
      status: 'success' | 'failed',
      error?: string,
      createdTaskIds: string[] = []
    ) => {
      if (!requestInfo || !taskId) return;

      const callbackRequest = {
        _id: new ObjectId().toString(),
        url: requestInfo.url,
        method: requestInfo.method,
        headers: requestInfo.headers,
        body: payload,
        receivedAt: requestInfo.receivedAt,
        status,
        error,
        createdTaskIds,
      };

      const currentTask = await this.tasks.findOne({ _id: taskId });
      const existingCallbacks = (currentTask?.metadata?.callbackRequests as unknown[]) || [];

      await this.tasks.updateOne(
        { _id: taskId },
        {
          $set: {
            'metadata.callbackRequests': [...existingCallbacks, callbackRequest],
          },
        }
      );
      console.log(`[WorkflowExecutionService] Logged ${status} callback request to task ${taskId}${error ? `: ${error}` : ''}`);
    };

    const task = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
      status: { $in: ['waiting', 'in_progress'] },
    });

    if (!task) {
      await logCallbackRequest(
        anyTaskForStep?._id || null,
        'failed',
        `Task for step ${stepId} not found or already completed`
      );
      throw new Error(`Task for step ${stepId} not found or already completed`);
    }

    let validSecret =
      task.externalConfig?.callbackSecret === secret ||
      run.callbackSecret === secret;

    if (!validSecret && task.taskType === 'foreach') {
      const prevExternalTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'external',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (prevExternalTask?.externalConfig?.callbackSecret === secret) {
        validSecret = true;
      }
    }

    if (!validSecret) {
      await logCallbackRequest(task._id, 'failed', 'Invalid callback secret');
      throw new Error('Invalid callback secret');
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      throw new Error(`Workflow ${run.workflowId} not found`);
    }

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow`);
    }

    const workflowUpdate = payload.workflowUpdate as { complete?: boolean; total?: number } | undefined;
    const signalComplete = workflowUpdate?.complete === true;
    const newTotal = workflowUpdate?.total;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workflowUpdate: _, ...payloadData } = payload;

    let items: unknown[] = [];
    if ('item' in payloadData && payloadData.item !== undefined) {
      items = [payloadData.item];
    } else if ('items' in payloadData && Array.isArray(payloadData.items)) {
      items = payloadData.items;
    } else if (Object.keys(payloadData).length > 0) {
      items = [payloadData];
    }

    let currentReceivedCount = task.batchCounters?.receivedCount || 0;
    let currentExpectedCount = task.batchCounters?.expectedCount || 0;
    const childTaskIds: string[] = [];

    if (newTotal !== undefined && newTotal >= 0) {
      currentExpectedCount = newTotal;
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            'batchCounters.expectedCount': currentExpectedCount,
            expectedQuantity: currentExpectedCount,
            status: 'in_progress' as TaskStatus,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`[WorkflowExecutionService] Task ${task._id} expectedCount set to ${currentExpectedCount}`);
    }

    if (task.taskType === 'foreach' && items.length > 0) {
      let nextStepId = step.connections?.[0]?.targetStepId;

      if (!nextStepId && workflow.mermaidDiagram) {
        const mermaidRegex = new RegExp(`${step.id}\\s*-->(?:\\|[^|]*\\|)?\\s*(step-\\d+)`, 'g');
        const match = mermaidRegex.exec(workflow.mermaidDiagram);
        if (match) {
          nextStepId = match[1];
          console.log(`[WorkflowExecutionService] Derived connection from mermaid: ${step.id} -> ${nextStepId}`);
        }
      }

      const nextStep = nextStepId ? workflow.steps.find(s => s.id === nextStepId) : null;

      if (!nextStep) {
        console.error(`[WorkflowExecutionService] No child step found for foreach ${stepId}`);
        console.error(`[WorkflowExecutionService] Step connections:`, step.connections);
        console.error(`[WorkflowExecutionService] Available steps:`, workflow.steps.map(s => s.id));
        throw new Error(`Foreach step ${stepId} has no connected child step`);
      }

      console.log(`[WorkflowExecutionService] Creating child tasks for step ${nextStep.id} (${nextStep.name || 'unnamed'}) of type ${nextStep.stepType}`);

      for (const item of items) {
        const itemPayload = {
          [step.itemVariable || 'item']: item,
          _index: currentReceivedCount,
          _total: currentExpectedCount,
        };

        try {
          const childTask = await this.createTaskForStep(run, workflow, nextStep, task, itemPayload);
          childTaskIds.push(childTask._id.toString());
          currentReceivedCount++;

          console.log(`[WorkflowExecutionService] Foreach ${task._id} received item ${currentReceivedCount}/${currentExpectedCount}`);

          await this.executeStepForTask(run, workflow, nextStep, childTask, itemPayload);
        } catch (err) {
          const mongoErr = err as { code?: number; errInfo?: { details?: unknown } };
          console.error(`[WorkflowExecutionService] Failed to create child task for step ${nextStep.id}:`, err);
          if (mongoErr.errInfo?.details) {
            console.error(`[WorkflowExecutionService] Validation details:`, JSON.stringify(mongoErr.errInfo.details, null, 2));
          }
          throw err;
        }
      }

      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            'batchCounters.receivedCount': currentReceivedCount,
            status: 'in_progress' as TaskStatus,
            updatedAt: new Date(),
          },
        }
      );
    } else if (items.length > 0) {
      // Build stepOutput for external task so next steps can access callback data via stepOutput.data
      const callbackData = items.length === 1 ? items[0] : items;
      const externalStepOutput = this.buildStepOutput(callbackData, {
        summary: `External callback received with ${items.length} item(s)`,
      });

      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'completed' as TaskStatus,
            stepOutput: externalStepOutput,
            metadata: { ...task.metadata, callbackPayload: callbackData },
            updatedAt: new Date(),
          },
        }
      );
      console.log(`[WorkflowExecutionService] External task ${task._id} completed with callback data`);
    }

    const isComplete = signalComplete ||
      (currentExpectedCount > 0 && currentReceivedCount >= currentExpectedCount);

    if (isComplete && task.taskType === 'foreach' && task.status !== 'completed') {
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'in_progress' as TaskStatus,
            'metadata.allItemsReceived': true,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`[WorkflowExecutionService] Foreach ${task._id} all items received, waiting for children to complete`);
    }

    await logCallbackRequest(task._id, 'success', undefined, childTaskIds);

    return {
      acknowledged: true,
      taskId: task._id.toString(),
      taskType: task.taskType || 'agent',
      childTaskIds,
      receivedCount: currentReceivedCount,
      expectedCount: currentExpectedCount,
      isComplete,
    };
  }

  async handleExternalCallback(
    runId: string,
    stepId: string,
    payload: Record<string, unknown>,
    secret: string,
    requestInfo?: {
      url: string;
      method: string;
      headers: Record<string, string>;
      receivedAt: Date;
    }
  ): Promise<Task> {
    const result = await this.handleCallback(runId, stepId, payload, secret, requestInfo);
    const task = await this.tasks.findOne({ _id: new ObjectId(result.taskId) });
    return task!;
  }

  async handleForeachItemCallback(
    runId: string,
    stepId: string,
    payload: { item?: unknown; expectedCount?: number; complete?: boolean },
    secret: string
  ): Promise<{
    acknowledged: boolean;
    foreachTaskId: string;
    childTaskId?: string;
    receivedCount: number;
    expectedCount: number;
    isComplete: boolean;
  }> {
    const unifiedPayload: Record<string, unknown> = {};
    if (payload.item !== undefined) {
      unifiedPayload.item = payload.item;
    }
    if (payload.expectedCount !== undefined || payload.complete !== undefined) {
      unifiedPayload.workflowUpdate = {
        total: payload.expectedCount,
        complete: payload.complete,
      };
    }

    const result = await this.handleCallback(runId, stepId, unifiedPayload, secret);
    return {
      acknowledged: result.acknowledged,
      foreachTaskId: result.taskId,
      childTaskId: result.childTaskIds[0],
      receivedCount: result.receivedCount,
      expectedCount: result.expectedCount,
      isComplete: result.isComplete,
    };
  }

  private async executeStepForTask(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    task: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    await this.publish({
      id: this.generateEventId(),
      type: 'workflow.run.step.started',
      workflowRunId: run._id,
      workflowRun: run,
      stepId: step.id,
      taskId: task._id,
      actorId: null,
      actorType: 'system',
      timestamp: new Date(),
    });

    switch (step.stepType) {
      case 'agent':
      case 'manual':
        break;

      case 'external':
        await this.executeExternal(run, workflow, step, task, inputPayload);
        break;

      case 'webhook':
        await this.executeWebhook(run, workflow, step, task, inputPayload);
        break;

      case 'decision':
        await this.executeDecision(run, workflow, step, task, inputPayload);
        break;
    }
  }

  // ============================================================================
  // Public Methods for Task Management
  // ============================================================================

  async rerunJoinTask(joinTaskId: ObjectId): Promise<{ success: boolean; error?: string; debug?: Record<string, unknown> }> {
    const joinTask = await this.tasks.findOne({ _id: joinTaskId });
    if (!joinTask || joinTask.taskType !== 'join') {
      console.log(`[WorkflowExecutionService] rerunJoinTask: task ${joinTaskId} not found or not a join task`);
      return { success: false, error: 'Task not found or not a join task' };
    }

    let foreachTaskId: ObjectId | undefined;
    let foreachSource = '';

    if (joinTask.joinConfig?.awaitTaskId) {
      const awaitId = joinTask.joinConfig.awaitTaskId;
      foreachTaskId = typeof awaitId === 'string' ? new ObjectId(awaitId) : awaitId as ObjectId;
      foreachSource = 'joinConfig.awaitTaskId';
    }

    if (!foreachTaskId && joinTask.metadata?.awaitingForeachTask) {
      const awaitingId = joinTask.metadata.awaitingForeachTask;
      foreachTaskId = typeof awaitingId === 'string' ? new ObjectId(awaitingId) : awaitingId as ObjectId;
      foreachSource = 'metadata.awaitingForeachTask';
      console.log(`[WorkflowExecutionService] rerunJoinTask: using metadata.awaitingForeachTask ${foreachTaskId}`);
    }

    if (!foreachTaskId && joinTask.parentId) {
      const parentTask = await this.tasks.findOne({ _id: joinTask.parentId });
      if (parentTask?.taskType === 'foreach') {
        foreachTaskId = parentTask._id;
        foreachSource = 'parentId (foreach parent)';
        console.log(`[WorkflowExecutionService] rerunJoinTask: using parent as foreach task ${foreachTaskId}`);
      }
    }

    if (foreachTaskId && !joinTask.joinConfig?.awaitTaskId) {
      await this.tasks.updateOne(
        { _id: joinTaskId },
        { $set: { 'joinConfig.awaitTaskId': foreachTaskId } }
      );
    }

    if (!foreachTaskId) {
      console.log(`[WorkflowExecutionService] rerunJoinTask: join task ${joinTaskId} has no awaitTaskId, metadata.awaitingForeachTask, or foreach parent`);
      return {
        success: false,
        error: 'No foreach task found to aggregate from.',
        debug: {
          joinTaskId: joinTaskId.toString(),
          hasJoinConfig: !!joinTask.joinConfig,
          hasAwaitTaskId: !!joinTask.joinConfig?.awaitTaskId,
          hasMetadataAwaiting: !!joinTask.metadata?.awaitingForeachTask,
          hasParentId: !!joinTask.parentId,
        }
      };
    }

    console.log(`[WorkflowExecutionService] rerunJoinTask: re-aggregating join ${joinTaskId} from foreach ${foreachTaskId}`);

    await this.tasks.updateOne(
      { _id: joinTaskId },
      { $set: { status: 'waiting' as TaskStatus } }
    );

    const result = await this.checkJoinConditionWithDebug(joinTaskId, foreachTaskId);

    if (result.success) {
      const updatedJoinTask = await this.tasks.findOne({ _id: joinTaskId });
      if (updatedJoinTask && updatedJoinTask.status === 'completed') {
        console.log(`[WorkflowExecutionService] rerunJoinTask: emitting completion event for join ${joinTaskId}`);
        await publishTaskEvent('task.status.changed', updatedJoinTask, {});
      }
    }

    return {
      success: result.success,
      debug: {
        foreachTaskId: foreachTaskId.toString(),
        foreachSource,
        ...result.debug
      }
    };
  }

  /**
   * Advance workflow after a decision task has been manually forced to a specific branch.
   * This executes the next step in the workflow based on the forced target.
   */
  async advanceFromForcedDecision(
    workflowRunId: ObjectId | string,
    decisionTaskId: ObjectId | string,
    targetStepId: string
  ): Promise<void> {
    const runId = typeof workflowRunId === 'string' ? new ObjectId(workflowRunId) : workflowRunId;
    const taskId = typeof decisionTaskId === 'string' ? new ObjectId(decisionTaskId) : decisionTaskId;

    console.log(`[WorkflowExecutionService] advanceFromForcedDecision: run=${runId}, task=${taskId}, target=${targetStepId}`);

    // Get the workflow run
    const run = await this.workflowRuns.findOne({ _id: runId });
    if (!run) {
      console.error(`[WorkflowExecutionService] advanceFromForcedDecision: run ${runId} not found`);
      return;
    }

    // Get the workflow definition
    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      console.error(`[WorkflowExecutionService] advanceFromForcedDecision: workflow ${run.workflowId} not found`);
      return;
    }

    // Get the decision task
    const decisionTask = await this.tasks.findOne({ _id: taskId });
    if (!decisionTask) {
      console.error(`[WorkflowExecutionService] advanceFromForcedDecision: task ${taskId} not found`);
      return;
    }

    // Find the target step
    const nextStep = workflow.steps.find(s => s.id === targetStepId);
    if (!nextStep) {
      console.error(`[WorkflowExecutionService] advanceFromForcedDecision: step ${targetStepId} not found in workflow`);
      return;
    }

    // Get the parent task (usually the flow/root task)
    const parentTask = decisionTask.parentId
      ? await this.tasks.findOne({ _id: decisionTask.parentId })
      : null;

    if (!parentTask) {
      console.error(`[WorkflowExecutionService] advanceFromForcedDecision: parent task not found for decision ${taskId}`);
      return;
    }

    // Get input payload from decision task metadata
    const inputPayload = (decisionTask.metadata as Record<string, unknown> | undefined)?.inputPayload as Record<string, unknown> | undefined;

    // Check if a task already exists for this step in this workflow run
    // This prevents duplicate task creation when forcing a decision that was already executed
    const existingTask = await this.tasks.findOne({
      workflowRunId: runId,
      workflowStepId: targetStepId,
    });

    if (existingTask) {
      // If the existing task is a flow task in pending status with no attempts,
      // we should trigger the flow execution instead of skipping entirely
      const isFlowTask = existingTask.taskType === 'flow' ||
        existingTask.stepConfig?.stepType === 'flow' ||
        existingTask.flowConfig?.workflowId;
      const isPending = existingTask.status === 'pending';
      const hasNoAttempts = !existingTask.flowConfig?.attempts || existingTask.flowConfig.attempts.length === 0;

      if (isFlowTask && isPending && hasNoAttempts) {
        console.log(`[WorkflowExecutionService] advanceFromForcedDecision: flow task ${existingTask._id} exists but not executed - triggering execution`);
        try {
          await this.executeFlowTask(existingTask._id.toString());
        } catch (error) {
          console.error(`[WorkflowExecutionService] advanceFromForcedDecision: failed to execute flow task:`, error);
        }
        return;
      }

      console.log(`[WorkflowExecutionService] advanceFromForcedDecision: task already exists for step ${targetStepId} (status: ${existingTask.status}) - skipping execution`);
      return;
    }

    // Execute the next step
    console.log(`[WorkflowExecutionService] advanceFromForcedDecision: executing step ${nextStep.id} (${nextStep.name})`);
    await this.executeStep(run, workflow, nextStep, parentTask, inputPayload);
  }

  private async checkJoinConditionWithDebug(joinTaskId: ObjectId, foreachTaskId: ObjectId): Promise<{ success: boolean; debug: Record<string, unknown> }> {
    const foreachTask = await this.tasks.findOne({ _id: foreachTaskId });
    if (!foreachTask) {
      console.log(`[WorkflowExecutionService] checkJoinCondition: foreach task ${foreachTaskId} not found`);
      return { success: false, debug: { error: 'Foreach task not found', foreachTaskId: foreachTaskId.toString() } };
    }

    const joinTask = await this.tasks.findOne({ _id: joinTaskId });
    if (!joinTask) {
      console.log(`[WorkflowExecutionService] checkJoinCondition: join task ${joinTaskId} not found`);
      return { success: false, debug: { error: 'Join task not found' } };
    }

    const children = await this.tasks.find({ parentId: foreachTaskId }).toArray();
    console.log(`[WorkflowExecutionService] checkJoinCondition: found ${children.length} children of foreach ${foreachTaskId}`);

    const completedCount = children.filter(c => c.status === 'completed').length;
    const failedCount = children.filter(c => c.status === 'failed').length;
    const totalDone = completedCount + failedCount;

    const expectedCount = joinTask.joinConfig?.expectedCount
      ?? foreachTask.batchCounters?.expectedCount
      ?? children.length;

    const minSuccessPercent = joinTask.joinConfig?.minSuccessPercent ?? 100;
    const requiredSuccessCount = Math.ceil((expectedCount * minSuccessPercent) / 100);
    const currentSuccessPercent = expectedCount > 0 ? (completedCount / expectedCount) * 100 : 0;

    const thresholdMet = completedCount >= requiredSuccessCount;
    const allDone = totalDone >= expectedCount;

    const debug = {
      childrenFound: children.length,
      completedCount,
      failedCount,
      totalDone,
      expectedCount,
      minSuccessPercent,
      requiredSuccessCount,
      currentSuccessPercent: Math.round(currentSuccessPercent * 10) / 10,
      thresholdMet,
      allDone,
      foreachTaskType: foreachTask.taskType,
      foreachStatus: foreachTask.status,
    };

    console.log(`[WorkflowExecutionService] Join check:`, debug);

    if (thresholdMet || allDone) {
      const result = await this.checkJoinCondition(joinTaskId, foreachTaskId);
      return { success: result, debug };
    }

    return { success: false, debug };
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  async getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
    return this.workflowRuns.findOne({ _id: new ObjectId(runId) });
  }

  async getWorkflowRunWithTasks(
    runId: string,
    options: {
      limit?: number;
      beforeCreatedAt?: Date;
      afterCreatedAt?: Date;
      includeDetails?: boolean;
      includeDescendantCounts?: boolean;
    } = {}
  ): Promise<{
    run: WorkflowRun & { workflow?: Workflow };
    tasks: Task[];
    pagination: {
      limit: number;
      hasMore: boolean;
      nextCursor?: string;
      prevCursor?: string;
    };
  } | null> {
    const run = await this.getWorkflowRun(runId);
    if (!run) return null;

    const workflow = await this.workflows.findOne({ _id: run.workflowId });

    const DEFAULT_LIMIT = 100;
    const MAX_LIMIT = 500;
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const filter: Record<string, unknown> = { workflowRunId: run._id };
    if (options.beforeCreatedAt) {
      filter.createdAt = { $lt: options.beforeCreatedAt };
    } else if (options.afterCreatedAt) {
      filter.createdAt = { $gt: options.afterCreatedAt };
    }

    const projection: Record<string, 0 | 1> = options.includeDetails
      ? {}
      : {
          'metadata.rawPayload': 0,
          'metadata.debugLogs': 0,
          'externalConfig.requestBody': 0,
          'webhookConfig.requestBody': 0,
        };

    let tasks = (await this.tasks
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .project(projection)
      .toArray()) as Task[];

    const hasMore = tasks.length > limit;
    if (hasMore) {
      tasks.pop();
    }

    if (options.includeDescendantCounts && tasks.length > 0) {
      const taskIds = tasks.map(t => t._id);
      const childCounts = await this.tasks.aggregate([
        { $match: { workflowRunId: run._id, parentId: { $in: taskIds } } },
        { $group: { _id: '$parentId', count: { $sum: 1 } } }
      ]).toArray();

      const countMap = new Map(childCounts.map(c => [c._id.toString(), c.count]));
      tasks.forEach(task => {
        (task as unknown as { childCount: number }).childCount = countMap.get(task._id.toString()) || 0;
      });
    }

    const pagination: {
      limit: number;
      hasMore: boolean;
      nextCursor?: string;
      prevCursor?: string;
    } = {
      limit,
      hasMore,
    };

    if (hasMore && tasks.length > 0) {
      const lastTask = tasks[tasks.length - 1];
      pagination.nextCursor = lastTask.createdAt.toISOString();
    }

    if (options.afterCreatedAt && tasks.length > 0) {
      const firstTask = tasks[0];
      pagination.prevCursor = firstTask.createdAt.toISOString();
    }

    return {
      run: { ...run, workflow: workflow || undefined },
      tasks,
      pagination,
    };
  }

  async getChildTasks(
    runId: string,
    parentId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ tasks: Task[]; hasMore: boolean }> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const tasks = await this.tasks
      .find({
        workflowRunId: new ObjectId(runId),
        parentId: new ObjectId(parentId)
      })
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    const hasMore = tasks.length > limit;
    if (hasMore) {
      tasks.pop();
    }

    return { tasks, hasMore };
  }

  async listWorkflowRuns(options: {
    workflowId?: string;
    groupId?: ObjectId;
    status?: WorkflowRunStatus | WorkflowRunStatus[];
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  } = {}): Promise<{ runs: WorkflowRun[]; total: number }> {
    const { page = 1, limit = 20 } = options;
    const filter: Record<string, unknown> = {};

    if (options.workflowId) {
      filter.workflowId = new ObjectId(options.workflowId);
    }

    // Filter by group - workflow runs are linked to workflows which have groupId
    if (options.groupId) {
      const workflowIds = await this.workflows
        .find({ groupId: options.groupId })
        .project({ _id: 1 })
        .toArray();
      filter.workflowId = { $in: workflowIds.map((w) => w._id) };
    }

    if (options.status) {
      filter.status = Array.isArray(options.status)
        ? { $in: options.status }
        : options.status;
    }
    if (options.dateFrom || options.dateTo) {
      filter.createdAt = {};
      if (options.dateFrom) {
        (filter.createdAt as Record<string, Date>).$gte = options.dateFrom;
      }
      if (options.dateTo) {
        (filter.createdAt as Record<string, Date>).$lte = options.dateTo;
      }
    }

    const [runs, total] = await Promise.all([
      this.workflowRuns
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.workflowRuns.countDocuments(filter),
    ]);

    return { runs, total };
  }

  async cancelWorkflowRun(runId: string, actorId?: ObjectId): Promise<WorkflowRun> {
    const now = new Date();
    const _id = new ObjectId(runId);

    const result = await this.workflowRuns.findOneAndUpdate(
      { _id, status: { $in: ['running', 'pending'] } },
      {
        $set: {
          status: 'cancelled' as WorkflowRunStatus,
          completedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Workflow run ${runId} not found or not in a cancellable state`);
    }

    const cancelResult = await this.tasks.updateMany(
      { workflowRunId: _id, status: { $in: ['pending', 'waiting', 'in_progress'] } },
      {
        $set: {
          status: 'cancelled' as TaskStatus,
          updatedAt: now,
          'webhookConfig.nextRetryAt': null,
        }
      }
    );

    console.log(`[WorkflowExecutionService] Cancelled workflow run ${runId}: ${cancelResult.modifiedCount} tasks marked as cancelled`);

    // Also update the root task if it exists and isn't already in a terminal state
    if (result.rootTaskId) {
      await this.tasks.updateOne(
        { _id: result.rootTaskId, status: { $nin: ['completed', 'failed', 'cancelled'] } },
        { $set: { status: 'cancelled' as TaskStatus, updatedAt: now } }
      );
    }

    await this.publish({
      id: this.generateEventId(),
      type: 'workflow.run.cancelled',
      workflowRunId: _id,
      workflowRun: result,
      actorId,
      actorType: 'user',
      timestamp: now,
    });

    return result;
  }

  // ============================================================================
  // Manual Step Execution (for stuck workflows)
  // ============================================================================

  async manuallyExecuteStep(
    workflowRunId: string,
    stepId: string,
    inputPayload?: Record<string, unknown>
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    console.log(`[WorkflowExecutionService] Manually executing step ${stepId} for run ${workflowRunId}`);

    const run = await this.workflowRuns.findOne({ _id: new ObjectId(workflowRunId) });
    if (!run) {
      return { success: false, error: 'Workflow run not found' };
    }

    if (!run.currentStepIds.includes(stepId)) {
      return { success: false, error: `Step ${stepId} is not in currentStepIds. Current steps: ${run.currentStepIds.join(', ')}` };
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      return { success: false, error: `Step ${stepId} not found in workflow` };
    }

    const existingTask = await this.tasks.findOne({
      workflowRunId: run._id,
      'metadata.stepId': stepId,
    });
    if (existingTask) {
      return { success: false, error: `Task already exists for step ${stepId}: ${existingTask._id}` };
    }

    if (!run.rootTaskId) {
      return { success: false, error: 'Workflow run has no root task' };
    }
    const rootTask = await this.tasks.findOne({ _id: run.rootTaskId });
    if (!rootTask) {
      return { success: false, error: 'Root task not found' };
    }

    let finalInputPayload = inputPayload;
    if (!finalInputPayload) {
      const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
      if (stepIndex > 0) {
        const prevStep = workflow.steps[stepIndex - 1];
        const prevTask = await this.tasks.findOne({
          workflowRunId: run._id,
          'metadata.stepId': prevStep.id,
        });
        if (prevTask) {
          if (step.inputPath && prevTask.metadata) {
            const pathParts = step.inputPath.split('.');
            let value: unknown = prevTask.metadata;
            for (const part of pathParts) {
              if (value && typeof value === 'object' && part in value) {
                value = (value as Record<string, unknown>)[part];
              } else {
                value = undefined;
                break;
              }
            }
            if (value) {
              finalInputPayload = { [pathParts[pathParts.length - 1] || 'input']: value };
            }
          }
        }
      }
    }

    try {
      const task = await this.executeStep(run, workflow, step, rootTask, finalInputPayload);
      console.log(`[WorkflowExecutionService] Successfully created task ${task._id} for step ${stepId}`);
      return { success: true, taskId: task._id.toString() };
    } catch (error) {
      console.error(`[WorkflowExecutionService] Failed to execute step ${stepId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Rollback a manual review task to the previous step.
   * This is used when a reviewer requests changes on a manual step.
   *
   * @param taskId - The ID of the manual task requesting rollback
   * @param reviewComment - Optional comment explaining why changes are requested
   */
  async rollbackToPreviousStep(
    taskId: string,
    reviewComment?: string
  ): Promise<{ success: boolean; error?: string; newTaskId?: string }> {
    console.log(`[WorkflowExecutionService] rollbackToPreviousStep called for task ${taskId}`);

    const task = await this.tasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.taskType !== 'manual') {
      return { success: false, error: 'Only manual tasks can be rolled back' };
    }

    if (!task.workflowRunId || !task.workflowStepId) {
      return { success: false, error: 'Task is not part of a workflow' };
    }

    const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
    if (!run) {
      return { success: false, error: 'Workflow run not found' };
    }

    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    // Find the current step
    const currentStep = workflow.steps.find(s => s.id === task.workflowStepId);
    if (!currentStep) {
      return { success: false, error: 'Current step not found in workflow' };
    }

    // Find the previous step
    // First, look for steps that have connections TO this step
    let previousStep: typeof workflow.steps[0] | undefined;
    for (const step of workflow.steps) {
      if (step.connections?.some(c => c.targetStepId === currentStep.id)) {
        previousStep = step;
        break;
      }
    }

    // If no explicit connection found, use sequential order
    if (!previousStep) {
      const currentIndex = workflow.steps.findIndex(s => s.id === currentStep.id);
      if (currentIndex > 0) {
        previousStep = workflow.steps[currentIndex - 1];
      }
    }

    if (!previousStep) {
      return { success: false, error: 'No previous step found - cannot rollback from the first step' };
    }

    // Skip trigger steps (can't rollback to trigger)
    if (previousStep.stepType === 'trigger') {
      return { success: false, error: 'Cannot rollback to trigger step' };
    }

    console.log(`[WorkflowExecutionService] Rolling back from ${currentStep.name} to ${previousStep.name}`);

    // Update the current task to archived/cancelled with review info
    await this.tasks.updateOne(
      { _id: task._id },
      {
        $set: {
          status: 'archived',
          reviewDecision: 'request_changes',
          reviewComment: reviewComment || undefined,
          reviewedAt: new Date(),
          metadata: {
            ...task.metadata,
            rolledBackAt: new Date(),
            rolledBackReason: reviewComment,
            rolledBackFromStep: currentStep.id,
            rolledBackToStep: previousStep.id,
          },
        },
      }
    );

    // Update workflow run: move current step from currentStepIds, add previous step
    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $pull: { currentStepIds: currentStep.id, completedStepIds: previousStep.id },
        $addToSet: { currentStepIds: previousStep.id },
      }
    );

    // Get the root task for creating the new task
    const rootTask = run.rootTaskId ? await this.tasks.findOne({ _id: run.rootTaskId }) : null;
    if (!rootTask) {
      return { success: false, error: 'Root task not found' };
    }

    // Find the original input for the previous step by looking at its completed task
    const previousStepTask = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: previousStep.id,
      status: { $in: ['completed', 'archived'] },
    }, { sort: { createdAt: -1 } });

    // Build input payload for the new task - include the review feedback
    const inputPayload: Record<string, unknown> = {
      ...(previousStepTask?.metadata || {}),
      _rollbackFeedback: {
        reviewComment: reviewComment,
        rolledBackAt: new Date().toISOString(),
        rolledBackFromStep: currentStep.name,
        requestedBy: task.assigneeId?.toString() || 'unknown',
      },
    };

    try {
      // Create a new task for the previous step
      const newTask = await this.executeStep(run, workflow, previousStep, rootTask, inputPayload);
      console.log(`[WorkflowExecutionService] Created rollback task ${newTask._id} for step ${previousStep.id}`);

      return { success: true, newTaskId: newTask._id.toString() };
    } catch (error) {
      console.error(`[WorkflowExecutionService] Failed to create rollback task:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================================================
  // Flow Task Execute/Retry Methods
  // ============================================================================

  /**
   * Execute or re-execute a flow task (start its subflow).
   * This can be used to:
   * - Force trigger a flow that hasn't started yet (pending status)
   * - Retry a failed flow
   * - Re-execute a flow with updated input payload
   *
   * @param taskId - The ID of the flow task
   * @param inputPayload - Optional override input payload (uses task's stored payload if not provided)
   * @returns The flow attempt record
   */
  async executeFlowTask(
    taskId: string,
    inputPayload?: Record<string, unknown>
  ): Promise<{ success: boolean; attempt?: FlowAttempt; error?: string }> {
    console.log(`[WorkflowExecutionService] Executing flow task ${taskId}`);

    const task = await this.tasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Check if this is a flow task
    const isFlowTask = task.taskType === 'flow' ||
      task.stepConfig?.stepType === 'flow' ||
      task.flowConfig?.workflowId;

    if (!isFlowTask) {
      return { success: false, error: 'Task is not a flow task' };
    }

    // Get the workflow ID from various possible locations
    const workflowId = task.flowConfig?.workflowId ||
      task.stepConfig?.flowId ||
      (task.metadata?.targetWorkflowId as string);

    if (!workflowId) {
      return { success: false, error: 'Flow task has no target workflow configured' };
    }

    // Get the target workflow
    const targetWorkflow = await this.workflows.findOne({ _id: new ObjectId(workflowId) });
    if (!targetWorkflow) {
      return { success: false, error: `Target workflow ${workflowId} not found` };
    }

    if (!targetWorkflow.isActive) {
      return { success: false, error: `Target workflow "${targetWorkflow.name}" is not active` };
    }

    // Determine input payload - use provided, or resolve inputMapping, or fall back to stored config
    let finalInputPayload: Record<string, unknown>;
    // Support both legacy inputMapping and new inputConfig.mapping
    // First try to get inputMapping from task config
    let inputMapping = task.flowConfig?.inputMapping ||
      task.stepConfig?.inputMapping ||
      (task.stepConfig?.inputConfig as { mapping?: Record<string, unknown> } | undefined)?.mapping;

    // If inputMapping not stored on task, look it up from the parent workflow definition
    // This handles tasks created before the fix that copies inputConfig.mapping to stepConfig
    if (!inputMapping && task.workflowRunId && task.workflowStepId) {
      const workflowRun = await this.workflowRuns.findOne({ _id: new ObjectId(task.workflowRunId) });
      if (workflowRun?.workflowId) {
        const parentWorkflow = await this.workflows.findOne({ _id: new ObjectId(workflowRun.workflowId) });
        if (parentWorkflow?.steps) {
          const step = parentWorkflow.steps.find(
            (s: { id?: string; _id?: ObjectId }) =>
              s.id === task.workflowStepId || s._id?.toString() === task.workflowStepId
          );
          if (step) {
            inputMapping = step.inputMapping || step.inputConfig?.mapping;
            if (inputMapping) {
              console.log(`[WorkflowExecutionService] Found inputMapping from parent workflow step: ${JSON.stringify(inputMapping).substring(0, 200)}`);
            }
          }
        }
      }
    }

    const taskInputPayload = task.metadata?.inputPayload as Record<string, unknown> | undefined;

    if (inputPayload) {
      // Explicit override provided - use it directly
      finalInputPayload = inputPayload;
    } else if (inputMapping && Object.keys(inputMapping).length > 0 && task.workflowRunId) {
      // Always resolve inputMapping templates - don't trust stored subflowInputPayload
      // because it may contain stale or unresolved templates from previous attempts
      console.log(`[WorkflowExecutionService] Resolving inputMapping for flow task ${taskId}: ${JSON.stringify(inputMapping)}`);

      finalInputPayload = {};
      for (const [targetField, sourceValue] of Object.entries(inputMapping)) {
        if (!targetField) continue;

        // Only resolve template if the value is a string
        // Non-string values (arrays, objects, numbers, booleans) are passed through as-is
        if (typeof sourceValue === 'string') {
          const resolvedValue = await this.resolveInputMappingValue(
            sourceValue,
            task.workflowRunId,
            task.workflowStepId || '',
            task._id,
            taskInputPayload
          );
          finalInputPayload[targetField] = resolvedValue;
        } else {
          // Pass through non-string values directly
          finalInputPayload[targetField] = sourceValue;
        }
      }
      console.log(`[WorkflowExecutionService] Resolved input payload: ${JSON.stringify(finalInputPayload).substring(0, 500)}`);
    } else if (inputMapping && Object.keys(inputMapping).length > 0) {
      // inputMapping exists but we don't have workflow context - log warning and use as-is
      console.warn(`[WorkflowExecutionService] Flow task ${taskId} has inputMapping but no workflow context, using raw values`);
      finalInputPayload = {};
      for (const [targetField, sourceTemplate] of Object.entries(inputMapping)) {
        if (!targetField) continue;
        // Try to use the value directly (without template resolution)
        finalInputPayload[targetField] = sourceTemplate;
      }
    } else if (task.metadata?.subflowInputPayload && Object.keys(task.metadata.subflowInputPayload as Record<string, unknown>).length > 0) {
      // No inputMapping but we have stored subflowInputPayload - use it
      finalInputPayload = task.metadata.subflowInputPayload as Record<string, unknown>;
    } else {
      // No inputMapping defined - pass through the task's input payload
      finalInputPayload = taskInputPayload || {};
    }

    // Check existing attempts
    const existingAttempts = task.flowConfig?.attempts || [];
    const attemptNumber = existingAttempts.length + 1;

    // Create the attempt record
    const now = new Date();
    const attempt: FlowAttempt = {
      attemptNumber,
      startedAt: now,
      status: 'running',
      inputPayload: finalInputPayload,
      resolvedInputMapping: task.flowConfig?.inputMapping || task.stepConfig?.inputMapping,
      targetWorkflowId: workflowId,
      targetWorkflowName: targetWorkflow.name,
    };

    // Update task status and add attempt record
    // Note: We need to handle the case where flowConfig or taskResult is null (not just undefined)
    // MongoDB $set can create nested paths for undefined fields, but not for null fields
    // So we set the entire objects when they might be null
    const taskResultUpdate = {
      current: {
        id: `flow-${task._id}-${Date.now()}`,
        status: 'running' as const,
        summary: `Starting subflow: ${targetWorkflow.name}`,
        executedAt: now,
        output: {
          targetWorkflow: { id: workflowId, name: targetWorkflow.name },
          inputPayload: finalInputPayload,
        },
      },
    };

    if (task.flowConfig === null || task.flowConfig === undefined) {
      // Initialize flowConfig and taskResult as objects
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            flowConfig: {
              workflowId,
              lastAttemptAt: now,
              attempts: [attempt],
            },
            taskResult: taskResultUpdate,
            status: 'in_progress' as TaskStatus,
            'metadata.targetWorkflowId': workflowId,
            'metadata.targetWorkflowName': targetWorkflow.name,
            'metadata.subflowInputPayload': finalInputPayload,
          },
        }
      );
    } else if (task.taskResult === null || task.taskResult === undefined) {
      // flowConfig exists, but taskResult needs to be initialized
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'in_progress' as TaskStatus,
            'metadata.targetWorkflowId': workflowId,
            'metadata.targetWorkflowName': targetWorkflow.name,
            'metadata.subflowInputPayload': finalInputPayload,
            'flowConfig.workflowId': workflowId,
            'flowConfig.lastAttemptAt': now,
            taskResult: taskResultUpdate,
          },
          $push: { 'flowConfig.attempts': attempt }
        }
      );
    } else {
      // Both flowConfig and taskResult exist, can use nested paths
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'in_progress' as TaskStatus,
            'metadata.targetWorkflowId': workflowId,
            'metadata.targetWorkflowName': targetWorkflow.name,
            'metadata.subflowInputPayload': finalInputPayload,
            'flowConfig.workflowId': workflowId,
            'flowConfig.lastAttemptAt': now,
            'taskResult.current': taskResultUpdate.current,
          },
          $push: { 'flowConfig.attempts': attempt }
        }
      );
    }

    try {
      // Find the parent workflow run context (if any)
      const parentRun = task.workflowRunId
        ? await this.workflowRuns.findOne({ _id: task.workflowRunId })
        : null;

      // Start the subflow
      const { run: subflowRun } = await this.startWorkflow(
        {
          workflowId,
          inputPayload: finalInputPayload,
          triggerTaskId: task._id.toString(),
          source: `flow-execute:${task._id}`,
          externalId: parentRun ? `${parentRun._id}:${task.workflowStepId}` : undefined,
        },
        parentRun?.createdById || null
      );

      // Update task with spawned run info
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            spawnedWorkflowRunId: subflowRun._id,
            'metadata.spawnedWorkflowRunId': subflowRun._id.toString(),
            'taskResult.current.spawnedWorkflow': {
              runId: subflowRun._id.toString(),
              status: 'running',
            },
            'taskResult.current.summary': `Subflow running: ${targetWorkflow.name}`,
            [`flowConfig.attempts.${attemptNumber - 1}.spawnedWorkflowRunId`]: subflowRun._id.toString(),
          }
        }
      );

      console.log(`[WorkflowExecutionService] Started subflow ${subflowRun._id} for flow task ${task._id}`);

      // Return updated attempt
      const updatedAttempt: FlowAttempt = {
        ...attempt,
        spawnedWorkflowRunId: subflowRun._id.toString(),
      };

      return { success: true, attempt: updatedAttempt };

    } catch (error) {
      console.error(`[WorkflowExecutionService] Failed to start subflow:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start subflow';
      const failedAt = new Date();

      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': errorMessage,
            'taskResult.current.status': 'failed' as const,
            'taskResult.current.completedAt': failedAt,
            'taskResult.current.summary': `Failed to start subflow: ${targetWorkflow.name}`,
            'taskResult.current.error': errorMessage,
            [`flowConfig.attempts.${attemptNumber - 1}.status`]: 'failed',
            [`flowConfig.attempts.${attemptNumber - 1}.completedAt`]: failedAt,
            [`flowConfig.attempts.${attemptNumber - 1}.errorMessage`]: errorMessage,
            [`flowConfig.attempts.${attemptNumber - 1}.durationMs`]: failedAt.getTime() - now.getTime(),
          }
        }
      );

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Retry a failed flow task.
   * This is a convenience wrapper around executeFlowTask that validates the task is in a failed state.
   *
   * @param taskId - The ID of the flow task
   * @param inputPayload - Optional override input payload
   */
  async retryFlowTask(
    taskId: string,
    inputPayload?: Record<string, unknown>
  ): Promise<{ success: boolean; attempt?: FlowAttempt; error?: string }> {
    console.log(`[WorkflowExecutionService] Retrying flow task ${taskId}`);

    const task = await this.tasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Allow retry from failed, pending, or on_hold status
    if (!['failed', 'pending', 'on_hold'].includes(task.status)) {
      return {
        success: false,
        error: `Cannot retry flow task in status "${task.status}". Must be failed, pending, or on_hold.`
      };
    }

    return this.executeFlowTask(taskId, inputPayload);
  }

  /**
   * Get the status of a flow task including its execution history.
   */
  async getFlowTaskStatus(taskId: string): Promise<{
    success: boolean;
    status?: {
      taskStatus: string;
      targetWorkflow?: { id: string; name: string };
      spawnedWorkflowRunId?: string;
      spawnedWorkflowStatus?: string;
      currentAttempt?: FlowAttempt;
      attemptCount: number;
      attempts: FlowAttempt[];
    };
    error?: string;
  }> {
    const task = await this.tasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const attempts = task.flowConfig?.attempts || [];
    const currentAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : undefined;

    // Get spawned workflow status if there's one
    let spawnedWorkflowStatus: string | undefined;
    if (task.spawnedWorkflowRunId) {
      const run = await this.workflowRuns.findOne({ _id: task.spawnedWorkflowRunId });
      spawnedWorkflowStatus = run?.status;
    }

    return {
      success: true,
      status: {
        taskStatus: task.status,
        targetWorkflow: task.flowConfig?.workflowId ? {
          id: task.flowConfig.workflowId,
          name: (task.metadata?.targetWorkflowName as string) || 'Unknown',
        } : undefined,
        spawnedWorkflowRunId: task.spawnedWorkflowRunId?.toString(),
        spawnedWorkflowStatus,
        currentAttempt,
        attemptCount: attempts.length,
        attempts,
      }
    };
  }

  /**
   * Recovery method: Check for stuck flow tasks (in_progress but subflow is completed/failed)
   * and complete them properly.
   */
  async recoverStuckFlowTasks(): Promise<{
    checked: number;
    recovered: number;
    errors: string[];
  }> {
    console.log('[WorkflowExecutionService] Running stuck flow task recovery...');

    const result = { checked: 0, recovered: 0, errors: [] as string[] };

    // Find flow tasks that are in_progress but have a spawned workflow
    const stuckCandidates = await this.tasks.find({
      status: 'in_progress',
      spawnedWorkflowRunId: { $exists: true, $ne: null },
      $or: [
        { taskType: 'flow' },
        { 'stepConfig.stepType': 'flow' },
        { 'flowConfig.workflowId': { $exists: true } },
      ]
    }).toArray();

    result.checked = stuckCandidates.length;
    console.log(`[WorkflowExecutionService] Found ${stuckCandidates.length} flow tasks in_progress to check`);

    for (const task of stuckCandidates) {
      try {
        if (!task.spawnedWorkflowRunId) continue;

        const subflowRun = await this.workflowRuns.findOne({ _id: task.spawnedWorkflowRunId });
        if (!subflowRun) {
          console.log(`[WorkflowExecutionService] Subflow run ${task.spawnedWorkflowRunId} not found for task ${task._id}`);
          continue;
        }

        // If subflow is still running, nothing to do
        if (subflowRun.status === 'running') {
          continue;
        }

        console.log(`[WorkflowExecutionService] Found stuck flow task ${task._id} - subflow ${subflowRun._id} is ${subflowRun.status}`);

        if (subflowRun.status === 'completed') {
          // Complete the flow task with the subflow output
          const outputPayload = subflowRun.outputPayload || {};
          const now = new Date();

          await this.tasks.updateOne(
            { _id: task._id },
            {
              $set: {
                status: 'completed' as TaskStatus,
                workflowResult: {
                  status: 'completed',
                  outputPayload,
                  completedAt: now,
                },
                'metadata.output': outputPayload,
                'metadata.subflowCompleted': true,
                'metadata.subflowCompletedAt': now,
                'metadata.recoveredAt': now,
                updatedAt: now,
                'taskResult.current.status': 'success',
                'taskResult.current.completedAt': now,
                'taskResult.current.summary': 'Subflow completed (recovered)',
                'taskResult.current.spawnedWorkflow.status': 'completed',
                'taskResult.current.spawnedWorkflow.outputPayload': outputPayload,
              }
            }
          );

          // Publish event to advance parent workflow
          const updatedTask = await this.tasks.findOne({ _id: task._id });
          if (updatedTask) {
            await eventBus.publish({
              type: 'task.status.changed',
              taskId: updatedTask._id,
              task: updatedTask,
              changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'completed' }],
              actorId: null,
              actorType: 'system',
            });
          }

          result.recovered++;
          console.log(`[WorkflowExecutionService] Recovered flow task ${task._id} - marked as completed`);

        } else if (subflowRun.status === 'failed' || subflowRun.status === 'cancelled') {
          // Fail the flow task
          const now = new Date();
          const errorMessage = subflowRun.error || `Subflow ${subflowRun.status}`;

          await this.tasks.updateOne(
            { _id: task._id },
            {
              $set: {
                status: 'failed' as TaskStatus,
                workflowResult: {
                  status: 'failed',
                  error: errorMessage,
                  completedAt: now,
                },
                'metadata.error': errorMessage,
                'metadata.subflowFailed': true,
                'metadata.subflowFailedAt': now,
                'metadata.recoveredAt': now,
                updatedAt: now,
                'taskResult.current.status': 'failed',
                'taskResult.current.completedAt': now,
                'taskResult.current.summary': `Subflow ${subflowRun.status} (recovered)`,
                'taskResult.current.error': errorMessage,
                'taskResult.current.spawnedWorkflow.status': subflowRun.status,
              }
            }
          );

          // Publish event
          const updatedTask = await this.tasks.findOne({ _id: task._id });
          if (updatedTask) {
            await eventBus.publish({
              type: 'task.status.changed',
              taskId: updatedTask._id,
              task: updatedTask,
              changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'failed' }],
              actorId: null,
              actorType: 'system',
            });
          }

          result.recovered++;
          console.log(`[WorkflowExecutionService] Recovered flow task ${task._id} - marked as failed`);
        }
      } catch (error) {
        const errorMsg = `Failed to recover task ${task._id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(`[WorkflowExecutionService] ${errorMsg}`);
      }
    }

    console.log(`[WorkflowExecutionService] Recovery complete: ${result.recovered}/${result.checked} tasks recovered`);
    return result;
  }

  // ============================================================================
  // Rerun Failed Workflow
  // ============================================================================

  /**
   * Rerun a failed workflow run.
   * Options:
   * - fromFailedStep (default): Restart from the step that failed
   * - fromStart: Restart the entire workflow from the beginning
   *
   * When rerunning from the failed step:
   * - The failed step's task is reset to pending
   * - The workflow run status is set back to running
   * - The workflow will continue from where it failed
   *
   * When rerunning from start:
   * - All tasks are reset or a new workflow run is created
   */
  async rerunWorkflowRun(
    runId: string,
    options: {
      fromStart?: boolean;
      actorId?: ObjectId;
    } = {}
  ): Promise<{
    success: boolean;
    workflowRunId: string;
    message: string;
    rerunFromStep?: string;
    resetTaskIds?: string[];
    supersededRunId?: string;
    error?: string;
  }> {
    const { fromStart = false, actorId } = options;
    const now = new Date();
    const _id = new ObjectId(runId);

    console.log(`[WorkflowExecutionService] Rerunning workflow run ${runId}, fromStart=${fromStart}`);

    // Get the workflow run
    const run = await this.workflowRuns.findOne({ _id });
    if (!run) {
      return { success: false, workflowRunId: runId, message: 'Workflow run not found', error: 'Workflow run not found' };
    }

    // Only allow rerunning failed, cancelled, or paused workflows
    if (!['failed', 'cancelled', 'paused'].includes(run.status)) {
      return {
        success: false,
        workflowRunId: runId,
        message: `Cannot rerun workflow with status "${run.status}". Only failed, paused, or cancelled workflows can be rerun.`,
        error: `Invalid status: ${run.status}`
      };
    }

    // Check if this run has already been superseded (already rerun with fromStart)
    if (run.supersededBy) {
      return {
        success: false,
        workflowRunId: runId,
        message: `This workflow run has already been rerun. See workflow run ${run.supersededBy.toString()} for the new run.`,
        error: 'Already superseded'
      };
    }

    // Get the workflow definition
    const workflow = await this.workflows.findOne({ _id: run.workflowId });
    if (!workflow) {
      return { success: false, workflowRunId: runId, message: 'Workflow definition not found', error: 'Workflow not found' };
    }

    if (fromStart) {
      // Option 1: Start a completely new workflow run with the same input
      // This is cleaner - creates a fresh run rather than resetting everything
      const newRunResult = await this.startWorkflow({
        workflowId: workflow._id.toString(),
        inputPayload: run.inputPayload,
        taskDefaults: run.taskDefaults ? {
          assigneeId: run.taskDefaults.assigneeId?.toString(),
          urgency: run.taskDefaults.urgency,
          tags: run.taskDefaults.tags,
          dueOffsetHours: run.taskDefaults.dueOffsetHours,
        } : undefined,
        executionOptions: run.executionOptions,
        externalId: run.externalId,
        source: run.source,
      }, actorId);

      // Mark old run as superseded
      await this.workflowRuns.updateOne(
        { _id },
        {
          $set: {
            supersededBy: newRunResult.run._id,
            supersededAt: now,
          }
        }
      );

      // Mark new run as superseding the old one
      await this.workflowRuns.updateOne(
        { _id: newRunResult.run._id },
        {
          $set: {
            supersedes: _id,
          }
        }
      );

      return {
        success: true,
        workflowRunId: newRunResult.run._id.toString(),
        message: `Started new workflow run ${newRunResult.run._id} (original run ${runId} marked as superseded)`,
        rerunFromStep: workflow.steps[0]?.id,
        supersededRunId: runId,
      };
    }

    // Option 2: Rerun from the failed/paused step
    // Find the step that caused the workflow to stop
    const stoppedStepId = run.failedStepId || run.pausedStepId;
    if (!stoppedStepId) {
      return {
        success: false,
        workflowRunId: runId,
        message: 'No failed or paused step recorded. Consider using fromStart=true to restart the entire workflow.',
        error: 'No failedStepId or pausedStepId'
      };
    }

    // Find the task for the stopped step
    const stoppedTask = await this.tasks.findOne({
      workflowRunId: _id,
      workflowStepId: stoppedStepId,
    });

    if (!stoppedTask) {
      return {
        success: false,
        workflowRunId: runId,
        message: `Task for step ${stoppedStepId} not found. Consider using fromStart=true.`,
        error: 'Stopped step task not found'
      };
    }

    // Alias for readability in the rest of the function
    const failedTask = stoppedTask;
    const failedStepId = stoppedStepId;

    const resetTaskIds: string[] = [];

    // Archive the current result if it exists
    if (failedTask.taskResult?.current) {
      const history = failedTask.taskResult.history || [];
      history.unshift(failedTask.taskResult.current);
      const trimmedHistory = history.slice(0, 10); // Keep last 10 results
      await this.tasks.updateOne(
        { _id: failedTask._id },
        {
          $set: { 'taskResult.history': trimmedHistory },
          $unset: { 'taskResult.current': '' }
        }
      );
    }

    // Reset the failed/paused task to pending
    await this.tasks.updateOne(
      { _id: failedTask._id },
      {
        $set: {
          status: 'pending' as TaskStatus,
          updatedAt: now,
        },
        $unset: {
          'metadata.error': '',
          'metadata.failedAt': '',
          'metadata.escalatedAt': '',
          'metadata.escalationReason': '',
          'metadata.nextAction': '',
          'metadata.nextActionReason': '',
        }
      }
    );
    resetTaskIds.push(failedTask._id.toString());

    // Reset workflow run status to running
    await this.workflowRuns.updateOne(
      { _id },
      {
        $set: {
          status: 'running' as WorkflowRunStatus,
          updatedAt: now,
        },
        $unset: {
          error: '',
          failedStepId: '',
          pausedStepId: '',
          pausedAt: '',
          completedAt: '',
        },
        $addToSet: {
          currentStepIds: failedStepId,
        },
        $pull: {
          completedStepIds: failedStepId,
        }
      }
    );

    // Also reset the root task if it was marked as failed or on_hold
    if (run.rootTaskId) {
      const rootTask = await this.tasks.findOne({ _id: run.rootTaskId });
      if (rootTask && ['failed', 'on_hold'].includes(rootTask.status)) {
        await this.tasks.updateOne(
          { _id: run.rootTaskId },
          {
            $set: {
              status: 'in_progress' as TaskStatus,
              updatedAt: now,
            },
            $unset: {
              'metadata.pausedReason': '',
            }
          }
        );
        resetTaskIds.push(run.rootTaskId.toString());
      }
    }

    // Publish task status changed event to trigger re-execution
    const oldStatus = stoppedTask.status;
    const updatedTask = await this.tasks.findOne({ _id: failedTask._id });
    if (updatedTask) {
      await publishTaskEvent('task.status.changed', updatedTask, {
        changes: [{ field: 'status', oldValue: oldStatus, newValue: 'pending' }],
        actorId: actorId ?? null,
        actorType: actorId ? 'user' : 'system',
      });
    }

    // Publish workflow rerun event
    const updatedRun = await this.workflowRuns.findOne({ _id });
    if (updatedRun) {
      await this.publish({
        id: this.generateEventId(),
        type: 'workflow.run.started', // Reuse started event type
        workflowRunId: _id,
        workflowRun: updatedRun,
        actorId,
        actorType: actorId ? 'user' : 'system',
        timestamp: now,
      });
    }

    console.log(`[WorkflowExecutionService] Rerun workflow ${runId} from step ${failedStepId}, reset ${resetTaskIds.length} tasks`);

    return {
      success: true,
      workflowRunId: runId,
      message: `Workflow rerun from step "${failedStepId}". Task ${failedTask._id} reset to pending.`,
      rerunFromStep: failedStepId,
      resetTaskIds,
    };
  }

  /**
   * Retry a failed task, optionally resetting related workflow state.
   * This is a simpler operation than full workflow rerun - just resets the task.
   */
  async retryFailedTask(
    taskId: ObjectId | string,
    options: {
      actorId?: ObjectId;
      clearError?: boolean;
    } = {}
  ): Promise<{
    success: boolean;
    taskId: string;
    message: string;
    workflowResumed?: boolean;
    error?: string;
  }> {
    const { actorId, clearError = true } = options;
    const now = new Date();
    const _taskId = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;

    const task = await this.tasks.findOne({ _id: _taskId });
    if (!task) {
      return { success: false, taskId: _taskId.toString(), message: 'Task not found', error: 'Task not found' };
    }

    // Only retry failed or on_hold tasks
    if (!['failed', 'on_hold'].includes(task.status)) {
      return {
        success: false,
        taskId: _taskId.toString(),
        message: `Cannot retry task with status "${task.status}". Only failed or on_hold tasks can be retried.`,
        error: `Invalid status: ${task.status}`
      };
    }

    // Archive current result
    if (task.taskResult?.current) {
      const history = task.taskResult.history || [];
      history.unshift(task.taskResult.current);
      await this.tasks.updateOne(
        { _id: _taskId },
        {
          $set: { 'taskResult.history': history.slice(0, 10) },
          $unset: { 'taskResult.current': '' }
        }
      );
    }

    // Build update
    const updateSet: Record<string, unknown> = {
      status: 'pending' as TaskStatus,
      updatedAt: now,
    };

    // Reset the task
    if (clearError) {
      await this.tasks.updateOne(
        { _id: _taskId },
        {
          $set: updateSet,
          $unset: {
            'metadata.error': '',
            'metadata.failedAt': '',
            'metadata.escalatedAt': '',
            'metadata.escalationReason': '',
          },
        }
      );
    } else {
      await this.tasks.updateOne(
        { _id: _taskId },
        { $set: updateSet }
      );
    }

    let workflowResumed = false;

    // If this is a workflow task, also reset the workflow run if it failed
    if (task.workflowRunId) {
      const run = await this.workflowRuns.findOne({ _id: task.workflowRunId });
      if (run && run.status === 'failed' && run.failedStepId === task.workflowStepId) {
        await this.workflowRuns.updateOne(
          { _id: task.workflowRunId },
          {
            $set: {
              status: 'running' as WorkflowRunStatus,
              updatedAt: now,
            },
            $unset: {
              error: '',
              failedStepId: '',
              completedAt: '',
            },
            $addToSet: {
              currentStepIds: task.workflowStepId,
            }
          }
        );
        workflowResumed = true;

        // Also reset root task if failed
        if (run.rootTaskId) {
          await this.tasks.updateOne(
            { _id: run.rootTaskId, status: 'failed' },
            { $set: { status: 'in_progress' as TaskStatus, updatedAt: now } }
          );
        }
      }
    }

    // Publish task status changed event
    const updatedTask = await this.tasks.findOne({ _id: _taskId });
    if (updatedTask) {
      await publishTaskEvent('task.status.changed', updatedTask, {
        changes: [{ field: 'status', oldValue: task.status, newValue: 'pending' }],
        actorId: actorId ?? null,
        actorType: actorId ? 'user' : 'system',
      });
    }

    return {
      success: true,
      taskId: _taskId.toString(),
      message: workflowResumed
        ? `Task reset to pending and workflow run resumed`
        : `Task reset to pending`,
      workflowResumed,
    };
  }
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
