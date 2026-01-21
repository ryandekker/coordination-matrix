import { ObjectId, Db } from 'mongodb';
import { User } from '../types/index.js';

/**
 * Well-known ObjectId for the system user.
 * This user is assigned to tasks that are executed by the system
 * (webhooks, joins, external callbacks, etc.) rather than humans or AI agents.
 *
 * Using a well-known ID allows consistent reference across:
 * - Database seeding
 * - Task creation in workflows
 * - Frontend display logic
 */
export const SYSTEM_USER_ID = new ObjectId('000000000000000000000001');

/**
 * Display name for the system user
 */
export const SYSTEM_USER_DISPLAY_NAME = 'System';

/**
 * Task types that should be assigned to the system user by default
 * when no explicit assignee is specified.
 *
 * These are automated task types that are executed by the system
 * rather than requiring human or AI agent action.
 */
export const SYSTEM_EXECUTED_TASK_TYPES = [
  'webhook',      // Outbound HTTP calls
  'external',     // External callbacks
  'join',         // Fan-in synchronization
  'decision',     // Conditional branching (evaluated by system)
  'trigger',      // Workflow entry points
  'flow',         // Nested workflow tasks
] as const;

/**
 * Check if a task type should default to the system user
 */
export function isSystemExecutedTaskType(taskType: string | undefined): boolean {
  if (!taskType) return false;
  return (SYSTEM_EXECUTED_TASK_TYPES as readonly string[]).includes(taskType);
}

/**
 * Get or create the system user in the database.
 * This is useful for ensuring the system user exists during migrations
 * or if the database was initialized without the seed data.
 */
export async function ensureSystemUser(db: Db): Promise<User> {
  const users = db.collection<User>('users');

  // Try to find existing system user
  let systemUser = await users.findOne({ _id: SYSTEM_USER_ID });

  if (!systemUser) {
    // Create the system user if it doesn't exist
    const now = new Date();
    const newSystemUser: User = {
      _id: SYSTEM_USER_ID,
      displayName: SYSTEM_USER_DISPLAY_NAME,
      role: 'operator',
      isActive: true,
      isSystem: true,
      botColor: '#6B7280', // Gray - neutral system color
      createdAt: now,
      updatedAt: now,
    };

    await users.insertOne(newSystemUser);
    systemUser = newSystemUser;
  }

  return systemUser;
}

/**
 * Check if a user ID refers to the system user
 */
export function isSystemUserId(userId: ObjectId | string | null | undefined): boolean {
  if (!userId) return false;
  const id = typeof userId === 'string' ? userId : userId.toHexString();
  return id === SYSTEM_USER_ID.toHexString();
}
