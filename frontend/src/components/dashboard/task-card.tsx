'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { UserChip } from '@/components/ui/user-chip'
import { KanbanTask } from '@/lib/dashboard-api'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, MessageSquareWarning } from 'lucide-react'

const URGENCY_COLORS: Record<string, string> = {
  low: '#6B7280',
  normal: '#3B82F6',
  high: '#F97316',
  urgent: '#EF4444',
}

function getUnansweredQuestionCount(task: KanbanTask): number {
  const questions = task.metadata?.pendingQuestions
  if (!Array.isArray(questions)) return 0
  return questions.filter(
    (q: { answered?: boolean }) => !q.answered
  ).length
}

interface TaskCardProps {
  task: KanbanTask
  onClick?: (taskId: string) => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const urgencyColor = URGENCY_COLORS[task.urgency || 'normal'] || URGENCY_COLORS.normal
  const unansweredCount = getUnansweredQuestionCount(task)
  const isEscalated = task.tags?.includes('escalated')
  const displayTags = (task.tags || []).filter((t) => t !== 'escalated').slice(0, 2)
  const assignee = task._resolved?.assignee
  const workflow = task._resolved?.workflow
  const project = task._resolved?.project

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors overflow-hidden"
      onClick={() => onClick?.(task._id)}
    >
      <div className="flex">
        {/* Urgency color bar */}
        <div
          className="w-[3px] shrink-0 rounded-l-md"
          style={{ backgroundColor: urgencyColor }}
        />

        <div className="flex-1 p-2.5 space-y-1.5 min-w-0">
          {/* Title */}
          <p className="text-sm font-medium leading-snug line-clamp-2">{task.title}</p>

          {/* Assignee + indicators row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {assignee && (
              <UserChip
                user={{
                  _id: assignee._id,
                  displayName: assignee.displayName,
                  role: 'member',
                  isActive: true,
                  isAgent: assignee.isAgent,
                  botColor: assignee.botColor,
                }}
                size="sm"
              />
            )}

            {isEscalated && (
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            )}

            {unansweredCount > 0 && (
              <Badge variant="outline" className="h-5 px-1.5 gap-0.5 text-xs text-purple-600 border-purple-300">
                <MessageSquareWarning className="h-3 w-3" />
                {unansweredCount}
              </Badge>
            )}
          </div>

          {/* Tags + project/workflow info row */}
          {(displayTags.length > 0 || workflow || project) && (
            <div className="flex items-center gap-1 overflow-hidden">
              {displayTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="h-4 px-1.5 text-[10px] font-normal truncate max-w-[80px] shrink-0">
                  {tag}
                </Badge>
              ))}
              {project && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate min-w-0">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || '#6B7280' }}
                  />
                  <span className="truncate">{project.displayName}</span>
                </span>
              )}
            </div>
          )}

          {/* Relative time */}
          <p className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
          </p>
        </div>
      </div>
    </Card>
  )
}
