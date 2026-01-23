'use client'

import { useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  SkipForward,
  Clock,
  ChevronDown,
  ChevronRight,
  History,
  Globe,
  GitBranch,
  FileText,
  Workflow,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonViewer } from '@/components/ui/json-viewer'
import { cn } from '@/lib/utils'
import { TaskResult, TaskResultEntry, TaskResultStatus, TaskType } from '@/lib/api'

interface TaskResultDisplayProps {
  taskResult: TaskResult | undefined
  taskType?: TaskType
  className?: string
}

const STATUS_CONFIG: Record<TaskResultStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: 'text-green-600', label: 'Success' },
  partial: { icon: AlertCircle, color: 'text-amber-600', label: 'Partial' },
  failed: { icon: XCircle, color: 'text-red-600', label: 'Failed' },
  skipped: { icon: SkipForward, color: 'text-muted-foreground', label: 'Skipped' },
  running: { icon: Clock, color: 'text-blue-600', label: 'Running' },
}

function ResultStatusBadge({ status }: { status: TaskResultStatus }) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn('gap-1', config.color)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}

function ResultEntry({
  entry,
  taskType,
  isHistorical = false,
}: {
  entry: TaskResultEntry
  taskType?: TaskType
  isHistorical?: boolean
}) {
  const [showOutput, setShowOutput] = useState(!isHistorical)
  const [showDetails, setShowDetails] = useState(false)

  // Safely parse dates - handle invalid/missing dates
  const parsedExecutedAt = entry.executedAt ? new Date(entry.executedAt) : null
  const executedAt = parsedExecutedAt && !isNaN(parsedExecutedAt.getTime()) ? parsedExecutedAt : new Date()
  const completedAt = entry.completedAt ? new Date(entry.completedAt) : undefined

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden",
      isHistorical && "opacity-75"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
        <div className="flex items-center gap-2">
          <ResultStatusBadge status={entry.status} />
          {entry.durationMs && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {entry.durationMs}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span title={format(executedAt, 'PPpp')}>
            {formatDistanceToNow(executedAt, { addSuffix: true })}
          </span>
          {isHistorical && (
            <Badge variant="secondary" className="text-[10px] h-4">
              Historical
            </Badge>
          )}
        </div>
      </div>

      {/* Summary */}
      {entry.summary && (
        <div className="px-3 py-2 border-b text-sm">
          {entry.summary}
        </div>
      )}

      {/* Error */}
      {entry.error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 border-b text-sm text-red-700 dark:text-red-300">
          <strong>Error:</strong> {entry.error}
        </div>
      )}

      {/* Type-specific results */}
      <div className="p-3 space-y-3">
        {/* Webhook Response */}
        {entry.webhookResponse && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Globe className="h-3.5 w-3.5" />
              HTTP Response
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Status</div>
                <div className={cn(
                  "font-mono font-medium",
                  entry.webhookResponse.httpStatus >= 200 && entry.webhookResponse.httpStatus < 300
                    ? "text-green-600"
                    : entry.webhookResponse.httpStatus >= 400
                      ? "text-red-600"
                      : "text-amber-600"
                )}>
                  {entry.webhookResponse.httpStatus}
                </div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Duration</div>
                <div className="font-mono">{entry.webhookResponse.durationMs}ms</div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Body Size</div>
                <div className="font-mono">
                  {typeof entry.webhookResponse.body === 'string'
                    ? entry.webhookResponse.body.length
                    : JSON.stringify(entry.webhookResponse.body).length} chars
                </div>
              </div>
            </div>
            {entry.webhookResponse.body !== undefined && entry.webhookResponse.body !== null && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Response Body
                </button>
                {showDetails && (
                  <div className="mt-2 max-h-48 overflow-auto">
                    <JsonViewer
                      data={entry.webhookResponse.body as Record<string, unknown>}
                      defaultExpanded={false}
                      maxInitialDepth={2}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Join Aggregation Results */}
        {entry.aggregationStats && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Aggregation Results
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Expected</div>
                <div className="font-mono font-medium">{entry.aggregationStats.expectedCount}</div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Success</div>
                <div className="font-mono font-medium text-green-600">
                  {entry.aggregationStats.successCount}
                </div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Failed</div>
                <div className={cn(
                  "font-mono font-medium",
                  entry.aggregationStats.failedCount > 0 ? "text-red-600" : ""
                )}>
                  {entry.aggregationStats.failedCount}
                </div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Success %</div>
                <div className={cn(
                  "font-mono font-medium",
                  entry.aggregationStats.successPercent >= 100
                    ? "text-green-600"
                    : entry.aggregationStats.successPercent >= 80
                      ? "text-amber-600"
                      : "text-red-600"
                )}>
                  {entry.aggregationStats.successPercent.toFixed(1)}%
                </div>
              </div>
            </div>
            {entry.aggregatedResults && entry.aggregatedResults.length > 0 && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Aggregated Data ({entry.aggregatedResults.length} items)
                </button>
                {showDetails && (
                  <div className="mt-2 max-h-48 overflow-auto">
                    <JsonViewer
                      data={entry.aggregatedResults}
                      defaultExpanded={false}
                      maxInitialDepth={1}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Decision Result */}
        {entry.selectedPath && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              Decision Result
            </div>
            <div className="p-2 bg-muted/50 rounded text-sm">
              <div className="font-medium">Selected Path: <code className="text-primary">{entry.selectedPath}</code></div>
              {entry.evaluatedCondition && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Condition: <code>{entry.evaluatedCondition}</code>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Document Results */}
        {entry.documentResults && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Document Results ({entry.documentResults.count} found)
            </div>
            <div className="space-y-1">
              {entry.documentResults.documents.map((doc) => (
                <div key={doc.id} className="p-2 bg-muted/50 rounded text-xs flex justify-between">
                  <span className="font-medium truncate">{doc.title}</span>
                  {doc.score !== undefined && (
                    <span className="text-muted-foreground">Score: {doc.score.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spawned Workflow */}
        {entry.spawnedWorkflow && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              Spawned Workflow
            </div>
            <div className="p-2 bg-muted/50 rounded text-sm">
              <div>
                Run ID: <code className="text-xs">{entry.spawnedWorkflow.runId}</code>
              </div>
              <div className="mt-1">
                Status: <Badge variant="outline" className="ml-1">{entry.spawnedWorkflow.status}</Badge>
              </div>
            </div>
          </div>
        )}

        {/* Generic Output */}
        {entry.output !== undefined && entry.output !== null && !entry.webhookResponse && !entry.aggregatedResults && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowOutput(!showOutput)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showOutput ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Output Data
            </button>
            {showOutput && (
              <div className="max-h-64 overflow-auto">
                <JsonViewer
                  data={entry.output as Record<string, unknown>}
                  defaultExpanded={true}
                  maxInitialDepth={3}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskResultDisplay({ taskResult, taskType, className }: TaskResultDisplayProps) {
  const [showHistory, setShowHistory] = useState(false)

  if (!taskResult?.current) {
    return (
      <div className={cn("p-4 text-center text-sm text-muted-foreground", className)}>
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>No results yet</p>
        <p className="text-xs mt-1">Results will appear here after execution</p>
      </div>
    )
  }

  const hasHistory = taskResult.history && taskResult.history.length > 0

  return (
    <div className={cn("space-y-3", className)}>
      {/* Current Result */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Current Result</h4>
          {hasHistory && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? 'Hide' : 'Show'} History ({taskResult.history!.length})
            </Button>
          )}
        </div>
        <ResultEntry entry={taskResult.current} taskType={taskType} />
      </div>

      {/* History */}
      {showHistory && hasHistory && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Previous Results</h4>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {taskResult.history!.map((entry, idx) => (
              <ResultEntry
                key={entry.id || idx}
                entry={entry}
                taskType={taskType}
                isHistorical
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
