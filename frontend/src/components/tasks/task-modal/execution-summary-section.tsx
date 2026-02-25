'use client'

import { useState, useMemo } from 'react'
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Workflow,
} from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ExecutionSummary, ExecutionSummaryStep } from '@/lib/api'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.floor((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function StepOutcomeIcon({ outcome }: { outcome: ExecutionSummaryStep['outcome'] }) {
  switch (outcome) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
    case 'skipped':
      return <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
  }
}

interface ExecutionSummarySectionProps {
  summary: ExecutionSummary
  defaultOpen?: boolean
}

export function ExecutionSummarySection({ summary, defaultOpen = false }: ExecutionSummarySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const hasSteps = summary.steps && summary.steps.length > 0
  const hasErrorChain = summary.errorChain && summary.errorChain.length > 0
  const hasChildFlows = summary.childFlowSummaries && summary.childFlowSummaries.length > 0
  const hasStats = summary.stats != null

  // Build a one-line overview
  const overviewText = useMemo(() => {
    const parts: string[] = []

    if (hasSteps) {
      const succeeded = summary.steps!.filter(s => s.outcome === 'success').length
      const failed = summary.steps!.filter(s => s.outcome === 'failed').length
      const total = summary.steps!.length
      parts.push(`${succeeded}/${total} steps succeeded`)
      if (failed > 0) parts.push(`${failed} failed`)
    }

    if (hasStats) {
      parts.push(`${summary.stats!.succeeded}/${summary.stats!.total} items`)
      if (summary.stats!.failed > 0) parts.push(`${summary.stats!.failed} failed`)
    }

    if (summary.durationMs) {
      parts.push(formatDuration(summary.durationMs))
    }

    return parts.join(' \u00b7 ')
  }, [summary, hasSteps, hasStats])

  const hasDetails = hasSteps || hasErrorChain || hasChildFlows

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {hasDetails ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <Workflow className="h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span className="font-medium">Execution Summary</span>
          {overviewText && (
            <span className="text-muted-foreground truncate">{overviewText}</span>
          )}
        </button>
      </CollapsibleTrigger>

      {hasDetails && (
        <CollapsibleContent>
          <div className="mt-2 space-y-2 pl-5">
            {/* Trigger source */}
            {summary.trigger && (
              <p className="text-xs text-muted-foreground">
                Source: {summary.trigger.source}
                {summary.trigger.inputSummary && (
                  <span className="ml-1 text-muted-foreground/70">({summary.trigger.inputSummary})</span>
                )}
              </p>
            )}

            {/* Step trace */}
            {hasSteps && (
              <div className="space-y-1">
                {summary.steps!.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <StepOutcomeIcon outcome={step.outcome} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{step.stepName}</span>
                      <span className="text-muted-foreground ml-1">({step.stepType})</span>
                      {step.durationMs != null && (
                        <span className="text-muted-foreground ml-1">{formatDuration(step.durationMs)}</span>
                      )}
                      {step.summary && (
                        <p className="text-muted-foreground line-clamp-1 mt-0.5">{step.summary}</p>
                      )}
                      {step.error && (
                        <p className="text-red-600 dark:text-red-400 line-clamp-2 mt-0.5">{step.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Foreach stats */}
            {hasStats && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="text-green-600 dark:text-green-400 font-medium">
                  {summary.stats!.succeeded} succeeded
                </span>
                {summary.stats!.failed > 0 && (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    {summary.stats!.failed} failed
                  </span>
                )}
                {summary.stats!.skipped > 0 && (
                  <span className="text-gray-500 font-medium">
                    {summary.stats!.skipped} skipped
                  </span>
                )}
                <span className="text-muted-foreground">of {summary.stats!.total} total</span>
              </div>
            )}

            {/* Child flow summaries */}
            {hasChildFlows && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3" />
                  Subflows
                </p>
                {summary.childFlowSummaries!.map((child, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs pl-1">
                    <StepOutcomeIcon outcome={child.outcome === 'success' ? 'success' : 'failed'} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{child.workflowName || child.title}</span>
                      {child.summary && (
                        <span className="text-muted-foreground ml-1">{child.summary}</span>
                      )}
                      {child.error && (
                        <p className="text-red-600 dark:text-red-400 line-clamp-1 mt-0.5">{child.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error chain */}
            {hasErrorChain && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">Error trace:</p>
                {summary.errorChain!.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs pl-1">
                    <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{entry.stepName}</span>
                      <p className="text-red-600 dark:text-red-400 line-clamp-2">{entry.error}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
