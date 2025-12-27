import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { eventBus, publishTaskEvent } from './event-bus.js';
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
 *   {{callbackUrl}} - Callback URL for current step (single result, completion signals)
 *   {{systemWebhookUrl}} - Smart callback URL that routes to next foreach step when available
 *                          (use for streaming items from external->foreach pattern)
 *   {{foreachWebhookUrl}} - Alias for systemWebhookUrl (backward compatibility)
 *   {{callbackSecret}} - Task-specific callback secret
 *   {{workflowRunId}} - Current workflow run ID
 *   {{stepId}} - Current step ID
 *   {{taskId}} - Current task ID
 *   {{input.path.to.value}} - Value from input payload (explicit prefix)
 *   {{message}} - Direct access to inputPayload.message (no prefix needed)
 *   {{item}} - Current item in foreach loop
 *   {{_index}} - Current index in foreach loop
 *   {{_total}} - Total count in foreach loop
 *   {{anyVariable}} - Direct lookup from input payload
 */
function resolveTemplateVariables(
  template: string,
  context: {
    workflowRunId: ObjectId;
    stepId: string;
    taskId?: ObjectId;
    callbackSecret?: string;
    inputPayload?: Record<string, unknown>;
    nextForeachStepId?: string;
  }
): string {
  let result = template;

  // Unified callback URL - same endpoint handles all callback types
  const callbackUrl = `${BASE_URL}/api/workflow-runs/${context.workflowRunId}/callback/${context.stepId}`;

  // {{callbackUrl}} - the primary/preferred variable
  result = result.replace(/\{\{callbackUrl\}\}/g, callbackUrl);

  // {{systemWebhookUrl}} - smart callback URL that routes to foreach step when available
  // This enables the common pattern: external trigger -> streaming items to foreach
  if (context.nextForeachStepId) {
    const smartCallbackUrl = `${BASE_URL}/api/workflow-runs/${context.workflowRunId}/callback/${context.nextForeachStepId}`;
    result = result.replace(/\{\{systemWebhookUrl\}\}/g, smartCallbackUrl);
  } else {
    result = result.replace(/\{\{systemWebhookUrl\}\}/g, callbackUrl);
  }

  // {{foreachWebhookUrl}} - backward compatibility (points to same unified endpoint)
  // If there's a next foreach step, use that step's callback URL
  if (context.nextForeachStepId) {
    const nextStepCallbackUrl = `${BASE_URL}/api/workflow-runs/${context.workflowRunId}/callback/${context.nextForeachStepId}`;
    result = result.replace(/\{\{foreachWebhookUrl\}\}/g, nextStepCallbackUrl);
  } else {
    // Fall back to current step's callback URL
    result = result.replace(/\{\{foreachWebhookUrl\}\}/g, callbackUrl);
  }
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

  // Replace direct variable references ({{message}}, {{item}}, {{_index}}, etc.)
  // This allows foreach items and other payload properties to be accessed without "input." prefix
  if (context.inputPayload) {
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      // Skip already-resolved system variables (they start with specific prefixes we've already handled)
      if (['callbackUrl', 'systemWebhookUrl', 'foreachWebhookUrl', 'workflowRunId', 'stepId', 'taskId', 'callbackSecret'].includes(trimmedPath)) {
        return match;
      }
      // Skip input. prefix (already handled above)
      if (trimmedPath.startsWith('input.')) {
        return match;
      }
      const value = getValueByPathStatic(context.inputPayload!, trimmedPath);
      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value);
      }
      // Return empty string for unresolved variables (consistent with input.* behavior)
      return '';
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
 * Recursively strips undefined values from an object.
 * MongoDB validation can fail if undefined values are present in documents.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item =>
      typeof item === 'object' && item !== null
        ? stripUndefined(item as Record<string, unknown>)
        : item
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof ObjectId)) {
        result[key] = stripUndefined(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
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
    // Publish to internal handlers
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

    // Also publish to the main event bus for SSE streaming
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
    // Only include optional fields when they have values to avoid MongoDB validation issues
    // (schema expects null for ObjectId fields, not undefined)
    const run: Omit<WorkflowRun, '_id'> = {
      workflowId,
      status: 'running',
      currentStepIds: [],
      completedStepIds: [],
      callbackSecret: this.generateSecret(),
      createdById: actorId ?? null,
      createdAt: now,
      startedAt: now,
      ...(input.inputPayload && { inputPayload: input.inputPayload }),
      ...(taskDefaults && { taskDefaults }),
      ...(input.executionOptions && { executionOptions: input.executionOptions }),
      ...(input.externalId && { externalId: input.externalId }),
      ...(input.source && { source: input.source }),
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

    // Resolve root task title from template if provided
    const defaultTitle = `Workflow: ${workflow.name}`;
    let taskTitle = defaultTitle;
    if (workflow.rootTaskTitleTemplate) {
      taskTitle = this.resolveTitleTemplate(workflow.rootTaskTitleTemplate, run.inputPayload, defaultTitle);
    }

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
      metadata: {
        workflowRunId: run._id.toString(),
        ...(run.inputPayload && { inputPayload: run.inputPayload }),
        ...(run.externalId && { externalId: run.externalId }),
        ...(run.source && { source: run.source }),
      },
      // Apply task defaults from workflow run
      ...this.applyTaskDefaults(run, now),
    };

    // Only add optional string fields if they have values
    if (workflow.description) {
      task.summary = workflow.description;
    }

    // Strip undefined values before insertion to prevent MongoDB validation errors
    const cleanTask = stripUndefined(task as unknown as Record<string, unknown>) as unknown as Task;
    const result = await this.tasks.insertOne(cleanTask);
    const createdTask = { ...cleanTask, _id: result.insertedId } as Task;

    // Publish task.created event for activity log tracking
    await publishTaskEvent('task.created', createdTask, { actorType: 'system' });

    return createdTask;
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

      case 'flow':
        // TODO: Implement flow execution (nested workflow)
        console.log('[WorkflowExecutionService] Flow execution not yet implemented');
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

    // Resolve title from template if provided, otherwise use step name
    let taskTitle = step.name || `Step ${step.id || 'Unknown'}`;
    if (step.titleTemplate) {
      taskTitle = this.resolveTitleTemplate(step.titleTemplate, inputPayload, step.name);
    }

    // Build task object, only including optional string fields if they have values
    // This prevents MongoDB validation errors for undefined string fields
    const task: Omit<Task, '_id'> = {
      title: taskTitle,
      status: initialStatus,
      parentId: parentTask._id,
      workflowId: workflow._id,
      workflowRunId: run._id,
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

    // Only add optional string fields if they have values
    // MongoDB schema validation fails if these are explicitly set to undefined
    if (step.id) {
      task.workflowStepId = step.id;
    }
    if (step.name) {
      task.workflowStage = step.name;
    }
    if (step.description) {
      task.summary = step.description;
    }
    if (step.additionalInstructions) {
      task.extraPrompt = step.additionalInstructions;
    }

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
      // Populate webhookConfig from either step.webhookConfig or step.externalConfig
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
          // Mark as workflow-managed so WebhookTaskService doesn't also execute it
          workflowManaged: true,
        };
      }
    }

    // Strip undefined values before insertion to prevent MongoDB validation errors
    const cleanTask = stripUndefined(task as unknown as Record<string, unknown>) as unknown as Task;
    const result = await this.tasks.insertOne(cleanTask);
    const createdTask = { ...cleanTask, _id: result.insertedId } as Task;

    // Publish task.created event for activity log tracking
    await publishTaskEvent('task.created', createdTask, { actorType: 'system' });

    return createdTask;
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
      'flow': 'flow',
    };
    return mapping[stepType] || 'agent';
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
      'flow': 'automated',
    };
    return mapping[stepType] || 'automated';
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
    // Check if we have a URL (either webhookConfig.url or externalConfig.endpoint)
    // If so, execute as fire-and-complete webhook
    const webhookUrl = step.webhookConfig?.url || step.externalConfig?.endpoint;
    if (webhookUrl) {
      await this.executeExternalAsWebhook(run, workflow, step, externalTask, inputPayload);
      return;
    }

    // Otherwise, use the legacy external callback flow (no URL configured)
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

  /**
   * Execute external step as a fire-and-complete webhook (no callback required).
   * This is used when an external step has webhookConfig or externalConfig with a URL.
   * Supports both config structures for backward compatibility.
   */
  private async executeExternalAsWebhook(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    externalTask: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
    // Support both webhookConfig and externalConfig structures
    const webhookCfg = step.webhookConfig;
    const externalCfg = step.externalConfig;

    // Determine the URL (prefer webhookConfig if both exist)
    const url = webhookCfg?.url || externalCfg?.endpoint;
    const method = webhookCfg?.method || externalCfg?.method || 'POST';
    const headers = webhookCfg?.headers || externalCfg?.headers || {};
    const bodyTemplate = webhookCfg?.bodyTemplate || externalCfg?.payloadTemplate;
    const timeoutMs = webhookCfg?.timeoutMs || 30000;
    const successStatusCodes = webhookCfg?.successStatusCodes || [200, 201, 202, 204];

    console.log(`[WorkflowExecutionService] Executing external step as webhook: ${method} ${url}`);

    // Find next foreach step for {{foreachWebhookUrl}} template variable
    // Look at explicit connections first, then fall back to sequential step
    let nextForeachStepId: string | undefined;
    const nextStepIds = step.connections?.map(c => c.targetStepId) || [];
    if (nextStepIds.length === 0) {
      // No explicit connections, check sequential next step
      const currentIndex = workflow.steps.findIndex(s => s.id === step.id);
      const nextStep = workflow.steps[currentIndex + 1];
      if (nextStep) {
        nextStepIds.push(nextStep.id);
      }
    }
    // Check if any of the next steps is a foreach
    for (const nextStepId of nextStepIds) {
      const nextStep = workflow.steps.find(s => s.id === nextStepId);
      if (nextStep?.stepType === 'foreach') {
        nextForeachStepId = nextStep.id;
        console.log(`[WorkflowExecutionService] Found next foreach step: ${nextStep.name} (${nextStep.id})`);
        break;
      }
    }

    // Resolve template variables
    const templateContext = {
      workflowRunId: run._id,
      stepId: step.id,
      taskId: externalTask._id,
      callbackSecret: externalTask.externalConfig?.callbackSecret || run.callbackSecret,
      inputPayload,
      nextForeachStepId,
    };

    const resolvedUrl = resolveTemplateVariables(url!, templateContext);
    let resolvedBody: string | undefined;

    if (bodyTemplate) {
      resolvedBody = resolveTemplateVariables(bodyTemplate, templateContext);
    } else if (inputPayload) {
      resolvedBody = JSON.stringify(inputPayload);
    }

    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Resolve template variables in headers
    for (const [key, value] of Object.entries(resolvedHeaders)) {
      resolvedHeaders[key] = resolveTemplateVariables(value, templateContext);
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

      // Record the attempt
      const attempt = {
        attemptNumber: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        status: isSuccess ? 'success' : 'failed',
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

        // Fetch the updated task to get full object for event
        const updatedTask = await this.tasks.findOne({ _id: externalTask._id });
        if (updatedTask) {
          // Publish task status change event to trigger workflow advancement
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
    // Debug: Log the input payload structure
    console.log(`[WorkflowExecutionService] executeForeach called for step ${step.id}`);
    console.log(`[WorkflowExecutionService] inputPayload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
    console.log(`[WorkflowExecutionService] inputPayload: ${JSON.stringify(inputPayload, null, 2).substring(0, 1000)}`);
    if (step.expectedCountPath) {
      console.log(`[WorkflowExecutionService] step.expectedCountPath: ${step.expectedCountPath}`);
      const testValue = this.getValueByPath(inputPayload, step.expectedCountPath);
      console.log(`[WorkflowExecutionService] getValueByPath(inputPayload, "${step.expectedCountPath}") = ${testValue} (type: ${typeof testValue})`);
    }

    // Helper to get expected count from step config (for waiting/callback scenarios)
    // Defined early so it can be used in all code paths
    const getExpectedCountFromStepConfig = (): number => {
      // Check expectedCountPath in input payload
      if (step.expectedCountPath) {
        const pathValue = this.getValueByPath(inputPayload, step.expectedCountPath);
        if (typeof pathValue === 'number' && pathValue >= 0) {
          console.log(`[WorkflowExecutionService] Using expectedCountPath "${step.expectedCountPath}" = ${pathValue}`);
          return pathValue;
        }

        // Path didn't resolve - log helpful debug info
        // Try common alternate paths that might have the count
        const alternates = ['output.count', 'response.count', 'count', 'output.total', 'response.total', 'total'];
        const foundAlternates: string[] = [];
        for (const alt of alternates) {
          const altValue = this.getValueByPath(inputPayload, alt);
          if (typeof altValue === 'number') {
            foundAlternates.push(`${alt}=${altValue}`);
          }
        }

        console.warn(`[WorkflowExecutionService] expectedCountPath "${step.expectedCountPath}" did not resolve to a number.`);
        console.warn(`[WorkflowExecutionService] Input payload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
        if (foundAlternates.length > 0) {
          console.warn(`[WorkflowExecutionService] Found numeric values at: ${foundAlternates.join(', ')}. Consider updating expectedCountPath.`);
        }
        // Also log the actual payload structure for debugging
        console.warn(`[WorkflowExecutionService] Input payload structure: ${JSON.stringify(inputPayload, null, 2).substring(0, 500)}`);
      }
      // Default to 0 (unknown, will be set via callback)
      return 0;
    };

    // No itemsPath means this foreach step expects items via callback
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

    // Get items from input payload using simple path extraction
    const items = this.getValueByPath(inputPayload, step.itemsPath);

    if (!Array.isArray(items)) {
      console.warn(`[WorkflowExecutionService] Items at ${step.itemsPath} is not an array. Input payload keys: ${Object.keys(inputPayload || {}).join(', ')}`);
      // Set to waiting status - items may arrive via external callback
      // Do NOT set to completed, as that would trigger workflow advancement
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

    // If we have an empty array, also set to waiting - items may arrive later
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

    // Determine expected count:
    // 1. If expectedCountPath is set, use that value from input payload
    // 2. Otherwise use the length of items being processed
    let expectedCount = itemsToProcess.length;
    if (step.expectedCountPath) {
      const pathValue = this.getValueByPath(inputPayload, step.expectedCountPath);
      if (typeof pathValue === 'number' && pathValue >= 0) {
        expectedCount = pathValue;
        console.log(`[WorkflowExecutionService] Using expectedCountPath "${step.expectedCountPath}" = ${expectedCount}`);
      } else {
        // Path didn't resolve - provide helpful debug info
        const alternates = ['output.count', 'response.count', 'count', 'output.total', 'response.total', 'total'];
        const foundAlternates: string[] = [];
        for (const alt of alternates) {
          const altValue = this.getValueByPath(inputPayload, alt);
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

    // Update foreach task with expected count (both top-level and in batchCounters)
    await this.tasks.updateOne(
      { _id: foreachTask._id },
      {
        $set: {
          expectedQuantity: expectedCount,  // Top-level field for easy access
          'batchCounters.expectedCount': expectedCount,
          'metadata.itemCount': itemsToProcess.length,  // Actual items being processed
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

  /**
   * Resolves a title template string by replacing {{variable}} placeholders.
   * Supports:
   *   {{input.path.to.value}} - Value from input payload
   *   {{item}} or {{_item}} - Current item in foreach loop
   *   {{_index}} - Current index in foreach loop
   *   {{_total}} - Total count in foreach loop
   *   {{anyVariable}} - Direct lookup from input payload
   */
  private resolveTitleTemplate(
    template: string,
    inputPayload?: Record<string, unknown>,
    fallbackTitle?: string
  ): string {
    if (!template) return fallbackTitle || '';

    let result = template;

    // Replace all {{...}} patterns
    result = result.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const trimmedPath = path.trim();

      // Handle input.* prefix explicitly
      if (trimmedPath.startsWith('input.')) {
        const inputPath = trimmedPath.substring(6); // Remove 'input.' prefix
        const value = this.getValueByPath(inputPayload, inputPath);
        return value !== undefined && value !== null ? String(value) : '';
      }

      // Handle direct property lookup (for item, _index, _total, etc.)
      const value = this.getValueByPath(inputPayload, trimmedPath);
      if (value !== undefined && value !== null) {
        // For objects, provide a brief representation
        if (typeof value === 'object') {
          // Try to get a meaningful identifier from the object
          const obj = value as Record<string, unknown>;
          if (obj.name) return String(obj.name);
          if (obj.title) return String(obj.title);
          if (obj.id) return String(obj.id);
          if (obj._id) return String(obj._id);
          // Fallback to JSON for simple objects
          return JSON.stringify(value);
        }
        return String(value);
      }

      // If not found, return empty string (variable not available)
      return '';
    });

    // If the result is empty after substitution, use fallback
    if (!result.trim()) {
      return fallbackTitle || template;
    }

    return result;
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
    if (!foreachTask) {
      console.log(`[WorkflowExecutionService] checkJoinCondition: foreach task ${foreachTaskId} not found`);
      return false;
    }

    // Get the join task to read its config
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

    // Determine expected count - prefer joinConfig.expectedCount, then batchCounters, then children count
    const expectedCount = joinTask.joinConfig?.expectedCount
      ?? foreachTask.batchCounters?.expectedCount
      ?? children.length;

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
      // Use inputPath from joinConfig if specified, otherwise take full metadata
      const inputPath = joinTask.joinConfig?.inputPath;
      const results = children
        .filter(c => c.status === 'completed')
        .map(c => {
          if (inputPath && c.metadata) {
            // Extract specific path from metadata
            const extracted = getValueByPathStatic(c.metadata, inputPath);
            return extracted !== undefined ? extracted : c.metadata;
          }
          return c.metadata;
        });

      console.log(`[WorkflowExecutionService] Join aggregation: inputPath=${inputPath || '(full metadata)'}, collected ${results.length} results`);

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
        // Always update the foreach parent's batchCounters when a child completes
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

        // Check if there's a join task waiting
        let joinTask = await this.tasks.findOne({
          workflowRunId: run._id,
          taskType: 'join',
          status: 'waiting',
        });

        // If no join task exists, check if the child task's next step is a join step and create it
        if (!joinTask) {
          const childStep = workflow.steps.find(s => s.id === task.workflowStepId);
          if (childStep) {
            // Find next step via connections or sequential order
            let nextStepIds = childStep.connections?.map(c => c.targetStepId) || [];
            if (nextStepIds.length === 0) {
              const childIndex = workflow.steps.findIndex(s => s.id === childStep.id);
              const nextStep = workflow.steps[childIndex + 1];
              if (nextStep) {
                nextStepIds.push(nextStep.id);
              }
            }

            // Check if any next step is a join step
            for (const nextStepId of nextStepIds) {
              const nextStep = workflow.steps.find(s => s.id === nextStepId);
              if (nextStep?.stepType === 'join') {
                console.log(`[WorkflowExecutionService] Creating join task for step ${nextStep.id} as it doesn't exist yet`);
                // Get the root task (workflow root) as parent for the join task
                const rootTask = await this.tasks.findOne({
                  workflowRunId: run._id,
                  parentId: null,
                });
                if (rootTask) {
                  await this.executeStep(run, workflow, nextStep, rootTask);
                  // Re-fetch the join task we just created
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
            // Re-fetch join task to get updated metadata (aggregatedResults, etc.)
            const updatedJoinTask = await this.tasks.findOne({ _id: joinTask._id });
            if (updatedJoinTask) {
              // Join completed - advance to next step
              await this.advanceToNextStep(run, workflow, updatedJoinTask);
            }
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

    // If still no connections and this is a join task, check the associated foreach step's connections
    if (nextStepIds.length === 0 && completedTask.taskType === 'join' && completedTask.joinConfig?.awaitTaskId) {
      console.log(`[WorkflowExecutionService] Join task has no connections, checking foreach step connections`);
      const foreachTask = await this.tasks.findOne({ _id: completedTask.joinConfig.awaitTaskId });
      if (foreachTask?.workflowStepId) {
        const foreachStep = workflow.steps.find(s => s.id === foreachTask.workflowStepId);
        if (foreachStep?.connections) {
          // Use foreach step's connections that aren't the join step itself
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
    // Wrap the metadata in an 'output' key so paths like 'output.emails' work correctly
    // Also include the response directly for backward compatibility
    const taskMetadata = completedTask.metadata || {};
    const outputPayload: Record<string, unknown> = {
      ...taskMetadata,
      output: taskMetadata.response || taskMetadata,
    };

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
  // Unified Callback Handler
  // Handles all callback types: single result, streaming items, batch items
  // ============================================================================

  /**
   * Unified callback handler for workflow step callbacks.
   *
   * Payload detection (in order of precedence):
   * 1. If payload has `item` key → use that as the item
   * 2. If payload has `items` array → process each as an item
   * 3. Otherwise → the entire payload (minus workflowUpdate) IS the item
   *
   * Workflow controls (namespaced to avoid conflicts with external payloads):
   * - workflowUpdate.complete: boolean - Signal that no more items will be sent
   * - workflowUpdate.total: number - Set/update expected item count
   */
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

    // Find any task for this step (for logging purposes - even completed ones)
    const anyTaskForStep = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
    }, { sort: { createdAt: -1 } });

    // Helper to log callback request (used for both success and failure)
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

    // Find the task for this step (could be any type: external, foreach, etc.)
    // Look for tasks that are waiting for callbacks
    const task = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
      status: { $in: ['waiting', 'in_progress'] },
    });

    if (!task) {
      // Log the failed request against any task we found for this step
      await logCallbackRequest(
        anyTaskForStep?._id || null,
        'failed',
        `Task for step ${stepId} not found or already completed`
      );
      throw new Error(`Task for step ${stepId} not found or already completed`);
    }

    // Verify secret - check task-specific, workflow run, and previous step secrets
    let validSecret =
      task.externalConfig?.callbackSecret === secret ||
      run.callbackSecret === secret;

    // For foreach tasks, also check the previous external step's callback secret
    // This supports the pattern where external step routes callbacks to the foreach step
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

    // Extract workflowUpdate controls (namespaced to avoid conflicts)
    const workflowUpdate = payload.workflowUpdate as { complete?: boolean; total?: number } | undefined;
    const signalComplete = workflowUpdate?.complete === true;
    const newTotal = workflowUpdate?.total;

    // Create a copy of payload without workflowUpdate for item data
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workflowUpdate: _, ...payloadData } = payload;

    // Determine items from payload
    let items: unknown[] = [];
    if ('item' in payloadData && payloadData.item !== undefined) {
      // Explicit single item
      items = [payloadData.item];
    } else if ('items' in payloadData && Array.isArray(payloadData.items)) {
      // Explicit array of items
      items = payloadData.items;
    } else if (Object.keys(payloadData).length > 0) {
      // Entire payload is the item (default case for external services)
      items = [payloadData];
    }

    // Track counters
    let currentReceivedCount = task.batchCounters?.receivedCount || 0;
    let currentExpectedCount = task.batchCounters?.expectedCount || 0;
    const childTaskIds: string[] = [];

    // Handle total update from workflowUpdate
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

    // Process items based on task type
    if (task.taskType === 'foreach' && items.length > 0) {
      // Foreach task: create child tasks for each item
      // Find the next step for child tasks
      let nextStepId = step.connections?.[0]?.targetStepId;

      // Fallback: parse from mermaid diagram if connections not populated
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

      // Create child task for each item
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

          // Execute the child task based on its step type
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

      // Update received count
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
      // Non-foreach task (external, etc.): store payload and complete
      // For single-result callbacks, the payload becomes the task's metadata/output
      await this.tasks.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'completed' as TaskStatus,
            metadata: { ...task.metadata, callbackPayload: items.length === 1 ? items[0] : items },
            updatedAt: new Date(),
          },
        }
      );
      console.log(`[WorkflowExecutionService] External task ${task._id} completed with callback data`);
    }

    // Check if we should mark as complete (for foreach tasks)
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

    // Log the successful callback request with created task IDs
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

  // Legacy method for backward compatibility
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

  // Legacy method for backward compatibility
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
    // Convert legacy payload format to unified format
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

  // Helper method to execute a task's step type
  private async executeStepForTask(
    run: WorkflowRun,
    workflow: Workflow,
    step: WorkflowStep,
    task: Task,
    inputPayload?: Record<string, unknown>
  ): Promise<void> {
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
      case 'agent':
      case 'manual':
        // These wait for external completion
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

  /**
   * Re-aggregate a join task using its current configuration.
   * Called when a join task is rerun to re-collect results from completed children.
   */
  async rerunJoinTask(joinTaskId: ObjectId): Promise<{ success: boolean; error?: string }> {
    const joinTask = await this.tasks.findOne({ _id: joinTaskId });
    if (!joinTask || joinTask.taskType !== 'join') {
      console.log(`[WorkflowExecutionService] rerunJoinTask: task ${joinTaskId} not found or not a join task`);
      return { success: false, error: 'Task not found or not a join task' };
    }

    // Try to find the foreach task ID from multiple sources
    let foreachTaskId: ObjectId | undefined = joinTask.joinConfig?.awaitTaskId;

    // Check metadata.awaitingForeachTask (set by workflow system)
    if (!foreachTaskId && joinTask.metadata?.awaitingForeachTask) {
      const awaitingId = joinTask.metadata.awaitingForeachTask;
      foreachTaskId = typeof awaitingId === 'string' ? new ObjectId(awaitingId) : awaitingId as ObjectId;
      console.log(`[WorkflowExecutionService] rerunJoinTask: using metadata.awaitingForeachTask ${foreachTaskId}`);
    }

    // If still no ID, try to find foreach parent
    if (!foreachTaskId && joinTask.parentId) {
      const parentTask = await this.tasks.findOne({ _id: joinTask.parentId });
      if (parentTask?.taskType === 'foreach') {
        foreachTaskId = parentTask._id;
        console.log(`[WorkflowExecutionService] rerunJoinTask: using parent as foreach task ${foreachTaskId}`);
      }
    }

    // Update joinConfig with the discovered awaitTaskId for future runs
    if (foreachTaskId && !joinTask.joinConfig?.awaitTaskId) {
      await this.tasks.updateOne(
        { _id: joinTaskId },
        { $set: { 'joinConfig.awaitTaskId': foreachTaskId } }
      );
    }

    if (!foreachTaskId) {
      console.log(`[WorkflowExecutionService] rerunJoinTask: join task ${joinTaskId} has no awaitTaskId, metadata.awaitingForeachTask, or foreach parent`);
      return { success: false, error: 'No foreach task found to aggregate from.' };
    }

    console.log(`[WorkflowExecutionService] rerunJoinTask: re-aggregating join ${joinTaskId} from foreach ${foreachTaskId}`);

    // First set the join task to 'waiting' status so checkJoinCondition can complete it
    await this.tasks.updateOne(
      { _id: joinTaskId },
      { $set: { status: 'waiting' as TaskStatus } }
    );

    // Now run the join check which will aggregate and complete/fail the task
    const result = await this.checkJoinCondition(joinTaskId, foreachTaskId);
    return { success: result };
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  async getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
    return this.workflowRuns.findOne({ _id: new ObjectId(runId) });
  }

  async getWorkflowRunWithTasks(runId: string): Promise<{
    run: WorkflowRun & { workflow?: Workflow };
    tasks: Task[];
  } | null> {
    const run = await this.getWorkflowRun(runId);
    if (!run) return null;

    // Fetch workflow definition to include steps for progress display
    const workflow = await this.workflows.findOne({ _id: run.workflowId });

    const tasks = await this.tasks
      .find({ workflowRunId: run._id })
      .sort({ createdAt: 1 })
      .toArray();

    return {
      run: { ...run, workflow: workflow || undefined },
      tasks,
    };
  }

  async listWorkflowRuns(options: {
    workflowId?: string;
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
    if (options.status) {
      filter.status = Array.isArray(options.status)
        ? { $in: options.status }
        : options.status;
    }
    // Add date range filter
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
