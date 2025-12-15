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

  // Track processed events to prevent duplicate handling
  private processedEvents = new Set<string>();
  private eventCleanupInterval: NodeJS.Timeout | null = null;

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
    this.eventCleanupInterval = setInterval(() => {
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
      case 'agent':
      case 'manual':
        // These wait for external completion (AI agent or human)
        // Task is already created, just wait for status change
        break;

      case 'external':
        // External step - mark as waiting for callback
        await this.tasks.updateOne(
          { _id: task._id },
          { $set: { status: 'waiting' as TaskStatus } }
        );
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
    const mapping: Record<string, TaskType> = {
      'agent': 'standard',
      'external': 'external',
      'manual': 'standard',
      'decision': 'decision',
      'foreach': 'foreach',
      'join': 'join',
      'subflow': 'subflow',
    };
    return mapping[stepType] || 'standard';
  }

  private mapStepTypeToExecutionMode(stepType: string): ExecutionMode {
    const mapping: Record<string, ExecutionMode> = {
      'agent': 'automated',
      'external': 'external_callback',
      'manual': 'manual',
      'decision': 'immediate',
      'foreach': 'immediate',
      'join': 'immediate',
      'subflow': 'automated',
    };
    return mapping[stepType] || 'automated';
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

    // Update foreach task with expected count
    await this.tasks.updateOne(
      { _id: foreachTask._id },
      {
        $set: {
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
    _step: WorkflowStep,
    joinTask: Task
  ): Promise<void> {
    // Find the foreach task we're joining on (usually the previous step)
    // For now, look for the most recent foreach task in this run
    const foreachTask = await this.tasks.findOne({
      workflowRunId: run._id,
      taskType: 'foreach',
      status: { $in: ['waiting', 'in_progress'] },
    });

    if (!foreachTask) {
      console.log('[WorkflowExecutionService] No foreach task to join on');
      await this.tasks.updateOne(
        { _id: joinTask._id },
        { $set: { status: 'completed' as TaskStatus } }
      );
      return;
    }

    // Store reference to foreach task
    await this.tasks.updateOne(
      { _id: joinTask._id },
      {
        $set: {
          'joinConfig.awaitTaskId': foreachTask._id,
          'joinConfig.scope': 'children',
          'metadata.awaitingForeachTask': foreachTask._id.toString(),
        },
      }
    );

    // Check if all children are complete
    await this.checkJoinCondition(joinTask._id, foreachTask._id);
  }

  private async checkJoinCondition(joinTaskId: ObjectId, foreachTaskId: ObjectId): Promise<boolean> {
    const foreachTask = await this.tasks.findOne({ _id: foreachTaskId });
    if (!foreachTask || !foreachTask.batchCounters) return false;

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

    const expectedCount = foreachTask.batchCounters.expectedCount;

    if (totalDone >= expectedCount) {
      // All children done - aggregate results and complete join
      const results = children
        .filter(c => c.status === 'completed')
        .map(c => c.metadata);

      await this.tasks.updateOne(
        { _id: joinTaskId },
        {
          $set: {
            status: 'completed' as TaskStatus,
            'metadata.aggregatedResults': results,
            'metadata.successCount': completedCount,
            'metadata.failedCount': failedCount,
          },
        }
      );

      // Also complete the foreach task
      await this.tasks.updateOne(
        { _id: foreachTaskId },
        { $set: { status: 'completed' as TaskStatus } }
      );

      return true;
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
        await this.executeStep(run, workflow, nextStep, rootTask, outputPayload);
      } else {
        console.log(`[WorkflowExecutionService] WARNING: Next step ${nextStepId} not found in workflow!`);
      }
    }
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

    // Find the task for this step
    const task = await this.tasks.findOne({
      workflowRunId: run._id,
      workflowStepId: stepId,
      status: 'waiting',
    });

    if (!task) {
      throw new Error(`Task for step ${stepId} not found or not waiting`);
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
