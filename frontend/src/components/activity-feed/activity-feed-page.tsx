'use client'

import { useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { useRecentActivity } from '@/hooks/use-activity-logs'
import { useUsers } from '@/hooks/use-tasks'
import { ActivityLogEntry, FieldChange } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'

const EVENT_TYPES = [
  { value: 'task.created', label: 'Created' },
  { value: 'task.updated', label: 'Updated' },
  { value: 'task.deleted', label: 'Deleted' },
  { value: 'task.status.changed', label: 'Status Changed' },
  { value: 'task.assignee.changed', label: 'Assignee Changed' },
  { value: 'task.priority.changed', label: 'Priority Changed' },
  { value: 'task.moved', label: 'Moved' },
  { value: 'task.comment.added', label: 'Comment Added' },
]

const ACTOR_TYPES = [
  { value: 'user', label: 'User' },
  { value: 'system', label: 'System' },
  { value: 'daemon', label: 'Daemon' },
]

const EVENT_TYPE_LABELS: Record<string, string> = {
  'task.created': 'Created',
  'task.updated': 'Updated',
  'task.deleted': 'Deleted',
  'task.status.changed': 'Status changed',
  'task.assignee.changed': 'Assignee changed',
  'task.priority.changed': 'Priority changed',
  'task.moved': 'Moved',
  'task.comment.added': 'Comment',
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  'task.created': 'bg-green-500',
  'task.updated': 'bg-blue-500',
  'task.deleted': 'bg-red-500',
  'task.status.changed': 'bg-purple-500',
  'task.assignee.changed': 'bg-orange-500',
  'task.priority.changed': 'bg-yellow-500',
  'task.moved': 'bg-cyan-500',
  'task.comment.added': 'bg-indigo-500',
}

const EVENT_TYPE_BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'task.created': 'default',
  'task.deleted': 'destructive',
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
}

function ActivityRow({ entry, getUserName }: ActivityRowProps) {
  const label = EVENT_TYPE_LABELS[entry.eventType] || entry.eventType
  const colorClass = EVENT_TYPE_COLORS[entry.eventType] || 'bg-muted-foreground'
  const badgeVariant = EVENT_TYPE_BADGE_VARIANTS[entry.eventType] || 'secondary'

  const actorDisplay = entry.actorType === 'user' && entry.actorId
    ? getUserName(entry.actorId)
    : entry.actorType

  return (
    <div className="flex items-start gap-4 p-4 border-b border-border hover:bg-muted/50 transition-colors">
      {/* Event type indicator */}
      <div className={cn('flex-shrink-0 w-2.5 h-2.5 rounded-full mt-2', colorClass)} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={badgeVariant} className="text-xs">
            {label}
          </Badge>
          <span className="text-sm text-muted-foreground">by</span>
          <span className="text-sm font-medium">{actorDisplay}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
          </span>
        </div>

        {/* Comment if present */}
        {entry.comment && (
          <p className="mt-2 text-sm text-foreground bg-muted/50 rounded-md p-2 border-l-2 border-primary/50">
            {entry.comment}
          </p>
        )}

        {/* Field changes */}
        {entry.changes && entry.changes.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground space-y-1">
            {entry.changes.map((change, idx) => (
              <div key={idx} className="font-mono bg-muted/30 rounded px-2 py-1">
                {formatFieldChange(change)}
              </div>
            ))}
          </div>
        )}

        {/* Metadata if present */}
        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            <details>
              <summary className="cursor-pointer hover:text-foreground">Metadata</summary>
              <pre className="mt-1 p-2 bg-muted rounded-md overflow-x-auto">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      {/* Task link */}
      <div className="flex-shrink-0">
        <Link
          href={`/tasks?taskId=${entry.taskId}`}
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
        >
          View Task
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Timestamp */}
      <div className="flex-shrink-0 text-right">
        <div className="text-xs text-muted-foreground">
          {format(new Date(entry.timestamp), 'MMM d, yyyy')}
        </div>
        <div className="text-xs text-muted-foreground">
          {format(new Date(entry.timestamp), 'HH:mm:ss')}
        </div>
      </div>
    </div>
  )
}

export function ActivityFeedPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Parse filters from URL
  const eventTypeFromUrl = searchParams.get('eventType')
  const actorTypeFromUrl = searchParams.get('actorType')
  const pageFromUrl = parseInt(searchParams.get('page') || '1', 10)

  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>(
    eventTypeFromUrl ? [eventTypeFromUrl] : []
  )
  const [selectedActorType, setSelectedActorType] = useState<string | null>(
    actorTypeFromUrl
  )
  const [page, setPage] = useState(pageFromUrl)
  const limit = 50

  // Fetch users for actor display
  const { data: usersData } = useUsers()
  const users = usersData?.data || []

  const getUserName = (userId: string): string => {
    const user = users.find(u => u._id === userId)
    return user?.displayName || user?.email || userId.slice(-6)
  }

  // Fetch activity data
  const { data, isLoading, error, refetch, isFetching } = useRecentActivity({
    limit,
    offset: (page - 1) * limit,
    eventTypes: selectedEventTypes.length > 0 ? selectedEventTypes : undefined,
  })

  const entries = data?.data || []
  const pagination = data?.pagination

  // Filter by actor type client-side (API doesn't support actorType filter)
  const filteredEntries = useMemo(() => {
    if (!selectedActorType) return entries
    return entries.filter(e => e.actorType === selectedActorType)
  }, [entries, selectedActorType])

  const totalPages = pagination ? Math.ceil(pagination.total / limit) : 1

  // Update URL when filters change
  const updateUrl = (newEventTypes: string[], newActorType: string | null, newPage: number) => {
    const params = new URLSearchParams()
    if (newEventTypes.length === 1) {
      params.set('eventType', newEventTypes[0])
    }
    if (newActorType) {
      params.set('actorType', newActorType)
    }
    if (newPage > 1) {
      params.set('page', String(newPage))
    }
    const queryString = params.toString()
    router.push(queryString ? `/activity?${queryString}` : '/activity', { scroll: false })
  }

  const handleEventTypeChange = (value: string) => {
    const newTypes = value === 'all' ? [] : [value]
    setSelectedEventTypes(newTypes)
    setPage(1)
    updateUrl(newTypes, selectedActorType, 1)
  }

  const handleActorTypeChange = (value: string) => {
    const newActorType = value === 'all' ? null : value
    setSelectedActorType(newActorType)
    setPage(1)
    updateUrl(selectedEventTypes, newActorType, 1)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    updateUrl(selectedEventTypes, selectedActorType, newPage)
  }

  const clearFilters = () => {
    setSelectedEventTypes([])
    setSelectedActorType(null)
    setPage(1)
    router.push('/activity', { scroll: false })
  }

  const hasActiveFilters = selectedEventTypes.length > 0 || selectedActorType !== null

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity Feed</h1>
          <p className="text-muted-foreground">
            View all activity across your tasks
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters:</span>
        </div>

        <Select
          value={selectedEventTypes[0] || 'all'}
          onValueChange={handleEventTypeChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Event Types</SelectItem>
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                <div className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 rounded-full', EVENT_TYPE_COLORS[type.value])} />
                  {type.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedActorType || 'all'}
          onValueChange={handleActorTypeChange}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Actor Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actors</SelectItem>
            {ACTOR_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        )}

        {/* Results count */}
        <div className="ml-auto text-sm text-muted-foreground">
          {pagination && (
            <>
              Showing {filteredEntries.length} of {pagination.total} activities
            </>
          )}
        </div>
      </div>

      {/* Activity list */}
      <div className="border rounded-lg bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading activity...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            Failed to load activity. Please try again.
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No activity found
            {hasActiveFilters && ' with the selected filters'}
          </div>
        ) : (
          <div>
            {filteredEntries.map((entry) => (
              <ActivityRow
                key={entry._id}
                entry={entry}
                getUserName={getUserName}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
