'use client'

import { KanbanColumn } from '@/lib/dashboard-api'
import { TaskCard } from './task-card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const COLUMN_ORDER = [
  'needs_attention',
  'questions',
  'pending',
  'processing',
  'in_progress',
  'review',
  'done_recent',
]

const COLUMN_CONFIG: Record<string, { label: string; indicatorColor: string }> = {
  needs_attention: { label: 'Needs Attention', indicatorColor: 'bg-amber-500' },
  questions: { label: 'Questions', indicatorColor: 'bg-purple-500' },
  pending: { label: 'Pending', indicatorColor: 'bg-gray-400' },
  processing: { label: 'Processing', indicatorColor: 'bg-cyan-500' },
  in_progress: { label: 'In Progress', indicatorColor: 'bg-blue-500' },
  review: { label: 'Review', indicatorColor: 'bg-violet-500' },
  done_recent: { label: 'Done', indicatorColor: 'bg-green-500' },
}

interface KanbanBoardProps {
  columns: Record<string, KanbanColumn>
  onTaskClick: (taskId: string) => void
}

export function KanbanBoard({ columns, onTaskClick }: KanbanBoardProps) {
  // Use defined order, but also include any extra columns not in the predefined list
  const extraKeys = Object.keys(columns).filter((k) => !COLUMN_ORDER.includes(k))
  const orderedKeys = [...COLUMN_ORDER, ...extraKeys].filter((k) => k in columns)

  return (
    <div className="grid grid-cols-7 border border-border rounded-lg overflow-hidden">
      {orderedKeys.map((key, index) => {
        const column = columns[key]
        const config = COLUMN_CONFIG[key] || {
          label: column.name,
          indicatorColor: 'bg-gray-400',
        }

        return (
          <div
            key={key}
            className={`flex flex-col min-w-0 px-3 py-3 ${index > 0 ? 'border-l border-border' : ''}`}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 pb-2 mb-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${config.indicatorColor}`} />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">{config.label}</h3>
              <Badge variant="secondary" className="h-5 px-1.5 text-xs font-normal ml-auto">
                {column.count}
              </Badge>
            </div>

            {/* Task list */}
            <ScrollArea className="flex-1" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <div className="space-y-2">
                {column.tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No tasks
                  </p>
                ) : (
                  column.tasks.map((task) => (
                    <TaskCard key={task._id} task={task} onClick={onTaskClick} />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )
      })}
    </div>
  )
}
