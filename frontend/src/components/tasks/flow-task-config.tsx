'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Loader2, CheckCircle2, XCircle, ExternalLink, Network, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, Workflow } from '@/lib/api'
import { useWorkflows } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import { TemplateTextarea } from '@/components/ui/template-textarea'
import Link from 'next/link'

export interface FlowConfig {
  workflowId: string
  inputPayload?: string // JSON string template with {{variables}}
}

interface FlowTaskConfigProps {
  task?: Task | null
  isEditMode: boolean
  flowConfig?: FlowConfig
  onConfigChange: (config: FlowConfig) => void
}

/**
 * FlowTaskConfig - Configuration panel for flow/nested workflow tasks
 *
 * Allows selecting a workflow to trigger and defining the input payload
 * using template variables.
 */
export function FlowTaskConfig({
  task,
  isEditMode,
  flowConfig,
  onConfigChange,
}: FlowTaskConfigProps) {
  // Fetch active workflows
  const { data: workflowsData, isLoading: isLoadingWorkflows } = useWorkflows()
  const workflows = workflowsData?.data?.filter((w: Workflow) => w.isActive) || []

  // Track if we've auto-loaded sample payload for a workflow (to avoid overwriting user edits)
  const lastAutoLoadedWorkflowId = useRef<string | null>(null)

  // Input payload as string template
  const [inputPayloadText, setInputPayloadText] = useState(() => {
    if (flowConfig?.inputPayload) {
      return flowConfig.inputPayload
    }
    // Default template
    return '{\n  "title": "{{title}}",\n  "summary": "{{summary}}"\n}'
  })

  // Sync when flowConfig changes externally
  useEffect(() => {
    if (flowConfig?.inputPayload) {
      setInputPayloadText(flowConfig.inputPayload)
    }
  }, [flowConfig?.inputPayload])

  // Get the selected workflow
  const selectedWorkflow = workflows.find((w: Workflow) => w._id === flowConfig?.workflowId)

  // Auto-load sample payload when workflow is first selected (if available)
  useEffect(() => {
    if (
      selectedWorkflow?.samplePayload &&
      selectedWorkflow._id !== lastAutoLoadedWorkflowId.current &&
      // Only auto-load if current payload is empty or is the default template
      (inputPayloadText === '{\n  "title": "{{title}}",\n  "summary": "{{summary}}"\n}' || !inputPayloadText.trim())
    ) {
      setInputPayloadText(selectedWorkflow.samplePayload)
      onConfigChange({
        ...flowConfig!,
        inputPayload: selectedWorkflow.samplePayload,
      })
      lastAutoLoadedWorkflowId.current = selectedWorkflow._id
    }
  }, [selectedWorkflow])

  // Check if task already has a spawned workflow (for edit mode)
  const spawnedWorkflowRunId = task?.spawnedWorkflowRunId
  const workflowResult = task?.workflowResult

  const handleWorkflowChange = (workflowId: string) => {
    const actualId = workflowId === '_none' ? '' : workflowId
    const newWorkflow = workflows.find((w: Workflow) => w._id === actualId)

    // If the new workflow has a sample payload, auto-load it
    if (newWorkflow?.samplePayload) {
      setInputPayloadText(newWorkflow.samplePayload)
      lastAutoLoadedWorkflowId.current = actualId
      onConfigChange({
        workflowId: actualId,
        inputPayload: newWorkflow.samplePayload,
      })
    } else {
      onConfigChange({
        ...flowConfig!,
        workflowId: actualId,
      })
    }
  }

  const handleInputPayloadChange = (value: string) => {
    setInputPayloadText(value)
    onConfigChange({
      ...flowConfig!,
      inputPayload: value,
    })
  }

  // Load sample payload from workflow
  const handleLoadSamplePayload = () => {
    if (selectedWorkflow?.samplePayload) {
      setInputPayloadText(selectedWorkflow.samplePayload)
      onConfigChange({
        ...flowConfig!,
        inputPayload: selectedWorkflow.samplePayload,
      })
    }
  }

  // Render workflow result status (for edit mode)
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
    <div className="space-y-3 pt-2 border-t border-border/50">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-pink-500" />
        <label className="text-xs font-medium text-muted-foreground">Flow Configuration</label>
      </div>

      <p className="text-xs text-muted-foreground">
        Select a workflow to trigger when this task runs. The workflow will receive the input payload you define.
      </p>

      {/* Show spawned workflow status if exists (edit mode) */}
      {task && renderWorkflowStatus()}

      {/* Workflow Selection */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Target Workflow</label>
        <Select
          value={flowConfig?.workflowId || '_none'}
          onValueChange={handleWorkflowChange}
          disabled={isLoadingWorkflows}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={isLoadingWorkflows ? "Loading..." : "Select workflow..."} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">
              <span className="text-muted-foreground">No workflow selected</span>
            </SelectItem>
            {workflows.map((workflow: Workflow) => (
              <SelectItem key={workflow._id} value={workflow._id}>
                <div className="flex items-center gap-2">
                  <Network className="h-3.5 w-3.5 text-pink-500" />
                  {workflow.name}
                </div>
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

      {/* Input Payload Template */}
      {flowConfig?.workflowId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Input Payload (JSON)</label>
            {selectedWorkflow?.samplePayload && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300"
                onClick={handleLoadSamplePayload}
              >
                <FileDown className="h-3 w-3 mr-1" />
                Load Sample
              </Button>
            )}
          </div>
          <TemplateTextarea
            description="Define the data to pass to the workflow. Use {{variable}} for dynamic values from this task."
            value={inputPayloadText}
            onChange={handleInputPayloadChange}
            placeholder={'{\n  "title": "{{title}}",\n  "summary": "{{summary}}",\n  "customField": "value"\n}'}
            minHeight="100px"
            maxHeight="200px"
            showTokenBrowser={true}
            taskOnly={true}
          />
        </div>
      )}

      {/* Workflow info hint */}
      {selectedWorkflow && (
        <div className="text-[10px] bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded px-2 py-1.5 text-pink-800 dark:text-pink-200">
          <p className="font-medium">Selected: {selectedWorkflow.name}</p>
          {selectedWorkflow.description && (
            <p className="opacity-80 mt-0.5">{selectedWorkflow.description}</p>
          )}
          {selectedWorkflow.samplePayload && (
            <p className="opacity-70 mt-0.5 flex items-center gap-1">
              <FileDown className="h-2.5 w-2.5" />
              Sample payload available
            </p>
          )}
        </div>
      )}
    </div>
  )
}
