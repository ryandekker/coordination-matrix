'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, lookupsApi, fieldConfigsApi, viewsApi, usersApi, workflowsApi, Task } from '@/lib/api'

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

      // Optimistically update the specific task
      queryClient.setQueryData(['task', id], (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task }
        return { ...oldData, data: { ...oldData.data, ...data } }
      })

      // Optimistically update task in lists
      queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[]; pagination: unknown }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            task._id === id ? { ...task, ...data } : task
          )
        }
      })

      // Optimistically update task tree
      queryClient.setQueriesData({ queryKey: ['task-tree'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: updateTaskInTree(oldData.data, id, data)
        }
      })

      // Optimistically update task children
      queryClient.setQueriesData({ queryKey: ['task-children'] }, (old: unknown) => {
        if (!old) return old
        const oldData = old as { data: Task[] }
        return {
          ...oldData,
          data: oldData.data.map((task: Task) =>
            task._id === id ? { ...task, ...data } : task
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

export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, deleteChildren = true }: { id: string; deleteChildren?: boolean }) =>
      tasksApi.delete(id, deleteChildren),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
      queryClient.invalidateQueries({ queryKey: ['task-children'] })
    },
  })
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskIds, updates }: { taskIds: string[]; updates: Partial<Task> }) =>
      tasksApi.bulkUpdate(taskIds, updates),
    onSuccess: () => {
      // Force refetch all task-related queries
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['task-tree'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['task-children'], refetchType: 'all' })
    },
  })
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskIds: string[]) => tasksApi.bulkDelete(taskIds),
    onSuccess: () => {
      // Force refetch all task-related queries
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['task-tree'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['task-children'], refetchType: 'all' })
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
export function useViews(collectionName?: string) {
  return useQuery({
    queryKey: ['views', collectionName],
    queryFn: () => viewsApi.list(collectionName),
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
