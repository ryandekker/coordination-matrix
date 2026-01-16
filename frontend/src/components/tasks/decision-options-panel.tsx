'use client'

import { useState, useMemo } from 'react'
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonViewer } from '@/components/ui/json-viewer'
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
import { Task, StepConnection } from '@/lib/api'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

interface DecisionOptionsPanelProps {
  task: Task
  className?: string
}

interface ConditionEvaluation {
  connection: StepConnection
  result: boolean | null
  actualValue: unknown
  expectedValues: string[]
  fieldPath: string
  formatError?: string // Explains why condition format is invalid
}

/**
 * Evaluates a condition string against a payload
 * If decisionField is provided, condition is just the value(s) to match
 * Otherwise, condition format is: "field.path:value1,value2,value3"
 */
function evaluateCondition(
  condition: string | null | undefined,
  payload: Record<string, unknown> | undefined,
  decisionField?: string
): { result: boolean | null; actualValue: unknown; expectedValues: string[]; fieldPath: string; formatError?: string } {
  if (!condition) {
    return { result: null, actualValue: undefined, expectedValues: [], fieldPath: '' }
  }

  let field: string
  let values: string

  // If decisionField is set, condition is just the value(s) to match
  // Otherwise, condition must be in "field:value" format
  if (decisionField) {
    field = decisionField
    values = condition
  } else {
    const colonIndex = condition.indexOf(':')
    if (colonIndex === -1) {
      // Condition doesn't have the required format "field:value"
      return {
        result: null,
        actualValue: undefined,
        expectedValues: [],
        fieldPath: '',
        formatError: `Invalid condition format "${condition}". Expected format: "field:value1,value2" (e.g., "route:Review" or "status:approved,pending")`
      }
    }

    field = condition.substring(0, colonIndex)
    values = condition.substring(colonIndex + 1)
  }

  if (!field) {
    return {
      result: null,
      actualValue: undefined,
      expectedValues: [],
      fieldPath: '',
      formatError: `Missing field name in condition "${condition}". Expected format: "field:value"`
    }
  }

  if (!values) {
    return {
      result: null,
      actualValue: undefined,
      expectedValues: [],
      fieldPath: field,
      formatError: `Missing expected values in condition "${condition}". Expected format: "field:value1,value2"`
    }
  }

  const expectedValues = values.split(',').map(v => v.trim())

  if (!payload) {
    return { result: false, actualValue: undefined, expectedValues, fieldPath: field }
  }

  // Get value by path (e.g., "output.category" -> payload.output.category)
  const actualValue = getValueByPath(payload, field)
  // Case-insensitive comparison
  const result = expectedValues.map(v => v.toLowerCase()).includes(String(actualValue).toLowerCase())

  return { result, actualValue, expectedValues, fieldPath: field }
}

function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export function DecisionOptionsPanel({ task, className }: DecisionOptionsPanelProps) {
  const queryClient = useQueryClient()
  const [showInputPayload, setShowInputPayload] = useState(false)
  const [forceDialogOpen, setForceDialogOpen] = useState(false)
  const [selectedOption, setSelectedOption] = useState<StepConnection | null>(null)
  const [isForcing, setIsForcing] = useState(false)

  const stepConfig = task.stepConfig
  const connections = stepConfig?.connections || []
  const defaultConnection = stepConfig?.defaultConnection
  // Read decisionField from stepConfig or metadata (for older tasks)
  const taskMetadata = task.metadata as Record<string, unknown> | undefined

  // Determine decisionField - check stepConfig first, then metadata
  // Also infer it if conditions don't have colons but the decision succeeded
  const explicitDecisionField = (stepConfig as Record<string, unknown> | undefined)?.decisionField as string | undefined
    || taskMetadata?.decisionField as string | undefined

  // If no explicit decisionField but task completed and conditions don't have colons,
  // it means decisionField was used (we just don't have it stored for older tasks)
  const hasConditionsWithoutColons = connections.some(c => c.condition && !c.condition.includes(':'))
  const taskSucceeded = task.status === 'completed' && taskMetadata?.selectedPath
  const inferredDecisionField = !explicitDecisionField && hasConditionsWithoutColons && taskSucceeded

  const decisionField = explicitDecisionField

  // Get the input payload that was evaluated
  const inputPayload = useMemo(() => {
    return taskMetadata?.inputPayload as Record<string, unknown> | undefined
  }, [taskMetadata])

  // Evaluate all conditions
  const evaluations = useMemo((): ConditionEvaluation[] => {
    return connections.map(conn => {
      const evaluation = evaluateCondition(conn.condition, inputPayload, decisionField)
      return {
        connection: conn,
        ...evaluation,
      }
    })
  }, [connections, inputPayload, decisionField])

  // Find which option was selected (if any)
  const metadata = task.metadata as Record<string, unknown> | undefined
  const selectedPath = metadata?.selectedPath as string | undefined
  const matchedValue = task.decisionResult || metadata?.matchedValue as string | undefined
  const evaluatedCondition = metadata?.condition as string | undefined
  const errorMessage = metadata?.error as string | undefined

  // Handle force decision
  const handleForceDecision = async () => {
    if (!selectedOption) return

    setIsForcing(true)
    try {
      const { tasksApi } = await import('@/lib/api')
      await tasksApi.forceDecision(task._id, selectedOption.targetStepId)

      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })

      toast.success(`Decision forced to: ${selectedOption.label || selectedOption.targetStepId}`)
      setForceDialogOpen(false)
      setSelectedOption(null)
    } catch (error) {
      toast.error('Failed to force decision')
    } finally {
      setIsForcing(false)
    }
  }

  if (!stepConfig || stepConfig.stepType !== 'decision') {
    return null
  }

  const hasNoConnections = connections.length === 0
  const isDecisionFailed = task.status === 'failed' && errorMessage
  const isDecisionCompleted = task.status === 'completed' && selectedPath
  const canForceDecision = ['pending', 'in_progress', 'failed'].includes(task.status)

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">Decision Options</h3>
        {isDecisionCompleted && (
          <Badge variant="outline" className="text-green-600 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Resolved
          </Badge>
        )}
        {isDecisionFailed && (
          <Badge variant="outline" className="text-red-600 gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Decision Failed</p>
              <p className="text-xs mt-1">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* No connections warning */}
      {hasNoConnections && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No Decision Options Configured</p>
              <p className="text-xs mt-1">This decision step has no branch routes configured.</p>
            </div>
          </div>
        </div>
      )}

      {/* Input Payload */}
      {inputPayload && (
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowInputPayload(!showInputPayload)}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted text-sm font-medium"
          >
            <div className="flex items-center gap-2">
              {showInputPayload ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>Input Payload</span>
            </div>
          </button>
          {showInputPayload && (
            <div className="p-3 bg-background border-t max-h-48 overflow-auto">
              <JsonViewer
                data={inputPayload}
                defaultExpanded={true}
                maxInitialDepth={2}
              />
            </div>
          )}
        </div>
      )}

      {/* Decision Options */}
      {connections.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Available Branches ({connections.length})
            </div>
          </div>

          {/* Show which field is being compared - use decisionField or get from first evaluation with a fieldPath */}
          {(() => {
            const fieldToShow = decisionField || evaluations.find(e => e.fieldPath)?.fieldPath
            if (fieldToShow && inputPayload) {
              return (
                <div className="text-xs text-muted-foreground">
                  Comparing <code className="bg-muted px-1 py-0.5 rounded font-mono">{fieldToShow}</code> = <code className="bg-muted px-1 py-0.5 rounded font-mono text-amber-600 dark:text-amber-400">{JSON.stringify(getValueByPath(inputPayload, fieldToShow))}</code>
                </div>
              )
            }
            return null
          })()}

          <div className="space-y-2">
            {evaluations.map((evalResult, idx) => {
              const conn = evalResult.connection
              const isSelected = selectedPath === conn.targetStepId
              const isDefaultRoute = defaultConnection === conn.targetStepId
              const hasCondition = !!conn.condition
              const conditionMatched = evalResult.result === true
              const conditionNotMatched = evalResult.result === false
              const conditionNotEvaluated = evalResult.result === null

              return (
                <div
                  key={idx}
                  className={cn(
                    'border rounded-lg overflow-hidden transition-colors',
                    isSelected && 'border-green-500 bg-green-50 dark:bg-green-950/30',
                    conditionMatched && !isSelected && 'border-amber-300',
                  )}
                >
                  {/* Option Header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isSelected ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : conditionMatched ? (
                        <CheckCircle2 className="h-4 w-4 text-amber-500 flex-shrink-0" />
                      ) : conditionNotMatched ? (
                        <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <GitBranch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {conn.label || conn.targetStepId}
                        </span>
                        {isDefaultRoute && (
                          <Badge variant="secondary" className="text-[10px] h-4">Default</Badge>
                        )}
                        {isSelected && (
                          <Badge variant="default" className="text-[10px] h-4 bg-green-600">Selected</Badge>
                        )}
                        {conditionMatched && !isSelected && (
                          <Badge variant="outline" className="text-[10px] h-4 text-amber-600">Would Match</Badge>
                        )}
                      </div>
                    </div>

                    {/* Force button */}
                    {canForceDecision && !isSelected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => {
                          setSelectedOption(conn)
                          setForceDialogOpen(true)
                        }}
                      >
                        <Play className="h-3 w-3" />
                        Force
                      </Button>
                    )}
                  </div>

                  {/* Condition Details */}
                  {hasCondition && (
                    <div className="px-3 py-2 border-t bg-background text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{(decisionField || inferredDecisionField) ? 'Match Value:' : 'Condition:'}</span>
                        <code className={cn(
                          'px-1.5 py-0.5 rounded font-mono text-[10px]',
                          // Only show error styling if there's a format error AND no decisionField (explicit or inferred)
                          evalResult.formatError && !decisionField && !inferredDecisionField ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-muted'
                        )}>
                          {conn.condition}
                        </code>
                      </div>

                      {/* Show format error if condition is invalid (only when no decisionField - explicit or inferred) */}
                      {evalResult.formatError && !decisionField && !inferredDecisionField && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-[11px]">Invalid Condition Format</p>
                              <p className="text-[10px] mt-0.5">{evalResult.formatError}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Show evaluation details when we have valid evaluation data */}
                      {evalResult.fieldPath && inputPayload && (
                        <div className="mt-2 p-2 bg-muted/50 rounded space-y-1">
                          {/* Only show field path if not using decisionField (since it's shown at the top) */}
                          {!decisionField && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Field:</span>
                              <code className="font-mono text-[10px]">{evalResult.fieldPath}</code>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Actual Value:</span>
                            <code className={cn(
                              'font-mono text-[10px] px-1 py-0.5 rounded',
                              conditionMatched ? 'bg-green-100 dark:bg-green-900/40' : 'bg-muted'
                            )}>
                              {evalResult.actualValue === undefined ? 'undefined' : JSON.stringify(evalResult.actualValue)}
                            </code>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Expected:</span>
                            <div className="flex gap-1 flex-wrap">
                              {evalResult.expectedValues.map((v, i) => (
                                <code
                                  key={i}
                                  className={cn(
                                    'font-mono text-[10px] px-1 py-0.5 rounded',
                                    String(evalResult.actualValue).toLowerCase() === v.toLowerCase()
                                      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                                      : 'bg-muted'
                                  )}
                                >
                                  {v}
                                </code>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-muted-foreground">Result:</span>
                            {conditionMatched ? (
                              <span className="text-green-600 font-medium">Match</span>
                            ) : conditionNotMatched ? (
                              <span className="text-red-600 font-medium">No Match</span>
                            ) : (
                              <span className="text-muted-foreground">Not Evaluated</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No condition = unconditional route */}
                  {!hasCondition && (
                    <div className="px-3 py-2 border-t bg-background text-xs text-muted-foreground">
                      <span>No condition (unconditional route)</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Default Connection (if not in connections list) */}
      {defaultConnection && !connections.some(c => c.targetStepId === defaultConnection) && (
        <div className="mt-2 p-2 border rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span>Default fallback:</span>
            <code className="font-mono">{defaultConnection}</code>
          </div>
        </div>
      )}

      {/* Force Decision Dialog */}
      <AlertDialog open={forceDialogOpen} onOpenChange={setForceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Decision</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to force this decision to route to{' '}
              <strong>{selectedOption?.label || selectedOption?.targetStepId}</strong>?
              {'\n\n'}
              This will mark the decision task as completed and execute the selected branch,
              ignoring any condition evaluations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isForcing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceDecision}
              disabled={isForcing}
              className="gap-2"
            >
              {isForcing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Forcing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Force Decision
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
