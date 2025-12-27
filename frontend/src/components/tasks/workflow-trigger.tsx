'use client'

import { useState } from 'react'
import { Play, Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, Workflow } from '@/lib/api'
import { useUpdateTask, useWorkflows } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface WorkflowTriggerProps {
  task: Task
}

export function WorkflowTrigger({ task }: WorkflowTriggerProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [isTriggering, setIsTriggering] = useState(false)
  const updateTask = useUpdateTask()

  // Fetch active workflows
  const { data: workflowsData, isLoading: isLoadingWorkflows } = useWorkflows()
  const workflows = workflowsData?.data?.filter((w: Workflow) => w.isActive) || []

  // Check if task already has a spawned workflow
  const spawnedWorkflowRunId = (task as any).spawnedWorkflowRunId
  const workflowResult = (task as any).workflowResult

  const handleTriggerWorkflow = async () => {
    if (!selectedWorkflowId) return

    setIsTriggering(true)
    try {
      await updateTask.mutateAsync({
        id: task._id,
        data: { triggerWorkflowId: selectedWorkflowId },
      })
      setSelectedWorkflowId('')
    } catch (error) {
      console.error('Failed to trigger workflow:', error)
    } finally {
      setIsTriggering(false)
    }
  }

  // Render workflow result status
  const renderWorkflowStatus = () => {
    if (!spawnedWorkflowRunId) return null

    const statusColor = workflowResult?.status === 'completed'
      ? 'text-green-600 dark:text-green-400'
      : workflowResult?.status === 'failed'
        ? 'text-red-600 dark:text-red-400'
        : 'text-blue-600 dark:text-blue-400'

    const StatusIcon = workflowResult?.status === 'completed'
      ? CheckCircle2
      : workflowResult?.status === 'failed'
        ? XCircle
        : Loader2

    return (
      <div className="p-3 bg-muted/50 rounded-lg border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn(
              "h-4 w-4",
              statusColor,
              !workflowResult?.status && "animate-spin"
            )} />
            <span className={cn("text-sm font-medium", statusColor)}>
              {workflowResult?.status === 'completed' && 'Workflow Completed'}
              {workflowResult?.status === 'failed' && 'Workflow Failed'}
              {!workflowResult?.status && 'Workflow Running...'}
            </span>
          </div>
          <Link
            href={`/workflow-runs/${spawnedWorkflowRunId}`}
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            View Run <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {workflowResult?.error && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {workflowResult.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
      <label className="text-xs font-medium text-purple-800 dark:text-purple-200">
        Trigger Workflow
      </label>

      <p className="text-xs text-muted-foreground">
        Start a workflow with this task as the trigger. The workflow will receive the task&apos;s metadata as input.
      </p>

      {/* Show spawned workflow status if exists */}
      {renderWorkflowStatus()}

      {/* Workflow selection and trigger */}
      <div className="flex gap-2">
        <Select
          value={selectedWorkflowId}
          onValueChange={setSelectedWorkflowId}
          disabled={isLoadingWorkflows || isTriggering}
        >
          <SelectTrigger className="flex-1 h-8 text-sm">
            <SelectValue placeholder={isLoadingWorkflows ? "Loading..." : "Select workflow..."} />
          </SelectTrigger>
          <SelectContent>
            {workflows.map((workflow: Workflow) => (
              <SelectItem key={workflow._id} value={workflow._id}>
                {workflow.name}
              </SelectItem>
            ))}
            {workflows.length === 0 && !isLoadingWorkflows && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No active workflows available
              </div>
            )}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 px-3 bg-purple-600 hover:bg-purple-700 text-white"
          disabled={!selectedWorkflowId || isTriggering}
          onClick={handleTriggerWorkflow}
        >
          {isTriggering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1" />
              Run
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
