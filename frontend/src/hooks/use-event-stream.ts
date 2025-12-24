'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Task } from '@/lib/api'

// Task event types from the backend
export type TaskEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status.changed'
  | 'task.assignee.changed'
  | 'task.priority.changed'
  | 'task.metadata.changed'
  | 'task.comment.added'
  | 'task.moved'

// Workflow run event types from the backend
export type WorkflowRunEventType =
  | 'workflow.run.created'
  | 'workflow.run.started'
  | 'workflow.run.step.started'
  | 'workflow.run.step.completed'
  | 'workflow.run.step.failed'
  | 'workflow.run.completed'
  | 'workflow.run.failed'
  | 'workflow.run.cancelled'

// Combined event type
export type EventType = TaskEventType | WorkflowRunEventType

export interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

export interface TaskEventData {
  id: string
  type: TaskEventType
  taskId: string
  timestamp: string
  changes?: FieldChange[]
  actorType: 'user' | 'system' | 'daemon'
  task?: Partial<Task>
}

export interface WorkflowRunEventData {
  id: string
  type: WorkflowRunEventType
  workflowRunId: string
  timestamp: string
  stepId?: string
  taskId?: string
  error?: string
  workflowRun?: {
    _id: string
    workflowId: string
    status: string
    currentStepIds: string[]
    completedStepIds: string[]
    failedStepId?: string
    error?: string
    createdAt: string
    startedAt?: string
    completedAt?: string
  }
}

// Union type for all event data
export type EventData = TaskEventData | WorkflowRunEventData

// Global event stream manager - shared across all hooks
class EventStreamManager {
  private eventSource: EventSource | null = null
  private listeners: Map<string, Set<(event: EventData) => void>> = new Map()
  private connectionListeners: Set<(connected: boolean) => void> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private disconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private baseReconnectDelay = 1000
  private disconnectDelay = 500 // Debounce delay for disconnect (handles React 18 StrictMode)
  private isConnecting = false
  private _isConnected = false

  get isConnected(): boolean {
    return this._isConnected
  }

  connect(): void {
    if (this.eventSource || this.isConnecting) return
    if (typeof window === 'undefined') return

    const token = localStorage.getItem('auth_token')
    if (!token) {
      console.log('[EventStream] No auth token, skipping connection')
      return
    }

    this.isConnecting = true

    // Connect to SSE endpoint with auth token as query param (SSE doesn't support headers)
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api'
    const url = `${apiBase}/events/stream?token=${encodeURIComponent(token)}`

    try {
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = () => {
        console.log('[EventStream] Connected')
        this.isConnecting = false
        this._isConnected = true
        this.reconnectAttempts = 0
        this.notifyConnectionListeners(true)
      }

      this.eventSource.onerror = () => {
        console.log('[EventStream] Connection error, will retry...')
        this.isConnecting = false
        this._isConnected = false
        this.notifyConnectionListeners(false)
        this.close()
        this.scheduleReconnect()
      }

      // Listen for the connected event
      this.eventSource.addEventListener('connected', (event: MessageEvent) => {
        console.log('[EventStream] Server confirmed connection:', event.data)
      })

      // Listen for all task events
      const taskEventTypes: TaskEventType[] = [
        'task.created',
        'task.updated',
        'task.deleted',
        'task.status.changed',
        'task.assignee.changed',
        'task.priority.changed',
        'task.metadata.changed',
        'task.comment.added',
        'task.moved',
      ]

      taskEventTypes.forEach(type => {
        this.eventSource?.addEventListener(type, (event: MessageEvent) => {
          try {
            const data: TaskEventData = JSON.parse(event.data)
            console.log(`[EventStream] Task event: ${type}`, { taskId: data.taskId, parentId: data.task?.parentId })
            this.notifyListeners(type, data)
            this.notifyListeners('*', data) // Also notify wildcard listeners
          } catch (error) {
            console.error('[EventStream] Error parsing task event:', error)
          }
        })
      })

      // Listen for workflow run events
      const workflowRunEventTypes: WorkflowRunEventType[] = [
        'workflow.run.created',
        'workflow.run.started',
        'workflow.run.step.started',
        'workflow.run.step.completed',
        'workflow.run.step.failed',
        'workflow.run.completed',
        'workflow.run.failed',
        'workflow.run.cancelled',
      ]

      workflowRunEventTypes.forEach(type => {
        this.eventSource?.addEventListener(type, (event: MessageEvent) => {
          try {
            const data: WorkflowRunEventData = JSON.parse(event.data)
            console.log(`[EventStream] Workflow run event: ${type}`, { workflowRunId: data.workflowRunId, stepId: data.stepId })
            this.notifyListeners(type, data)
            this.notifyListeners('*', data) // Also notify wildcard listeners
          } catch (error) {
            console.error('[EventStream] Error parsing workflow run event:', error)
          }
        })
      })
    } catch (error) {
      console.error('[EventStream] Error creating EventSource:', error)
      this.isConnecting = false
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[EventStream] Max reconnect attempts reached')
      return
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    )
    this.reconnectAttempts++

    console.log(`[EventStream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, delay)
  }

  close(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this._isConnected = false
  }

  subscribe(eventType: EventType | '*', callback: (event: EventData) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(callback)

    // Cancel any pending disconnect (handles React 18 StrictMode remounting)
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout)
      this.disconnectTimeout = null
    }

    // Auto-connect when first subscriber joins
    if (!this.eventSource && !this.isConnecting) {
      this.connect()
    }

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(callback)

      // Clean up empty listener sets
      if (this.listeners.get(eventType)?.size === 0) {
        this.listeners.delete(eventType)
      }

      // Schedule disconnect when no more listeners (debounced for React 18 StrictMode)
      if (this.getTotalListenerCount() === 0 && !this.disconnectTimeout) {
        this.disconnectTimeout = setTimeout(() => {
          this.disconnectTimeout = null
          // Double-check no listeners were added during the delay
          if (this.getTotalListenerCount() === 0) {
            this.close()
          }
        }, this.disconnectDelay)
      }
    }
  }

  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.add(callback)
    // Immediately notify of current state
    callback(this._isConnected)
    return () => {
      this.connectionListeners.delete(callback)
    }
  }

  private notifyListeners(eventType: string, data: EventData): void {
    this.listeners.get(eventType)?.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error('[EventStream] Error in listener callback:', error)
      }
    })
  }

  private notifyConnectionListeners(connected: boolean): void {
    this.connectionListeners.forEach(callback => {
      try {
        callback(connected)
      } catch (error) {
        console.error('[EventStream] Error in connection listener:', error)
      }
    })
  }

  private getTotalListenerCount(): number {
    let count = 0
    this.listeners.forEach(set => {
      count += set.size
    })
    return count
  }
}

// Singleton instance
const eventStreamManager = new EventStreamManager()

// Helper to check if event is a task event
function isTaskEvent(event: EventData): event is TaskEventData {
  return 'taskId' in event && event.type.startsWith('task.')
}

// Helper to check if event is a workflow run event
function isWorkflowRunEvent(event: EventData): event is WorkflowRunEventData {
  return 'workflowRunId' in event && event.type.startsWith('workflow.')
}

/**
 * Hook to subscribe to real-time task and workflow run events
 * Automatically manages connection lifecycle
 */
export function useEventStream(options?: {
  eventTypes?: (EventType | '*')[]
  onEvent?: (event: EventData) => void
  enabled?: boolean
}) {
  const { eventTypes = ['*'], onEvent, enabled = true } = options || {}
  const queryClient = useQueryClient()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  // Handle all events (task + workflow run)
  const handleEvent = useCallback((event: EventData) => {
    // Call custom handler if provided
    onEventRef.current?.(event)

    // Handle workflow run events - invalidate caches
    if (isWorkflowRunEvent(event)) {
      switch (event.type) {
        case 'workflow.run.created':
        case 'workflow.run.started':
        case 'workflow.run.step.started':
        case 'workflow.run.step.completed':
        case 'workflow.run.step.failed':
        case 'workflow.run.completed':
        case 'workflow.run.failed':
        case 'workflow.run.cancelled':
          // Invalidate workflow run queries
          queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
          queryClient.invalidateQueries({ queryKey: ['workflow-run', event.workflowRunId] })
          break
      }
      return
    }

    // Handle task events
    if (!isTaskEvent(event)) return

    // Update React Query cache based on event type
    switch (event.type) {
      case 'task.created':
        // Optimistically add the new task to cache if we have task data
        if (event.task && event.task._id) {
          const newTask = event.task as Task

          // Add to individual task cache
          queryClient.setQueryData(['task', event.taskId], { data: newTask })

          // Add to task list caches - only add root tasks to main list
          if (!newTask.parentId) {
            queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
              if (!old) return old
              const oldData = old as { data: Task[]; pagination: { total: number; page: number; limit: number; pages: number } }
              // Check if task already exists (avoid duplicates)
              if (oldData.data.some((t: Task) => t._id === newTask._id)) {
                return oldData
              }
              // Add new task at the beginning (most recent first)
              return {
                ...oldData,
                data: [newTask, ...oldData.data],
                pagination: {
                  ...oldData.pagination,
                  total: oldData.pagination.total + 1
                }
              }
            })
          } else {
            // For subtasks, add to parent's children in the cache
            // First update the parent task's children array
            queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
              if (!old) return old
              const oldData = old as { data: Task[]; pagination: unknown }
              return {
                ...oldData,
                data: oldData.data.map((task: Task) => {
                  if (task._id === newTask.parentId) {
                    const existingChildren = task.children || []
                    // Avoid duplicates
                    if (existingChildren.some((c: Task) => c._id === newTask._id)) {
                      return task
                    }
                    return {
                      ...task,
                      children: [...existingChildren, newTask]
                    }
                  }
                  return task
                })
              }
            })
            // Also update task-children cache if it exists
            queryClient.setQueriesData({ queryKey: ['task-children', newTask.parentId] }, (old: unknown) => {
              if (!old) return old
              const oldData = old as { data: Task[] }
              if (oldData.data.some((t: Task) => t._id === newTask._id)) {
                return oldData
              }
              return {
                ...oldData,
                data: [...oldData.data, newTask]
              }
            })
          }

          // Update task tree caches
          queryClient.setQueriesData({ queryKey: ['task-tree'] }, (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task[] }
            if (!newTask.parentId) {
              // Add as root task
              if (oldData.data.some((t: Task) => t._id === newTask._id)) {
                return oldData
              }
              return {
                ...oldData,
                data: [newTask, ...oldData.data]
              }
            } else {
              // Add as child to parent in tree
              return {
                ...oldData,
                data: addTaskToTree(oldData.data, newTask.parentId, newTask)
              }
            }
          })
        } else {
          // Fall back to invalidation if we don't have full task data
          queryClient.invalidateQueries({ queryKey: ['tasks'] })
          queryClient.invalidateQueries({ queryKey: ['task-tree'] })
          if (event.task?.parentId) {
            queryClient.invalidateQueries({ queryKey: ['task-children', event.task.parentId] })
          }
        }
        break

      case 'task.updated':
      case 'task.status.changed':
      case 'task.priority.changed':
      case 'task.metadata.changed':
        // Update the specific task in cache if we have task data
        if (event.task) {
          const taskData = event.task as Task
          const isChildTask = !!taskData.parentId

          // Update individual task cache
          queryClient.setQueryData(['task', event.taskId], (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task }
            // Preserve existing children array if present (don't overwrite with empty)
            const preservedChildren = oldData.data.children || []
            return {
              ...oldData,
              data: { ...oldData.data, ...event.task, children: event.task.children?.length ? event.task.children : preservedChildren }
            }
          })

          // Update task in list caches - use a targeted approach
          queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task[]; pagination: unknown }
            return {
              ...oldData,
              data: oldData.data.map((task: Task) => {
                if (task._id === event.taskId) {
                  // Preserve existing children array
                  const preservedChildren = task.children || []
                  return { ...task, ...event.task, children: event.task.children?.length ? event.task.children : preservedChildren }
                }
                return task
              })
            }
          })

          // Update task tree caches
          queryClient.setQueriesData({ queryKey: ['task-tree'] }, (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task[] }
            return {
              ...oldData,
              data: updateTaskInTree(oldData.data, event.taskId, event.task as Partial<Task>)
            }
          })

          // For child tasks, invalidate all cached pages for the parent's children
          // This is more reliable than optimistic updates for nested data
          if (isChildTask) {
            // Invalidate all queries that start with ['task-children', parentId]
            // This covers all pagination variations
            queryClient.invalidateQueries({
              predicate: (query) => {
                const key = query.queryKey
                return Array.isArray(key) &&
                  key[0] === 'task-children' &&
                  key[1] === taskData.parentId
              },
              refetchType: 'active'
            })
          }

          // Also try optimistic update for immediate feedback on any matching query
          queryClient.setQueriesData(
            { predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'task-children' },
            (old: unknown) => {
              if (!old) return old
              const oldData = old as { data: Task[]; pagination?: unknown }
              const updatedData = oldData.data.map((task: Task) =>
                task._id === event.taskId ? { ...task, ...event.task } : task
              )
              // Only return new object if something changed
              if (updatedData.some((t, i) => t !== oldData.data[i])) {
                return { ...oldData, data: updatedData }
              }
              return old
            }
          )
        }
        break

      case 'task.assignee.changed':
        // Assignee changes need full refetch to get resolved user data (name, email, etc.)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', event.taskId] })
        queryClient.invalidateQueries({ queryKey: ['task-tree'] })
        queryClient.invalidateQueries({ queryKey: ['task-children'] })
        break

      case 'task.deleted':
        // Remove from caches
        queryClient.removeQueries({ queryKey: ['task', event.taskId] })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task-tree'] })
        queryClient.invalidateQueries({ queryKey: ['task-children'] })
        break

      case 'task.moved':
        // Task parent changed - invalidate relevant caches
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task-tree'] })
        queryClient.invalidateQueries({ queryKey: ['task-children'] })
        // Update the specific task if we have task data
        if (event.task) {
          queryClient.setQueryData(['task', event.taskId], (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task }
            return {
              ...oldData,
              data: { ...oldData.data, ...event.task }
            }
          })
        }
        break

      case 'task.comment.added':
        // Comments are also activity, but handled below
        break
    }

    // All task events create activity log entries - invalidate activity logs
    queryClient.invalidateQueries({ queryKey: ['activity-logs', 'task', event.taskId] })
    queryClient.invalidateQueries({ queryKey: ['activity-logs', 'recent'] })

    // Also invalidate workflow-related queries if task has workflowId
    if (event.task?.workflowId) {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
    }
  }, [queryClient])

  useEffect(() => {
    if (!enabled) return

    const unsubscribers = eventTypes.map(type =>
      eventStreamManager.subscribe(type, handleEvent)
    )

    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }, [enabled, eventTypes.join(','), handleEvent])

  return {
    isConnected: eventStreamManager.isConnected,
  }
}

/**
 * Hook to get connection status with reactive updates
 */
export function useEventStreamStatus() {
  const [isConnected, setIsConnected] = useState(eventStreamManager.isConnected)

  useEffect(() => {
    const unsubscribe = eventStreamManager.onConnectionChange((connected) => {
      setIsConnected(connected)
    })
    return unsubscribe
  }, [])

  return { isConnected }
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

// Helper to recursively add a task to a parent in a tree structure
function addTaskToTree(tasks: Task[], parentId: string, newTask: Task): Task[] {
  return tasks.map(task => {
    if (task._id === parentId) {
      const existingChildren = task.children || []
      // Avoid duplicates
      if (existingChildren.some((c: Task) => c._id === newTask._id)) {
        return task
      }
      return {
        ...task,
        children: [...existingChildren, newTask]
      }
    }
    if (task.children && task.children.length > 0) {
      return {
        ...task,
        children: addTaskToTree(task.children, parentId, newTask)
      }
    }
    return task
  })
}

// Export the manager for direct access if needed
export { eventStreamManager }
