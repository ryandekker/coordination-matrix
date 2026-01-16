'use client'

import { useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  AlertTriangle,
  RotateCcw,
  Play,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Task, LookupValue, WebhookAttempt } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getTaskTypeConfig } from '@/lib/task-type-config'

interface StatusPanelProps {
  task: Task
  statusOptions: LookupValue[]
  onRerun?: () => void
  onExecuteWebhook?: () => void
  onRetryWebhook?: () => void
  isRerunning?: boolean
  isExecuting?: boolean
  isRetrying?: boolean
}

export function StatusPanel({
  task,
  statusOptions,
  onRerun,
  onExecuteWebhook,
  onRetryWebhook,
  isRerunning,
  isExecuting,
  isRetrying,
}: StatusPanelProps) {
  const status = task.status
  const taskType = task.taskType || 'agent'
  const typeConfig = getTaskTypeConfig(taskType)
  const statusOption = statusOptions.find((s) => s.code === status)

  // Extract relevant data based on task type
  const metadata = task.metadata as Record<string, unknown> | undefined
  const batchCounters = task.batchCounters
  const joinConfig = task.joinConfig
  const webhookConfig = task.webhookConfig
  const attempts = webhookConfig?.attempts || []
  const lastAttempt = attempts[attempts.length - 1]

  // Determine output summary
  const outputSummary = useMemo(() => {
    if (metadata?.summary && typeof metadata.summary === 'string') {
      return metadata.summary
    }
    if (metadata?.output && typeof metadata.output === 'object') {
      const output = metadata.output as Record<string, unknown>
      if (output.summary && typeof output.summary === 'string') {
        return output.summary
      }
    }
    return null
  }, [metadata])

  // Determine error message
  const errorMessage = useMemo(() => {
    if (metadata?.error && typeof metadata.error === 'string') {
      return metadata.error
    }
    if (lastAttempt?.errorMessage) {
      return lastAttempt.errorMessage
    }
    return null
  }, [metadata, lastAttempt])

  // Waiting reason
  const waitingReason = metadata?.waitingReason as string | undefined

  // Can rerun?
  const canRerun = ['completed', 'failed', 'cancelled'].includes(status) || !!task.workflowRunId

  // ForEach progress
  const foreachProgress = useMemo(() => {
    if (taskType !== 'foreach' || !batchCounters) return null
    const expected = batchCounters.expectedCount || 0
    const completed = batchCounters.completedCount || 0
    const failed = batchCounters.failedCount || 0
    const remaining = Math.max(0, expected - completed - failed)
    const percent = expected > 0 ? ((completed + failed) / expected) * 100 : 0
    return { expected, completed, failed, remaining, percent }
  }, [taskType, batchCounters])

  // Join progress
  const joinProgress = useMemo(() => {
    if (taskType !== 'join') return null
    const successCount = (metadata?.successCount as number) || 0
    const expectedCount = (metadata?.expectedCount as number) || joinConfig?.expectedCount || 0
    const successPercent = (metadata?.successPercent as number) || 0
    const requiredPercent = joinConfig?.minSuccessPercent || 100
    return { successCount, expectedCount, successPercent, requiredPercent }
  }, [taskType, metadata, joinConfig])

  // Render based on status
  const renderContent = () => {
    switch (status) {
      case 'completed':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  Task completed successfully
                </p>
                {outputSummary && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {outputSummary}
                  </p>
                )}
              </div>
            </div>
            {canRerun && onRerun && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRerun}
                  disabled={isRerunning}
                  className="gap-2"
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isRerunning && 'animate-spin')} />
                  {isRerunning ? 'Rerunning...' : 'Rerun'}
                </Button>
              </div>
            )}
          </div>
        )

      case 'failed':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  {taskType === 'external' && lastAttempt
                    ? `Request failed after ${attempts.length} attempt${attempts.length > 1 ? 's' : ''}`
                    : 'Task failed'}
                </p>
                {errorMessage && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-300 line-clamp-3">
                    {errorMessage}
                  </p>
                )}
                {lastAttempt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last attempt: {formatDistanceToNow(new Date(lastAttempt.startedAt), { addSuffix: true })}
                    {lastAttempt.httpStatus && ` (HTTP ${lastAttempt.httpStatus})`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {taskType === 'external' && onRetryWebhook && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetryWebhook}
                  disabled={isRetrying}
                  className="gap-2"
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} />
                  {isRetrying ? 'Retrying...' : 'Retry'}
                </Button>
              )}
              {canRerun && onRerun && taskType !== 'external' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRerun}
                  disabled={isRerunning}
                  className="gap-2"
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isRerunning && 'animate-spin')} />
                  {isRerunning ? 'Rerunning...' : 'Rerun'}
                </Button>
              )}
            </div>
          </div>
        )

      case 'pending':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  Ready to process
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {taskType === 'agent' && 'Waiting for agent to pick up this task'}
                  {taskType === 'external' && webhookConfig?.url && 'Ready to execute webhook'}
                  {taskType === 'external' && !webhookConfig?.url && 'Configure webhook URL to execute'}
                  {taskType === 'manual' && 'Requires manual completion'}
                  {taskType === 'foreach' && 'Waiting for batch processing to start'}
                  {taskType === 'join' && 'Waiting for upstream tasks to complete'}
                </p>
              </div>
            </div>
            {taskType === 'external' && webhookConfig?.url && onExecuteWebhook && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={onExecuteWebhook}
                  disabled={isExecuting}
                  className="gap-2"
                >
                  <Play className={cn('h-3.5 w-3.5', isExecuting && 'hidden')} />
                  <Loader2 className={cn('h-3.5 w-3.5 animate-spin', !isExecuting && 'hidden')} />
                  {isExecuting ? 'Executing...' : 'Execute Now'}
                </Button>
              </div>
            )}
          </div>
        )

      case 'waiting':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Loader2 className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5 animate-spin" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
                  {taskType === 'foreach' ? 'Processing batch' : 'Waiting'}
                </p>
                {waitingReason && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {waitingReason}
                  </p>
                )}
              </div>
            </div>

            {/* ForEach progress */}
            {foreachProgress && (
              <div className="space-y-2">
                <Progress value={foreachProgress.percent} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    <span className="text-green-600 dark:text-green-400">{foreachProgress.completed} completed</span>
                    {foreachProgress.failed > 0 && (
                      <span className="text-red-600 dark:text-red-400 ml-2">{foreachProgress.failed} failed</span>
                    )}
                  </span>
                  <span>{foreachProgress.remaining} remaining</span>
                </div>
              </div>
            )}

            {/* Join progress */}
            {joinProgress && joinProgress.expectedCount > 0 && (
              <div className="space-y-2">
                <Progress
                  value={(joinProgress.successCount / joinProgress.expectedCount) * 100}
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {joinProgress.successCount}/{joinProgress.expectedCount} succeeded
                  </span>
                  <span className={cn(
                    joinProgress.successPercent >= joinProgress.requiredPercent
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-amber-600 dark:text-amber-400'
                  )}>
                    {joinProgress.successPercent.toFixed(0)}% / {joinProgress.requiredPercent}% required
                  </span>
                </div>
              </div>
            )}
          </div>
        )

      case 'on_hold':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Pause className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Task on hold
                </p>
                {waitingReason && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {waitingReason}
                  </p>
                )}
              </div>
            </div>
            {canRerun && onRerun && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRerun}
                  disabled={isRerunning}
                  className="gap-2"
                >
                  <Play className="h-3.5 w-3.5" />
                  Resume
                </Button>
              </div>
            )}
          </div>
        )

      case 'cancelled':
        return (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-400">
                  Task cancelled
                </p>
              </div>
            </div>
            {canRerun && onRerun && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRerun}
                  disabled={isRerunning}
                  className="gap-2"
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isRerunning && 'animate-spin')} />
                  {isRerunning ? 'Rerunning...' : 'Rerun'}
                </Button>
              </div>
            )}
          </div>
        )

      default:
        return (
          <div className="flex items-center gap-3">
            <div
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: statusOption?.color || '#888' }}
            />
            <span className="text-sm">
              {statusOption?.displayName || status}
            </span>
          </div>
        )
    }
  }

  // Panel background color based on status
  const panelBgClass = useMemo(() => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
      case 'failed':
        return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
      case 'waiting':
        return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
      case 'on_hold':
        return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
      case 'pending':
        return 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
      case 'cancelled':
        return 'bg-gray-50 dark:bg-gray-950/30 border-gray-200 dark:border-gray-800'
      default:
        return 'bg-muted/50 border-border'
    }
  }, [status])

  return (
    <div className={cn('rounded-lg border p-4', panelBgClass)}>
      {renderContent()}
    </div>
  )
}
