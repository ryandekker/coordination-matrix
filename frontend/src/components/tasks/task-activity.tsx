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
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.deleted': 'Task deleted',
  'task.status.changed': 'Status changed',
  'task.assignee.changed': 'Assignee changed',
  'task.priority.changed': 'Priority changed',
  'task.moved': 'Task moved',
  'task.comment.added': 'Comment added',
}

const EVENT_TYPE_ICONS: Record<string, string> = {
  'task.created': '+',
  'task.updated': '~',
  'task.deleted': '-',
  'task.status.changed': '!',
  'task.assignee.changed': '@',
  'task.priority.changed': '^',
  'task.moved': '>',
  'task.comment.added': '#',
}

function formatFieldChange(change: FieldChange): string {
  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return 'none'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }
  return `${change.field}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
}

function ActivityEntry({ entry }: { entry: ActivityLogEntry }) {
  const icon = EVENT_TYPE_ICONS[entry.eventType] || '?'
  const label = EVENT_TYPE_LABELS[entry.eventType] || entry.eventType

  return (
    <div className="flex gap-3 py-2 border-b border-border last:border-b-0">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-mono">
        {icon}
      </div>
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
                {formatFieldChange(change)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-0.5 text-xs text-muted-foreground">
          by {entry.actorType}
          {entry.actorId && <span className="ml-1">({entry.actorId.slice(-6)})</span>}
        </div>
      </div>
    </div>
  )
}

export function TaskActivity({ taskId, className }: TaskActivityProps) {
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
        <div className="text-sm text-muted-foreground">Loading activity...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('p-4', className)}>
        <div className="text-sm text-destructive">Failed to load activity</div>
      </div>
    )
  }

  const entries = data?.data || []

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
