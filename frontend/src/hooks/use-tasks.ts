'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, lookupsApi, fieldConfigsApi, viewsApi, viewFoldersApi, usersApi, workflowsApi, tagsApi, Task, ViewFolder } from '@/lib/api'

// Helper to normalize query params for consistent cache keys
function normalizeParams(params?: Record<string, string | number | boolean>): string {
  if (!params) return ''
  // Sort keys and create a stable string representation
  const sortedKeys = Object.keys(params).sort()
  return sortedKeys.map(k => `${k}:${params[k]}`).join('|')
}

interface UseTasksOptions extends Record<string, string | number | boolean | undefined> {
  enabled?: boolean
}

export function useTasks(options?: UseTasksOptions) {
  const { enabled = true, ...params } = options || {}

  // Create a stable query key by normalizing params
  const normalizedKey = normalizeParams(params as Record<string, string | number | boolean>)

  return useQuery({
    queryKey: ['tasks', normalizedKey],
    queryFn: () => tasksApi.list(params as Record<string, string | number | boolean | string[]>),
    enabled,
    staleTime: 30 * 1000, // 30 seconds - reduce refetching
  })
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => (id ? tasksApi.get(id, { includeChildren: 'true', resolveReferences: 'true' }) : null),
    enabled: !!id,
  })
}

export function useTaskTree(params?: Record<string, string>) {
  const normalizedKey = normalizeParams(params as Record<string, string | number | boolean>)

  return useQuery({
    queryKey: ['task-tree', normalizedKey],
    queryFn: () => tasksApi.getTree(params),
  })
}

interface UseTaskChildrenOptions {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export function useTaskChildren(parentId: string | null, options?: UseTaskChildrenOptions) {
  const { page = 1, limit = 50, sortBy = 'createdAt', sortOrder = 'asc' } = options || {}

  return useQuery({
    queryKey: ['task-children', parentId, { page, limit, sortBy, sortOrder }],
    queryFn: () => (parentId ? tasksApi.getChildren(parentId, { page, limit, sortBy, sortOrder }) : null),
    enabled: !!parentId,
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: tasksApi.create,
    onSuccess: (result) => {
      // Invalidate all task queries
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
      // If this is a subtask, invalidate the parent's children query
      if (result?.data?.parentId) {
        queryClient.invalidateQueries({ queryKey: ['task-children', result.data.parentId] })
      }
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      tasksApi.update(id, data),
    // Use optimistic updates to prevent table refresh/collapse
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      await queryClient.cancelQueries({ queryKey: ['task', id] })

      // Snapshot previous values
      const previousTask = queryClient.getQueryData(['task', id])
      const previousTasks = queryClient.getQueriesData({ queryKey: ['tasks'] })

      // Build resolved references for the optimistic update
      // This ensures UI displays correctly without waiting for server response
      let resolvedUpdates: Record<string, unknown> = {}
      // Note: fieldPath is 'assigneeId' but _resolved uses 'assignee'
      if ('assigneeId' in data) {
        // Look up user from cache to get full user object for _resolved
        const usersCache = queryClient.getQueryData(['users']) as { data: { _id: string; displayName?: string; email?: string; isAgent?: boolean; botColor?: string; profilePicture?: string }[] } | undefined
        const assigneeId = (data as { assigneeId?: string }).assigneeId
        const user = assigneeId ? usersCache?.data?.find(u => u._id === assigneeId) : null
        resolvedUpdates.assignee = user || null
      }

      // Helper to apply both data and resolved updates to a task
      const applyUpdates = (task: Task): Task => {
        const updated = { ...task, ...data }
        if (Object.keys(resolvedUpdates).length > 0) {
          updated._resolved = { ...task._resolved, ...resolvedUpdates }
        }
        return updated
      }

      // Optimistically update the specific task
      queryClient.setQueryData(['task', id], (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task }
        return { ...oldData, data: applyUpdates(oldData.data) }
      })

      // Optimistically update task in lists
      queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[]; pagination: unknown }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            task._id === id ? applyUpdates(task) : task
          )
        }
      })

      // Optimistically update task tree
      queryClient.setQueriesData({ queryKey: ['task-tree'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: updateTaskInTreeWithResolver(oldData.data, id, applyUpdates)
        }
      })

      // Optimistically update task children
      queryClient.setQueriesData({ queryKey: ['task-children'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            task._id === id ? applyUpdates(task) : task
          )
        }
      })

      return { previousTask, previousTasks }
    },
    onError: (_err, { id }, context) => {
      // Rollback on error
      if (context?.previousTask) {
        queryClient.setQueryData(['task', id], context.previousTask)
      }
      if (context?.previousTasks) {
        context.previousTasks.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    // SSE will handle real-time updates, so we don't need to invalidate
    // Only invalidate the specific task to get the resolved references
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['task', id] })
    },
  })
}

// Helper to recursively update a task in a tree structure
function updateTaskInTree(tasks: Task[], taskId: string, updates: Partial<Task>): Task[] {
  return tasks.map(task => {
    if (task._id === taskId) {
      return { ...task, ...updates }
    }
    if (task.children && task.children.length > 0) {
      return {
        ...task,
        children: updateTaskInTree(task.children, taskId, updates)
      }
    }
    return task
  })
}

// Helper to recursively update a task in a tree using a resolver function
function updateTaskInTreeWithResolver(tasks: Task[], taskId: string, resolver: (task: Task) => Task): Task[] {
  return tasks.map(task => {
    if (task._id === taskId) {
      return resolver(task)
    }
    if (task.children && task.children.length > 0) {
      return {
        ...task,
        children: updateTaskInTreeWithResolver(task.children, taskId, resolver)
      }
    }
    return task
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, deleteChildren = true }: { id: string; deleteChildren?: boolean }) =>
      tasksApi.delete(id, deleteChildren),
    onSuccess: (_data, { id }) => {
      // Remove the specific task from cache
      queryClient.removeQueries({ queryKey: ['task', id] })
      // Invalidate task lists (but don't force immediate refetch)
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-tree'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-children'], refetchType: 'none' })
    },
  })
}

export function useRerunTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, options }: { id: string; options?: { clearMetadata?: boolean; preserveInput?: boolean } }) =>
      tasksApi.rerun(id, options),
    onSuccess: (_data, variables) => {
      // Invalidate all task-related queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', variables.id] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
      queryClient.invalidateQueries({ queryKey: ['task-children'] })
      queryClient.invalidateQueries({ queryKey: ['activity-logs'] })
    },
  })
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskIds, updates }: { taskIds: string[]; updates: Partial<Task> }) =>
      tasksApi.bulkUpdate(taskIds, updates),
    // Use optimistic updates to prevent table refresh/collapse
    onMutate: async ({ taskIds, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      await queryClient.cancelQueries({ queryKey: ['task-tree'] })
      await queryClient.cancelQueries({ queryKey: ['task-children'] })

      // Snapshot previous values
      const previousTasks = queryClient.getQueriesData({ queryKey: ['tasks'] })
      const previousTaskTree = queryClient.getQueriesData({ queryKey: ['task-tree'] })
      const previousTaskChildren = queryClient.getQueriesData({ queryKey: ['task-children'] })

      const taskIdSet = new Set(taskIds)

      // Optimistically update tasks in lists
      queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[]; pagination: unknown }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            taskIdSet.has(task._id) ? { ...task, ...updates } : task
          )
        }
      })

      // Optimistically update task tree
      queryClient.setQueriesData({ queryKey: ['task-tree'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: updateTasksInTree(oldData.data, taskIdSet, updates)
        }
      })

      // Optimistically update task children
      queryClient.setQueriesData({ queryKey: ['task-children'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            taskIdSet.has(task._id) ? { ...task, ...updates } : task
          )
        }
      })

      return { previousTasks, previousTaskTree, previousTaskChildren }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        context.previousTasks.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
      if (context?.previousTaskTree) {
        context.previousTaskTree.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
      if (context?.previousTaskChildren) {
        context.previousTaskChildren.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSettled: () => {
      // Invalidate without forcing immediate refetch - data already optimistically updated
      // SSE will handle real-time sync
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-tree'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-children'], refetchType: 'none' })
    },
  })
}

// Helper to recursively update multiple tasks in a tree structure
function updateTasksInTree(tasks: Task[], taskIds: Set<string>, updates: Partial<Task>): Task[] {
  return tasks.map(task => {
    const updatedTask = taskIds.has(task._id) ? { ...task, ...updates } : task
    if (task.children && task.children.length > 0) {
      return {
        ...updatedTask,
        children: updateTasksInTree(task.children, taskIds, updates)
      }
    }
    return updatedTask
  })
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskIds: string[]) => tasksApi.bulkDelete(taskIds),
    onMutate: async (taskIds) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] })

      // Snapshot previous values
      const previousTasks = queryClient.getQueriesData({ queryKey: ['tasks'] })

      const taskIdSet = new Set(taskIds)

      // Optimistically remove tasks from lists
      queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[]; pagination: { total: number } }
        return {
          ...oldData,
          data: oldData.data.filter((task: Task) => !taskIdSet.has(task._id)),
          pagination: {
            ...oldData.pagination,
            total: Math.max(0, oldData.pagination.total - taskIds.length)
          }
        }
      })

      return { previousTasks }
    },
    onError: (_err, _taskIds, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        context.previousTasks.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSettled: () => {
      // Invalidate without forcing immediate refetch
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-tree'], refetchType: 'none' })
      queryClient.invalidateQueries({ queryKey: ['task-children'], refetchType: 'none' })
    },
  })
}

// Lookups
export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => lookupsApi.getAll(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Field Configs
export function useFieldConfigs(collection: string) {
  return useQuery({
    queryKey: ['field-configs', collection],
    queryFn: () => fieldConfigsApi.getForCollection(collection),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Views
export function useViews(collectionName?: string, groupId?: string) {
  return useQuery({
    queryKey: ['views', collectionName, groupId],
    queryFn: () => viewsApi.list(collectionName, groupId),
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useCreateView() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: viewsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] })
    },
  })
}

export function useUpdateView() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<unknown> }) =>
      viewsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] })
    },
  })
}

export function useDeleteView() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: viewsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] })
    },
  })
}

// View Folders
export function useViewFolders(collectionName?: string) {
  return useQuery({
    queryKey: ['view-folders', collectionName],
    queryFn: () => viewFoldersApi.list(collectionName),
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useCreateViewFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: viewFoldersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['view-folders'] })
    },
  })
}

export function useUpdateViewFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ViewFolder> }) =>
      viewFoldersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['view-folders'] })
    },
  })
}

export function useDeleteViewFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, moveViewsToRoot = true }: { id: string; moveViewsToRoot?: boolean }) =>
      viewFoldersApi.delete(id, moveViewsToRoot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['view-folders'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
    },
  })
}

// Users
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Workflows
export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowsApi.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Tags
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Task Documents
export function useTaskDocuments(taskId: string | null) {
  return useQuery({
    queryKey: ['task-documents', taskId],
    queryFn: () => (taskId ? tasksApi.getDocuments(taskId) : null),
    enabled: !!taskId,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useAttachDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, data }: {
      taskId: string
      data: { documentId: string } | {
        title: string
        content: string
        type?: string
        status?: string
        summary?: string
        tags?: string[]
        metadata?: Record<string, unknown>
      }
    }) => tasksApi.attachDocument(taskId, data as Parameters<typeof tasksApi.attachDocument>[1]),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-documents', taskId] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useDetachDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, documentId }: { taskId: string; documentId: string }) =>
      tasksApi.detachDocument(taskId, documentId),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-documents', taskId] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}
