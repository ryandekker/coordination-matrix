import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';
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
  StartWorkflowInput,
  TaskEvent,
} from '../types/index.js';

// Environment config for webhook URLs
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

type WorkflowRunEventHandler = (event: WorkflowRunEvent) => void | Promise<void>;

/**
 * Resolves template variables in a string.
 * Supported variables:
 *   {{systemWebhookUrl}} - Base webhook URL for callbacks
 *   {{callbackSecret}} - Task-specific callback secret
 *   {{workflowRunId}} - Current workflow run ID
 *   {{stepId}} - Current step ID
 *   {{taskId}} - Current task ID
 *   {{input.path.to.value}} - Value from input payload
 */
function resolveTemplateVariables(
  template: string,
  context: {
    workflowRunId: ObjectId;
    stepId: string;
    taskId?: ObjectId;
    callbackSecret?: string;
    inputPayload?: Record<string, unknown>;
  }
): string {
  let result = template;

  // Replace system variables
  // {{systemWebhookUrl}} generates the full callback URL with workflowRunId and stepId embedded
  const callbackUrl = `${BASE_URL}/api/workflow-runs/${context.workflowRunId}/callback/${context.stepId}`;
  result = result.replace(/\{\{systemWebhookUrl\}\}/g, callbackUrl);
  result = result.replace(/\{\{workflowRunId\}\}/g, context.workflowRunId.toString());
  result = result.replace(/\{\{stepId\}\}/g, context.stepId);

  if (context.taskId) {
    result = result.replace(/\{\{taskId\}\}/g, context.taskId.toString());
  }

  if (context.callbackSecret) {
    result = result.replace(/\{\{callbackSecret\}\}/g, context.callbackSecret);
  }

  // Replace input payload variables ({{input.path.to.value}})
  if (context.inputPayload) {
    result = result.replace(/\{\{input\.([^}]+)\}\}/g, (_, path) => {
      const value = getValueByPathStatic(context.inputPayload!, path);
      return value !== undefined ? String(value) : '';
    });
  }

  return result;
}

/**
 * Static version of getValueByPath for use outside the class
 */
function getValueByPathStatic(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj || !path) return undefined;

  // Remove leading $. or . if present
  const cleanPath = path.replace(/^\$?\.?/, '');
  const parts = cleanPath.split('.');

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * WorkflowExecutionService orchestrates workflow execution.
 *
 * It listens for task events and advances workflows through their steps,
 * handling different step types (foreach, join, decision, etc.)
 */
class WorkflowExecutionService {
  private initialized = false;
  private handlers: Map<string, Set<WorkflowRunEventHandler>> = new Map();

  // Track processed events to prevent duplicate handling
  private processedEvents = new Set<string>();

  initialize(): void {
    if (this.initialized) return;

    // Subscribe to task status changes to advance workflows
    eventBus.subscribe('task.status.changed', async (event: TaskEvent) => {
      await this.safeHandleTaskEvent(event);
    });

    // Also listen for general task updates (metadata changes, etc.)
    eventBus.subscribe('task.updated', async (event: TaskEvent) => {
      // Only process if status changed to completed/failed
      const statusChange = event.changes?.find(c => c.field === 'status');
      if (statusChange && ['completed', 'failed'].includes(statusChange.newValue as string)) {
        await this.safeHandleTaskEvent(event);
      }
    });

    // Clean up old event IDs periodically (every 5 minutes)
    setInterval(() => {
      this.processedEvents.clear();
    }, 5 * 60 * 1000);

    this.initialized = true;
    console.log('[WorkflowExecutionService] Initialized and listening for task events');
  }

  /**
   * Wrapper that adds error handling and deduplication to event processing
   */
  private async safeHandleTaskEvent(event: TaskEvent): Promise<void> {
    // Create a unique key for this event to prevent duplicate processing
    const eventKey = `${event.task._id}-${event.task.status}-${event.task.updatedAt}`;

    if (this.processedEvents.has(eventKey)) {
      console.log(`[WorkflowExecutionService] Skipping duplicate event for task ${event.task._id}`);
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
  }

  private generateEventId(): string {
    return `wevt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateSecret(): string {
    return `wfsec_${crypto.randomBytes(24).toString('hex')}`;
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

    // Get workflow definition
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

    // Normalize task defaults (convert string assigneeId to ObjectId)
    const taskDefaults = input.taskDefaults ? {
      assigneeId: input.taskDefaults.assigneeId
        ? new ObjectId(input.taskDefaults.assigneeId)
        : undefined,
      urgency: input.taskDefaults.urgency,
      tags: input.taskDefaults.tags,
      dueOffsetHours: input.taskDefaults.dueOffsetHours,
    } : undefined;

    // Create workflow run
    const run: Omit<WorkflowRun, '_id'> = {
      workflowId,
      status: 'running',
      currentStepIds: [],
      completedStepIds: [],
      inputPayload: input.inputPayload,
      taskDefaults,
      executionOptions: input.executionOptions,
      externalId: input.externalId,
      source: input.source,
      callbackSecret: this.generateSecret(),
      createdById: actorId,
      createdAt: now,
      startedAt: now,
    };

    const runResult = await this.workflowRuns.insertOne(run as WorkflowRun);
    const createdRun = { ...run, _id: runResult.insertedId } as WorkflowRun;

    // Create root task for the workflow run
    const rootTask = await this.createRootTask(createdRun, workflow, actorId);

    // Update run with root task ID
    await this.workflowRuns.updateOne(
      { _id: createdRun._id },
      { $set: { rootTaskId: rootTask._id } }
    );
    createdRun.rootTaskId = rootTask._id;

    // Publish event
    await this.publish({
      id: this.generateEventId(),
      type: 'workflow.run.started',
      workflowRunId: createdRun._id,
      workflowRun: createdRun,
      actorId,
      actorType: 'user',
      timestamp: now,
    });

    // Start the first step
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

    const task: Omit<Task, '_id'> = {
      title: `Workflow: ${workflow.name}`,
      summary: workflow.description,
      status: 'in_progress',
      parentId: null,
      workflowId: workflow._id,
      workflowRunId: run._id,
      taskType: 'standard',
      executionMode: 'automated',
      createdById: actorId,
      createdAt: now,
      updatedAt: now,
      metadata: {
        workflowRunId: run._id.toString(),
        inputPayload: run.inputPayload,
        externalId: run.externalId,
        source: run.source,
      },
      // Apply task defaults from workflow run
      ...this.applyTaskDefaults(run, now),
    };

    const result = await this.tasks.insertOne(task as Task);
    return { ...task, _id: result.insertedId } as Task;
  }

  /**
   * Apply task defaults from the workflow run configuration
   */
  private applyTaskDefaults(
    run: WorkflowRun,
    now: Date
  ): Partial<Task> {
    const defaults: Partial<Task> = {};

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

    // Update run with current step
    await this.workflowRuns.updateOne(
      { _id: run._id },
      { $addToSet: { currentStepIds: step.id } }
    );

    // Create task for this step
    const task = await this.createTaskForStep(run, workflow, step, parentTask, inputPayload);

    // Publish step started event
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

    // Handle step type-specific execution
    switch (step.stepType) {
      case 'trigger':
        // Trigger steps complete immediately - they just initiate the workflow
        await this.tasks.updateOne(
          { _id: task._id },
          { $set: { status: 'completed' as TaskStatus } }
        );
        break;

      case 'agent':
      case 'manual':
        // These wait for external completion (AI agent or human)
        // Task is already created, just wait for status change
        break;

      case 'external':
        // External steps - make outbound HTTP call and wait for callback
        await this.executeExternal(run, workflow, step, task, inputPayload);
        break;

      case 'webhook':
        // Webhook step - outbound HTTP call with retry logic
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

      case 'subflow':
        // TODO: Implement subflow execution
        console.log('[WorkflowExecutionService] Subflow execution not yet implemented');
        break;
    }

    return task;
  }

  private async createTaskForStep(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    parentTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<Task> {
    const now = new Date();

    // Map step type to task type
    const taskType = this.mapStepTypeToTaskType(step.stepType);
    const executionMode = this.mapStepTypeToExecutionMode(step.stepType);

    // Determine initial status
    let initialStatus: TaskStatus = 'pending';
    if (step.stepType === 'foreach' || step.stepType === 'join') {
      initialStatus = 'waiting';
    } else if (step.stepType === 'decision') {
      initialStatus = 'in_progress';
    }

    // Apply run-level task defaults, then step-specific overrides
    const runDefaults = this.applyTaskDefaults(run, now);

    const task: Omit<Task, '_id'> = {
      title: step.name,
      summary: step.description,
      extraPrompt: step.additionalInstructions,
      status: initialStatus,
      parentId: parentTask._id,
      workflowId: workflow._id,
      workflowRunId: run._id,
      workflowStepId: step.id,
      workflowStage: step.name,
      taskType,
      executionMode,
      // Apply run defaults first, then step-specific assignee overrides
      ...runDefaults,
      assigneeId: step.defaultAssigneeId
        ? new ObjectId(step.defaultAssigneeId)
        : runDefaults.assigneeId || null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        stepId: step.id,
        stepType: step.stepType,
        inputPayload,
      },
    };

    // Add foreach config if applicable
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

    // Add external config if applicable
    if (step.stepType === 'external') {
      task.externalConfig = {
        callbackSecret: this.generateSecret(),
      };
    }

    const result = await this.tasks.insertOne(task as Task);
    return { ...task, _id: result.insertedId } as Task;
  }

  private mapStepTypeToTaskType(stepType: string): TaskType {
    // 1:1 mapping between step types and task types
    const mapping: Record<string, TaskType> = {
      'trigger': 'trigger',
      'agent': 'agent',
      'manual': 'manual',
      'external': 'external',
      'webhook': 'webhook',
      'decision': 'decision',
      'foreach': 'foreach',
      'join': 'join',
      'subflow': 'subflow',
    };
    return mapping[stepType] || 'standard';
  }

  private mapStepTypeToExecutionMode(stepType: string): ExecutionMode {
    const mapping: Record<string, ExecutionMode> = {
      'trigger': 'immediate',
      'agent': 'automated',
      'manual': 'manual',
      'external': 'external_callback',
      'webhook': 'automated',
      'decision': 'immediate',
      'foreach': 'immediate',
      'join': 'immediate',
      'subflow': 'automated',
    };
    return mapping[stepType] || 'automated';
  }

  // ============================================================================
  // External Step Execution
  // ============================================================================

  private async executeExternal(
    run: WorkflowRun,
    _workflow: Workflow,
    step: WorkflowStep,
    externalTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    const config = step.externalConfig;
    const callbackSecret = externalTask.externalConfig?.callbackSecret || this.generateSecret();

    // Set task to in_progress status (waiting for external callback)
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

    // If no endpoint configured, just wait for callback
    if (!config?.endpoint) {
      console.log(`[WorkflowExecutionService] External step ${step.id} has no endpoint - waiting for manual callback`);
      return;
    }

    // Resolve template variables in endpoint and payload
    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: externalTask._id,
      callbackSecret,
      inputPayload,
    };

    const endpoint = resolveTemplateVariables(config.endpoint, templateContext);

    // Build request payload
    let requestBody: Record<string, unknown> = {};
    if (config.payloadTemplate) {
      try {
        const resolvedPayload = resolveTemplateVariables(config.payloadTemplate, templateContext);
        requestBody = JSON.parse(resolvedPayload);
      } catch (e) {
        console.error(`[WorkflowExecutionService] Failed to parse payload template:`, e);
        requestBody = { ...inputPayload };
      }
    } else {
      // Default payload includes callback info
      requestBody = {
        ...inputPayload,
        _callback: {
          url: `${BASE_URL}/api/workflows/callback`,
          workflowRunId: run._id.toString(),
          stepId: step.id,
          secret: callbackSecret,
        },
      };
    }

    // Build headers with template resolution
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        headers[key] = resolveTemplateVariables(value, templateContext);
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

      // Store response in task metadata
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
        // Don't fail the task - still wait for callback in case of async processing
      } else {
        console.log(`[WorkflowExecutionService] External call succeeded, waiting for callback`);

        // If the response includes a count (for foreach scenarios), store it
        if (config.responseMapping) {
          const mappedData: Record<string, unknown> = {};
          for (const [targetPath, sourcePath] of Object.entries(config.responseMapping)) {
            const value = getValueByPathStatic(responseData, sourcePath);
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
      // Still waiting for callback - don't fail the task
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

    // Build webhook configuration for the task
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

    // Update the task with webhook config and set to in_progress
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

    // Execute the webhook call
    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: webhookTask._id,
      inputPayload,
    };

    try {
      const resolvedUrl = resolveTemplateVariables(config.url, templateContext);
      let resolvedBody: string | undefined;

      if (config.bodyTemplate) {
        resolvedBody = resolveTemplateVariables(config.bodyTemplate, templateContext);
      } else if (inputPayload) {
        resolvedBody = JSON.stringify(inputPayload);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      // Resolve template variables in headers
      for (const [key, value] of Object.entries(headers)) {
        headers[key] = resolveTemplateVariables(value, templateContext);
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

      // Record the attempt
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
    if (!step.itemsPath) {
      console.warn(`[WorkflowExecutionService] Foreach step ${step.id} has no itemsPath`);
      return;
    }

    // Get items from input payload using simple path extraction
    const items = this.getValueByPath(inputPayload, step.itemsPath);

    if (!Array.isArray(items)) {
      console.warn(`[WorkflowExecutionService] Items at ${step.itemsPath} is not an array`);
      await this.tasks.updateOne(
        { _id: foreachTask._id },
        {
          $set: {
            status: 'completed' as TaskStatus,
            'batchCounters.expectedCount': 0,
          }
        }
      );
      return;
    }

    const maxItems = step.maxItems || 100;
    const itemsToProcess = items.slice(0, maxItems);

    // Update foreach task with expected count (both top-level and in batchCounters)
    await this.tasks.updateOne(
      { _id: foreachTask._id },
      {
        $set: {
          expectedQuantity: itemsToProcess.length,  // Top-level field for easy access
          'batchCounters.expectedCount': itemsToProcess.length,
          'metadata.itemCount': itemsToProcess.length,
        },
      }
    );

    // Find the next step(s) inside the foreach (steps that this foreach connects to)
    const nextStepId = step.connections?.[0]?.targetStepId;
    const nextStep = nextStepId ? workflow.steps.find(s => s.id === nextStepId) : null;

    if (!nextStep) {
      console.warn(`[WorkflowExecutionService] Foreach step ${step.id} has no connected steps`);
      return;
    }

    // Create child tasks for each item
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

  private getValueByPath(obj: Record<string, unknown> | undefined, path: string): unknown {
    if (!obj || !path) return undefined;

    // Remove leading $. or . if present
    const cleanPath = path.replace(/^\$?\.?/, '');
    const parts = cleanPath.split('.');

    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
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
    // Find the task to join on using awaitStepId if specified
    let foreachTask: Task | null = null;

    if (step.awaitStepId) {
      // Use explicit awaitStepId to find the task to join on
      foreachTask = await this.tasks.findOne({
        workflowRunId: run._id,
        workflowStepId: step.awaitStepId,
      });
      console.log(`[WorkflowExecutionService] Join using awaitStepId: ${step.awaitStepId}`);
    } else {
      // Fall back to finding the most recent foreach task in this run
      foreachTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'foreach',
        status: { $in: ['waiting', 'in_progress'] },
      });
    }

    // Determine expected count - can come from:
    // 1. Step config (expectedCountPath to look up from previous step)
    // 2. Join config static value
    // 3. Foreach task's batchCounters
    let expectedCount: number | undefined;

    // Check if we should get expected count from a previous step's response
    if (step.expectedCountPath) {
      // Look for the most recent external task to get count from its response
      const externalTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'external',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (externalTask?.metadata) {
        // Try to get from mappedResponse first, then from callbackPayload
        const mappedResponse = externalTask.metadata.mappedResponse as Record<string, unknown> | undefined;
        const callbackPayload = externalTask.metadata.callbackPayload as Record<string, unknown> | undefined;
        const externalResponse = externalTask.metadata.externalCallResponse as Record<string, unknown> | undefined;

        const countFromMapped = mappedResponse ? getValueByPathStatic(mappedResponse, step.expectedCountPath) : undefined;
        const countFromCallback = callbackPayload ? getValueByPathStatic(callbackPayload, step.expectedCountPath) : undefined;
        const countFromResponse = externalResponse ? getValueByPathStatic(externalResponse, step.expectedCountPath) : undefined;

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

    // Get minSuccessPercent from joinBoundary, step config, or default to 100
    const minSuccessPercent = step.joinBoundary?.minPercent ?? step.minSuccessPercent ?? 100;

    // Determine the scope based on configuration
    const scope = step.awaitStepId ? 'step_tasks' : 'children';

    // Store reference to foreach task and join config with full boundary settings
    await this.tasks.updateOne(
      { _id: joinTask._id },
      {
        $set: {
          'joinConfig.awaitStepId': step.awaitStepId,
          'joinConfig.awaitTaskId': foreachTask._id,
          'joinConfig.scope': scope,
          'joinConfig.minSuccessPercent': minSuccessPercent,
          'joinConfig.expectedCount': expectedCount,
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

    // Check if join condition is met
    await this.checkJoinCondition(joinTask._id, foreachTask._id);
  }

  private async checkJoinCondition(joinTaskId: ObjectId, foreachTaskId: ObjectId): Promise<boolean> {
    const foreachTask = await this.tasks.findOne({ _id: foreachTaskId });
    if (!foreachTask || !foreachTask.batchCounters) return false;

    // Get the join task to read its config
    const joinTask = await this.tasks.findOne({ _id: joinTaskId });
    if (!joinTask) return false;

    const children = await this.tasks.find({ parentId: foreachTaskId }).toArray();
    const completedCount = children.filter(c => c.status === 'completed').length;
    const failedCount = children.filter(c => c.status === 'failed').length;
    const totalDone = completedCount + failedCount;

    // Update foreach counters
    await this.tasks.updateOne(
      { _id: foreachTaskId },
      {
        $set: {
          'batchCounters.processedCount': completedCount,
          'batchCounters.failedCount': failedCount,
        },
      }
    );

    // Determine expected count - prefer joinConfig.expectedCount if set, else use batchCounters
    const expectedCount = joinTask.joinConfig?.expectedCount ?? foreachTask.batchCounters.expectedCount;

    // Get minSuccessPercent from joinConfig, default to 100
    const minSuccessPercent = joinTask.joinConfig?.minSuccessPercent ?? 100;

    // Calculate the required number of completed tasks based on percentage
    const requiredSuccessCount = Math.ceil((expectedCount * minSuccessPercent) / 100);

    // Calculate current success percentage
    const currentSuccessPercent = expectedCount > 0 ? (completedCount / expectedCount) * 100 : 0;

    console.log(`[WorkflowExecutionService] Join check: ${completedCount}/${expectedCount} completed (${currentSuccessPercent.toFixed(1)}%), need ${minSuccessPercent}% (${requiredSuccessCount} tasks)`);

    // Check if we've met the success threshold
    // We can complete the join if:
    // 1. We've achieved the required success percentage, OR
    // 2. All tasks are done (even if below threshold - we fail gracefully)
    const thresholdMet = completedCount >= requiredSuccessCount;
    const allDone = totalDone >= expectedCount;

    if (thresholdMet || allDone) {
      // Aggregate results from completed tasks
      const results = children
        .filter(c => c.status === 'completed')
        .map(c => c.metadata);

      const joinStatus: TaskStatus = thresholdMet ? 'completed' : 'failed';
      const statusReason = thresholdMet
        ? `Success threshold met: ${currentSuccessPercent.toFixed(1)}% >= ${minSuccessPercent}%`
        : `Success threshold not met: ${currentSuccessPercent.toFixed(1)}% < ${minSuccessPercent}%`;

      await this.tasks.updateOne(
        { _id: joinTaskId },
        {
          $set: {
            status: joinStatus,
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

      // Complete the foreach task
      await this.tasks.updateOne(
        { _id: foreachTaskId },
        { $set: { status: 'completed' as TaskStatus } }
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
    // Evaluate conditions and pick the right branch
    let selectedConnection = step.connections?.find(conn => {
      if (!conn.condition) return false;
      return this.evaluateCondition(conn.condition, inputPayload);
    });

    // Fall back to default connection
    if (!selectedConnection && step.defaultConnection) {
      selectedConnection = { targetStepId: step.defaultConnection };
    }

    // Or take first connection without condition
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

    // Record decision and complete
    await this.tasks.updateOne(
      { _id: decisionTask._id },
      {
        $set: {
          status: 'completed' as TaskStatus,
          decisionResult: selectedConnection.targetStepId,
          'metadata.selectedPath': selectedConnection.targetStepId,
          'metadata.condition': selectedConnection.condition,
        },
      }
    );

    // Execute the selected step
    const nextStep = workflow.steps.find(s => s.id === selectedConnection!.targetStepId);
    if (nextStep) {
      const parentTask = await this.tasks.findOne({ _id: decisionTask.parentId! });
      if (parentTask) {
        await this.executeStep(run, workflow, nextStep, parentTask, inputPayload);
      }
    }
  }

  private evaluateCondition(condition: string, payload?: Record<string, unknown>): boolean {
    if (!condition || !payload) return false;

    // Simple condition evaluation: "field:value" or "field:value1,value2"
    const [field, values] = condition.split(':');
    if (!field || !values) return false;

    const actualValue = this.getValueByPath(payload, field);
    const expectedValues = values.split(',').map(v => v.trim());

    return expectedValues.includes(String(actualValue));
  }

  // ============================================================================
  // Task Event Handler
  // ============================================================================

  private async onTaskStatusChanged(event: TaskEvent): Promise<void> {
    const task = event.task;

    console.log(`[WorkflowExecutionService] onTaskStatusChanged: task=${task._id}, status=${task.status}, workflowRunId=${task.workflowRunId}, workflowStepId=${task.workflowStepId}`);

    // Only process workflow tasks
    if (!task.workflowRunId || !task.workflowStepId) {
      console.log(`[WorkflowExecutionService] Skipping - not a workflow task (missing workflowRunId or workflowStepId)`);
      return;
    }

    // Only process completed or failed tasks
    if (task.status !== 'completed' && task.status !== 'failed') {
      console.log(`[WorkflowExecutionService] Skipping - status is ${task.status}, not completed/failed`);
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

    // Publish step event
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

    // Handle based on task type
    if (task.taskType === 'foreach' || task.parentId) {
      // Check if this is a child of a foreach task
      const parentTask = task.parentId ? await this.tasks.findOne({ _id: task.parentId }) : null;

      if (parentTask?.taskType === 'foreach') {
        // Check if there's a join task waiting
        const joinTask = await this.tasks.findOne({
          workflowRunId: run._id,
          taskType: 'join',
          status: 'waiting',
        });

        if (joinTask && joinTask.joinConfig?.awaitTaskId) {
          const joined = await this.checkJoinCondition(joinTask._id, joinTask.joinConfig.awaitTaskId);
          if (joined) {
            // Join completed - advance to next step
            await this.advanceToNextStep(run, workflow, joinTask);
          }
        }
        return;
      }
    }

    // For regular completed steps, advance to next
    if (task.status === 'completed') {
      await this.advanceToNextStep(run, workflow, task);
    } else if (task.status === 'failed') {
      await this.handleStepFailure(run, workflow, task);
    }
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

    // Mark step as completed
    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $pull: { currentStepIds: currentStep.id },
        $addToSet: { completedStepIds: currentStep.id },
      }
    );

    // Find next step(s)
    const nextStepIds = currentStep.connections?.map(c => c.targetStepId) || [];
    console.log(`[WorkflowExecutionService] Step connections: ${JSON.stringify(currentStep.connections)}`);

    // If no explicit connections, try to find next step in array
    if (nextStepIds.length === 0) {
      const currentIndex = workflow.steps.findIndex(s => s.id === currentStep.id);
      const nextStep = workflow.steps[currentIndex + 1];
      console.log(`[WorkflowExecutionService] No connections, checking sequential. Current index: ${currentIndex}, next step: ${nextStep?.id || 'none'}`);
      if (nextStep) {
        nextStepIds.push(nextStep.id);
      }
    }

    console.log(`[WorkflowExecutionService] Next step IDs to execute: ${nextStepIds.join(', ') || 'NONE'}`);

    if (nextStepIds.length === 0) {
      // No more steps - workflow complete
      console.log(`[WorkflowExecutionService] No more steps - completing workflow`);
      await this.completeWorkflow(run);
      return;
    }

    // Get the parent task (root task) for creating new step tasks
    const rootTask = run.rootTaskId ? await this.tasks.findOne({ _id: run.rootTaskId }) : null;
    if (!rootTask) {
      console.log(`[WorkflowExecutionService] Root task not found!`);
      return;
    }

    // Prepare output from completed task
    const outputPayload = completedTask.metadata || {};

    // Execute next steps
    for (const nextStepId of nextStepIds) {
      const nextStep = workflow.steps.find(s => s.id === nextStepId);
      if (nextStep) {
        console.log(`[WorkflowExecutionService] Creating task for next step: ${nextStep.name} (${nextStep.id})`);

        // If the next step has an inputPath, extract specific data using JSONPath
        let stepInputPayload = outputPayload;
        if (nextStep.inputPath) {
          const extractedInput = await this.resolveInputPath(run, nextStep.inputPath, outputPayload);
          if (extractedInput !== undefined) {
            stepInputPayload = {
              ...outputPayload,
              _extractedInput: extractedInput,
            };
            console.log(`[WorkflowExecutionService] Extracted input using path ${nextStep.inputPath}`);
          }
        }

        await this.executeStep(run, workflow, nextStep, rootTask, stepInputPayload);
      } else {
        console.log(`[WorkflowExecutionService] WARNING: Next step ${nextStepId} not found in workflow!`);
      }
    }
  }

  /**
   * Resolve inputPath to extract data from previous steps.
   * Supports paths like:
   *   - "aggregatedResults" - direct path from completed task metadata
   *   - "steps.step-1.metadata.results" - lookup from specific step
   *   - "join.aggregatedResults" - lookup from most recent join task
   */
  private async resolveInputPath(
    run: WorkflowRun,
    inputPath: string,
    currentPayload: Record<string, unknown>
  ): Promise<unknown> {
    // Check if path references a specific step by ID
    if (inputPath.startsWith('steps.')) {
      const pathParts = inputPath.split('.');
      const stepId = pathParts[1];
      const remainingPath = pathParts.slice(2).join('.');

      // Find the task for that step
      const stepTask = await this.tasks.findOne({
        workflowRunId: run._id,
        workflowStepId: stepId,
        status: 'completed',
      });

      if (stepTask?.metadata) {
        return remainingPath
          ? getValueByPathStatic(stepTask.metadata, remainingPath)
          : stepTask.metadata;
      }
      return undefined;
    }

    // Check if path references the join task
    if (inputPath.startsWith('join.')) {
      const remainingPath = inputPath.substring(5);
      const joinTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'join',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (joinTask?.metadata) {
        return remainingPath
          ? getValueByPathStatic(joinTask.metadata, remainingPath)
          : joinTask.metadata;
      }
      return undefined;
    }

    // Check if path references external task
    if (inputPath.startsWith('external.')) {
      const remainingPath = inputPath.substring(9);
      const externalTask = await this.tasks.findOne({
        workflowRunId: run._id,
        taskType: 'external',
        status: 'completed',
      }, { sort: { createdAt: -1 } });

      if (externalTask?.metadata) {
        return remainingPath
          ? getValueByPathStatic(externalTask.metadata, remainingPath)
          : externalTask.metadata;
      }
      return undefined;
    }

    // Check if path references all completed tasks (for aggregation)
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

    // Default: look up path in current payload
    return getValueByPathStatic(currentPayload, inputPath);
  }

  private async handleStepFailure(
    run: WorkflowRun,
    _workflow: Workflow,
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

    // Update root task
    if (run.rootTaskId) {
      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        { $set: { status: 'failed' as TaskStatus } }
      );
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

    // Aggregate outputs from all completed tasks
    const completedTasks = await this.tasks
      .find({ workflowRunId: run._id, status: 'completed' })
      .toArray();

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

    // Update root task
    if (run.rootTaskId) {
      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        {
          $set: {
            status: 'completed' as TaskStatus,
            metadata: { ...outputPayload, completedAt: now },
          },
        }
      );
    }

    const updatedRun = await this.workflowRuns.findOne({ _id: run._id });
    if (updatedRun) {
      await this.publish({
        id: this.generateEventId(),
        type: 'workflow.run.completed',
        workflowRunId: run._id,
        workflowRun: updatedRun,
        actorId: null,
        actorType: 'system',
        timestamp: now,
      });
    }

    console.log(`[WorkflowExecutionService] Workflow run ${run._id} completed`);
  }

  // ============================================================================
  // External Callback Handler
  // ============================================================================

  async handleExternalCallback(
    runId: string,
    stepId: string,
    payload: Record<string, unknown>,
    secret: string
  ): Promise<Task> {
    const run = await this.workflowRuns.findOne({ _id: new ObjectId(runId) });
    if (!run) {
      throw new Error(`Workflow run ${runId} not found`);
    }

    // Find the task for this step (external tasks are in_progress while awaiting callback)
    const task = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
      status: 'in_progress',
    });

    if (!task) {
      throw new Error(`Task for step ${stepId} not found or not in_progress`);
    }

    // Verify secret
    if (task.externalConfig?.callbackSecret !== secret) {
      throw new Error('Invalid callback secret');
    }

    // Update task with result and complete it
    await this.tasks.updateOne(
      { _id: task._id },
      {
        $set: {
          status: 'completed' as TaskStatus,
          metadata: { ...task.metadata, callbackPayload: payload },
          updatedAt: new Date(),
        },
      }
    );

    const updatedTask = await this.tasks.findOne({ _id: task._id });
    return updatedTask!;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  async getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
    return this.workflowRuns.findOne({ _id: new ObjectId(runId) });
  }

  async getWorkflowRunWithTasks(runId: string): Promise<{
    run: WorkflowRun;
    tasks: Task[];
  } | null> {
    const run = await this.getWorkflowRun(runId);
    if (!run) return null;

    const tasks = await this.tasks
      .find({ workflowRunId: run._id })
      .sort({ createdAt: 1 })
      .toArray();

    return { run, tasks };
  }

  async listWorkflowRuns(options: {
    workflowId?: string;
    status?: WorkflowRunStatus | WorkflowRunStatus[];
    page?: number;
    limit?: number;
  } = {}): Promise<{ runs: WorkflowRun[]; total: number }> {
    const { page = 1, limit = 20 } = options;
    const filter: Record<string, unknown> = {};

    if (options.workflowId) {
      filter.workflowId = new ObjectId(options.workflowId);
    }
    if (options.status) {
      filter.status = Array.isArray(options.status)
        ? { $in: options.status }
        : options.status;
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
      { _id, status: 'running' },
      {
        $set: {
          status: 'cancelled' as WorkflowRunStatus,
          completedAt: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Workflow run ${runId} not found or not running`);
    }

    // Cancel all pending/waiting tasks
    await this.tasks.updateMany(
      { workflowRunId: _id, status: { $in: ['pending', 'waiting', 'in_progress'] } },
      { $set: { status: 'cancelled' as TaskStatus, updatedAt: now } }
    );

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
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
