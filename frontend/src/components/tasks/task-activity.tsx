'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useTaskActivity, useAddComment } from '@/hooks/use-activity-logs'
import { ActivityLogEntry, FieldChange } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TaskActivityProps {
  taskId: string
  className?: string
  compact?: boolean
  /** Polling interval in milliseconds. Default: 30000 (30 seconds) - SSE handles real-time updates */
  pollInterval?: number
}

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

function formatFieldChange(change: FieldChange, compact: boolean): string {
  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return 'none'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  if (compact) {
    return `${change.field}: ${formatValue(change.newValue)}`
  }
  return `${change.field}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
}

// Threshold for truncating comments (approximate line count * chars per line)
const COMMENT_TRUNCATE_THRESHOLD = 100

function ExpandableText({
  text,
  className,
  truncateClassName,
  expandedClassName
}: {
  text: string
  className?: string
  truncateClassName?: string
  expandedClassName?: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const shouldTruncate = text.length > COMMENT_TRUNCATE_THRESHOLD

  if (!shouldTruncate) {
    return <p className={className}>{text}</p>
  }

  return (
    <div>
      <p
        className={cn(
          className,
          'cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 transition-colors',
          isExpanded ? expandedClassName : truncateClassName
        )}
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        title={isExpanded ? 'Click to collapse' : 'Click to expand'}
      >
        {text}
      </p>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        className="text-[10px] text-primary hover:underline mt-0.5"
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}

function ExpandableChanges({
  changes,
  compact,
  initialLimit = 2
}: {
  changes: FieldChange[]
  compact: boolean
  initialLimit?: number
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasMore = changes.length > initialLimit

  const displayedChanges = isExpanded ? changes : changes.slice(0, initialLimit)

  if (compact) {
    return (
      <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
        {displayedChanges.map((change, idx) => (
          <div key={idx} className={cn('font-mono', !isExpanded && 'truncate')}>
            {formatFieldChange(change, true)}
          </div>
        ))}
        {hasMore && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
            className="text-primary hover:underline"
          >
            {isExpanded ? 'Show less' : `+${changes.length - initialLimit} more`}
          </button>
        )}
      </div>
    )
  }

  return (
    <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
      {displayedChanges.map((change, idx) => (
        <li key={idx} className="font-mono">
          {formatFieldChange(change, false)}
        </li>
      ))}
      {hasMore && (
        <li>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
            className="text-primary hover:underline"
          >
            {isExpanded ? 'Show less' : `+${changes.length - initialLimit} more`}
          </button>
        </li>
      )}
    </ul>
  )
}

function ActivityEntry({ entry, compact, isNew }: { entry: ActivityLogEntry; compact?: boolean; isNew?: boolean }) {
  const label = EVENT_TYPE_LABELS[entry.eventType] || entry.eventType
  const colorClass = EVENT_TYPE_COLORS[entry.eventType] || 'bg-muted-foreground'

  if (compact) {
    return (
      <div className={cn(
        'flex gap-2 py-1.5 border-b border-border/50 last:border-b-0 transition-colors duration-500',
        isNew && 'bg-primary/5'
      )}>
        <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', colorClass)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-xs font-medium">{label}</span>
            <span className="text-[10px] text-muted-foreground">
              by {entry.actor?.displayName || entry.actorType}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
            </span>
          </div>

          {entry.comment && (
            <ExpandableText
              text={entry.comment}
              className="text-xs text-foreground mt-0.5"
              truncateClassName="line-clamp-2"
            />
          )}

          {entry.changes && entry.changes.length > 0 && (
            <ExpandableChanges changes={entry.changes} compact={true} initialLimit={2} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'flex gap-3 py-2 border-b border-border last:border-b-0 transition-colors duration-500',
      isNew && 'bg-primary/5'
    )}>
      <div className={cn('flex-shrink-0 w-2 h-2 rounded-full mt-1.5', colorClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">
            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
          </span>
        </div>

        {entry.comment && (
          <ExpandableText
            text={entry.comment}
            className="mt-1 text-sm text-foreground"
            truncateClassName="line-clamp-3"
          />
        )}

        {entry.changes && entry.changes.length > 0 && (
          <ExpandableChanges changes={entry.changes} compact={false} initialLimit={3} />
        )}

        <div className="mt-0.5 text-xs text-muted-foreground">
          by {entry.actor?.displayName || entry.actorType}
        </div>
      </div>
    </div>
  )
}

export function TaskActivity({ taskId, className, compact = false, pollInterval = 30000 }: TaskActivityProps) {
  const [newComment, setNewComment] = useState('')
  const [newEntryIds, setNewEntryIds] = useState<Set<string>>(new Set())
  const prevEntryIdsRef = useRef<Set<string>>(new Set())
  const isInitialLoadRef = useRef(true)

  const { data, isLoading, error } = useTaskActivity(taskId, {
    refetchInterval: pollInterval,
    refetchOnMount: 'always',
  })
  const addComment = useAddComment()

  // Deduplicate entries by _id (in case of any duplicates from backend/cache)
  const entries = useMemo(() => {
    const rawEntries = data?.data || []
    const seen = new Set<string>()
    return rawEntries.filter(entry => {
      if (seen.has(entry._id)) return false
      seen.add(entry._id)
      return true
    })
  }, [data?.data])

  // Track new entries for highlight effect
  useEffect(() => {
    if (entries.length > 0) {
      const currentIds = new Set(entries.map(e => e._id))

      // Skip highlighting on initial load
      if (!isInitialLoadRef.current) {
        const newIds: string[] = []
        currentIds.forEach(id => {
          if (!prevEntryIdsRef.current.has(id)) {
            newIds.push(id)
          }
        })

        if (newIds.length > 0) {
          setNewEntryIds(new Set(newIds))
          // Clear highlight after animation
          const timer = setTimeout(() => setNewEntryIds(new Set()), 2000)
          return () => clearTimeout(timer)
        }
      }

      isInitialLoadRef.current = false
      prevEntryIdsRef.current = currentIds
    }
  }, [entries])

  const handleSubmitComment = async () => {
    if (!newComment.trim() || addComment.isPending) return

    try {
      await addComment.mutateAsync({ taskId, comment: newComment.trim() })
      setNewComment('')
    } catch (err) {
      console.error('Failed to add comment:', err)
    }
  }

  if (isLoading) {
    return (
      <div className={cn('p-4', className)}>
        <div className="text-xs text-muted-foreground animate-pulse">Loading activity...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('p-4', className)}>
        <div className="text-xs text-destructive">Failed to load activity</div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Compact comment input */}
        <div className="px-3 py-2 border-b border-border/50 flex-shrink-0">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
              placeholder="Add comment..."
              className={cn(
                'flex-1 px-2 py-1 text-xs rounded border border-input bg-background transition-colors',
                'focus:outline-none focus:border-primary'
              )}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || addComment.isPending}
            >
              {addComment.isPending ? '...' : 'Add'}
            </Button>
          </div>
        </div>

        {/* Compact activity list */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {entries.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No activity yet
            </div>
          ) : (
            <div>
              {entries.map((entry) => (
                <ActivityEntry
                  key={entry._id}
                  entry={entry}
                  compact
                  isNew={newEntryIds.has(entry._id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Entry count + live indicator */}
        <div className="px-3 py-1.5 border-t border-border/50 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Activity</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{entries.length} entries</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* Comment input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
          placeholder="Add a comment..."
          className={cn(
            'flex-1 px-3 py-1.5 text-sm rounded-md border border-input bg-background transition-colors',
            'focus:outline-none focus:border-primary'
          )}
        />
        <Button
          size="sm"
          onClick={handleSubmitComment}
          disabled={!newComment.trim() || addComment.isPending}
        >
          {addComment.isPending ? '...' : 'Add'}
        </Button>
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto max-h-[300px]">
        {entries.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No activity yet
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <ActivityEntry
                key={entry._id}
                entry={entry}
                isNew={newEntryIds.has(entry._id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskActivity
