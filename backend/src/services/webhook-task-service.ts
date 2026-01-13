import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/connection.js';
import { Task, WebhookAttempt, TaskStatus } from '../types/index.js';
import { eventBus, publishTaskEvent } from './event-bus.js';
import { resolveTemplateVariables, TemplateContext } from './workflow/template-utils.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SUCCESS_STATUS_CODES = [200, 201, 202, 204];

/**
 * WebhookTaskService handles execution of webhook tasks with retry logic.
 *
 * It executes HTTP calls for tasks with taskType='external' and webhookConfig,
 * tracks attempts, handles retries with exponential backoff, and updates
 * task status on success/failure.
 */
class WebhookTaskService {
  private initialized = false;
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  get tasks(): Collection<Task> {
    return getDb().collection<Task>('tasks');
  }

  initialize(): void {
    if (this.initialized) return;

    // Listen for webhook tasks that need execution
    eventBus.subscribe('task.created', async (event) => {
      const task = event.task;
      // Skip workflow-managed webhooks - they are executed by WorkflowExecutionService
      if (task.webhookConfig?.workflowManaged) {
        console.log(`[WebhookTaskService] Skipping workflow-managed webhook task: ${task._id}`);
        return;
      }
      if (task.taskType === 'external' && task.webhookConfig && task.status === 'pending') {
        console.log(`[WebhookTaskService] New external task created: ${task._id}`);
        await this.executeWebhook(task._id);
      }
    });

    // Also check for pending retries or reruns on status changes
    eventBus.subscribe('task.status.changed', async (event) => {
      const task = event.task;
      if (task.taskType === 'external' && task.webhookConfig && task.status === 'pending') {
        const config = task.webhookConfig;
        const attempts = config.attempts || [];

        // Execute webhook if:
        // 1. It's a scheduled retry that's due, OR
        // 2. Attempts array is empty (task was rerun and reset)
        const isScheduledRetryDue = config.nextRetryAt && new Date(config.nextRetryAt) <= new Date();
        const isRerun = attempts.length === 0 && !config.nextRetryAt;

        if (isScheduledRetryDue || isRerun) {
          console.log(`[WebhookTaskService] Executing webhook for task ${task._id} (rerun=${isRerun}, scheduledRetry=${isScheduledRetryDue})`);
          await this.executeWebhook(task._id);
        }
      }
    });

    console.log('[WebhookTaskService] Initialized and listening for webhook tasks');
    this.initialized = true;
  }

  /**
   * Execute a webhook task, handling retries and status updates
   */
  async executeWebhook(taskId: ObjectId | string): Promise<WebhookAttempt> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.taskType !== 'external' || !task.webhookConfig) {
      throw new Error(`Task ${id} is not an external task`);
    }

    // Don't execute webhooks for cancelled tasks
    if (task.status === 'cancelled') {
      console.log(`[WebhookTaskService] Skipping execution of cancelled task ${id}`);
      throw new Error(`Task ${id} has been cancelled`);
    }

    const config = task.webhookConfig;
    const attempts = config.attempts || [];
    const attemptNumber = attempts.length + 1;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

    // Build template context for resolving variables
    // For workflow tasks, use workflowRunId; for standalone tasks, use task._id as a fallback
    //
    // Data sources for template variables:
    // - task.metadata.inputPayload: Contains previous step's output (from workflow execution)
    //   - inputPayload.output = previous task's metadata.response OR metadata
    //   - inputPayload.response = previous task's metadata.response (if it exists)
    // - We also inject current task fields for direct access
    //
    const baseInputPayload = task.metadata?.inputPayload as Record<string, unknown> | undefined;
    const enrichedInputPayload: Record<string, unknown> = {
      // Spread previous step data first (includes 'output' key from workflow execution)
      ...baseInputPayload,
      // Then overlay current task fields for direct access ({{title}}, {{status}}, etc.)
      // These take precedence if there's a naming conflict
      title: task.title,
      summary: task.summary,
      status: task.status,
      tags: task.tags || [],
      urgency: task.urgency,
      // Include the full task object for {{task.fieldName}} access
      task: {
        _id: task._id.toString(),
        title: task.title,
        summary: task.summary,
        status: task.status,
        tags: task.tags || [],
        taskType: task.taskType,
        urgency: task.urgency,
        assigneeId: task.assigneeId?.toString(),
        parentId: task.parentId?.toString(),
        workflowRunId: task.workflowRunId?.toString(),
        workflowStepId: task.workflowStepId,
      },
    };

    const templateContext: TemplateContext = {
      workflowRunId: task.workflowRunId || task._id,
      stepId: task.workflowStepId || 'standalone',
      taskId: task._id,
      callbackSecret: task.externalConfig?.callbackSecret,
      inputPayload: enrichedInputPayload,
      apiKey: process.env.MATRIX_API_KEY,
    };

    // Resolve template variables in URL
    const resolvedUrl = resolveTemplateVariables(config.url, templateContext);

    // Resolve template variables in headers
    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        resolvedHeaders[key] = resolveTemplateVariables(value, templateContext);
      }
    }

    // Resolve template variables in body
    let resolvedBody: string | undefined;
    if (config.body && config.method !== 'GET') {
      resolvedBody = resolveTemplateVariables(config.body, templateContext);
    }

    // Create new attempt record with resolved request details
    const attempt: WebhookAttempt = {
      attemptNumber,
      startedAt: new Date(),
      status: 'pending',
      requestUrl: resolvedUrl,
      requestMethod: config.method,
      requestHeaders: resolvedHeaders,
      requestBody: resolvedBody,
    };

    // Update task to in_progress
    await this.tasks.updateOne(
      { _id: id },
      {
        $set: {
          status: 'in_progress' as TaskStatus,
          'webhookConfig.lastAttemptAt': new Date(),
          updatedAt: new Date(),
        },
        $push: { 'webhookConfig.attempts': attempt as any },
      }
    );

    const startTime = Date.now();
    let httpStatus: number | undefined;
    let responseBody: unknown;
    let errorMessage: string | undefined;

    try {
      // Make the HTTP request with timeout
      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      console.log(`[WebhookTaskService] Executing webhook ${id} attempt ${attemptNumber}: ${attempt.requestMethod} ${attempt.requestUrl}`);

      const response = await fetch(attempt.requestUrl!, {
        method: attempt.requestMethod,
        headers: attempt.requestHeaders,
        body: attempt.requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      httpStatus = response.status;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => null);
      }

      // Check if status is considered success
      const successCodes = config.successStatusCodes ?? DEFAULT_SUCCESS_STATUS_CODES;
      const isSuccess = successCodes.includes(httpStatus);

      if (isSuccess) {
        // Success - update attempt and complete task
        const durationMs = Date.now() - startTime;
        await this.updateAttempt(id, attemptNumber, {
          status: 'success',
          httpStatus,
          responseBody,
          durationMs,
          completedAt: new Date(),
        });

        await this.tasks.updateOne(
          { _id: id },
          {
            $set: {
              status: 'completed' as TaskStatus,
              'webhookConfig.nextRetryAt': null,
              'metadata.webhookResponse': responseBody,
              updatedAt: new Date(),
            },
          }
        );

        console.log(`[WebhookTaskService] Webhook ${id} succeeded with status ${httpStatus}`);

        // Emit status change event
        const updatedTask = await this.tasks.findOne({ _id: id });
        if (updatedTask) {
          await publishTaskEvent('task.status.changed', updatedTask, {
            changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'completed' }],
            actorType: 'system',
          });
        }

        return { ...attempt, status: 'success', httpStatus, responseBody, durationMs };
      } else {
        // Non-success HTTP status
        errorMessage = `HTTP ${httpStatus}: ${JSON.stringify(responseBody).slice(0, 200)}`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('abort')) {
        errorMessage = `Request timeout after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`;
      }
    }

    // Failure - update attempt and decide on retry
    const durationMs = Date.now() - startTime;
    await this.updateAttempt(id, attemptNumber, {
      status: 'failed',
      httpStatus,
      responseBody,
      errorMessage,
      durationMs,
      completedAt: new Date(),
    });

    console.log(`[WebhookTaskService] Webhook ${id} attempt ${attemptNumber} failed: ${errorMessage}`);

    // Check if we should retry
    if (attemptNumber < maxRetries) {
      // Schedule retry with exponential backoff
      const baseDelay = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
      const retryDelay = baseDelay * Math.pow(2, attemptNumber - 1);
      const nextRetryAt = new Date(Date.now() + retryDelay);

      await this.tasks.updateOne(
        { _id: id },
        {
          $set: {
            status: 'pending' as TaskStatus,
            'webhookConfig.nextRetryAt': nextRetryAt,
            updatedAt: new Date(),
          },
        }
      );

      console.log(`[WebhookTaskService] Scheduling retry ${attemptNumber + 1}/${maxRetries} in ${retryDelay}ms`);

      // Schedule the retry
      this.scheduleRetry(id, retryDelay);

      return { ...attempt, status: 'failed', httpStatus, responseBody, errorMessage, durationMs };
    } else {
      // Max retries exceeded - mark as failed
      await this.tasks.updateOne(
        { _id: id },
        {
          $set: {
            status: 'failed' as TaskStatus,
            'webhookConfig.nextRetryAt': null,
            'metadata.webhookError': errorMessage,
            updatedAt: new Date(),
          },
        }
      );

      console.log(`[WebhookTaskService] Webhook ${id} failed after ${attemptNumber} attempts`);

      // Emit status change event
      const updatedTask = await this.tasks.findOne({ _id: id });
      if (updatedTask) {
        await publishTaskEvent('task.status.changed', updatedTask, {
          changes: [{ field: 'status', oldValue: 'in_progress', newValue: 'failed' }],
          actorType: 'system',
        });
      }

      return { ...attempt, status: 'failed', httpStatus, responseBody, errorMessage, durationMs };
    }
  }

  /**
   * Manually retry a failed webhook task
   */
  async retryWebhook(taskId: ObjectId | string): Promise<WebhookAttempt> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.taskType !== 'external' || !task.webhookConfig) {
      throw new Error(`Task ${id} is not an external task`);
    }

    if (task.status !== 'failed') {
      throw new Error(`Can only retry failed webhook tasks. Current status: ${task.status}`);
    }

    // Reset for retry
    await this.tasks.updateOne(
      { _id: id },
      {
        $set: {
          status: 'pending' as TaskStatus,
          updatedAt: new Date(),
        },
      }
    );

    return this.executeWebhook(id);
  }

  /**
   * Cancel any pending retries for a task
   */
  cancelRetry(taskId: ObjectId | string): void {
    const key = taskId.toString();
    const timer = this.retryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
      console.log(`[WebhookTaskService] Cancelled retry for ${key}`);
    }
  }

  private scheduleRetry(taskId: ObjectId, delayMs: number): void {
    const key = taskId.toString();

    // Cancel any existing retry timer
    this.cancelRetry(taskId);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(key);
      try {
        await this.executeWebhook(taskId);
      } catch (error) {
        console.error(`[WebhookTaskService] Retry execution error for ${key}:`, error);
      }
    }, delayMs);

    this.retryTimers.set(key, timer);
  }

  private async updateAttempt(
    taskId: ObjectId,
    attemptNumber: number,
    updates: Partial<WebhookAttempt>
  ): Promise<void> {
    // Update the specific attempt in the array
    await this.tasks.updateOne(
      { _id: taskId, 'webhookConfig.attempts.attemptNumber': attemptNumber },
      {
        $set: {
          'webhookConfig.attempts.$.status': updates.status,
          'webhookConfig.attempts.$.httpStatus': updates.httpStatus,
          'webhookConfig.attempts.$.responseBody': updates.responseBody,
          'webhookConfig.attempts.$.errorMessage': updates.errorMessage,
          'webhookConfig.attempts.$.durationMs': updates.durationMs,
          'webhookConfig.attempts.$.completedAt': updates.completedAt,
        },
      }
    );
  }

  /**
   * Get execution status for a webhook task
   */
  async getWebhookStatus(taskId: ObjectId | string): Promise<{
    task: Task;
    attempts: WebhookAttempt[];
    canRetry: boolean;
    lastError?: string;
  }> {
    const id = typeof taskId === 'string' ? new ObjectId(taskId) : taskId;
    const task = await this.tasks.findOne({ _id: id });

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.taskType !== 'external' || !task.webhookConfig) {
      throw new Error(`Task ${id} is not an external task`);
    }

    const attempts = task.webhookConfig.attempts || [];
    const lastAttempt = attempts[attempts.length - 1];
    const canRetry = task.status === 'failed';

    return {
      task,
      attempts,
      canRetry,
      lastError: lastAttempt?.errorMessage,
    };
  }
}

export const webhookTaskService = new WebhookTaskService();
