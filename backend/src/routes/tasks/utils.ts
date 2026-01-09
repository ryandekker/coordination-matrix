import { ObjectId, Filter } from 'mongodb';
import { createError } from '../../middleware/error-handler.js';
import { Task } from '../../types/index.js';

// Helper to parse ObjectId safely
export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw createError('Invalid ID format', 400);
  }
  return new ObjectId(id);
}

// Helper to resolve {{currentUserId}} placeholder
export function resolveUserPlaceholder(value: string, currentUserId?: string): string {
  if (value === '{{currentUserId}}' && currentUserId) {
    return currentUserId;
  }
  return value;
}

// Helper to build filter from query params
export function buildFilter(query: Record<string, unknown>, currentUserId?: string): Filter<Task> {
  const filter: Filter<Task> = {};
  const { search, filters, parentId, rootOnly, status, urgency, assigneeId, tags, includeArchived } = query;

  // By default, exclude archived tasks unless explicitly requested
  const shouldIncludeArchived = includeArchived === 'true' || includeArchived === true;

  // Text search
  if (search && typeof search === 'string') {
    filter.$text = { $search: search };
  }

  // Check if any filters are active (meaning we should flatten the view)
  const hasActiveFilters = !!(
    search ||
    status ||
    urgency ||
    assigneeId ||
    tags ||
    (filters && typeof filters === 'object' && Object.keys(filters as object).length > 0)
  );

  // Parent filter - flow tasks should appear at root level even if they have a parent
  // When filters are active, skip rootOnly to show all matching tasks (flattened view)
  if ((rootOnly === 'true' || rootOnly === true) && !hasActiveFilters) {
    // Show root tasks OR flow tasks (flow tasks appear at both root and under parent)
    filter.$or = [
      { parentId: null },
      { taskType: 'flow', parentId: { $ne: null } }
    ];
  } else if (parentId) {
    filter.parentId = toObjectId(parentId as string);
  }

  // Status filter
  if (status) {
    // Explicit status filter provided - use it as-is
    if (Array.isArray(status)) {
      (filter as Record<string, unknown>).status = { $in: status };
    } else {
      (filter as Record<string, unknown>).status = status as string;
    }
  } else if (!shouldIncludeArchived) {
    // No explicit status filter - exclude archived by default
    (filter as Record<string, unknown>).status = { $ne: 'archived' };
  }

  // Urgency filter
  if (urgency) {
    if (Array.isArray(urgency)) {
      (filter as Record<string, unknown>).urgency = { $in: urgency };
    } else {
      (filter as Record<string, unknown>).urgency = urgency as string;
    }
  }

  // Assignee filter
  if (assigneeId) {
    // Handle special __unassigned__ marker for null values
    if (assigneeId === '__unassigned__' || (Array.isArray(assigneeId) && assigneeId.includes('__unassigned__'))) {
      filter.assigneeId = { $eq: null } as unknown as ObjectId;
    } else if (Array.isArray(assigneeId)) {
      const resolvedIds = assigneeId
        .map((id) => resolveUserPlaceholder(id as string, currentUserId))
        .filter((id) => id !== '{{currentUserId}}')
        .map((id) => toObjectId(id));
      if (resolvedIds.length > 0) {
        filter.assigneeId = { $in: resolvedIds };
      }
    } else {
      const resolvedAssigneeId = resolveUserPlaceholder(assigneeId as string, currentUserId);
      // Skip if placeholder couldn't be resolved (no current user)
      if (resolvedAssigneeId !== '{{currentUserId}}') {
        filter.assigneeId = toObjectId(resolvedAssigneeId);
      }
    }
  }

  // Tags filter
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    filter.tags = { $in: tagArray };
  }

  // Custom filters
  if (filters && typeof filters === 'object') {
    Object.entries(filters as Record<string, unknown>).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Handle special __unassigned__ marker for null values (e.g., assigneeId: ['__unassigned__'])
        if (Array.isArray(value) && value.includes('__unassigned__')) {
          (filter as Record<string, unknown>)[key] = { $eq: null };
        // Handle arrays - convert to $in query for multi-value filters (e.g., status: ['pending', 'in_progress'])
        } else if (Array.isArray(value)) {
          (filter as Record<string, unknown>)[key] = { $in: value };
        // Handle ObjectId fields
        } else if (key.endsWith('Id') && typeof value === 'string' && ObjectId.isValid(value)) {
          (filter as Record<string, unknown>)[key] = new ObjectId(value);
        } else {
          (filter as Record<string, unknown>)[key] = value;
        }
      }
    });
  }

  // Final archived exclusion check: if we ended up with a status filter that explicitly
  // includes 'archived', remove it from the array (unless includeArchived is true)
  if (!shouldIncludeArchived) {
    const currentStatusFilter = (filter as Record<string, unknown>).status;
    if (currentStatusFilter) {
      // Status filter exists - check if it explicitly includes 'archived'
      if (typeof currentStatusFilter === 'object' && '$in' in (currentStatusFilter as object)) {
        const statusValues = (currentStatusFilter as { $in: unknown[] }).$in;
        if (Array.isArray(statusValues) && statusValues.includes('archived')) {
          // Remove 'archived' from the array
          const filteredValues = statusValues.filter(s => s !== 'archived');
          if (filteredValues.length > 0) {
            (filter as Record<string, unknown>).status = { $in: filteredValues };
          } else {
            // If no values left, use $ne: 'archived' instead
            (filter as Record<string, unknown>).status = { $ne: 'archived' };
          }
        }
      } else if (currentStatusFilter === 'archived') {
        // Single status is 'archived' but includeArchived is false - this shouldn't match anything
        // Use an impossible condition to return no results
        (filter as Record<string, unknown>).status = { $in: [] };
      }
    }
    // If no status filter at all, lines 71-73 already added $ne: 'archived'
  }

  return filter;
}
