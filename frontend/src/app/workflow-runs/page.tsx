'use client'

import { useState, Suspense, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEventStream, EventData } from '@/hooks/use-event-stream'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  Ban,
  Workflow,
  Workflow as WorkflowIcon,
  Bot,
  Globe,
  GitBranch,
  Repeat,
  Merge,
  Search,
  Calendar,
  User,
  X,
  CircleDashed,
  ExternalLink,
  FileText,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { workflowRunsApi, workflowsApi, WorkflowRun, WorkflowRunStatus, Task, Workflow as WorkflowType } from '@/lib/api'
import { useFieldConfigs, useLookups } from '@/hooks/use-tasks'
import { TaskModal } from '@/components/tasks/task-modal'

const STATUS_CONFIG: Record<WorkflowRunStatus, { icon: React.ElementType; color: string; bgColor: string; label: string; filterable: boolean }> = {
  pending: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50', label: 'Pending', filterable: true },
  running: { icon: Play, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50', label: 'Running', filterable: true },
  paused: { icon: Pause, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50', label: 'Paused', filterable: false },
  completed: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50', label: 'Completed', filterable: true },
  failed: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50', label: 'Failed', filterable: true },
  cancelled: { icon: Ban, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50', label: 'Cancelled', filterable: true },
}

// Get only filterable statuses for the filter dropdown
const FILTERABLE_STATUSES = Object.entries(STATUS_CONFIG)
  .filter(([, config]) => config.filterable)
  .map(([status]) => status as WorkflowRunStatus)

const TASK_STATUS_CONFIG: Record<string, { color: string; bgColor: string }> = {
  pending: { color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
  in_progress: { color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50' },
  blocked: { color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50' },
  completed: { color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50' },
  failed: { color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50' },
  cancelled: { color: 'text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
}

type TaskType = 'flow' | 'agent' | 'decision' | 'foreach' | 'join' | 'external' | 'trigger' | 'manual' | 'webhook'

const TASK_TYPE_CONFIG: Record<TaskType, { icon: React.ElementType; color: string; label: string }> = {
  flow: { icon: WorkflowIcon, color: 'text-pink-500', label: 'Flow' },
  agent: { icon: Bot, color: 'text-blue-500', label: 'Agent' },
  decision: { icon: GitBranch, color: 'text-amber-500', label: 'Decision' },
  foreach: { icon: Repeat, color: 'text-green-500', label: 'ForEach' },
  join: { icon: Merge, color: 'text-indigo-500', label: 'Join' },
  external: { icon: Globe, color: 'text-orange-500', label: 'External' },
  trigger: { icon: Bot, color: 'text-yellow-500', label: 'Trigger' },
  manual: { icon: User, color: 'text-purple-500', label: 'Manual' },
  webhook: { icon: Globe, color: 'text-purple-500', label: 'Webhook' },
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

// Build parent-child index once for O(1) lookups
type ChildrenMap = Map<string, Task[]>

function buildChildrenMap(tasks: Task[]): ChildrenMap {
  const map = new Map<string, Task[]>()
  for (const task of tasks) {
    if (task.parentId) {
      const parentId = task.parentId
      if (!map.has(parentId)) {
        map.set(parentId, [])
      }
      map.get(parentId)!.push(task)
    }
  }
  return map
}

// Task tree node component - shows task details in modal
interface TaskNodeProps {
  task: Task
  depth: number
  childrenMap: ChildrenMap  // Pre-computed children index for O(1) lookups
  onTaskClick: (task: Task) => void
  stepType?: TaskType  // Override type from workflow step
  maxInitialChildren?: number  // Limit children shown initially (for large lists)
}

function TaskNode({ task, depth, childrenMap, onTaskClick, stepType, maxInitialChildren = 20 }: TaskNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth === 0)  // Only expand root level by default
  const [showAll, setShowAll] = useState(false)

  const allChildren = childrenMap.get(task._id) || []
  const childCount = (task as any).childCount ?? allChildren.length
  const hasChildren = childCount > 0

  // Show limited children initially for performance
  const displayedChildren = showAll ? allChildren : allChildren.slice(0, maxInitialChildren)
  const hasMoreChildren = allChildren.length > maxInitialChildren && !showAll

  // Use stepType override if provided, otherwise fall back to task.taskType
  const taskType = stepType || ((task as any).taskType || 'agent') as TaskType
  const typeConfig = TASK_TYPE_CONFIG[taskType] || TASK_TYPE_CONFIG.agent
  const TypeIcon = typeConfig.icon
  const statusConfig = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending

  return (
    <div className="space-y-1">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div
          className={cn(
            'flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer',
            statusConfig.bgColor,
            'hover:bg-muted/50'
          )}
          style={{ marginLeft: `${depth * 24}px` }}
          onClick={() => onTaskClick(task)}
        >
          {/* Collapse/expand toggle for tasks with children */}
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button
                className="p-0.5 hover:bg-muted rounded flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}
          <TypeIcon className={cn('h-4 w-4 flex-shrink-0', typeConfig.color)} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate hover:underline">
                {task.title}
              </span>
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
              {childCount} {childCount === 1 ? 'child' : 'children'}
            </span>
          )}

          {/* ForEach batch progress */}
          {taskType === 'foreach' && (task as any).batchCounters && (
            <span className="text-xs text-muted-foreground flex-shrink-0 font-mono">
              {(task as any).batchCounters.processedCount || 0}/{(task as any).batchCounters.expectedCount || '?'}
              {(task as any).batchCounters.failedCount > 0 && (
                <span className="text-destructive ml-1">({(task as any).batchCounters.failedCount} failed)</span>
              )}
            </span>
          )}

          {/* Waiting indicator with reason */}
          {task.status === 'waiting' && (task as any).metadata?.waitingReason && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0 max-w-[200px] truncate" title={(task as any).metadata.waitingReason}>
              {(task as any).metadata.waitingReason}
            </span>
          )}

          {task.status === 'in_progress' && (
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
        </div>

        {hasChildren && (
          <CollapsibleContent>
            <div className="mt-1">
              {displayedChildren.map(child => (
                <TaskNode
                  key={child._id}
                  task={child}
                  depth={depth + 1}
                  childrenMap={childrenMap}
                  onTaskClick={onTaskClick}
                  stepType={stepType}
                  maxInitialChildren={maxInitialChildren}
                />
              ))}
              {hasMoreChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowAll(true)
                  }}
                  className="ml-6 mt-1 text-xs text-primary hover:underline"
                  style={{ marginLeft: `${(depth + 1) * 24}px` }}
                >
                  Show {allChildren.length - maxInitialChildren} more...
                </button>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  )
}

// Helper to get the effective step type from a workflow step
function getStepType(step: any): TaskType {
  // Check stepType first (new format)
  if (step.stepType) {
    return step.stepType as TaskType
  }
  // Check execution mode (older format) - multiple legacy field names
  if (step.execution === 'manual' || step.type === 'manual' || step.executionMode === 'manual') {
    return 'manual'
  }
  // Check for hitlPhase which indicates human-in-the-loop
  if (step.hitlPhase) {
    return 'manual'
  }
  // Default to agent
  return 'agent'
}

// Detail view component
function WorkflowRunDetail({ runId }: { runId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  // Real-time updates - invalidate this run's data when related tasks change
  const handleEvent = useCallback((event: EventData) => {
    if ('task' in event && event.task?.workflowId) {
      queryClient.invalidateQueries({ queryKey: ['workflow-run', runId] })
    }
  }, [queryClient, runId])

  useEventStream({ onEvent: handleEvent })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-run', runId],
    queryFn: () => workflowRunsApi.get(runId, {
      includeTasks: true,
      includeChildCounts: true,
    }),
    refetchInterval: (query) => {
      const apiData = query.state.data as { run?: WorkflowRun } | undefined
      if (apiData?.run && (apiData.run.status === 'running' || apiData.run.status === 'pending')) {
        return 3000
      }
      return false
    },
  })

  // Fetch field configs and lookups for TaskModal
  const { data: fieldConfigsData } = useFieldConfigs('tasks')
  const { data: lookupsData } = useLookups()

  const cancelMutation = useMutation({
    mutationFn: () => workflowRunsApi.cancel(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-run', runId] })
      setCancelConfirm(false)
    },
  })

  const apiResponse = data as { run?: WorkflowRun & { workflow?: WorkflowType }; tasks?: Task[]; totalTasks?: number } | undefined
  const run = apiResponse?.run
  const tasks = apiResponse?.tasks || []
  const workflow = run?.workflow

  // Build children index once for O(1) lookups instead of O(n²) filtering
  const childrenMap = useMemo(() => buildChildrenMap(tasks), [tasks])

  const taskIdsInRun = useMemo(() => new Set(tasks.map(t => t._id)), [tasks])
  const rootTasks = useMemo(() => tasks.filter(t => !t.parentId || !taskIdsInRun.has(t.parentId)), [tasks, taskIdsInRun])

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
        <Button variant="ghost" onClick={() => router.push('/workflow-runs')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/workflow-runs')}>
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
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">Run ID: {run._id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {isActive && (
            <Button variant="destructive" size="sm" onClick={() => setCancelConfirm(true)}>
              <Ban className="h-4 w-4 mr-2" />
              Cancel Run
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
          <p className="text-sm text-muted-foreground">Tasks</p>
          <p className="font-medium">
            <span className="text-green-600">{tasks.filter(t => t.status === 'completed').length}</span>
            <span className="text-muted-foreground"> / {tasks.length}</span>
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Steps</p>
          <p className="font-medium">
            <span className="text-green-600">{run.completedStepIds.length}</span>
            <span className="text-muted-foreground"> / {workflow?.steps?.length || 0}</span>
          </p>
        </div>
      </div>

      {run.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Workflow Failed</p>
              <p className="text-sm text-destructive/80 mt-1">{run.error}</p>
              {run.failedStepId && (
                <p className="text-sm text-muted-foreground mt-1">Failed at step: {run.failedStepId}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-3">Step Progress</h2>
        {(() => {
          // Build step-to-tasks map for deriving status from actual tasks
          const stepToTasks = new Map<string, Task[]>()
          tasks.forEach(task => {
            const stepId = (task as any).workflowStepId
            if (stepId) {
              const existing = stepToTasks.get(stepId) || []
              existing.push(task)
              stepToTasks.set(stepId, existing)
            }
          })

          const steps = workflow?.steps || []

          // Calculate derived statuses for each step
          const stepStatuses = steps.map(step => {
            const stepTasks = stepToTasks.get(step.id) || []
            const hasTasks = stepTasks.length > 0

            // Derive status from tasks if available, otherwise use run's tracking
            const tasksDerivedCompleted = hasTasks && stepTasks.every(t => t.status === 'completed')
            const tasksDerivedInProgress = hasTasks && stepTasks.some(t => t.status === 'in_progress' || t.status === 'waiting')
            const tasksDerivedFailed = hasTasks && stepTasks.some(t => t.status === 'failed')

            const isCompleted = tasksDerivedCompleted || (!hasTasks && run.completedStepIds.includes(step.id))
            const isCurrent = !isCompleted && (tasksDerivedInProgress || (!hasTasks && run.currentStepIds.includes(step.id)))
            const isFailed = tasksDerivedFailed || run.failedStepId === step.id
            const isPending = !isCompleted && !isCurrent && !isFailed

            return { step, isCompleted, isCurrent, isFailed, isPending }
          })

          const completedCount = stepStatuses.filter(s => s.isCompleted).length
          const inProgressCount = stepStatuses.filter(s => s.isCurrent).length
          const failedCount = stepStatuses.filter(s => s.isFailed).length
          const pendingCount = stepStatuses.filter(s => s.isPending).length

          return (
            <>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm">{completedCount} steps completed</span>
                </div>
                {inProgressCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">{inProgressCount} steps in progress</span>
                  </div>
                )}
                {failedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">{failedCount} steps failed</span>
                  </div>
                )}
                {pendingCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-muted-foreground">{pendingCount} steps pending</span>
                  </div>
                )}
              </div>

              {steps.length > 0 && (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {stepStatuses.map(({ step, isCompleted, isCurrent, isFailed, isPending }) => (
                      <Badge
                        key={step.id}
                        variant="outline"
                        className={cn(
                          'text-xs',
                          isCompleted && 'bg-green-50 text-green-700 border-green-300 dark:bg-green-950/50 dark:text-green-400 dark:border-green-700',
                          isCurrent && 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-700',
                          isFailed && 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950/50 dark:text-red-400 dark:border-red-700',
                          isPending && 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800/50 dark:text-gray-500 dark:border-gray-700'
                        )}
                        title={isPending ? 'Not started yet' : undefined}
                      >
                        {isPending && <Clock className="h-3 w-3 mr-1 inline" />}
                        {step.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-4">Tasks by Stage</h2>
        {(() => {
          // Build a map from step ID to tasks (check ALL tasks, not just root tasks)
          const stepToTasks = new Map<string, Task[]>()
          const workflowRootTasks: Task[] = [] // Tasks that represent the whole workflow
          const orphanTasks: Task[] = [] // Tasks without step mapping

          // First pass: categorize all tasks
          tasks.forEach(task => {
            const stepId = (task as any).workflowStepId
            if (stepId) {
              const existing = stepToTasks.get(stepId) || []
              existing.push(task)
              stepToTasks.set(stepId, existing)
            } else if (!task.parentId) {
              // Root task without a step ID - likely the workflow container task
              workflowRootTasks.push(task)
            }
            // Non-root tasks without stepId are children and will be shown via their parent
          })

          const steps = workflow?.steps || []

          if (steps.length === 0 && tasks.length === 0) {
            return <p className="text-sm text-muted-foreground">No tasks created yet.</p>
          }

          // Helper to get children that don't have their own stepId (those with stepId are shown in their step section)
          const getChildrenWithoutStep = (parentId: string) => {
            return tasks.filter(t => t.parentId === parentId && !(t as any).workflowStepId)
          }

          return (
            <div className="space-y-3">
              {/* Show all workflow steps */}
              {steps.map((step, index) => {
                const stepTasks = stepToTasks.get(step.id) || []
                const hasTasks = stepTasks.length > 0

                // Derive step status from tasks if available, otherwise use run's tracking
                const tasksDerivedCompleted = hasTasks && stepTasks.every(t => t.status === 'completed')
                const tasksDerivedInProgress = hasTasks && stepTasks.some(t => t.status === 'in_progress' || t.status === 'waiting')
                const tasksDerivedFailed = hasTasks && stepTasks.some(t => t.status === 'failed')

                const isCompleted = tasksDerivedCompleted || run.completedStepIds.includes(step.id)
                const isCurrent = !isCompleted && (tasksDerivedInProgress || run.currentStepIds.includes(step.id))
                const isFailed = tasksDerivedFailed || run.failedStepId === step.id
                const isPending = !isCompleted && !isCurrent && !isFailed

                const stepType = getStepType(step)
                const typeConfig = TASK_TYPE_CONFIG[stepType] || TASK_TYPE_CONFIG.agent
                const TypeIcon = typeConfig.icon

                return (
                  <div key={step.id} className="space-y-1">
                    {/* Step header - always shown */}
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-xs',
                        isCompleted && 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
                        isCurrent && 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400',
                        isFailed && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
                        isPending && 'bg-muted'
                      )}>
                        {index + 1}
                      </span>
                      {step.name}
                      <Badge variant="outline" className="text-xs">
                        {typeConfig.label}
                      </Badge>
                      {isCompleted && <CheckCircle className="h-3 w-3 text-green-500" />}
                      {isCurrent && <Play className="h-3 w-3 text-blue-500" />}
                      {isFailed && <XCircle className="h-3 w-3 text-red-500" />}
                    </div>

                    {/* Show actual tasks if they exist */}
                    {hasTasks ? (
                      <div className="space-y-1 ml-7">
                        {stepTasks.map(task => (
                          <TaskNode
                            key={task._id}
                            task={task}
                            depth={0}
                            childrenMap={childrenMap}
                            onTaskClick={setSelectedTask}
                            stepType={stepType}
                          />
                        ))}
                      </div>
                    ) : (
                      /* Show prospective task placeholder in gray */
                      <div
                        className={cn(
                          'flex items-center gap-2 p-2 rounded-lg border ml-7 transition-colors',
                          'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 border-dashed'
                        )}
                      >
                        <CircleDashed className="h-4 w-4 text-gray-400" />
                        <TypeIcon className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-400 italic">
                          {isPending ? 'Waiting to start...' : isCurrent ? 'Starting...' : 'Task will be created'}
                        </span>
                        <Badge variant="outline" className="text-xs text-gray-400 border-gray-300">
                          {typeConfig.label}
                        </Badge>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Show workflow root tasks (container tasks) if they exist and have details worth showing */}
              {workflowRootTasks.length > 0 && (
                <div className="space-y-1 pt-3 border-t">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Workflow Task</div>
                  {workflowRootTasks.map(task => (
                    <TaskNode
                      key={task._id}
                      task={task}
                      depth={0}
                      childrenMap={childrenMap}
                      onTaskClick={setSelectedTask}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {(run.inputPayload || run.outputPayload) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {run.inputPayload && Object.keys(run.inputPayload).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Input Payload</h2>
              <div className="bg-muted rounded p-3 overflow-auto max-h-64">
                <JsonViewer data={run.inputPayload} defaultExpanded={true} maxInitialDepth={2} />
              </div>
            </div>
          )}
          {run.outputPayload && Object.keys(run.outputPayload).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Output Payload</h2>
              <div className="bg-muted rounded p-3 overflow-auto max-h-64">
                <JsonViewer data={run.outputPayload} defaultExpanded={true} maxInitialDepth={2} />
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Task Detail Modal */}
      <TaskModal
        task={selectedTask}
        isOpen={!!selectedTask}
        fieldConfigs={fieldConfigsData?.data || []}
        lookups={lookupsData?.data || {}}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  )
}

// List view component
function WorkflowRunsList() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [workflowFilter, setWorkflowFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState<WorkflowRun | null>(null)
  const [startDialog, setStartDialog] = useState<{ open: boolean; workflow: WorkflowType | null }>({
    open: false,
    workflow: null,
  })
  const [startPayload, setStartPayload] = useState('')
  const [page, setPage] = useState(1)

  // Real-time updates - invalidate workflow runs when tasks change
  const handleEvent = useCallback((event: EventData) => {
    if ('task' in event && event.task?.workflowId) {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
    }
  }, [queryClient])

  useEventStream({ onEvent: handleEvent })

  const { data: workflowsData } = useQuery({
    queryKey: ['workflows', 'all'],
    queryFn: () => workflowsApi.list({ includeInactive: true }),
  })

  const { data: runsData, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-runs', statusFilter, workflowFilter, dateFrom, dateTo, page],
    queryFn: () => workflowRunsApi.list({
      status: statusFilter !== 'all' ? statusFilter as WorkflowRunStatus : undefined,
      workflowId: workflowFilter !== 'all' ? workflowFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      limit: 20,
    }),
    // Reduced polling - SSE handles most updates, polling is fallback for non-task events
    refetchInterval: 15000,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => workflowRunsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
      setCancelConfirm(null)
    },
  })

  const startMutation = useMutation({
    mutationFn: (data: { workflowId: string; inputPayload?: Record<string, unknown> }) =>
      workflowRunsApi.start(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
      setStartDialog({ open: false, workflow: null })
      setStartPayload('')
    },
  })

  const workflows = workflowsData?.data || []
  const allRuns = runsData?.data || []
  const pagination = runsData?.pagination

  // Build workflow name lookup for efficient searching
  const workflowNameLookup = useMemo(() => {
    const lookup: Record<string, string> = {}
    workflows.forEach(w => {
      lookup[w._id] = w.name.toLowerCase()
    })
    return lookup
  }, [workflows])

  // Apply client-side search filter
  const runs = useMemo(() => {
    if (!searchQuery.trim()) return allRuns
    const query = searchQuery.toLowerCase()
    return allRuns.filter(run => {
      const workflowName = workflowNameLookup[run.workflowId] || ''
      return workflowName.includes(query) || run._id.toLowerCase().includes(query)
    })
  }, [allRuns, searchQuery, workflowNameLookup])

  // Count active filters for badge
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (statusFilter !== 'all') count++
    if (workflowFilter !== 'all') count++
    if (dateFrom) count++
    if (dateTo) count++
    if (searchQuery.trim()) count++
    return count
  }, [statusFilter, workflowFilter, dateFrom, dateTo, searchQuery])

  const clearAllFilters = () => {
    setStatusFilter('all')
    setWorkflowFilter('all')
    setSearchQuery('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const handleStartWorkflow = () => {
    if (!startDialog.workflow) return

    let payload: Record<string, unknown> | undefined
    if (startPayload.trim()) {
      try {
        payload = JSON.parse(startPayload)
      } catch {
        alert('Invalid JSON payload')
        return
      }
    }

    startMutation.mutate({
      workflowId: startDialog.workflow._id,
      inputPayload: payload,
    })
  }

  const getWorkflowName = (workflowId: string): string => {
    const workflow = workflows.find(w => w._id === workflowId)
    return workflow?.name || 'Unknown Workflow'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflow Runs</h1>
          <p className="text-muted-foreground">Monitor and manage workflow executions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Select
            value={startDialog.workflow?._id || ''}
            onValueChange={(id) => {
              const workflow = workflows.find(w => w._id === id)
              if (workflow) {
                setStartDialog({ open: true, workflow })
              }
            }}
          >
            <SelectTrigger className="w-[200px]">
              <Play className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Start Workflow..." />
            </SelectTrigger>
            <SelectContent>
              {workflows.filter(w => w.isActive).map((workflow) => (
                <SelectItem key={workflow._id} value={workflow._id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search and filter bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by workflow name or run ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {FILTERABLE_STATUSES.map((status) => {
                const config = STATUS_CONFIG[status]
                return (
                  <SelectItem key={status} value={status}>
                    <div className="flex items-center gap-2">
                      <config.icon className={cn('h-4 w-4', config.color)} />
                      {config.label}
                    </div>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          {/* Workflow filter */}
          <Select value={workflowFilter} onValueChange={(v) => { setWorkflowFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Workflow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflows</SelectItem>
              {workflows.map((workflow) => (
                <SelectItem key={workflow._id} value={workflow._id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* More filters toggle */}
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Date Range
            {(dateFrom || dateTo) && (
              <Badge variant="secondary" className="ml-2 h-5 w-5 p-0 flex items-center justify-center">
                1
              </Badge>
            )}
          </Button>

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear ({activeFilterCount})
            </Button>
          )}
        </div>

        {/* Expanded date filters */}
        {showFilters && (
          <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Label htmlFor="dateFrom" className="text-sm text-muted-foreground whitespace-nowrap">
                From:
              </Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-[160px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="dateTo" className="text-sm text-muted-foreground whitespace-nowrap">
                To:
              </Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-[160px]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
              >
                Clear dates
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load workflow runs</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Workflow className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No workflow runs yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a workflow to see execution history here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => {
            const statusConfig = STATUS_CONFIG[run.status]
            const StatusIcon = statusConfig.icon
            const isActive = run.status === 'running' || run.status === 'pending'

            return (
              <div
                key={run._id}
                className={cn(
                  'rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50',
                  isActive && 'border-blue-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn('p-2 rounded-lg', statusConfig.bgColor)}>
                      <StatusIcon className={cn('h-5 w-5', statusConfig.color)} />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/workflow-runs?id=${run._id}`}
                          className="font-medium hover:underline"
                        >
                          {getWorkflowName(run.workflowId)}
                        </Link>
                        <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                          {statusConfig.label}
                        </Badge>
                        {isActive && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        <span>ID: {run._id.slice(-8)}</span>
                        <span>Started: {formatDate(run.startedAt || run.createdAt)}</span>
                        {run.completedAt && (
                          <span>Completed: {formatDate(run.completedAt)}</span>
                        )}
                        <span>Duration: {formatDuration(run.startedAt || run.createdAt, run.completedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {run.error && (
                      <div className="flex items-center gap-1 text-destructive text-sm">
                        <AlertCircle className="h-4 w-4" />
                        <span className="max-w-[200px] truncate">{run.error}</span>
                      </div>
                    )}

                    {isActive && (
                      <Button variant="outline" size="sm" onClick={() => setCancelConfirm(run)}>
                        <Ban className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}

                    <Link href={`/workflow-runs?id=${run._id}`}>
                      <Button variant="ghost" size="sm">
                        View Details
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {(run.completedStepIds.length > 0 || run.currentStepIds.length > 0) && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">Steps:</span>
                      <span className="text-green-600">{run.completedStepIds.length} completed</span>
                      {run.currentStepIds.length > 0 && (
                        <span className="text-blue-600">{run.currentStepIds.length} in progress</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
          >
            Next
          </Button>
        </div>
      )}

      <AlertDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
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
              onClick={() => cancelConfirm && cancelMutation.mutate(cancelConfirm._id)}
            >
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={startDialog.open} onOpenChange={(open) => {
        if (!open) {
          setStartDialog({ open: false, workflow: null })
          setStartPayload('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Workflow: {startDialog.workflow?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Input Payload (JSON)</label>
              <Textarea
                value={startPayload}
                onChange={(e) => setStartPayload(e.target.value)}
                placeholder='{"key": "value"}'
                className="mt-1 font-mono text-sm"
                rows={6}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Provide initial data for the workflow.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartDialog({ open: false, workflow: null })}>
              Cancel
            </Button>
            <Button onClick={handleStartWorkflow} disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Starting...' : 'Start Workflow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Main component that switches between views based on URL params
function WorkflowRunsContent() {
  const searchParams = useSearchParams()
  const runId = searchParams.get('id')

  if (runId) {
    return <WorkflowRunDetail runId={runId} />
  }

  return <WorkflowRunsList />
}

// Export wrapped in Suspense for useSearchParams
export default function WorkflowRunsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <WorkflowRunsContent />
    </Suspense>
  )
}
