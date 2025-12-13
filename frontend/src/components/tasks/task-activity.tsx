'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useTaskActivity, useAddComment } from '@/hooks/use-activity-logs'
import { ActivityLogEntry, FieldChange } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TaskActivityProps {
  taskId: string
  className?: string
  compact?: boolean
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

function ActivityEntry({ entry, compact }: { entry: ActivityLogEntry; compact?: boolean }) {
  const label = EVENT_TYPE_LABELS[entry.eventType] || entry.eventType
  const colorClass = EVENT_TYPE_COLORS[entry.eventType] || 'bg-muted-foreground'

  if (compact) {
    return (
      <div className="flex gap-2 py-1.5 border-b border-border/50 last:border-b-0">
        <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', colorClass)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium">{label}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
            </span>
          </div>

          {entry.comment && (
            <p className="text-xs text-foreground mt-0.5 line-clamp-2">{entry.comment}</p>
          )}

          {entry.changes && entry.changes.length > 0 && (
            <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
              {entry.changes.slice(0, 2).map((change, idx) => (
                <div key={idx} className="font-mono truncate">
                  {formatFieldChange(change, true)}
                </div>
              ))}
              {entry.changes.length > 2 && (
                <div className="text-muted-foreground">+{entry.changes.length - 2} more</div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 py-2 border-b border-border last:border-b-0">
      <div className={cn('flex-shrink-0 w-2 h-2 rounded-full mt-1.5', colorClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">
            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
          </span>
        </div>

        {entry.comment && (
          <p className="mt-1 text-sm text-foreground">{entry.comment}</p>
        )}

        {entry.changes && entry.changes.length > 0 && (
          <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
            {entry.changes.map((change, idx) => (
              <li key={idx} className="font-mono">
                {formatFieldChange(change, false)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-0.5 text-xs text-muted-foreground">
          by {entry.actorType}
          {entry.actorId && <span className="ml-1 opacity-70">({entry.actorId.slice(-6)})</span>}
        </div>
      </div>
    </div>
  )
}

export function TaskActivity({ taskId, className, compact = false }: TaskActivityProps) {
  const [newComment, setNewComment] = useState('')
  const { data, isLoading, error } = useTaskActivity(taskId)
  const addComment = useAddComment()

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return

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

  const entries = data?.data || []

  if (compact) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Compact comment input */}
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
              placeholder="Add comment..."
              className={cn(
                'flex-1 px-2 py-1 text-xs rounded border border-input bg-background',
                'focus:outline-none focus:ring-1 focus:ring-ring'
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
                <ActivityEntry key={entry._id} entry={entry} compact />
              ))}
            </div>
          )}
        </div>

        {/* Entry count */}
        {entries.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Activity</h3>
        <span className="text-xs text-muted-foreground">{entries.length} entries</span>
      </div>

      {/* Comment input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
          placeholder="Add a comment..."
          className={cn(
            'flex-1 px-3 py-1.5 text-sm rounded-md border border-input bg-background',
            'focus:outline-none focus:ring-2 focus:ring-ring'
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
              <ActivityEntry key={entry._id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskActivity
