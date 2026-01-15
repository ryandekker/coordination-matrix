'use client'

import { useMemo, useState } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Task, WebhookAttempt } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

interface OutputTabProps {
  task: Task
}

export function OutputTab({ task }: OutputTabProps) {
  const [copied, setCopied] = useState(false)
  const taskType = task.taskType || 'agent'
  const metadata = task.metadata as Record<string, unknown> | undefined
  const webhookConfig = task.webhookConfig
  const attempts = webhookConfig?.attempts || []
  const lastAttempt = attempts[attempts.length - 1]

  // Extract output based on task type
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

  // Format output for display
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formattedOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // For external/webhook tasks, show attempts history
  if (taskType === 'external' && attempts.length > 0) {
    return (
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
    )
  }

  // For tasks without output
  if (!hasOutput) {
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

  // Check if output is JSON-like (object or array)
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

  // Parse string JSON for JsonViewer
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

  // Show output
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Task Output</h3>
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
