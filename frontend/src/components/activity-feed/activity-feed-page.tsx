'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { useRecentActivity } from '@/hooks/use-activity-logs'
import { useUsers } from '@/hooks/use-tasks'
import { ActivityLogEntry, FieldChange, tasksApi, Task } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  RefreshCw,
} from 'lucide-react'

const EVENT_TYPES = [
  { value: 'task.created', label: 'Created' },
  { value: 'task.updated', label: 'Updated' },
  { value: 'task.deleted', label: 'Deleted' },
  { value: 'task.status.changed', label: 'Status' },
  { value: 'task.assignee.changed', label: 'Assignee' },
  { value: 'task.priority.changed', label: 'Priority' },
  { value: 'task.moved', label: 'Moved' },
  { value: 'task.comment.added', label: 'Comment' },
]

const ACTOR_TYPES = [
  { value: 'user', label: 'Users' },
  { value: 'system', label: 'System' },
  { value: 'daemon', label: 'Daemon' },
]

const EVENT_TYPE_LABELS: Record<string, string> = {
  'task.created': 'Created',
  'task.updated': 'Updated',
  'task.deleted': 'Deleted',
  'task.status.changed': 'Status',
  'task.assignee.changed': 'Assignee',
  'task.priority.changed': 'Priority',
  'task.moved': 'Moved',
  'task.comment.added': 'Comment',
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  'task.created': 'text-green-600 dark:text-green-400',
  'task.updated': 'text-blue-600 dark:text-blue-400',
  'task.deleted': 'text-red-600 dark:text-red-400',
  'task.status.changed': 'text-purple-600 dark:text-purple-400',
  'task.assignee.changed': 'text-orange-600 dark:text-orange-400',
  'task.priority.changed': 'text-yellow-600 dark:text-yellow-400',
  'task.moved': 'text-cyan-600 dark:text-cyan-400',
  'task.comment.added': 'text-indigo-600 dark:text-indigo-400',
}

const EVENT_DOT_COLORS: Record<string, string> = {
  'task.created': 'bg-green-500',
  'task.updated': 'bg-blue-500',
  'task.deleted': 'bg-red-500',
  'task.status.changed': 'bg-purple-500',
  'task.assignee.changed': 'bg-orange-500',
  'task.priority.changed': 'bg-yellow-500',
  'task.moved': 'bg-cyan-500',
  'task.comment.added': 'bg-indigo-500',
}

function formatFieldChange(change: FieldChange): string {
  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return 'none'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }
  return `${change.field}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
}

interface ActivityRowProps {
  entry: ActivityLogEntry
  getUserName: (userId: string) => string
  getTaskName: (taskId: string) => string
}

function ActivityRow({ entry, getUserName, getTaskName }: ActivityRowProps) {
  const label = EVENT_TYPE_LABELS[entry.eventType] || entry.eventType
  const colorClass = EVENT_TYPE_COLORS[entry.eventType] || 'text-muted-foreground'
  const dotColorClass = EVENT_DOT_COLORS[entry.eventType] || 'bg-muted-foreground'

  const actorDisplay = entry.actorType === 'user' && entry.actorId
    ? getUserName(entry.actorId)
    : entry.actorType

  const taskName = getTaskName(entry.taskId)

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border/50 hover:bg-muted/30 transition-colors text-xs">
      {/* Dot indicator */}
      <div className={cn('flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5', dotColorClass)} />

      {/* Event type */}
      <span className={cn('flex-shrink-0 w-16 font-medium', colorClass)}>
        {label}
      </span>

      {/* Task name with link */}
      <Link
        href={`/tasks?taskId=${entry.taskId}`}
        className="flex-shrink-0 w-48 truncate text-foreground hover:text-primary hover:underline"
        title={taskName}
      >
        {taskName}
      </Link>

      {/* Actor */}
      <span className="flex-shrink-0 w-24 truncate text-muted-foreground" title={actorDisplay}>
        {actorDisplay}
      </span>

      {/* Changes or comment */}
      <div className="flex-1 min-w-0 text-muted-foreground truncate">
        {entry.comment ? (
          <span className="italic">&quot;{entry.comment}&quot;</span>
        ) : entry.changes && entry.changes.length > 0 ? (
          <span className="font-mono text-[11px]">
            {entry.changes.map(c => formatFieldChange(c)).join(', ')}
          </span>
        ) : null}
      </div>

      {/* Timestamp */}
      <span className="flex-shrink-0 text-muted-foreground/70 w-24 text-right">
        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
      </span>
    </div>
  )
}

export function ActivityFeedPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Parse filters from URL
  const eventTypeFromUrl = searchParams.get('eventType')
  const actorTypeFromUrl = searchParams.get('actorType')
  const actorIdFromUrl = searchParams.get('actorId')
  const pageFromUrl = parseInt(searchParams.get('page') || '1', 10)

  const [selectedEventType, setSelectedEventType] = useState<string | null>(eventTypeFromUrl)
  const [selectedActorType, setSelectedActorType] = useState<string | null>(actorTypeFromUrl)
  const [selectedActorId, setSelectedActorId] = useState<string | null>(actorIdFromUrl)
  const [page, setPage] = useState(pageFromUrl)
  const [taskCache, setTaskCache] = useState<Record<string, Task>>({})
  const limit = 50

  // Fetch users for actor display and filtering
  const { data: usersData } = useUsers()
  const users = usersData?.data || []

  const getUserName = (userId: string): string => {
    const user = users.find(u => u._id === userId)
    return user?.displayName || user?.email || userId.slice(-6)
  }

  const getTaskName = (taskId: string): string => {
    const task = taskCache[taskId]
    return task?.title || `Task ${taskId.slice(-6)}`
  }

  // Fetch activity data
  const { data, isLoading, error, refetch, isFetching } = useRecentActivity({
    limit,
    offset: (page - 1) * limit,
    eventTypes: selectedEventType ? [selectedEventType] : undefined,
    actorId: selectedActorId || undefined,
  })

  const entries = data?.data || []
  const pagination = data?.pagination

  // Filter by actor type client-side
  const filteredEntries = useMemo(() => {
    if (!selectedActorType) return entries
    return entries.filter(e => e.actorType === selectedActorType)
  }, [entries, selectedActorType])

  // Fetch task names for activity entries
  useEffect(() => {
    const taskIds = [...new Set(entries.map(e => e.taskId))]
    const missingIds = taskIds.filter(id => !taskCache[id])

    if (missingIds.length > 0) {
      // Fetch tasks in batches
      Promise.all(
        missingIds.slice(0, 20).map(async (id) => {
          try {
            const response = await tasksApi.get(id)
            return response.data
          } catch {
            return null
          }
        })
      ).then((tasks) => {
        const newCache: Record<string, Task> = {}
        tasks.forEach((task) => {
          if (task) newCache[task._id] = task
        })
        if (Object.keys(newCache).length > 0) {
          setTaskCache(prev => ({ ...prev, ...newCache }))
        }
      })
    }
  }, [entries, taskCache])

  const totalPages = pagination ? Math.ceil(pagination.total / limit) : 1

  // Update URL when filters change
  const updateUrl = (
    newEventType: string | null,
    newActorType: string | null,
    newActorId: string | null,
    newPage: number
  ) => {
    const params = new URLSearchParams()
    if (newEventType) params.set('eventType', newEventType)
    if (newActorType) params.set('actorType', newActorType)
    if (newActorId) params.set('actorId', newActorId)
    if (newPage > 1) params.set('page', String(newPage))
    const queryString = params.toString()
    router.push(queryString ? `/activity?${queryString}` : '/activity', { scroll: false })
  }

  const handleEventTypeChange = (value: string) => {
    const newType = value === 'all' ? null : value
    setSelectedEventType(newType)
    setPage(1)
    updateUrl(newType, selectedActorType, selectedActorId, 1)
  }

  const handleActorTypeChange = (value: string) => {
    const newActorType = value === 'all' ? null : value
    setSelectedActorType(newActorType)
    // Clear specific actor when changing type
    if (newActorType !== 'user') {
      setSelectedActorId(null)
      updateUrl(selectedEventType, newActorType, null, 1)
    } else {
      updateUrl(selectedEventType, newActorType, selectedActorId, 1)
    }
    setPage(1)
  }

  const handleActorIdChange = (value: string) => {
    const newActorId = value === 'all' ? null : value
    setSelectedActorId(newActorId)
    setPage(1)
    updateUrl(selectedEventType, selectedActorType, newActorId, 1)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    updateUrl(selectedEventType, selectedActorType, selectedActorId, newPage)
  }

  const clearFilters = () => {
    setSelectedEventType(null)
    setSelectedActorType(null)
    setSelectedActorId(null)
    setPage(1)
    router.push('/activity', { scroll: false })
  }

  const hasActiveFilters = selectedEventType !== null || selectedActorType !== null || selectedActorId !== null

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Activity Feed</h1>
          <p className="text-xs text-muted-foreground">
            All activity across tasks
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 text-xs"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Filter className="h-3 w-3 text-muted-foreground" />

        <Select value={selectedEventType || 'all'} onValueChange={handleEventTypeChange}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue placeholder="Event" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Events</SelectItem>
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <div className={cn('w-1.5 h-1.5 rounded-full', EVENT_DOT_COLORS[type.value])} />
                  {type.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedActorType || 'all'} onValueChange={handleActorTypeChange}>
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue placeholder="Actor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Actors</SelectItem>
            {ACTOR_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value} className="text-xs">
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Specific user filter - only show when actor type is user or all */}
        {(selectedActorType === 'user' || !selectedActorType) && users.length > 0 && (
          <Select value={selectedActorId || 'all'} onValueChange={handleActorIdChange}>
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="User" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Users</SelectItem>
              {users.map((user) => (
                <SelectItem key={user._id} value={user._id} className="text-xs">
                  {user.displayName || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs">
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}

        <div className="ml-auto text-muted-foreground">
          {pagination && `${filteredEntries.length} of ${pagination.total}`}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-t-lg border border-b-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <span className="w-1.5" />
        <span className="w-16">Event</span>
        <span className="w-48">Task</span>
        <span className="w-24">Actor</span>
        <span className="flex-1">Details</span>
        <span className="w-24 text-right">When</span>
      </div>

      {/* Activity list */}
      <div className="border rounded-b-lg rounded-t-none bg-card -mt-3">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Loading activity...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-destructive">
            Failed to load activity
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No activity found{hasActiveFilters && ' with filters'}
          </div>
        ) : (
          <div>
            {filteredEntries.map((entry) => (
              <ActivityRow
                key={entry._id}
                entry={entry}
                getUserName={getUserName}
                getTaskName={getTaskName}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="h-7 px-2 text-xs"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="h-7 px-2 text-xs"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
