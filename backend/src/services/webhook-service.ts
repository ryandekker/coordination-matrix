import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';
import {
  TaskEvent,
  View,
  Webhook,
  WebhookDelivery,
  WebhookTrigger,
} from '../types/index.js';

/**
 * Webhook Service
 *
 * Subscribes to the event bus and dispatches webhooks to external services.
 * Handles retry logic and delivery tracking.
 */
class WebhookService {
  private initialized = false;
  private retryIntervals = [1000, 5000, 30000, 120000, 600000]; // 1s, 5s, 30s, 2m, 10m
  private maxAttempts = 5;
  private retryTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the service and subscribe to events
   */
  initialize(): void {
    if (this.initialized) return;

    // Subscribe to all task events
    eventBus.subscribe('*', async (event: TaskEvent) => {
      await this.handleEvent(event);
    });

    // Start retry processor
    this.startRetryProcessor();

    this.initialized = true;
    console.log('WebhookService: Initialized and listening for events');
  }

  /**
   * Handle an incoming event
   */
  private async handleEvent(event: TaskEvent): Promise<void> {
    try {
      const db = getDb();

      // Find active webhooks that match this event type
      const webhooks = await db
        .collection<Webhook>('webhooks')
        .find({
          isActive: true,
          triggers: { $in: [event.type as WebhookTrigger, 'task.entered_filter'] },
        })
        .toArray();

      for (const webhook of webhooks) {
        // Check if we should trigger based on filter
        if (await this.shouldTrigger(webhook, event)) {
          await this.queueDelivery(webhook, event);
        }
      }
    } catch (error) {
      console.error('WebhookService: Error handling event:', error);
    }
  }

  /**
   * Check if a webhook should be triggered for this event
   */
  private async shouldTrigger(webhook: Webhook, event: TaskEvent): Promise<boolean> {
    // Always trigger for direct event type matches
    if (webhook.triggers.includes(event.type as WebhookTrigger)) {
      // If there's a saved search, check if task matches its filters
      if (webhook.savedSearchId) {
        return this.taskMatchesSavedSearch(event.task as unknown as Record<string, unknown>, webhook.savedSearchId);
      }
      // If there's a filter query, check if task matches
      if (webhook.filterQuery) {
        return this.taskMatchesFilter(event.task as unknown as Record<string, unknown>, webhook.filterQuery);
      }
      return true;
    }

    // Handle task.entered_filter trigger
    if (webhook.triggers.includes('task.entered_filter')) {
      // Check if task now matches filter when it didn't before
      if (event.type === 'task.updated' || event.type === 'task.created') {
        // Check saved search first, then fall back to filter query
        if (webhook.savedSearchId) {
          return this.taskMatchesSavedSearch(event.task as unknown as Record<string, unknown>, webhook.savedSearchId);
        }
        if (webhook.filterQuery) {
          return this.taskMatchesFilter(event.task as unknown as Record<string, unknown>, webhook.filterQuery);
        }
      }
    }

    return false;
  }

  /**
   * Simple filter matching for task
   * Supports: status:value, priority/urgency:value, label:value, AND
   */
  private taskMatchesFilter(task: Record<string, unknown>, filterQuery: string): boolean {
    const conditions = filterQuery.split(/\s+AND\s+/i);

    for (const condition of conditions) {
      const match = condition.trim().match(/^(\w+):(.+)$/);
      if (!match) continue;

      const [, field, value] = match;

      if (field === 'status' && task.status !== value) return false;
      if ((field === 'priority' || field === 'urgency') && task.urgency !== value) return false;
      if (field === 'label' || field === 'tag') {
        const tags = task.tags as string[] | undefined;
        if (!tags || !tags.includes(value)) return false;
      }
    }

    return true;
  }

  /**
   * Check if a task matches a saved search's filters
   */
  private async taskMatchesSavedSearch(task: Record<string, unknown>, savedSearchId: ObjectId): Promise<boolean> {
    try {
      const db = getDb();
      const savedSearch = await db.collection<View>('views').findOne({ _id: savedSearchId });

      if (!savedSearch || !savedSearch.filters) {
        return true; // No filters means all tasks match
      }

      // Check each filter condition from the saved search
      for (const [key, value] of Object.entries(savedSearch.filters)) {
        if (value === undefined || value === null || value === '') continue;

        const taskValue = task[key];

        // Handle array filter values (like status: ['pending', 'in_progress'])
        if (Array.isArray(value)) {
          // If the filter has array values, task value must be in that array
          if (!value.includes(taskValue as string)) {
            return false;
          }
        } else if (key.endsWith('Id')) {
          // Handle ObjectId comparisons - convert both to strings for comparison
          let taskIdStr: string;
          if (taskValue && typeof (taskValue as ObjectId).toString === 'function' && (taskValue as ObjectId)._bsontype === 'ObjectId') {
            taskIdStr = (taskValue as ObjectId).toString();
          } else if (typeof taskValue === 'object' && taskValue !== null && '_id' in (taskValue as object)) {
            taskIdStr = String((taskValue as { _id: unknown })._id);
          } else {
            taskIdStr = String(taskValue ?? '');
          }
          const filterIdStr = value instanceof ObjectId ? value.toString() : String(value);

          if (taskIdStr !== filterIdStr) {
            return false;
          }
        } else {
          // Simple equality check for other fields
          if (taskValue !== value) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error('WebhookService: Error checking saved search filters:', error);
      return false; // Fail closed - don't trigger if we can't check
    }
  }

  /**
   * Queue a webhook delivery
   */
  private async queueDelivery(webhook: Webhook, event: TaskEvent): Promise<void> {
    const db = getDb();

    const payload = {
      event: {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
      },
      task: {
        id: event.taskId.toString(),
        ...event.task,
      },
      changes: event.changes,
    };

    const delivery: Omit<WebhookDelivery, '_id'> = {
      webhookId: webhook._id,
      eventId: event.id,
      eventType: event.type,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      createdAt: new Date(),
    };

    const result = await db.collection('webhook_deliveries').insertOne(delivery);

    // Try immediate delivery
    await this.attemptDelivery(result.insertedId, webhook, payload);
  }

  /**
   * Attempt to deliver a webhook
   */
  private async attemptDelivery(
    deliveryId: ObjectId,
    webhook: Webhook,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const db = getDb();

    try {
      // Update attempt count
      await db.collection('webhook_deliveries').updateOne(
        { _id: deliveryId },
        { $inc: { attempts: 1 } }
      );

      // Make HTTP request
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhook.secret,
          'X-Webhook-Event': payload.event ? (payload.event as Record<string, unknown>).type as string : '',
          'X-Webhook-Delivery': deliveryId.toString(),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        // Success
        await db.collection('webhook_deliveries').updateOne(
          { _id: deliveryId },
          {
            $set: {
              status: 'success',
              statusCode: response.status,
              responseBody: responseBody.slice(0, 1000),
              completedAt: new Date(),
            },
          }
        );
        return true;
      } else {
        // HTTP error
        await this.handleDeliveryFailure(deliveryId, `HTTP ${response.status}`, response.status);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.handleDeliveryFailure(deliveryId, errorMessage);
      return false;
    }
  }

  /**
   * Handle delivery failure and schedule retry if applicable
   */
  private async handleDeliveryFailure(
    deliveryId: ObjectId,
    error: string,
    statusCode?: number
  ): Promise<void> {
    const db = getDb();

    const delivery = await db
      .collection<WebhookDelivery>('webhook_deliveries')
      .findOne({ _id: deliveryId });

    if (!delivery) return;

    const attempts = delivery.attempts;

    if (attempts >= this.maxAttempts) {
      // Max retries exceeded
      await db.collection('webhook_deliveries').updateOne(
        { _id: deliveryId },
        {
          $set: {
            status: 'failed',
            error,
            statusCode,
            completedAt: new Date(),
          },
        }
      );
    } else {
      // Schedule retry
      const retryDelay = this.retryIntervals[Math.min(attempts - 1, this.retryIntervals.length - 1)];
      const nextRetryAt = new Date(Date.now() + retryDelay);

      await db.collection('webhook_deliveries').updateOne(
        { _id: deliveryId },
        {
          $set: {
            status: 'retrying',
            error,
            statusCode,
            nextRetryAt,
          },
        }
      );
    }
  }

  /**
   * Start the retry processor
   */
  private startRetryProcessor(): void {
    // Check for pending retries every 10 seconds
    this.retryTimer = setInterval(() => {
      this.processRetries().catch(console.error);
    }, 10000);
  }

  /**
   * Process pending retries
   */
  private async processRetries(): Promise<void> {
    try {
      const db = getDb();

      const pendingRetries = await db
        .collection<WebhookDelivery>('webhook_deliveries')
        .find({
          status: 'retrying',
          nextRetryAt: { $lte: new Date() },
        })
        .limit(10)
        .toArray();

      for (const delivery of pendingRetries) {
        const webhook = await db
          .collection<Webhook>('webhooks')
          .findOne({ _id: delivery.webhookId });

        if (webhook && webhook.isActive) {
          await this.attemptDelivery(delivery._id, webhook, delivery.payload);
        } else {
          // Webhook no longer active, mark as failed
          await db.collection('webhook_deliveries').updateOne(
            { _id: delivery._id },
            {
              $set: {
                status: 'failed',
                error: 'Webhook inactive or deleted',
                completedAt: new Date(),
              },
            }
          );
        }
      }
    } catch (error) {
      console.error('WebhookService: Error processing retries:', error);
    }
  }

  /**
   * Get delivery history for a webhook
   */
  async getDeliveryHistory(
    webhookId: ObjectId,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ data: WebhookDelivery[]; total: number }> {
    const { limit = 50, offset = 0 } = options;
    const db = getDb();

    const [deliveries, total] = await Promise.all([
      db
        .collection<WebhookDelivery>('webhook_deliveries')
        .find({ webhookId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('webhook_deliveries').countDocuments({ webhookId }),
    ]);

    return { data: deliveries, total };
  }

  /**
   * Get all deliveries across all webhooks
   */
  async getAllDeliveries(
    options: { limit?: number; offset?: number; status?: string } = {}
  ): Promise<{ data: WebhookDelivery[]; total: number }> {
    const { limit = 50, offset = 0, status } = options;
    const db = getDb();

    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    }

    const [deliveries, total] = await Promise.all([
      db
        .collection<WebhookDelivery>('webhook_deliveries')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('webhook_deliveries').countDocuments(filter),
    ]);

    return { data: deliveries, total };
  }

  /**
   * Retry a specific delivery
   */
  async retryDelivery(deliveryId: ObjectId): Promise<boolean> {
    const db = getDb();

    const delivery = await db
      .collection<WebhookDelivery>('webhook_deliveries')
      .findOne({ _id: deliveryId });

    if (!delivery) return false;

    const webhook = await db
      .collection<Webhook>('webhooks')
      .findOne({ _id: delivery.webhookId });

    if (!webhook) return false;

    // Reset attempts and status
    await db.collection('webhook_deliveries').updateOne(
      { _id: deliveryId },
      {
        $set: {
          status: 'pending',
          attempts: 0,
          error: null,
          nextRetryAt: null,
        },
      }
    );

    return this.attemptDelivery(deliveryId, webhook, delivery.payload);
  }

  /**
   * Test a webhook by sending a test event
   */
  async testWebhook(webhookId: ObjectId): Promise<{ success: boolean; error?: string }> {
    const db = getDb();

    const webhook = await db.collection<Webhook>('webhooks').findOne({ _id: webhookId });
    if (!webhook) {
      return { success: false, error: 'Webhook not found' };
    }

    const testPayload = {
      event: {
        id: `test_${Date.now()}`,
        type: 'webhook.test',
        timestamp: new Date().toISOString(),
      },
      task: {
        id: 'test-task-id',
        title: 'Test Task',
        status: 'pending',
      },
      test: true,
    };

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhook.secret,
          'X-Webhook-Event': 'webhook.test',
          'X-Webhook-Test': 'true',
        },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        return { success: true };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Cleanup old deliveries
   */
  async cleanupOldDeliveries(daysToKeep: number = 30): Promise<number> {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const result = await db.collection('webhook_deliveries').deleteMany({
      createdAt: { $lt: cutoff },
      status: { $in: ['success', 'failed'] },
    });

    return result.deletedCount;
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

// Singleton instance
export const webhookService = new WebhookService();

export default webhookService;
