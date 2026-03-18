'use client'

import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Network,
  FileDown,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, Workflow, FlowAttempt, tasksApi } from '@/lib/api'
import { useWorkflows } from '@/hooks/use-tasks'

/** Normalize samplePayload which may arrive as an object from the API */
function normalizeSamplePayload(payload: unknown): string {
  if (!payload) return ''
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload, null, 2)
}
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
 * using template variables. Also shows execution history and retry controls.
 */
export function FlowTaskConfig({
  task,
  isEditMode,
  flowConfig,
  onConfigChange,
}: FlowTaskConfigProps) {
  const queryClient = useQueryClient()

  // Fetch active workflows
  const { data: workflowsData, isLoading: isLoadingWorkflows } = useWorkflows()
  const workflows = workflowsData?.data?.filter((w: Workflow) => w.isActive) || []

  // Track if we've auto-loaded sample payload for a workflow (to avoid overwriting user edits)
  const lastAutoLoadedWorkflowId = useRef<string | null>(null)

  // Loading states for execute/retry
  const [isExecuting, setIsExecuting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

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
      const normalized = normalizeSamplePayload(selectedWorkflow.samplePayload)
      setInputPayloadText(normalized)
      onConfigChange({
        ...flowConfig!,
        inputPayload: normalized,
      })
      lastAutoLoadedWorkflowId.current = selectedWorkflow._id
    }
  }, [selectedWorkflow])

  // Check if task already has a spawned workflow (for edit mode)
  const spawnedWorkflowRunId = task?.spawnedWorkflowRunId
  const workflowResult = task?.workflowResult

  // Get flow attempts from task
  const flowAttempts = task?.flowConfig?.attempts || []
  const lastAttempt = flowAttempts.length > 0 ? flowAttempts[flowAttempts.length - 1] : null

  // Determine if we can execute or retry
  const isFlowTask = task?.taskType === 'flow' || task?.stepConfig?.stepType === 'flow' || task?.flowConfig?.workflowId
  const canExecute = task && isFlowTask && task.status === 'pending' && flowConfig?.workflowId
  const canRetry = task && isFlowTask && ['failed', 'on_hold'].includes(task.status)

  const handleWorkflowChange = (workflowId: string) => {
    const actualId = workflowId === '_none' ? '' : workflowId
    const newWorkflow = workflows.find((w: Workflow) => w._id === actualId)

    // If the new workflow has a sample payload, auto-load it
    if (newWorkflow?.samplePayload) {
      const normalized = normalizeSamplePayload(newWorkflow.samplePayload)
      setInputPayloadText(normalized)
      lastAutoLoadedWorkflowId.current = actualId
      onConfigChange({
        workflowId: actualId,
        inputPayload: normalized,
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
      const normalized = normalizeSamplePayload(selectedWorkflow.samplePayload)
      setInputPayloadText(normalized)
      onConfigChange({
        ...flowConfig!,
        inputPayload: normalized,
      })
    }
  }

  // Execute the flow task
  const handleExecute = async () => {
    if (!task?._id) return
    setIsExecuting(true)
    try {
      // Parse input payload if provided
      let inputPayload: Record<string, unknown> | undefined
      if (inputPayloadText.trim()) {
        try {
          inputPayload = JSON.parse(inputPayloadText)
        } catch {
          // If it contains template variables, send as-is and let backend handle it
          inputPayload = undefined
        }
      }

      await tasksApi.executeFlow(task._id, inputPayload)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
    } catch (error) {
      console.error('Failed to execute flow:', error)
    } finally {
      setIsExecuting(false)
    }
  }

  // Retry the flow task
  const handleRetry = async () => {
    if (!task?._id) return
    setIsRetrying(true)
    try {
      // Parse input payload if provided
      let inputPayload: Record<string, unknown> | undefined
      if (inputPayloadText.trim()) {
        try {
          inputPayload = JSON.parse(inputPayloadText)
        } catch {
          inputPayload = undefined
        }
      }

      await tasksApi.retryFlow(task._id, inputPayload)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
    } catch (error) {
      console.error('Failed to retry flow:', error)
    } finally {
      setIsRetrying(false)
    }
  }

  // Render workflow result status (for edit mode)
  const renderWorkflowStatus = () => {
    if (!spawnedWorkflowRunId && !lastAttempt) return null

    const status = workflowResult?.status || lastAttempt?.status
    const isRunning = status === 'running' || (task?.status === 'in_progress' && !workflowResult?.status)

    const statusColor = status === 'completed' || status === 'success'
      ? 'text-green-600 dark:text-green-400'
      : status === 'failed'
        ? 'text-red-600 dark:text-red-400'
        : 'text-blue-600 dark:text-blue-400'

    const StatusIcon = status === 'completed' || status === 'success'
      ? CheckCircle2
      : status === 'failed'
        ? XCircle
        : Loader2

    return (
      <div className="p-3 bg-muted/50 rounded-lg border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn(
              "h-4 w-4",
              statusColor,
              isRunning && "animate-spin"
            )} />
            <span className={cn("text-sm font-medium", statusColor)}>
              {(status === 'completed' || status === 'success') && 'Workflow Completed'}
              {status === 'failed' && 'Workflow Failed'}
              {isRunning && 'Workflow Running...'}
              {!status && !isRunning && 'Workflow Pending'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                <RefreshCw className={cn("h-3 w-3 mr-1", isRetrying && "animate-spin")} />
                {isRetrying ? 'Retrying...' : 'Retry'}
              </Button>
            )}
            {spawnedWorkflowRunId && (
              <Link
                href={`/workflow-runs/${spawnedWorkflowRunId}`}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                View Run <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
        {workflowResult?.error && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {workflowResult.error}
          </p>
        )}
        {lastAttempt?.errorMessage && !workflowResult?.error && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {lastAttempt.errorMessage}
          </p>
        )}
      </div>
    )
  }

  // Render the resolved input payload that was sent
  const renderResolvedInputPayload = () => {
    // Get the input payload from the last attempt or metadata
    const resolvedPayload = lastAttempt?.inputPayload ||
      (task?.metadata?.subflowInputPayload as Record<string, unknown>)

    if (!resolvedPayload) return null

    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Play className="h-3 w-3" />
          Resolved Input Payload (sent to subflow)
        </label>
        <pre className="text-[10px] bg-muted/50 rounded border p-2 overflow-auto max-h-40 font-mono">
          {JSON.stringify(resolvedPayload, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div className="space-y-3 pt-2 border-t border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-pink-500" />
          <label className="text-xs font-medium text-muted-foreground">Flow Configuration</label>
        </div>
        <div className="flex items-center gap-2">
          {canExecute && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleExecute}
              disabled={isExecuting}
            >
              <Play className={cn("h-3 w-3 mr-1", isExecuting && "animate-pulse")} />
              {isExecuting ? 'Starting...' : 'Execute Now'}
            </Button>
          )}
          {canRetry && !spawnedWorkflowRunId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleRetry}
              disabled={isRetrying}
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", isRetrying && "animate-spin")} />
              {isRetrying ? 'Retrying...' : 'Retry'}
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Select a workflow to trigger when this task runs. The workflow will receive the input payload you define.
      </p>

      {/* Show spawned workflow status if exists (edit mode) */}
      {task ? renderWorkflowStatus() : null}

      {/* Show resolved input payload that was actually sent */}
      {task && (lastAttempt || task?.metadata?.subflowInputPayload) ? renderResolvedInputPayload() : null}

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
          {selectedWorkflow.inputSchema && (() => {
            const schema = selectedWorkflow.inputSchema as Record<string, unknown>
            const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>
            const required = new Set((schema.required || []) as string[])
            const entries = Object.entries(properties)
            if (entries.length === 0) return null
            return (
              <div className="mt-1 pt-1 border-t border-pink-200/50 dark:border-pink-700/50">
                <p className="font-medium flex items-center gap-1">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  Input Schema
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {entries.map(([name, rawProp]) => {
                    const prop = rawProp as Record<string, unknown>
                    return (
                      <li key={name}>
                        <code className="bg-pink-100 dark:bg-pink-900/30 px-0.5 rounded">{name}</code>
                        <span className="opacity-70"> ({String(prop.type || 'any')})</span>
                        {required.has(name) && <span className="text-red-600 dark:text-red-400 ml-0.5">*</span>}
                        {typeof prop.description === 'string' && <span className="opacity-60"> — {prop.description}</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })()}
          {selectedWorkflow.samplePayload && (
            <p className="opacity-70 mt-0.5 flex items-center gap-1">
              <FileDown className="h-2.5 w-2.5" />
              Sample payload available
            </p>
          )}
        </div>
      )}

      {/* Execution History */}
      {flowAttempts.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Execution History ({flowAttempts.length} attempt{flowAttempts.length !== 1 ? 's' : ''})
          </label>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {[...flowAttempts].reverse().map((attempt, index) => (
              <FlowAttemptRow
                key={flowAttempts.length - 1 - index}
                attempt={attempt}
                attemptIndex={flowAttempts.length - 1 - index}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Component to render a single flow attempt row
function FlowAttemptRow({ attempt, attemptIndex }: { attempt: FlowAttempt; attemptIndex: number }) {
  const [expanded, setExpanded] = useState(false)

  const statusColors: Record<string, string> = {
    success: 'bg-green-500/20 text-green-600',
    failed: 'bg-red-500/20 text-red-600',
    running: 'bg-blue-500/20 text-blue-600',
    pending: 'bg-yellow-500/20 text-yellow-600',
  }

  const StatusIcon = attempt.status === 'success'
    ? CheckCircle2
    : attempt.status === 'failed'
      ? XCircle
      : attempt.status === 'running'
        ? Loader2
        : Clock

  return (
    <div className="text-xs bg-muted/30 rounded border p-2 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn(
            "h-3 w-3",
            attempt.status === 'success' && "text-green-600",
            attempt.status === 'failed' && "text-red-600",
            attempt.status === 'running' && "text-blue-600 animate-spin",
            attempt.status === 'pending' && "text-yellow-600"
          )} />
          <span className="text-muted-foreground">#{attempt.attemptNumber}</span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', statusColors[attempt.status])}>
            {attempt.status}
          </span>
          {attempt.durationMs && (
            <span className="text-muted-foreground">{Math.round(attempt.durationMs / 1000)}s</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {attempt.spawnedWorkflowRunId && (
            <Link
              href={`/workflow-runs/${attempt.spawnedWorkflowRunId}`}
              className="h-5 px-1 text-[10px] text-primary hover:underline flex items-center gap-0.5"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              View Run
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-[10px]"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Details'}
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground">
        {attempt.targetWorkflowName && (
          <span className="font-medium text-foreground">{attempt.targetWorkflowName}</span>
        )}
        {attempt.startedAt && (
          <>
            {' • '}
            {format(new Date(attempt.startedAt), 'MMM d, HH:mm:ss')}
          </>
        )}
        {attempt.completedAt && (
          <span> → {format(new Date(attempt.completedAt), 'HH:mm:ss')}</span>
        )}
      </div>

      {attempt.errorMessage && (
        <div className="flex items-start gap-1 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded p-1.5">
          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{attempt.errorMessage}</span>
        </div>
      )}

      {expanded && (
        <div className="pt-2 space-y-2 border-t border-border/50">
          {attempt.inputPayload && (
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Input Payload:</label>
              <pre className="text-[10px] bg-muted/50 rounded p-1.5 overflow-auto max-h-24 font-mono mt-0.5">
                {JSON.stringify(attempt.inputPayload, null, 2)}
              </pre>
            </div>
          )}
          {attempt.outputPayload && (
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Output Payload:</label>
              <pre className="text-[10px] bg-muted/50 rounded p-1.5 overflow-auto max-h-24 font-mono mt-0.5">
                {JSON.stringify(attempt.outputPayload, null, 2)}
              </pre>
            </div>
          )}
          {attempt.resolvedInputMapping && Object.keys(attempt.resolvedInputMapping).length > 0 && (
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Input Mapping:</label>
              <pre className="text-[10px] bg-muted/50 rounded p-1.5 overflow-auto max-h-20 font-mono mt-0.5">
                {JSON.stringify(attempt.resolvedInputMapping, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
