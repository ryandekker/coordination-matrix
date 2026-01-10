import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { eventBus, computeChanges, getSpecificEventTypes, publishTaskEvent } from './event-bus.js';
import type { Task, TaskEvent, FieldChange } from '../types/index.js';

// Create a mock task for testing
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    _id: new ObjectId(),
    title: 'Test Task',
    status: 'pending',
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('EventBus', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    eventBus.removeAllListeners();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  describe('subscribe', () => {
    it('should subscribe to specific event types', async () => {
      const handler = vi.fn();
      eventBus.subscribe('task.created', handler);

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('task.created');
    });

    it('should subscribe to wildcard (*) for all events', async () => {
      const handler = vi.fn();
      eventBus.subscribe('*', handler);

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });
      await eventBus.publish({
        type: 'task.updated',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('task.created', handler);

      unsubscribe();

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscribeMany', () => {
    it('should subscribe to multiple event types', async () => {
      const handler = vi.fn();
      eventBus.subscribeMany(['task.created', 'task.updated'], handler);

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });
      await eventBus.publish({
        type: 'task.updated',
        taskId: task._id,
        task,
        actorType: 'system',
      });
      await eventBus.publish({
        type: 'task.deleted',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function that removes all subscriptions', async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribeMany(['task.created', 'task.updated'], handler);

      unsubscribe();

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should only receive one event', async () => {
      const handler = vi.fn();
      eventBus.once('task.created', handler);

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });
      await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('publish', () => {
    it('should add id and timestamp to events', async () => {
      const handler = vi.fn();
      eventBus.subscribe('task.created', handler);

      const task = createMockTask();
      const event = await eventBus.publish({
        type: 'task.created',
        taskId: task._id,
        task,
        actorType: 'system',
      });

      expect(event.id).toBeDefined();
      expect(event.id).toMatch(/^evt_\d+_/);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should emit field-specific events for changes', async () => {
      const statusHandler = vi.fn();
      eventBus.subscribe('task.status.changed' as any, statusHandler);

      const task = createMockTask();
      await eventBus.publish({
        type: 'task.updated',
        taskId: task._id,
        task,
        actorType: 'system',
        changes: [{ field: 'status', oldValue: 'pending', newValue: 'completed' }],
      });

      expect(statusHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('listenerCount', () => {
    it('should return correct listener count', () => {
      expect(eventBus.listenerCount('task.created')).toBe(0);

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.subscribe('task.created', handler1);
      eventBus.subscribe('task.created', handler2);

      expect(eventBus.listenerCount('task.created')).toBe(2);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove listeners for specific event type', () => {
      const handler = vi.fn();
      eventBus.subscribe('task.created', handler);
      eventBus.subscribe('task.updated', handler);

      eventBus.removeAllListeners('task.created');

      expect(eventBus.listenerCount('task.created')).toBe(0);
      expect(eventBus.listenerCount('task.updated')).toBe(1);
    });

    it('should remove all listeners when no event type specified', () => {
      const handler = vi.fn();
      eventBus.subscribe('task.created', handler);
      eventBus.subscribe('task.updated', handler);

      eventBus.removeAllListeners();

      expect(eventBus.listenerCount('task.created')).toBe(0);
      expect(eventBus.listenerCount('task.updated')).toBe(0);
    });
  });

  describe('workflow run events', () => {
    it('should publish and subscribe to workflow run events', async () => {
      const handler = vi.fn();
      eventBus.subscribeWorkflowRun('workflow.run.started', handler);

      await eventBus.publishWorkflowRunEvent({
        id: 'wrevt_123',
        type: 'workflow.run.started',
        workflowRunId: new ObjectId(),
        workflowRun: {
          _id: new ObjectId(),
          workflowId: new ObjectId(),
          status: 'running',
          currentStepIds: [],
          completedStepIds: [],
          createdAt: new Date(),
        },
        actorType: 'system',
        timestamp: new Date(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support wildcard subscription for workflow run events', async () => {
      const handler = vi.fn();
      eventBus.subscribeWorkflowRun('*', handler);

      await eventBus.publishWorkflowRunEvent({
        id: 'wrevt_123',
        type: 'workflow.run.started',
        workflowRunId: new ObjectId(),
        workflowRun: {
          _id: new ObjectId(),
          workflowId: new ObjectId(),
          status: 'running',
          currentStepIds: [],
          completedStepIds: [],
          createdAt: new Date(),
        },
        actorType: 'system',
        timestamp: new Date(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('computeChanges', () => {
  it('should detect string field changes', () => {
    const oldTask = { title: 'Old Title' };
    const newTask = { title: 'New Title' };

    const changes = computeChanges(oldTask, newTask);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      field: 'title',
      oldValue: 'Old Title',
      newValue: 'New Title',
    });
  });

  it('should detect status changes', () => {
    const oldTask = { status: 'pending' as const };
    const newTask = { status: 'completed' as const };

    const changes = computeChanges(oldTask, newTask);

    expect(changes).toContainEqual({
      field: 'status',
      oldValue: 'pending',
      newValue: 'completed',
    });
  });

  it('should detect ObjectId changes', () => {
    const oldId = new ObjectId();
    const newId = new ObjectId();
    const oldTask = { assigneeId: oldId };
    const newTask = { assigneeId: newId };

    const changes = computeChanges(oldTask, newTask);

    expect(changes).toContainEqual({
      field: 'assigneeId',
      oldValue: oldId,
      newValue: newId,
    });
  });

  it('should detect array changes', () => {
    const oldTask = { tags: ['tag1'] };
    const newTask = { tags: ['tag1', 'tag2'] };

    const changes = computeChanges(oldTask, newTask);

    expect(changes).toContainEqual({
      field: 'tags',
      oldValue: ['tag1'],
      newValue: ['tag1', 'tag2'],
    });
  });

  it('should handle null to value changes', () => {
    const oldTask = { assigneeId: null };
    const newTask = { assigneeId: new ObjectId() };

    const changes = computeChanges(oldTask, newTask);

    expect(changes.find(c => c.field === 'assigneeId')).toBeDefined();
  });

  it('should return empty array when no changes', () => {
    const task = { title: 'Same', status: 'pending' as const };

    const changes = computeChanges(task, task);

    expect(changes).toHaveLength(0);
  });
});

describe('getSpecificEventTypes', () => {
  it('should return task.status.changed for status changes', () => {
    const changes: FieldChange[] = [
      { field: 'status', oldValue: 'pending', newValue: 'completed' },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toContain('task.status.changed');
  });

  it('should return task.assignee.changed for assigneeId changes', () => {
    const changes: FieldChange[] = [
      { field: 'assigneeId', oldValue: null, newValue: new ObjectId() },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toContain('task.assignee.changed');
  });

  it('should return task.priority.changed for urgency changes', () => {
    const changes: FieldChange[] = [
      { field: 'urgency', oldValue: 'normal', newValue: 'high' },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toContain('task.priority.changed');
  });

  it('should return task.metadata.changed for metadata changes', () => {
    const changes: FieldChange[] = [
      { field: 'metadata', oldValue: {}, newValue: { key: 'value' } },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toContain('task.metadata.changed');
  });

  it('should return multiple types for multiple changes', () => {
    const changes: FieldChange[] = [
      { field: 'status', oldValue: 'pending', newValue: 'completed' },
      { field: 'assigneeId', oldValue: null, newValue: new ObjectId() },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toContain('task.status.changed');
    expect(types).toContain('task.assignee.changed');
  });

  it('should return empty array for non-tracked field changes', () => {
    const changes: FieldChange[] = [
      { field: 'title', oldValue: 'Old', newValue: 'New' },
    ];

    const types = getSpecificEventTypes(changes);

    expect(types).toHaveLength(0);
  });
});

describe('publishTaskEvent', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('should publish event with task data', async () => {
    const handler = vi.fn();
    eventBus.subscribe('task.created', handler);

    const task = createMockTask({ title: 'Test Task' });
    await publishTaskEvent('task.created', task);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as TaskEvent;
    expect(event.task.title).toBe('Test Task');
    expect(event.taskId).toEqual(task._id);
  });

  it('should include changes when provided', async () => {
    const handler = vi.fn();
    eventBus.subscribe('task.updated', handler);

    const task = createMockTask();
    const changes: FieldChange[] = [
      { field: 'status', oldValue: 'pending', newValue: 'completed' },
    ];
    await publishTaskEvent('task.updated', task, { changes });

    const event = handler.mock.calls[0][0] as TaskEvent;
    expect(event.changes).toEqual(changes);
  });

  it('should include actorId when provided', async () => {
    const handler = vi.fn();
    eventBus.subscribe('task.updated', handler);

    const task = createMockTask();
    const actorId = new ObjectId();
    await publishTaskEvent('task.updated', task, { actorId, actorType: 'user' });

    const event = handler.mock.calls[0][0] as TaskEvent;
    expect(event.actorId).toEqual(actorId);
    expect(event.actorType).toBe('user');
  });

  it('should default actorType to system', async () => {
    const handler = vi.fn();
    eventBus.subscribe('task.created', handler);

    const task = createMockTask();
    await publishTaskEvent('task.created', task);

    const event = handler.mock.calls[0][0] as TaskEvent;
    expect(event.actorType).toBe('system');
  });

  it('should include metadata when provided', async () => {
    const handler = vi.fn();
    eventBus.subscribe('task.updated', handler);

    const task = createMockTask();
    const metadata = { source: 'api', correlationId: '123' };
    await publishTaskEvent('task.updated', task, { metadata });

    const event = handler.mock.calls[0][0] as TaskEvent;
    expect(event.metadata).toEqual(metadata);
  });
});
