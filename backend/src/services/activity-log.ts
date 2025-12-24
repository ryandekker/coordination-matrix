import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';
import { TaskEvent, ActivityLogEntry, FieldChange } from '../types/index.js';

/**
 * Activity Log Service
 *
 * Subscribes to the event bus and persists activity entries to the database.
 * Provides methods for querying activity history and adding manual comments.
 */
class ActivityLogService {
  private initialized = false;

  /**
   * Resolve actor information for activity log entries
   * Populates the `actor` field with displayName and email from the users collection
   */
  private async populateActors(
    entries: ActivityLogEntry[]
  ): Promise<ActivityLogEntry[]> {
    if (entries.length === 0) return entries;

    const db = getDb();

    // Collect unique actorIds that need resolution
    const actorIds = new Set<string>();
    for (const entry of entries) {
      if (entry.actorId && entry.actorType === 'user') {
        actorIds.add(entry.actorId.toString());
      }
    }

    if (actorIds.size === 0) {
      // No user actors to resolve, just set actor based on actorType
      return entries.map((entry) => ({
        ...entry,
        actor:
          entry.actorType === 'system'
            ? { displayName: 'System' }
            : entry.actorType === 'daemon'
              ? { displayName: 'Automation Daemon' }
              : null,
      }));
    }

    // Fetch users in bulk
    const userObjectIds = Array.from(actorIds).map((id) => new ObjectId(id));
    const users = await db
      .collection('users')
      .find(
        { _id: { $in: userObjectIds } },
        { projection: { _id: 1, displayName: 1, email: 1 } }
      )
      .toArray();

    // Create lookup map
    const userMap = new Map<
      string,
      { displayName: string; email?: string }
    >();
    for (const user of users) {
      userMap.set(user._id.toString(), {
        displayName: user.displayName || 'Unknown User',
        email: user.email,
      });
    }

    // Populate actor field
    return entries.map((entry) => {
      if (entry.actorType === 'system') {
        return { ...entry, actor: { displayName: 'System' } };
      }
      if (entry.actorType === 'daemon') {
        return { ...entry, actor: { displayName: 'Automation Daemon' } };
      }
      if (entry.actorId) {
        const actor = userMap.get(entry.actorId.toString());
        return { ...entry, actor: actor || { displayName: 'Unknown User' } };
      }
      return { ...entry, actor: null };
    });
  }

  /**
   * Initialize the service and subscribe to events
   */
  initialize(): void {
    if (this.initialized) return;

    // Subscribe to all task events
    eventBus.subscribe('*', async (event: TaskEvent) => {
      await this.recordEvent(event);
    });

    this.initialized = true;
    console.log('ActivityLogService: Initialized and listening for events');
  }

  /**
   * Record an event to the activity log
   */
  async recordEvent(event: TaskEvent): Promise<ActivityLogEntry | null> {
    try {
      // Skip comment events - they are already recorded directly by addComment()
      if (event.type === 'task.comment.added') {
        return null;
      }

      const db = getDb();

      // Build entry, omitting undefined fields to avoid MongoDB validation errors
      const entry: Omit<ActivityLogEntry, '_id'> = {
        taskId: event.taskId,
        eventType: event.type,
        actorId: event.actorId ?? null,
        actorType: event.actorType,
        timestamp: event.timestamp,
      };

      // Only include optional fields if they have values
      if (event.changes && event.changes.length > 0) {
        entry.changes = event.changes;
      }
      if (event.metadata && Object.keys(event.metadata).length > 0) {
        entry.metadata = event.metadata;
      }

      const result = await db.collection('activity_logs').insertOne(entry);
      return { ...entry, _id: result.insertedId } as ActivityLogEntry;
    } catch (error) {
      console.error('ActivityLogService: Error recording event:', error);
      return null;
    }
  }

  /**
   * Add a manual comment to a task
   */
  async addComment(
    taskId: ObjectId,
    comment: string,
    actorId?: ObjectId | null,
    actorType: 'user' | 'system' | 'daemon' = 'user'
  ): Promise<ActivityLogEntry | null> {
    try {
      const db = getDb();

      const entry: Omit<ActivityLogEntry, '_id'> = {
        taskId,
        eventType: 'task.comment.added',
        actorId: actorId ?? null,
        actorType,
        comment,
        timestamp: new Date(),
      };

      const result = await db.collection('activity_logs').insertOne(entry);

      // Also publish to event bus for other subscribers
      await eventBus.publish({
        type: 'task.comment.added',
        taskId,
        task: {} as any, // Comment events don't include full task
        actorId,
        actorType,
        metadata: { comment },
      });

      return { ...entry, _id: result.insertedId } as ActivityLogEntry;
    } catch (error) {
      console.error('ActivityLogService: Error adding comment:', error);
      return null;
    }
  }

  /**
   * Get activity log entries for a task
   */
  async getTaskActivity(
    taskId: ObjectId,
    options: {
      limit?: number;
      offset?: number;
      eventTypes?: string[];
    } = {}
  ): Promise<{ data: ActivityLogEntry[]; total: number }> {
    const { limit = 50, offset = 0, eventTypes } = options;
    const db = getDb();

    const filter: Record<string, unknown> = { taskId };

    if (eventTypes && eventTypes.length > 0) {
      filter.eventType = { $in: eventTypes };
    }

    const [entries, total] = await Promise.all([
      db
        .collection<ActivityLogEntry>('activity_logs')
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('activity_logs').countDocuments(filter),
    ]);

    // Populate actor information
    const populatedEntries = await this.populateActors(entries);

    return { data: populatedEntries, total };
  }

  /**
   * Get recent activity across all tasks
   */
  async getRecentActivity(
    options: {
      limit?: number;
      offset?: number;
      eventTypes?: string[];
      actorId?: ObjectId;
    } = {}
  ): Promise<{ data: ActivityLogEntry[]; total: number }> {
    const { limit = 50, offset = 0, eventTypes, actorId } = options;
    const db = getDb();

    const filter: Record<string, unknown> = {};

    if (eventTypes && eventTypes.length > 0) {
      filter.eventType = { $in: eventTypes };
    }

    if (actorId) {
      filter.actorId = actorId;
    }

    const [entries, total] = await Promise.all([
      db
        .collection<ActivityLogEntry>('activity_logs')
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('activity_logs').countDocuments(filter),
    ]);

    // Populate actor information
    const populatedEntries = await this.populateActors(entries);

    return { data: populatedEntries, total };
  }

  /**
   * Delete activity logs for a task (used when task is deleted)
   */
  async deleteTaskActivity(taskId: ObjectId): Promise<number> {
    const db = getDb();
    const result = await db.collection('activity_logs').deleteMany({ taskId });
    return result.deletedCount;
  }

  /**
   * Cleanup old activity logs (retention policy)
   * Call this periodically to remove logs for deleted tasks
   */
  async cleanupOrphanedLogs(): Promise<number> {
    const db = getDb();

    // Get all unique taskIds from activity logs
    const taskIds = await db
      .collection('activity_logs')
      .distinct('taskId') as ObjectId[];

    if (taskIds.length === 0) return 0;

    // Find which tasks still exist
    const existingTasks = await db
      .collection('tasks')
      .find({ _id: { $in: taskIds } }, { projection: { _id: 1 } })
      .toArray();

    const existingTaskIds = new Set(existingTasks.map((t) => t._id.toString()));

    // Find orphaned taskIds
    const orphanedTaskIds = taskIds.filter(
      (id) => !existingTaskIds.has(id.toString())
    );

    if (orphanedTaskIds.length === 0) return 0;

    // Delete orphaned logs
    const result = await db.collection('activity_logs').deleteMany({
      taskId: { $in: orphanedTaskIds },
    });

    console.log(
      `ActivityLogService: Cleaned up ${result.deletedCount} orphaned activity logs`
    );
    return result.deletedCount;
  }

  /**
   * Format a field change for display
   */
  formatChange(change: FieldChange): string {
    const formatValue = (value: unknown): string => {
      if (value === null || value === undefined) return 'none';
      if (value instanceof ObjectId) return value.toString().slice(-6);
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    return `${change.field}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`;
  }
}

// Singleton instance
export const activityLogService = new ActivityLogService();

export default activityLogService;
