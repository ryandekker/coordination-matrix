'use client'

import { useMemo, useState, useCallback } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Task, WebhookAttempt, ManualReviewDecision, AgentQuestionAnswer, AgentQuestionsOutput, tasksApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { TaskResultDisplay } from '../task-result-display'
import { DecisionOptionsPanel } from '../decision-options-panel'
import { ManualReviewPanel } from './manual-review-panel'
import { AgentQuestionsPanel } from './agent-questions-panel'
import { DocumentOperationsPanel, type DocumentOperationResult } from './document-operations-panel'
import { RoutingOperationsPanel, type RoutingOperationResult } from './routing-operations-panel'
import { ExecutionSummarySection } from './execution-summary-section'
import { useUpdateTask } from '@/hooks/use-tasks'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

interface OutputTabProps {
  task: Task
  onRollback?: () => Promise<void>
}

export function OutputTab({ task, onRollback }: OutputTabProps) {
  const [copied, setCopied] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const updateTask = useUpdateTask()
  const queryClient = useQueryClient()
  const taskType = task.taskType || 'agent'
  const metadata = task.metadata as Record<string, unknown> | undefined
  const webhookConfig = task.webhookConfig
  const attempts = webhookConfig?.attempts || []
  const lastAttempt = attempts[attempts.length - 1]

  // Check if this is a manual task requiring review
  const isManualTask = taskType === 'manual'
  const needsReview = isManualTask && ['pending', 'in_progress'].includes(task.status)
  const hasBeenReviewed = isManualTask && task.reviewDecision

  // Check if task has agent questions pending
  const agentQuestionsData = useMemo((): AgentQuestionsOutput | null => {
    const output = metadata?.output as Record<string, unknown> | undefined
    if (!output) return null

    // Check if action is ASK and there are questions
    if (output.action === 'ASK' && output.questions) {
      const questionsData = output.questions as AgentQuestionsOutput
      if (questionsData.questions && Array.isArray(questionsData.questions) && questionsData.questions.length > 0) {
        return questionsData
      }
    }
    return null
  }, [metadata])

  const hasAgentQuestions = agentQuestionsData !== null

  // Extract document operation results from output
  const documentOpsResults = useMemo(() => {
    const outputData = metadata?.output as Record<string, unknown> | undefined
    if (!outputData?.documentOperations) return null
    const ops = outputData.documentOperations as DocumentOperationResult[]
    return ops.length > 0 ? ops : null
  }, [metadata])

  // Extract routing operation results from output
  const routingOpsResults = useMemo(() => {
    const outputData = metadata?.output as Record<string, unknown> | undefined
    if (!outputData?.routingOperations) return null
    const ops = outputData.routingOperations as RoutingOperationResult[]
    return ops.length > 0 ? ops : null
  }, [metadata])

  // Extract output based on task type - MUST be before any early returns (React hooks rule)
  const output = useMemo(() => {
    // Check for daemon-style output first
    if (metadata?.output !== undefined) {
      return metadata.output
    }
    // Check for response from webhook
    if (lastAttempt?.responseBody !== undefined) {
      return lastAttempt.responseBody
    }
    // Check for any result field
    if (metadata?.result !== undefined) {
      return metadata.result
    }
    return null
  }, [metadata, lastAttempt])

  const hasOutput = output !== null && output !== undefined

  // Format output for display - MUST be before any early returns (React hooks rule)
  const formattedOutput = useMemo(() => {
    if (!hasOutput) return ''
    if (typeof output === 'string') {
      // Try to parse as JSON for pretty printing
      try {
        const parsed = JSON.parse(output)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return output
      }
    }
    return JSON.stringify(output, null, 2)
  }, [output, hasOutput])

  // Check if output is JSON-like (object or array) - MUST be before any early returns (React hooks rule)
  const isJsonOutput = useMemo(() => {
    if (output === null || output === undefined) return false
    if (typeof output === 'object') return true
    if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output)
        return typeof parsed === 'object'
      } catch {
        return false
      }
    }
    return false
  }, [output])

  // Parse string JSON for JsonViewer - MUST be before any early returns (React hooks rule)
  const jsonData = useMemo(() => {
    if (typeof output === 'object') return output
    if (typeof output === 'string') {
      try {
        return JSON.parse(output)
      } catch {
        return null
      }
    }
    return null
  }, [output])

  // Handle agent questions submission
  const handleSubmitAnswers = useCallback(async (answers: AgentQuestionAnswer[]) => {
    setIsSubmitting(true)
    try {
      await tasksApi.answerQuestions(task._id, answers)
      toast.success('Answers submitted successfully. Task will resume processing.')
      // Invalidate task queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
    } catch (error) {
      toast.error('Failed to submit answers')
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }, [task._id, queryClient])

  // Handle manual review submission
  const handleReview = useCallback(async (decision: ManualReviewDecision, comment: string) => {
    setIsSubmitting(true)
    try {
      // Update the task with review decision and complete it
      await updateTask.mutateAsync({
        id: task._id,
        data: {
          reviewDecision: decision,
          reviewComment: comment || undefined,
          reviewedAt: new Date().toISOString(),
          // Mark as completed for 'approved' or 'approved_with_notes'
          // 'request_changes' will be handled by rollback
          status: decision === 'request_changes' ? 'on_hold' : 'completed',
          // Add review notes to metadata for the next step
          metadata: {
            ...task.metadata,
            reviewNotes: comment || undefined,
            reviewDecision: decision,
          },
        } as Partial<Task>,
      })
      toast.success(
        decision === 'approved' ? 'Task approved' :
        decision === 'approved_with_notes' ? 'Task approved with notes' :
        'Changes requested'
      )
    } catch (error) {
      toast.error('Failed to submit review')
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }, [task, updateTask])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(formattedOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [formattedOutput])

  // Get conversation session ID from output metadata
  const conversationSessionId = useMemo(() => {
    const outputData = metadata?.output as Record<string, unknown> | undefined
    return outputData?.conversationSessionId as string | undefined
  }, [metadata])

  // Execution summary banner — shown at the top of the Output tab when present
  const executionSummaryBanner = task.executionSummary ? (
    <div className="p-4 pb-0">
      <div className="rounded-lg border bg-muted/30 p-3">
        <ExecutionSummarySection summary={task.executionSummary} defaultOpen={true} />
      </div>
    </div>
  ) : null

  // For decision tasks, show the DecisionOptionsPanel
  if (taskType === 'decision') {
    return (
      <>
        {executionSummaryBanner}
        <div className="p-4 space-y-4">
          <DecisionOptionsPanel task={task} />
          {/* Also show task result if available */}
          {task.taskResult?.current && (
            <div className="pt-4 border-t">
              <TaskResultDisplay
                taskResult={task.taskResult}
                taskType={task.taskType}
              />
            </div>
          )}
        </div>
      </>
    )
  }

  // For manual tasks pending review, show the review panel
  if (needsReview || hasBeenReviewed) {
    return (
      <>
        {executionSummaryBanner}
        <ManualReviewPanel
          task={task}
          previousStepOutput={metadata as Record<string, unknown> | null}
          onReview={handleReview}
          onRollback={onRollback}
          isSubmitting={isSubmitting}
        />
      </>
    )
  }

  // For tasks with agent questions (ASK action), show the questions panel
  if (hasAgentQuestions && agentQuestionsData) {
    return (
      <>
        {executionSummaryBanner}
        <AgentQuestionsPanel
          task={task}
          questionsData={agentQuestionsData}
          onSubmitAnswers={handleSubmitAnswers}
          isSubmitting={isSubmitting}
        />
      </>
    )
  }

  // If task has structured taskResult, show TaskResultDisplay
  if (task.taskResult?.current) {
    return (
      <>
        {executionSummaryBanner}
        <div className="p-4">
          <TaskResultDisplay
            taskResult={task.taskResult}
            taskType={task.taskType}
          />
        </div>
      </>
    )
  }

  // For external/webhook tasks, show attempts history
  if (taskType === 'external' && attempts.length > 0) {
    return (
      <>
        {executionSummaryBanner}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Webhook Attempts</h3>
            <span className="text-xs text-muted-foreground">
              {attempts.length} attempt{attempts.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-3">
            {[...attempts].reverse().map((attempt, reverseIndex) => {
              const index = attempts.length - 1 - reverseIndex
              return (
                <WebhookAttemptCard
                  key={index}
                  attempt={attempt}
                  taskId={task._id}
                  attemptIndex={index}
                />
              )
            })}
          </div>
        </div>
      </>
    )
  }

  // For tasks without output
  if (!hasOutput) {
    if (executionSummaryBanner) {
      // If there's an execution summary but no other output, show just the summary
      return executionSummaryBanner
    }
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full min-h-[200px] text-center">
        <p className="text-sm text-muted-foreground">
          {task.status === 'pending' && 'Output will appear here after the task completes'}
          {task.status === 'waiting' && 'Task is still processing...'}
          {task.status === 'completed' && 'No output data available'}
          {task.status === 'failed' && 'Task failed without producing output'}
          {task.status === 'cancelled' && 'Task was cancelled'}
          {task.status === 'on_hold' && 'Task is on hold'}
        </p>
      </div>
    )
  }

  // Show output
  return (
    <>
      {executionSummaryBanner}
      {documentOpsResults && (
        <div className="p-4 pb-0">
          <DocumentOperationsPanel operations={documentOpsResults} />
        </div>
      )}
      {routingOpsResults && (
        <div className="p-4 pb-0">
          <RoutingOperationsPanel operations={routingOpsResults} />
        </div>
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Task Output</h3>
          <div className="flex items-center gap-2">
            {conversationSessionId && (
              <Link
                href={`/conversations/${conversationSessionId}`}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                View Conversation
              </Link>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2 gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-xs">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span className="text-xs">Copy</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {isJsonOutput && jsonData !== null ? (
          <div className="p-3 bg-muted/50 rounded-lg border">
            <JsonViewer
              data={jsonData}
              defaultExpanded={true}
              maxInitialDepth={3}
            />
          </div>
        ) : (
          <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-[500px] whitespace-pre-wrap break-all">
            {formattedOutput}
          </pre>
        )}
      </div>
    </>
  )
}

interface WebhookAttemptCardProps {
  attempt: WebhookAttempt
  taskId: string
  attemptIndex: number
}

function WebhookAttemptCard({ attempt, taskId, attemptIndex }: WebhookAttemptCardProps) {
  const [expanded, setExpanded] = useState(attemptIndex === 0) // Expand latest by default

  const statusColors = {
    success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
    pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  }

  const statusBadgeColors = {
    success: 'bg-green-500/20 text-green-700 dark:text-green-400',
    failed: 'bg-red-500/20 text-red-700 dark:text-red-400',
    pending: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  }

  const requestPageUrl = `/requests?type=webhook_task&id=${taskId}-${attemptIndex}`

  return (
    <div className={cn('rounded-lg border', statusColors[attempt.status])}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="text-xs text-muted-foreground">#{attempt.attemptNumber}</span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', statusBadgeColors[attempt.status])}>
            {attempt.status}
          </span>
          {attempt.httpStatus && (
            <span className="text-xs">HTTP {attempt.httpStatus}</span>
          )}
          {attempt.durationMs && (
            <span className="text-xs text-muted-foreground">{attempt.durationMs}ms</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(attempt.startedAt), { addSuffix: true })}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-inherit">
          {/* Timestamp */}
          <div className="pt-2 text-xs text-muted-foreground">
            {format(new Date(attempt.startedAt), 'MMM d, yyyy HH:mm:ss')}
          </div>

          {/* Request Details */}
          {attempt.requestUrl && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase">Request</div>
              <div className="p-2 bg-background/50 rounded text-xs space-y-1">
                <div className="font-mono break-all">
                  <span className="font-semibold">{attempt.requestMethod}</span>{' '}
                  <span className="text-muted-foreground">{attempt.requestUrl}</span>
                </div>
                {attempt.requestHeaders && Object.keys(attempt.requestHeaders).length > 0 && (
                  <div className="text-muted-foreground">
                    <span className="font-medium">Headers:</span>{' '}
                    <span className="font-mono text-[10px]">
                      {JSON.stringify(attempt.requestHeaders)}
                    </span>
                  </div>
                )}
                {attempt.requestBody && attempt.requestMethod !== 'GET' && (
                  <div>
                    <span className="font-medium text-muted-foreground">Body:</span>
                    <pre className="mt-1 p-2 bg-muted rounded font-mono text-[10px] break-all whitespace-pre-wrap max-h-24 overflow-y-auto">
                      {attempt.requestBody}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Message */}
          {attempt.errorMessage && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-red-600 dark:text-red-400 uppercase">Error</div>
              <div className="p-2 bg-red-50 dark:bg-red-950/50 rounded text-xs text-red-700 dark:text-red-300 break-all">
                {attempt.errorMessage}
              </div>
            </div>
          )}

          {/* Response Body */}
          {attempt.responseBody !== undefined && attempt.responseBody !== null && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase">Response</div>
              <pre className="p-2 bg-background/50 rounded font-mono text-[10px] break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                {typeof attempt.responseBody === 'string'
                  ? attempt.responseBody
                  : JSON.stringify(attempt.responseBody as object, null, 2)}
              </pre>
            </div>
          )}

          {/* View Full Request Link */}
          <div className="pt-1">
            <Link
              href={requestPageUrl}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View full request
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
