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
  StartWorkflowInput,
  TaskEvent,
  Document,
} from '../../types/index.js';

import { resolveTemplateVariables, getValueByPath, resolveTitleTemplate, BASE_URL } from './template-utils.js';
import { stripUndefined } from './mongo-utils.js';
import { searchDocuments } from '../embedding-service.js';

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

    setInterval(() => {
      this.processedEvents.clear();
    }, 5 * 60 * 1000);

    this.initialized = true;
    console.log('[WorkflowExecutionService] Initialized and listening for task events');
  }

  private async safeHandleTaskEvent(event: TaskEvent): Promise<void> {
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
      ...(triggerTaskId && { triggerTaskId }),
      ...(input.triggerContext && { triggerContext: input.triggerContext }),
    };

    const runResult = await this.workflowRuns.insertOne(run as WorkflowRun);
    const createdRun = { ...run, _id: runResult.insertedId } as WorkflowRun;

    const rootTask = await this.createRootTask(createdRun, workflow, actorId);

    await this.workflowRuns.updateOne(
      { _id: createdRun._id },
      { $set: { rootTaskId: rootTask._id } }
    );
    createdRun.rootTaskId = rootTask._id;

    if (triggerTaskId) {
      await this.tasks.updateOne(
        { _id: triggerTaskId },
        {
          $set: {
            spawnedWorkflowRunId: createdRun._id,
            updatedAt: now,
          }
        }
      );
      console.log(`[WorkflowExecutionService] Linked trigger task ${triggerTaskId} to workflow run ${createdRun._id}`);
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
      taskTitle = resolveTitleTemplate(workflow.rootTaskTitleTemplate, run.inputPayload, defaultTitle);
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
      case 'trigger':
        await this.tasks.updateOne(
          { _id: task._id },
          { $set: { status: 'completed' as TaskStatus } }
        );
        break;

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
        console.log('[WorkflowExecutionService] Flow execution not yet implemented');
        break;

      case 'findDocument':
        await this.executeFindDocument(run, workflow, step, task, inputPayload);
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

    const taskType = this.mapStepTypeToTaskType(step.stepType);
    const executionMode = this.mapStepTypeToExecutionMode(step.stepType);

    let initialStatus: TaskStatus = 'pending';
    if (step.stepType === 'foreach' || step.stepType === 'join') {
      initialStatus = 'waiting';
    } else if (step.stepType === 'decision') {
      initialStatus = 'in_progress';
    }

    const runDefaults = this.applyTaskDefaults(run, now);

    let taskTitle = step.name || `Step ${step.id || 'Unknown'}`;
    if (step.titleTemplate) {
      taskTitle = resolveTitleTemplate(step.titleTemplate, inputPayload, step.name);
    }

    const task: Omit<Task, '_id'> = {
      title: taskTitle,
      status: initialStatus,
      parentId: parentTask._id,
      workflowId: workflow._id,
      workflowRunId: run._id,
      taskType,
      executionMode,
      ...runDefaults,
      assigneeId: step.defaultAssigneeId
        ? new ObjectId(step.defaultAssigneeId)
        : runDefaults.assigneeId ?? null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        stepId: step.id,
        stepType: step.stepType,
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

    return createdTask;
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
      'findDocument': 'immediate',
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

    const endpoint = resolveTemplateVariables(config.endpoint, templateContext);

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
    let selectedConnection = step.connections?.find(conn => {
      if (!conn.condition) return false;
      return this.evaluateCondition(conn.condition, inputPayload);
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

    const [field, values] = condition.split(':');
    if (!field || !values) return false;

    const actualValue = getValueByPath(payload, field);
    const expectedValues = values.split(',').map(v => v.trim());

    return expectedValues.includes(String(actualValue));
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

    if (!config) {
      console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} has no findDocumentConfig`);
      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': 'No findDocumentConfig provided',
          }
        }
      );
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
            await this.tasks.updateOne(
              { _id: findDocTask._id },
              {
                $set: {
                  status: 'failed' as TaskStatus,
                  'metadata.error': `Document ${config.documentId} not found`,
                  'metadata.mode': 'static',
                  'metadata.documentId': config.documentId,
                }
              }
            );
            return;
          }
          // Not failing, just store null
          await this.tasks.updateOne(
            { _id: findDocTask._id },
            {
              $set: {
                status: 'completed' as TaskStatus,
                [`metadata.${storeAs}`]: null,
                'metadata.mode': 'static',
                'metadata.documentId': config.documentId,
                'metadata.resultCount': 0,
              }
            }
          );
          return;
        }

        // Remove embedding from response (too large)
        const { embedding, ...documentWithoutEmbedding } = document as Record<string, unknown>;

        await this.tasks.updateOne(
          { _id: findDocTask._id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              [`metadata.${storeAs}`]: { document: documentWithoutEmbedding },
              'metadata.mode': 'static',
              'metadata.documentId': config.documentId,
              'metadata.resultCount': 1,
            }
          }
        );
        console.log(`[WorkflowExecutionService] FindDocument step ${step.id} (static) completed successfully`);
        return;
      } catch (error) {
        console.error(`[WorkflowExecutionService] FindDocument step ${step.id} (static) failed:`, error);
        await this.tasks.updateOne(
          { _id: findDocTask._id },
          {
            $set: {
              status: 'failed' as TaskStatus,
              'metadata.error': error instanceof Error ? error.message : 'Failed to fetch document',
              'metadata.mode': 'static',
              'metadata.documentId': config.documentId,
            }
          }
        );
        return;
      }
    }

    // Dynamic mode: semantic search
    // Resolve the search prompt with template variables from inputPayload
    let searchPrompt = config.searchPrompt || '';
    if (searchPrompt && inputPayload) {
      const templateContext = {
        workflowRunId: run._id,
        stepId: step.id,
        taskId: findDocTask._id,
        inputPayload,
        ...inputPayload, // Allow direct access to input fields
      };
      searchPrompt = resolveTemplateVariables(searchPrompt, templateContext);
    }

    if (!searchPrompt) {
      console.warn(`[WorkflowExecutionService] FindDocument step ${step.id} has no search prompt after resolution`);
      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': 'No search prompt provided or resolved to empty',
            'metadata.mode': 'dynamic',
          }
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
        await this.tasks.updateOne(
          { _id: findDocTask._id },
          {
            $set: {
              status: 'failed' as TaskStatus,
              'metadata.error': 'No documents found matching search criteria',
              'metadata.mode': 'dynamic',
              'metadata.searchPrompt': searchPrompt,
              'metadata.searchConfig': {
                documentTypes: config.documentTypes,
                documentStatus: config.documentStatus || ['approved'],
                tags: config.tags,
                minScore: config.minScore || 0.5,
              },
            }
          }
        );
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

      // Mark task as completed with the found document(s)
      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'completed' as TaskStatus,
            [`metadata.${storeAs}`]: documentResult,
            'metadata.mode': 'dynamic',
            'metadata.searchPrompt': searchPrompt,
            'metadata.resultCount': searchResults.length,
          }
        }
      );

      console.log(`[WorkflowExecutionService] FindDocument step ${step.id} (dynamic) completed successfully`);
    } catch (error) {
      console.error(`[WorkflowExecutionService] FindDocument step ${step.id} (dynamic) failed:`, error);
      await this.tasks.updateOne(
        { _id: findDocTask._id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'metadata.error': error instanceof Error ? error.message : 'Search failed',
            'metadata.mode': 'dynamic',
            'metadata.searchPrompt': searchPrompt,
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

    await this.workflowRuns.updateOne(
      { _id: run._id },
      {
        $pull: { currentStepIds: currentStep.id },
        $addToSet: { completedStepIds: currentStep.id },
      }
    );

    const nextStepIds = currentStep.connections?.map(c => c.targetStepId) || [];
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

    const taskMetadata = completedTask.metadata || {};
    const outputPayload: Record<string, unknown> = {
      ...taskMetadata,
      output: taskMetadata.response || taskMetadata,
    };

    for (const nextStepId of nextStepIds) {
      const nextStep = workflow.steps.find(s => s.id === nextStepId);
      if (nextStep) {
        console.log(`[WorkflowExecutionService] Creating task for next step: ${nextStep.name} (${nextStep.id})`);

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

    if (run.rootTaskId) {
      await this.tasks.updateOne(
        { _id: run.rootTaskId },
        { $set: { status: 'failed' as TaskStatus } }
      );
    }

    if (run.triggerTaskId) {
      const workflowResult = {
        status: 'failed' as WorkflowRunStatus,
        error: `Step "${failedTask.title}" failed`,
        completedAt: now,
      };
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

    if (run.triggerTaskId) {
      const workflowResult = {
        status: 'completed' as WorkflowRunStatus,
        outputPayload,
        completedAt: now,
      };
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
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
