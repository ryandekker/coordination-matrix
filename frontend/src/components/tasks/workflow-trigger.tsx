'use client'

import { useState } from 'react'
import { Play, Loader2, CheckCircle2, XCircle, ExternalLink, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, Workflow, workflowRunsApi, tasksApi } from '@/lib/api'
import { useWorkflows } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { WorkflowInputForm, useWorkflowInputForm } from '@/components/workflows/workflow-input-form'

interface WorkflowTriggerProps {
  task: Task
}

export function WorkflowTrigger({ task }: WorkflowTriggerProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [isTriggering, setIsTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Fetch active workflows
  const { data: workflowsData, isLoading: isLoadingWorkflows } = useWorkflows()
  const workflows = workflowsData?.data?.filter((w: Workflow) => w.isActive) || []

  // Get selected workflow for schema
  const selectedWorkflow = workflows.find((w: Workflow) => w._id === selectedWorkflowId)

  // Input form state driven by selected workflow's schema
  const inputForm = useWorkflowInputForm(selectedWorkflow?.inputSchema)

  // Check if task already has a spawned workflow
  const spawnedWorkflowRunId = task.spawnedWorkflowRunId
  const workflowResult = task.workflowResult

  const handleWorkflowChange = (value: string) => {
    setSelectedWorkflowId(value)
    setError(null)
    inputForm.reset()
  }

  const handleTriggerWorkflow = async () => {
    if (!selectedWorkflowId) return

    // Validate input if schema exists
    if (selectedWorkflow?.inputSchema && !inputForm.validate()) {
      return
    }

    setIsTriggering(true)
    setError(null)
    try {
      // Start workflow directly via the workflow-runs API
      const inputPayload = Object.keys(inputForm.values).length > 0
        ? inputForm.values
        : {
            // Fallback: pass task context when no explicit input
            title: task.title,
            summary: task.summary || '',
          }

      const result = await workflowRunsApi.start({
        workflowId: selectedWorkflowId,
        inputPayload,
        source: 'task-trigger',
      })

      // Link the spawned run to this task
      if (result.data?.run?._id) {
        await tasksApi.update(task._id, {
          spawnedWorkflowRunId: result.data.run._id,
        })
      }

      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
      setSelectedWorkflowId('')
      inputForm.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger workflow')
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
      <label className="text-xs font-medium text-purple-800 dark:text-purple-200 flex items-center gap-2">
        <Network className="h-3.5 w-3.5" />
        Trigger Workflow
      </label>

      {/* Show spawned workflow status if exists */}
      {renderWorkflowStatus()}

      {/* Workflow selection */}
      <div className="space-y-1">
        <Select
          value={selectedWorkflowId || '_none'}
          onValueChange={(v) => handleWorkflowChange(v === '_none' ? '' : v)}
          disabled={isLoadingWorkflows || isTriggering}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={isLoadingWorkflows ? "Loading..." : "Select workflow..."} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">
              <span className="text-muted-foreground">Select workflow...</span>
            </SelectItem>
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
      </div>

      {/* Input form - shown when a workflow is selected */}
      {selectedWorkflowId && (
        <WorkflowInputForm
          inputSchema={selectedWorkflow?.inputSchema}
          samplePayload={selectedWorkflow?.samplePayload}
          value={inputForm.values}
          onChange={inputForm.setValues}
          errors={inputForm.errors}
          disabled={isTriggering}
        />
      )}

      {/* Error display */}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Run button */}
      {selectedWorkflowId && (
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 px-3 w-full bg-purple-600 hover:bg-purple-700 text-white"
          disabled={!selectedWorkflowId || isTriggering}
          onClick={handleTriggerWorkflow}
        >
          {isTriggering ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-2" />
              Run Workflow
            </>
          )}
        </Button>
      )}
    </div>
  )
}
