'use client'

import { useState, useMemo, useCallback } from 'react'
import { AlertTriangle, Play, RotateCcw, Loader2, ChevronDown, ChevronRight, MessageSquare, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Task } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

interface EscalationPanelProps {
  task: Task
  onRetry: (humanInstruction?: string) => Promise<void>
  onRollback?: () => Promise<void>
  isRetrying?: boolean
}

export function EscalationPanel({
  task,
  onRetry,
  onRollback,
  isRetrying = false,
}: EscalationPanelProps) {
  const [humanInstruction, setHumanInstruction] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)

  const metadata = task.metadata as Record<string, unknown> | undefined
  const output = metadata?.output as Record<string, unknown> | undefined

  const escalationReason = useMemo(() => {
    if (metadata?.escalationReason && typeof metadata.escalationReason === 'string') {
      return metadata.escalationReason
    }
    if (output?.reason && typeof output.reason === 'string') {
      return output.reason
    }
    return 'Task escalated — requires human intervention'
  }, [metadata, output])

  const agentSummary = useMemo(() => {
    if (output?.summary && typeof output.summary === 'string') {
      return output.summary
    }
    if (metadata?.summary && typeof metadata.summary === 'string') {
      return metadata.summary
    }
    return null
  }, [metadata, output])

  const agentStatus = output?.status as string | undefined
  const confidence = output?.confidence as number | undefined
  const agentResult = output?.result as Record<string, unknown> | undefined
  const conversationSessionId = output?.conversationSessionId as string | undefined
  const escalatedAt = metadata?.escalatedAt as string | undefined

  const handleRetry = useCallback(async () => {
    const instruction = humanInstruction.trim() || undefined
    await onRetry(instruction)
  }, [humanInstruction, onRetry])

  const handleRollback = useCallback(async () => {
    if (!onRollback) return
    setIsRollingBack(true)
    try {
      await onRollback()
    } finally {
      setIsRollingBack(false)
    }
  }, [onRollback])

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Escalated — Needs Human Intervention
          </p>
          {escalatedAt && (
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(escalatedAt), { addSuffix: true })}
            </p>
          )}
        </div>
        {conversationSessionId && (
          <Link
            href={`/conversations/${conversationSessionId}`}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline flex-shrink-0"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            View Conversation
          </Link>
        )}
      </div>

      {/* Escalation Reason */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Why it was escalated
        </h4>
        <div className="p-3 bg-muted/50 rounded-lg border text-sm">
          {escalationReason}
        </div>
      </div>

      {/* Agent Summary */}
      {agentSummary && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Agent Summary
            </h4>
            {agentStatus && (
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                agentStatus === 'SUCCESS' && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                agentStatus === 'PARTIAL' && 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
                agentStatus === 'BLOCKED' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                agentStatus === 'FAILED' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
              )}>
                {agentStatus}
              </span>
            )}
            {confidence !== undefined && (
              <span className="text-[10px] text-muted-foreground">
                {Math.round(confidence * 100)}% confidence
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{agentSummary}</p>
        </div>
      )}

      {/* Collapsible Agent Output Details */}
      {agentResult && Object.keys(agentResult).length > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Agent Output Details
          </button>
          {showDetails && (
            <div className="p-3 bg-muted/50 rounded-lg border">
              <JsonViewer
                data={agentResult}
                defaultExpanded={true}
                maxInitialDepth={3}
              />
            </div>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="border-t" />

      {/* Human Instruction */}
      <div className="space-y-1.5">
        <label htmlFor="escalation-instruction" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Additional Instructions (optional)
        </label>
        <Textarea
          id="escalation-instruction"
          value={humanInstruction}
          onChange={(e) => setHumanInstruction(e.target.value)}
          placeholder="Provide extra context or instructions for the retry..."
          rows={3}
          className="resize-y"
        />
        <p className="text-xs text-muted-foreground">
          These instructions will be available to the agent when the task is retried.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={handleRetry}
          disabled={isRetrying || isRollingBack}
          className="gap-2 flex-1"
        >
          {isRetrying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Retrying...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Retry This Step
            </>
          )}
        </Button>
        {onRollback && (
          <Button
            variant="outline"
            onClick={handleRollback}
            disabled={isRetrying || isRollingBack}
            className="gap-2"
          >
            {isRollingBack ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rolling back...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                Rerun from Previous Step
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
