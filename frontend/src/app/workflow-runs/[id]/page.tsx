'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Ban,
  Workflow as WorkflowIcon,
  Bot,
  User,
  Globe,
  GitBranch,
  Repeat,
  Merge,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { workflowRunsApi, WorkflowRun, WorkflowRunStatus, Task, Workflow } from '@/lib/api'

const STATUS_CONFIG: Record<WorkflowRunStatus, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  pending: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-50', label: 'Pending' },
  running: { icon: Play, color: 'text-blue-500', bgColor: 'bg-blue-50', label: 'Running' },
  paused: { icon: Pause, color: 'text-amber-500', bgColor: 'bg-amber-50', label: 'Paused' },
  completed: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50', label: 'Failed' },
  cancelled: { icon: Ban, color: 'text-gray-500', bgColor: 'bg-gray-50', label: 'Cancelled' },
}

const TASK_STATUS_CONFIG: Record<string, { color: string; bgColor: string }> = {
  pending: { color: 'text-gray-500', bgColor: 'bg-gray-50' },
  in_progress: { color: 'text-blue-500', bgColor: 'bg-blue-50' },
  blocked: { color: 'text-amber-500', bgColor: 'bg-amber-50' },
  completed: { color: 'text-green-500', bgColor: 'bg-green-50' },
  failed: { color: 'text-red-500', bgColor: 'bg-red-50' },
  cancelled: { color: 'text-gray-400', bgColor: 'bg-gray-50' },
}

type TaskType = 'standard' | 'trigger' | 'decision' | 'foreach' | 'join' | 'subflow' | 'external'

const TASK_TYPE_CONFIG: Record<TaskType, { icon: React.ElementType; color: string; label: string }> = {
  standard: { icon: Bot, color: 'text-blue-500', label: 'Agent' },
  trigger: { icon: Play, color: 'text-green-500', label: 'Trigger' },
  decision: { icon: GitBranch, color: 'text-amber-500', label: 'Decision' },
  foreach: { icon: Repeat, color: 'text-green-500', label: 'ForEach' },
  join: { icon: Merge, color: 'text-indigo-500', label: 'Join' },
  subflow: { icon: WorkflowIcon, color: 'text-pink-500', label: 'Subflow' },
  external: { icon: Globe, color: 'text-orange-500', label: 'External' },
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString()
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '-'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  const durationMs = endDate.getTime() - startDate.getTime()

  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`
  if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`
  return `${Math.round(durationMs / 3600000)}h`
}

interface TaskNodeProps {
  task: Task
  depth: number
  allTasks: Task[]
}

function TaskNode({ task, depth, allTasks }: TaskNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const children = allTasks.filter(t => t.parentId === task._id)
  const hasChildren = children.length > 0

  const taskType = ((task as any).taskType || 'standard') as TaskType
  const typeConfig = TASK_TYPE_CONFIG[taskType] || TASK_TYPE_CONFIG.standard
  const TypeIcon = typeConfig.icon
  const statusConfig = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending

  return (
    <div className="space-y-1">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div
          className={cn(
            'flex items-center gap-2 p-2 rounded-lg border transition-colors',
            statusConfig.bgColor,
            'hover:bg-muted/50'
          )}
          style={{ marginLeft: `${depth * 24}px` }}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-6" />
          )}

          <TypeIcon className={cn('h-4 w-4 flex-shrink-0', typeConfig.color)} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/tasks?taskId=${task._id}`}
                className="font-medium truncate hover:underline"
              >
                {task.title}
              </Link>
              <Badge variant="outline" className={cn('text-xs flex-shrink-0', statusConfig.color)}>
                {task.status.replace('_', ' ')}
              </Badge>
              <Badge variant="outline" className="text-xs flex-shrink-0">
                {typeConfig.label}
              </Badge>
            </div>
            {task.summary && (
              <p className="text-sm text-muted-foreground truncate">{task.summary}</p>
            )}
          </div>

          {hasChildren && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {children.length} {children.length === 1 ? 'child' : 'children'}
            </span>
          )}

          {task.status === 'in_progress' && (
            <span className="flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
        </div>

        {hasChildren && (
          <CollapsibleContent>
            <div className="mt-1">
              {children.map(child => (
                <TaskNode
                  key={child._id}
                  task={child}
                  depth={depth + 1}
                  allTasks={allTasks}
                />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  )
}

export default function WorkflowRunDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const runId = params.id as string
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-run', runId],
    queryFn: () => workflowRunsApi.get(runId, true),
    refetchInterval: (query) => {
      const apiData = query.state.data as { run?: WorkflowRun } | undefined
      // Auto-refresh every 3 seconds if the run is active
      if (apiData?.run && (apiData.run.status === 'running' || apiData.run.status === 'pending')) {
        return 3000
      }
      return false
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => workflowRunsApi.cancel(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-run', runId] })
      setCancelConfirm(false)
    },
  })

  // API returns { run: {...}, tasks: [...] } structure when includeTasks=true
  const apiResponse = data as { run?: WorkflowRun & { workflow?: Workflow }; tasks?: Task[] } | undefined
  const run = apiResponse?.run
  const tasks = apiResponse?.tasks || []
  const workflow = run?.workflow

  // Build task tree - find root tasks (those without parent in this run)
  const taskIdsInRun = new Set(tasks.map(t => t._id))
  const rootTasks = tasks.filter(t => !t.parentId || !taskIdsInRun.has(t.parentId))

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load workflow run</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[run.status]
  const StatusIcon = statusConfig.icon
  const isActive = run.status === 'running' || run.status === 'pending'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{workflow?.name || 'Workflow Run'}</h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className="h-4 w-4 mr-1" />
                {statusConfig.label}
              </Badge>
              {isActive && (
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Run ID: {run._id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCancelConfirm(true)}
            >
              <Ban className="h-4 w-4 mr-2" />
              Cancel Run
            </Button>
          )}
        </div>
      </div>

      {/* Run Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Started</p>
          <p className="font-medium">{formatDate(run.startedAt || run.createdAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="font-medium">{formatDate(run.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Duration</p>
          <p className="font-medium">{formatDuration(run.startedAt || run.createdAt, run.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Tasks</p>
          <p className="font-medium">{tasks.length}</p>
        </div>
      </div>

      {/* Error Display */}
      {run.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Workflow Failed</p>
              <p className="text-sm text-destructive/80 mt-1">{run.error}</p>
              {run.failedStepId && (
                <p className="text-sm text-muted-foreground mt-1">
                  Failed at step: {run.failedStepId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress Summary */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-3">Progress</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm">{run.completedStepIds.length} steps completed</span>
          </div>
          {run.currentStepIds.length > 0 && (
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-blue-500" />
              <span className="text-sm">{run.currentStepIds.length} steps in progress</span>
            </div>
          )}
        </div>

        {workflow?.steps && workflow.steps.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {workflow.steps.map((step) => {
                const isCompleted = run.completedStepIds.includes(step.id)
                const isCurrent = run.currentStepIds.includes(step.id)
                const isFailed = run.failedStepId === step.id

                return (
                  <Badge
                    key={step.id}
                    variant="outline"
                    className={cn(
                      'text-xs',
                      isCompleted && 'bg-green-50 text-green-700 border-green-300',
                      isCurrent && 'bg-blue-50 text-blue-700 border-blue-300',
                      isFailed && 'bg-red-50 text-red-700 border-red-300',
                      !isCompleted && !isCurrent && !isFailed && 'bg-gray-50 text-gray-500'
                    )}
                  >
                    {step.name}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Task Tree */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-4">Task Tree</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks created yet.</p>
        ) : (
          <div className="space-y-1">
            {rootTasks.map(task => (
              <TaskNode
                key={task._id}
                task={task}
                depth={0}
                allTasks={tasks}
              />
            ))}
          </div>
        )}
      </div>

      {/* Input/Output Payloads */}
      {(run.inputPayload || run.outputPayload) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {run.inputPayload && Object.keys(run.inputPayload).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Input Payload</h2>
              <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-48">
                {JSON.stringify(run.inputPayload, null, 2)}
              </pre>
            </div>
          )}
          {run.outputPayload && Object.keys(run.outputPayload).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Output Payload</h2>
              <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-48">
                {JSON.stringify(run.outputPayload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Workflow Run</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this workflow run? This will stop all running
              tasks and mark the run as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelMutation.mutate()}
            >
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
