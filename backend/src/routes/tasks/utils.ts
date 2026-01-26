import { ObjectId, Filter } from 'mongodb';
import { Request } from 'express';
import { createError } from '../../middleware/error-handler.js';
import { Task } from '../../types/index.js';
import { isAdmin } from '../../middleware/authorize.js';

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
// The req parameter is optional for backward compatibility, but required for group filtering
export function buildFilter(query: Record<string, unknown>, currentUserId?: string, req?: Request): Filter<Task> {
  const filter: Filter<Task> = {};
  const { search, filters, parentId, rootOnly, status, urgency, assigneeId, tags, includeArchived, workflowId, workflowRunId, workflowStage, hasWorkflow, groupId, projectId } = query;

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
    workflowId ||
    workflowRunId ||
    workflowStage ||
    hasWorkflow ||
    (filters && typeof filters === 'object' && Object.keys(filters as object).length > 0)
  );

  // Parent filter - rootOnly shows only true root-level tasks
  // Subflow root tasks already have parentId: null, so they appear at root naturally
  // Flow step tasks that spawn subflows remain nested under their parent and link to the subflow root
  // When filters are active, skip rootOnly to show all matching tasks (flattened view)
  if ((rootOnly === 'true' || rootOnly === true) && !hasActiveFilters) {
    filter.parentId = null;
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

  // Workflow ID filter
  if (workflowId) {
    if (Array.isArray(workflowId)) {
      filter.workflowId = { $in: workflowId.map((id) => toObjectId(id as string)) };
    } else {
      filter.workflowId = toObjectId(workflowId as string);
    }
  }

  // Workflow Run ID filter
  if (workflowRunId) {
    if (Array.isArray(workflowRunId)) {
      filter.workflowRunId = { $in: workflowRunId.map((id) => toObjectId(id as string)) };
    } else {
      filter.workflowRunId = toObjectId(workflowRunId as string);
    }
  }

  // Workflow Stage filter
  if (workflowStage) {
    if (Array.isArray(workflowStage)) {
      (filter as Record<string, unknown>).workflowStage = { $in: workflowStage };
    } else {
      (filter as Record<string, unknown>).workflowStage = workflowStage as string;
    }
  }

  // Has Workflow filter (tasks that are part of any workflow)
  if (hasWorkflow === 'true' || hasWorkflow === true) {
    filter.workflowId = { $ne: null } as unknown as ObjectId;
  } else if (hasWorkflow === 'false' || hasWorkflow === false) {
    filter.workflowId = { $eq: null } as unknown as ObjectId;
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

  // Group ID filter - explicit filter for a specific group
  if (groupId) {
    if (Array.isArray(groupId)) {
      filter.groupId = { $in: groupId.map((id) => toObjectId(id as string)) };
    } else {
      filter.groupId = toObjectId(groupId as string);
    }
  }

  // Project ID filter
  if (projectId) {
    if (Array.isArray(projectId)) {
      filter.projectId = { $in: projectId.map((id) => toObjectId(id as string)) };
    } else {
      filter.projectId = toObjectId(projectId as string);
    }
  }

  // Group access filtering - restrict results to user's groups unless admin
  // This only applies if we have request context and no explicit groupId filter
  if (req && !groupId) {
    if (!isAdmin(req)) {
      const userGroupIds = req.userGroupIds || [];
      if (userGroupIds.length === 0) {
        // User has no group memberships - they can only see tasks without a group (none, since admin-only)
        // Return an impossible filter to match nothing
        (filter as Record<string, unknown>)._id = { $exists: false };
      } else {
        // User can only see tasks in their groups
        filter.groupId = { $in: userGroupIds };
      }
    }
    // Admins see all tasks - no additional filtering needed
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
