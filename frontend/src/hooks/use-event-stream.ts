'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Task } from '@/lib/api'

// Event types from the backend
export type TaskEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status.changed'
  | 'task.assignee.changed'
  | 'task.priority.changed'
  | 'task.metadata.changed'
  | 'task.comment.added'

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

// Global event stream manager - shared across all hooks
class EventStreamManager {
  private eventSource: EventSource | null = null
  private listeners: Map<string, Set<(event: TaskEventData) => void>> = new Map()
  private connectionListeners: Set<(connected: boolean) => void> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private baseReconnectDelay = 1000
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
      const eventTypes: TaskEventType[] = [
        'task.created',
        'task.updated',
        'task.deleted',
        'task.status.changed',
        'task.assignee.changed',
        'task.priority.changed',
        'task.metadata.changed',
        'task.comment.added',
      ]

      eventTypes.forEach(type => {
        this.eventSource?.addEventListener(type, (event: MessageEvent) => {
          try {
            const data: TaskEventData = JSON.parse(event.data)
            this.notifyListeners(type, data)
            this.notifyListeners('*', data) // Also notify wildcard listeners
          } catch (error) {
            console.error('[EventStream] Error parsing event:', error)
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

  subscribe(eventType: TaskEventType | '*', callback: (event: TaskEventData) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(callback)

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

      // Auto-disconnect when no more listeners
      if (this.getTotalListenerCount() === 0) {
        this.close()
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

  private notifyListeners(eventType: string, data: TaskEventData): void {
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

/**
 * Hook to subscribe to real-time task events
 * Automatically manages connection lifecycle
 */
export function useEventStream(options?: {
  eventTypes?: (TaskEventType | '*')[]
  onEvent?: (event: TaskEventData) => void
  enabled?: boolean
}) {
  const { eventTypes = ['*'], onEvent, enabled = true } = options || {}
  const queryClient = useQueryClient()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  // Handle task cache updates
  const handleTaskEvent = useCallback((event: TaskEventData) => {
    // Call custom handler if provided
    onEventRef.current?.(event)

    // Update React Query cache based on event type
    switch (event.type) {
      case 'task.created':
        // Invalidate task lists to show new task
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task-tree'] })
        // If it has a parent, invalidate that parent's children
        if (event.task?.parentId) {
          queryClient.invalidateQueries({ queryKey: ['task-children', event.task.parentId] })
        }
        break

      case 'task.updated':
      case 'task.status.changed':
      case 'task.assignee.changed':
      case 'task.priority.changed':
      case 'task.metadata.changed':
        // Update the specific task in cache if we have task data
        if (event.task) {
          // Update individual task cache
          queryClient.setQueryData(['task', event.taskId], (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task }
            return {
              ...oldData,
              data: { ...oldData.data, ...event.task }
            }
          })

          // Update task in list caches - use a targeted approach
          queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task[]; pagination: unknown }
            return {
              ...oldData,
              data: oldData.data.map((task: Task) =>
                task._id === event.taskId ? { ...task, ...event.task } : task
              )
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

          // Update children caches if this task appears in them
          queryClient.setQueriesData({ queryKey: ['task-children'] }, (old: unknown) => {
            if (!old) return old
            const oldData = old as { data: Task[] }
            return {
              ...oldData,
              data: oldData.data.map((task: Task) =>
                task._id === event.taskId ? { ...task, ...event.task } : task
              )
            }
          })
        }
        break

      case 'task.deleted':
        // Remove from caches
        queryClient.removeQueries({ queryKey: ['task', event.taskId] })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task-tree'] })
        queryClient.invalidateQueries({ queryKey: ['task-children'] })
        break

      case 'task.comment.added':
        // Invalidate activity logs for this task
        queryClient.invalidateQueries({ queryKey: ['activity-logs', 'task', event.taskId] })
        queryClient.invalidateQueries({ queryKey: ['activity-logs', 'recent'] })
        break
    }

    // Also invalidate workflow-related queries if task has workflowId
    if (event.task?.workflowId) {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
    }
  }, [queryClient])

  useEffect(() => {
    if (!enabled) return

    const unsubscribers = eventTypes.map(type =>
      eventStreamManager.subscribe(type, handleTaskEvent)
    )

    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }, [enabled, eventTypes.join(','), handleTaskEvent])

  return {
    isConnected: eventStreamManager.isConnected,
  }
}

/**
 * Hook to get connection status
 */
export function useEventStreamStatus() {
  const statusRef = useRef(eventStreamManager.isConnected)

  useEffect(() => {
    const unsubscribe = eventStreamManager.onConnectionChange((connected) => {
      statusRef.current = connected
    })
    return unsubscribe
  }, [])

  return { isConnected: statusRef.current }
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

// Export the manager for direct access if needed
export { eventStreamManager }
