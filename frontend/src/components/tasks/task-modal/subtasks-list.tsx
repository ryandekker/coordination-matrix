'use client'

import { cn } from '@/lib/utils'
import { Plus, Loader2, ListTree } from 'lucide-react'
import { getTaskTypeConfig } from '@/lib/task-type-config'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Task, LookupValue } from '@/lib/api'

interface SubtasksListProps {
  subtasks: Task[]
  isLoading: boolean
  statusOptions: LookupValue[]
  users: Array<{ _id: string; displayName: string }>
  onSubtaskClick: (id: string) => void
  newSubtaskTitle: string
  setNewSubtaskTitle: (title: string) => void
  onSubtaskInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  isCreatingSubtask: boolean
  subtaskInputRef: React.RefObject<HTMLInputElement>
}

export function SubtasksList({
  subtasks,
  isLoading,
  statusOptions,
  users,
  onSubtaskClick,
  newSubtaskTitle,
  setNewSubtaskTitle,
  onSubtaskInputKeyDown,
  isCreatingSubtask,
  subtaskInputRef,
}: SubtasksListProps) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Subtasks {subtasks.length > 0 && `(${subtasks.length})`}
        </label>
      </div>

      {/* Quick create input */}
      <div className="relative">
        <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          ref={subtaskInputRef}
          type="text"
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          onKeyDown={onSubtaskInputKeyDown}
          placeholder="Add subtask... (Enter to create)"
          disabled={isCreatingSubtask}
          className={cn(
            'w-full h-8 pl-8 pr-8 text-sm rounded-md border border-input bg-background',
            'placeholder:text-muted-foreground/60',
            'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        />
        {isCreatingSubtask && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <span className="text-sm">Loading subtasks...</span>
        </div>
      ) : subtasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <ListTree className="h-6 w-6 mb-1.5 opacity-50" />
          <span className="text-xs">No subtasks yet</span>
        </div>
      ) : (
        <div className="space-y-1">
          {subtasks.map((subtask) => {
            const subtaskStatus = statusOptions.find(s => s.code === subtask.status)
            const subtaskAssignee = users.find(u => u._id === subtask.assigneeId)
            const subtaskTypeConfig = getTaskTypeConfig(subtask.taskType)
            const SubtaskTypeIcon = subtaskTypeConfig.icon

            return (
              <button
                key={subtask._id}
                type="button"
                onClick={() => onSubtaskClick(subtask._id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left',
                  'bg-muted/30 hover:bg-muted/60 transition-colors',
                  'border border-transparent hover:border-border'
                )}
              >
                {/* Task type icon */}
                <SubtaskTypeIcon
                  className="h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: subtaskTypeConfig.hexColor }}
                />

                {/* Status badge */}
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                  style={{
                    backgroundColor: `${subtaskStatus?.color || '#888'}20`,
                    color: subtaskStatus?.color || '#888',
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: subtaskStatus?.color || '#888' }}
                  />
                  {subtaskStatus?.displayName || subtask.status}
                </span>

                {/* Title */}
                <span className="flex-1 text-sm truncate" title={subtask.title}>
                  {subtask.title}
                </span>

                {/* Assignee avatar with tooltip */}
                {subtaskAssignee ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium flex-shrink-0 cursor-default"
                        >
                          {subtaskAssignee.displayName.charAt(0).toUpperCase()}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {subtaskAssignee.displayName}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <span className="w-5 h-5 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
