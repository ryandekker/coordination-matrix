import { EventEmitter } from 'events';
import { ObjectId } from 'mongodb';
import { Task, TaskEvent, TaskEventType, FieldChange, EventHandler } from '../types/index.js';

/**
 * Event Bus - Pub/Sub backbone for the event system
 *
 * Provides a centralized event bus that all components can subscribe to:
 * - Activity log writer
 * - Webhook dispatcher
 * - Local automation daemon
 */
class EventBus {
  private emitter: EventEmitter;
  private handlers: Map<string, Set<EventHandler>>;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Allow many subscribers
    this.handlers = new Map();
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Publish a task event to all subscribers
   */
  async publish(event: Omit<TaskEvent, 'id' | 'timestamp'>): Promise<TaskEvent> {
    const fullEvent: TaskEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date(),
    };

    // Emit to all wildcard handlers first
    this.emitter.emit('*', fullEvent);

    // Emit to specific event type handlers
    this.emitter.emit(event.type, fullEvent);

    // Emit field-specific events if changes exist
    if (event.changes) {
      for (const change of event.changes) {
        const fieldEvent = `task.${change.field}.changed`;
        this.emitter.emit(fieldEvent, fullEvent);
      }
    }

    return fullEvent;
  }

  /**
   * Subscribe to events
   * @param eventType - Event type to subscribe to, or '*' for all events
   * @param handler - Async function to handle events
   */
  subscribe(eventType: TaskEventType | '*', handler: EventHandler): () => void {
    this.emitter.on(eventType, handler);

    // Track handlers for cleanup
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(eventType, handler);
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Subscribe to multiple event types
   */
  subscribeMany(eventTypes: (TaskEventType | '*')[], handler: EventHandler): () => void {
    const unsubscribers = eventTypes.map(type => this.subscribe(type, handler));
    return () => unsubscribers.forEach(unsub => unsub());
  }

  /**
   * One-time subscription
   */
  once(eventType: TaskEventType | '*', handler: EventHandler): void {
    this.emitter.once(eventType, handler);
  }

  /**
   * Get subscriber count for an event type
   */
  listenerCount(eventType: TaskEventType | '*'): number {
    return this.emitter.listenerCount(eventType);
  }

  /**
   * Remove all handlers for an event type
   */
  removeAllListeners(eventType?: TaskEventType | '*'): void {
    if (eventType) {
      this.emitter.removeAllListeners(eventType);
      this.handlers.delete(eventType);
    } else {
      this.emitter.removeAllListeners();
      this.handlers.clear();
    }
  }
}

// Singleton instance
export const eventBus = new EventBus();

/**
 * Helper to compute field changes between old and new task
 */
export function computeChanges(oldTask: Partial<Task>, newTask: Partial<Task>): FieldChange[] {
  const changes: FieldChange[] = [];
  // Track all actual Task fields from the schema
  const trackedFields = [
    'title', 'summary', 'extraPrompt', 'additionalInfo', 'status', 'urgency',
    'parentId', 'workflowId', 'workflowStage', 'externalId', 'externalHoldDate',
    'assigneeId', 'createdById', 'tags', 'dueAt'
  ];

  for (const field of trackedFields) {
    const oldValue = (oldTask as Record<string, unknown>)[field];
    const newValue = (newTask as Record<string, unknown>)[field];

    // Normalize ObjectId comparisons
    const oldStr = oldValue instanceof ObjectId ? oldValue.toString() : JSON.stringify(oldValue);
    const newStr = newValue instanceof ObjectId ? newValue.toString() : JSON.stringify(newValue);

    if (oldStr !== newStr) {
      changes.push({
        field,
        oldValue: oldValue ?? null,
        newValue: newValue ?? null,
      });
    }
  }

  return changes;
}

/**
 * Determine additional specific event types based on changes
 */
export function getSpecificEventTypes(changes: FieldChange[]): TaskEventType[] {
  const types: TaskEventType[] = [];

  for (const change of changes) {
    switch (change.field) {
      case 'status':
        types.push('task.status.changed');
        break;
      case 'assigneeId':
        types.push('task.assignee.changed');
        break;
      case 'urgency':
        types.push('task.priority.changed');
        break;
    }
  }

  return types;
}

/**
 * Create and publish a task event
 */
export async function publishTaskEvent(
  type: TaskEventType,
  task: Task,
  options: {
    changes?: FieldChange[];
    actorId?: ObjectId | null;
    actorType?: 'user' | 'system' | 'daemon';
    metadata?: Record<string, unknown>;
  } = {}
): Promise<TaskEvent> {
  return eventBus.publish({
    type,
    taskId: task._id,
    task,
    changes: options.changes,
    actorId: options.actorId ?? null,
    actorType: options.actorType ?? 'system',
    metadata: options.metadata,
  });
}

export default eventBus;
