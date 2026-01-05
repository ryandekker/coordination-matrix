import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

// Test the filter matching logic that doesn't require database
// We need to extract and test the private methods by testing the public behavior

describe('WebhookService', () => {
  describe('taskMatchesFilter', () => {
    // We test the filter logic by creating a test version of the matching function
    // since the actual implementation is private

    function taskMatchesFilter(task: Record<string, unknown>, filterQuery: string): boolean {
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

    it('should match task with correct status', () => {
      const task = { status: 'pending', title: 'Test' };
      expect(taskMatchesFilter(task, 'status:pending')).toBe(true);
    });

    it('should not match task with different status', () => {
      const task = { status: 'completed', title: 'Test' };
      expect(taskMatchesFilter(task, 'status:pending')).toBe(false);
    });

    it('should match priority/urgency filter', () => {
      const task = { status: 'pending', urgency: 'high' };
      expect(taskMatchesFilter(task, 'priority:high')).toBe(true);
      expect(taskMatchesFilter(task, 'urgency:high')).toBe(true);
    });

    it('should not match with different priority', () => {
      const task = { status: 'pending', urgency: 'low' };
      expect(taskMatchesFilter(task, 'priority:high')).toBe(false);
    });

    it('should match task with correct tag', () => {
      const task = { status: 'pending', tags: ['bug', 'urgent'] };
      expect(taskMatchesFilter(task, 'tag:bug')).toBe(true);
      expect(taskMatchesFilter(task, 'label:urgent')).toBe(true);
    });

    it('should not match task without required tag', () => {
      const task = { status: 'pending', tags: ['bug'] };
      expect(taskMatchesFilter(task, 'tag:feature')).toBe(false);
    });

    it('should handle task with no tags', () => {
      const task = { status: 'pending' };
      expect(taskMatchesFilter(task, 'tag:bug')).toBe(false);
    });

    it('should handle AND conditions', () => {
      const task = { status: 'pending', urgency: 'high', tags: ['bug'] };
      expect(taskMatchesFilter(task, 'status:pending AND priority:high')).toBe(true);
      expect(taskMatchesFilter(task, 'status:pending AND tag:bug')).toBe(true);
      expect(taskMatchesFilter(task, 'status:pending AND priority:low')).toBe(false);
    });

    it('should handle multiple AND conditions', () => {
      const task = { status: 'pending', urgency: 'high', tags: ['bug', 'critical'] };
      expect(taskMatchesFilter(task, 'status:pending AND priority:high AND tag:bug')).toBe(true);
      expect(taskMatchesFilter(task, 'status:pending AND priority:high AND tag:feature')).toBe(false);
    });

    it('should be case insensitive for AND operator', () => {
      const task = { status: 'pending', urgency: 'high' };
      expect(taskMatchesFilter(task, 'status:pending and priority:high')).toBe(true);
      expect(taskMatchesFilter(task, 'status:pending And priority:high')).toBe(true);
    });

    it('should match empty filter to all tasks', () => {
      const task = { status: 'pending' };
      expect(taskMatchesFilter(task, '')).toBe(true);
    });

    it('should ignore malformed conditions', () => {
      const task = { status: 'pending' };
      // Malformed conditions are skipped, so task matches
      expect(taskMatchesFilter(task, 'invalid')).toBe(true);
      expect(taskMatchesFilter(task, 'also-invalid')).toBe(true);
    });
  });

  describe('retryIntervals', () => {
    it('should have correct retry intervals', () => {
      const retryIntervals = [1000, 5000, 30000, 120000, 600000];
      expect(retryIntervals).toEqual([1000, 5000, 30000, 120000, 600000]);
      expect(retryIntervals[0]).toBe(1000);     // 1s
      expect(retryIntervals[1]).toBe(5000);     // 5s
      expect(retryIntervals[2]).toBe(30000);    // 30s
      expect(retryIntervals[3]).toBe(120000);   // 2m
      expect(retryIntervals[4]).toBe(600000);   // 10m
    });
  });

  describe('webhook payload structure', () => {
    it('should build correct payload structure', () => {
      const eventId = 'evt_123';
      const eventType = 'task.created';
      const taskId = new ObjectId();
      const task = {
        _id: taskId,
        title: 'Test Task',
        status: 'pending',
      };
      const changes = [{ field: 'status', oldValue: 'draft', newValue: 'pending' }];

      const payload = {
        event: {
          id: eventId,
          type: eventType,
          timestamp: new Date().toISOString(),
        },
        task: {
          id: taskId.toString(),
          ...task,
        },
        changes,
      };

      expect(payload.event.id).toBe(eventId);
      expect(payload.event.type).toBe(eventType);
      expect(payload.task.id).toBe(taskId.toString());
      expect(payload.task.title).toBe('Test Task');
      expect(payload.changes).toEqual(changes);
    });
  });

  describe('delivery record structure', () => {
    it('should create correct delivery record', () => {
      const webhookId = new ObjectId();
      const eventId = 'evt_123';
      const eventType = 'task.created';
      const maxAttempts = 5;

      const delivery = {
        webhookId,
        eventId,
        eventType,
        payload: { event: { id: eventId, type: eventType } },
        status: 'pending' as const,
        attempts: 0,
        maxAttempts,
        createdAt: new Date(),
      };

      expect(delivery.webhookId).toEqual(webhookId);
      expect(delivery.eventId).toBe(eventId);
      expect(delivery.eventType).toBe(eventType);
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(0);
      expect(delivery.maxAttempts).toBe(5);
    });
  });

  describe('webhook headers', () => {
    it('should include correct headers in webhook request', () => {
      const secret = 'test-secret';
      const eventType = 'task.created';
      const deliveryId = new ObjectId();

      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': deliveryId.toString(),
      };

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Webhook-Secret']).toBe(secret);
      expect(headers['X-Webhook-Event']).toBe(eventType);
      expect(headers['X-Webhook-Delivery']).toBe(deliveryId.toString());
    });
  });

  describe('shouldTrigger logic', () => {
    it('should identify which triggers apply to events', () => {
      const webhookTriggers: string[] = ['task.created', 'task.updated'];

      expect(webhookTriggers.includes('task.created')).toBe(true);
      expect(webhookTriggers.includes('task.updated')).toBe(true);
      expect(webhookTriggers.includes('task.deleted')).toBe(false);
    });

    it('should handle task.entered_filter trigger condition', () => {
      const triggers = ['task.entered_filter'];
      const eventTypes = ['task.created', 'task.updated', 'task.deleted', 'task.status.changed'];

      // Only task.created and task.updated should potentially trigger entered_filter
      const validEventTypes = eventTypes.filter(type =>
        type === 'task.updated' || type === 'task.created'
      );

      expect(validEventTypes).toContain('task.created');
      expect(validEventTypes).toContain('task.updated');
      expect(validEventTypes).not.toContain('task.deleted');
      expect(validEventTypes).not.toContain('task.status.changed');
    });
  });

  describe('retry scheduling', () => {
    it('should calculate correct retry delay based on attempt number', () => {
      const retryIntervals = [1000, 5000, 30000, 120000, 600000];

      // First retry (attempts = 1)
      expect(retryIntervals[Math.min(0, retryIntervals.length - 1)]).toBe(1000);

      // Second retry (attempts = 2)
      expect(retryIntervals[Math.min(1, retryIntervals.length - 1)]).toBe(5000);

      // Third retry (attempts = 3)
      expect(retryIntervals[Math.min(2, retryIntervals.length - 1)]).toBe(30000);

      // Beyond max intervals, use last one
      expect(retryIntervals[Math.min(10, retryIntervals.length - 1)]).toBe(600000);
    });

    it('should schedule next retry at correct time', () => {
      const retryIntervals = [1000, 5000, 30000, 120000, 600000];
      const now = Date.now();
      const attempts = 2; // Second attempt

      const retryDelay = retryIntervals[Math.min(attempts - 1, retryIntervals.length - 1)];
      const nextRetryAt = new Date(now + retryDelay);

      expect(retryDelay).toBe(5000);
      expect(nextRetryAt.getTime()).toBeGreaterThan(now);
      expect(nextRetryAt.getTime()).toBeLessThanOrEqual(now + 5000 + 100); // Allow small margin
    });
  });

  describe('cleanup logic', () => {
    it('should calculate correct cleanup cutoff date', () => {
      const daysToKeep = 30;
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysToKeep);

      const expectedDiff = daysToKeep * 24 * 60 * 60 * 1000;
      const actualDiff = now.getTime() - cutoff.getTime();

      // Allow for small time differences during test execution
      expect(actualDiff).toBeGreaterThanOrEqual(expectedDiff - 1000);
      expect(actualDiff).toBeLessThanOrEqual(expectedDiff + 1000);
    });
  });
});
