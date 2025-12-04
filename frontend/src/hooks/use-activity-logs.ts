'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activityLogsApi, ActivityLogEntry } from '@/lib/api'

export function useTaskActivity(taskId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['activity-logs', 'task', taskId],
    queryFn: async () => {
      if (!taskId) throw new Error('Task ID required')
      return activityLogsApi.getTaskActivity(taskId, { limit: 50 })
    },
    enabled: options?.enabled !== false && !!taskId,
    staleTime: 30000, // 30 seconds
  })
}

export function useRecentActivity(params?: {
  limit?: number
  offset?: number
  eventTypes?: string[]
  actorId?: string
}) {
  return useQuery({
    queryKey: ['activity-logs', 'recent', params],
    queryFn: () => activityLogsApi.getRecentActivity(params),
    staleTime: 30000,
  })
}

export function useAddComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, comment, actorId }: { taskId: string; comment: string; actorId?: string }) =>
      activityLogsApi.addComment(taskId, comment, actorId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['activity-logs', 'task', variables.taskId] })
      queryClient.invalidateQueries({ queryKey: ['activity-logs', 'recent'] })
    },
  })
}
