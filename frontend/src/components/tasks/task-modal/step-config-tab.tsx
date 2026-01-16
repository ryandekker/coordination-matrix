'use client'

import { Task, TaskStepConfig as TaskStepConfigType } from '@/lib/api'
import { TaskStepConfig } from '../task-step-config'
import { Settings2 } from 'lucide-react'

interface StepConfigTabProps {
  task: Task
  onConfigChange: (config: TaskStepConfigType) => void
}

export function StepConfigTab({ task, onConfigChange }: StepConfigTabProps) {
  if (!task.stepConfig) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full min-h-[200px] text-center">
        <Settings2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          No step configuration available
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {task.workflowRunId
            ? 'This task was created before step config tracking was added'
            : 'Step configuration is only available for workflow tasks'
          }
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Workflow Step Configuration</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Original configuration from the workflow step. Edit values here before rerunning.
        </p>
      </div>

      <TaskStepConfig
        stepConfig={task.stepConfig}
        taskType={task.taskType}
        onConfigChange={onConfigChange}
      />
    </div>
  )
}
