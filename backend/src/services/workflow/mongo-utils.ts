import { ObjectId } from 'mongodb';

/**
 * Fields that are optional objectId references.
 * Old MongoDB validators may reject null for these fields, so we strip them.
 */
export const NULLABLE_ID_FIELDS = new Set(['parentId', 'createdById', 'assigneeId']);

/**
 * taskType values that exist in old Atlas validators.
 * New values like 'flow', 'trigger', 'agent', 'manual', 'webhook' are not in
 * the old enum and will cause validation failures. We strip these so the
 * optional taskType field is omitted rather than rejected.
 */
export const OLD_ATLAS_TASK_TYPES = new Set([
  'standard', 'decision', 'foreach', 'join', 'external', 'subflow'
]);

/**
 * Recursively strips undefined values and null values for optional objectId fields.
 * MongoDB validation can fail if undefined values are present in documents.
 * Old validators may also reject null for optional objectId fields.
 * Also strips taskType values not in the old Atlas enum.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
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
    // Skip undefined values
    if (value === undefined) continue;
    // Skip null values for optional objectId fields (old validators may reject null)
    if (value === null && NULLABLE_ID_FIELDS.has(key)) continue;
    // Skip taskType values not in old Atlas enum (optional field, omit rather than reject)
    if (key === 'taskType' && typeof value === 'string' && !OLD_ATLAS_TASK_TYPES.has(value)) continue;

    if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof ObjectId)) {
      result[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
