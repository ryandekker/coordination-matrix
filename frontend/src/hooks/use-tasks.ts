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

export function useTaskChildren(parentId: string | null) {
  return useQuery({
    queryKey: ['task-children', parentId],
    queryFn: () => (parentId ? tasksApi.getChildren(parentId) : null),
    enabled: !!parentId,
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      // Invalidate all task queries
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      tasksApi.update(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific task and task lists
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', variables.id] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
      queryClient.invalidateQueries({ queryKey: ['task-children'] })
    },
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
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
    },
  })
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskIds: string[]) => tasksApi.bulkDelete(taskIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task-tree'] })
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
