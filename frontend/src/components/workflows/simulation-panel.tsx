'use client'

import { useState, useCallback } from 'react'
import { authFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Loader2,
  Beaker,
  ShieldCheck,
  Clock,
  Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkflowStep } from './editor/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// ============================================================================
// Types
// ============================================================================

interface WorkflowDiagnostic {
  level: 'error' | 'warning' | 'info'
  code: string
  stepId?: string
  stepName?: string
  field?: string
  message: string
  suggestion?: string
}

interface ValidationResult {
  valid: boolean
  diagnostics: WorkflowDiagnostic[]
  summary: { errors: number; warnings: number; info: number }
  stepGraph: {
    reachableSteps: string[]
    unreachableSteps: string[]
    terminalSteps: string[]
  }
}

interface SimulationStepTrace {
  stepId: string
  stepName: string
  stepType: string
  status: 'success' | 'failed' | 'skipped' | 'mocked'
  input: Record<string, unknown>
  output: Record<string, unknown>
  durationMs?: number
  error?: string
  suggestion?: string
  children?: SimulationStepTrace[]
  branchTaken?: string
  branchLabel?: string
  logs?: string[]
}

interface SimulationResult {
  success: boolean
  workflowName?: string
  totalSteps: number
  executedSteps: number
  failedSteps: number
  mockedSteps: number
  durationMs: number
  trace: SimulationStepTrace[]
  finalOutput: Record<string, unknown> | null
  validation: ValidationResult
  dataFlowSummary: {
    stepId: string
    stepName: string
    stepType: string
    inputKeys: string[]
    outputKeys: string[]
  }[]
}

// ============================================================================
// Props
// ============================================================================

interface SimulationPanelProps {
  steps: WorkflowStep[]
  workflowId?: string
  workflowName?: string
  samplePayload?: string
  inputSchema?: Record<string, unknown>
  rootTaskTitleTemplate?: string
}

// ============================================================================
// Component
// ============================================================================

export function SimulationPanel({ steps, workflowId, workflowName, samplePayload, inputSchema, rootTaskTitleTemplate }: SimulationPanelProps) {
  const [inputPayload, setInputPayload] = useState(() => {
    if (samplePayload) {
      try {
        return JSON.stringify(JSON.parse(samplePayload), null, 2)
      } catch {
        return samplePayload
      }
    }
    return '{}'
  })
  const [mockOutputsStr, setMockOutputsStr] = useState('{}')
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [activeView, setActiveView] = useState<'input' | 'validation' | 'simulation'>('input')
  const [expandedTraceSteps, setExpandedTraceSteps] = useState<Set<string>>(new Set())

  // Validate workflow
  const handleValidate = useCallback(async () => {
    setIsValidating(true)
    try {
      const response = await authFetch(`${API_BASE}/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps, checkReferences: true, inputSchema, rootTaskTitleTemplate }),
      })
      if (!response.ok) throw new Error('Validation request failed')
      const data = await response.json()
      setValidationResult(data.data)
      setActiveView('validation')
    } catch (err) {
      console.error('Validation error:', err)
    } finally {
      setIsValidating(false)
    }
  }, [steps])

  // Simulate workflow
  const handleSimulate = useCallback(async () => {
    let parsedInput: Record<string, unknown>
    try {
      parsedInput = JSON.parse(inputPayload)
    } catch {
      alert('Invalid JSON in Input Payload')
      return
    }

    let parsedMocks: Record<string, Record<string, unknown>> = {}
    try {
      parsedMocks = JSON.parse(mockOutputsStr)
    } catch {
      alert('Invalid JSON in Mock Outputs')
      return
    }

    setIsSimulating(true)
    try {
      const endpoint = workflowId
        ? `${API_BASE}/workflows/${workflowId}/simulate`
        : `${API_BASE}/workflows/simulate`

      const body: Record<string, unknown> = {
        inputPayload: parsedInput,
        mockOutputs: Object.keys(parsedMocks).length > 0 ? parsedMocks : undefined,
        maxForeachItems: 3,
      }
      if (!workflowId) {
        body.steps = steps
        body.name = workflowName || 'Unsaved Workflow'
      }

      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(errData?.error || 'Simulation request failed')
      }
      const data = await response.json()
      setSimulationResult(data.data)
      setValidationResult(data.data.validation)
      setActiveView('simulation')
      // Auto-expand failed steps
      const failedIds = new Set<string>()
      for (const t of data.data.trace) {
        if (t.status === 'failed') failedIds.add(t.stepId)
      }
      setExpandedTraceSteps(failedIds)
    } catch (err) {
      console.error('Simulation error:', err)
      alert(`Simulation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsSimulating(false)
    }
  }, [inputPayload, mockOutputsStr, workflowId, steps, workflowName])

  const toggleTraceStep = (stepId: string) => {
    setExpandedTraceSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  // Find agent/manual steps that need mocks
  const mockableSteps = steps.filter(s =>
    s.stepType && ['agent', 'manual', 'external', 'webhook', 'findDocument', 'flow'].includes(s.stepType)
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleValidate}
          disabled={isValidating || steps.length === 0}
          className="gap-1.5"
        >
          {isValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Validate
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSimulate}
          disabled={isSimulating || steps.length === 0}
          className="gap-1.5"
        >
          {isSimulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Test Run
        </Button>
        <div className="flex-1" />
        {/* View toggles */}
        <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
          <button
            type="button"
            className={cn('px-2 py-1 text-xs rounded', activeView === 'input' && 'bg-background shadow-sm')}
            onClick={() => setActiveView('input')}
          >
            Input
          </button>
          <button
            type="button"
            className={cn('px-2 py-1 text-xs rounded', activeView === 'validation' && 'bg-background shadow-sm')}
            onClick={() => setActiveView('validation')}
            disabled={!validationResult}
          >
            Validation
            {validationResult && (
              <span className={cn(
                'ml-1 text-[10px]',
                validationResult.summary.errors > 0 ? 'text-red-500' : 'text-green-500'
              )}>
                {validationResult.summary.errors > 0 ? `${validationResult.summary.errors}E` : 'OK'}
              </span>
            )}
          </button>
          <button
            type="button"
            className={cn('px-2 py-1 text-xs rounded', activeView === 'simulation' && 'bg-background shadow-sm')}
            onClick={() => setActiveView('simulation')}
            disabled={!simulationResult}
          >
            Results
            {simulationResult && (
              <span className={cn(
                'ml-1 text-[10px]',
                simulationResult.success ? 'text-green-500' : 'text-red-500'
              )}>
                {simulationResult.success ? 'PASS' : 'FAIL'}
              </span>
            )}
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Input View */}
        {activeView === 'input' && (
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Input Payload (trigger data)
              </label>
              <textarea
                className="w-full h-40 text-xs font-mono rounded-md border bg-muted/50 p-2 resize-y"
                value={inputPayload}
                onChange={e => setInputPayload(e.target.value)}
                placeholder='{"key": "value"}'
                spellCheck={false}
              />
            </div>

            {mockableSteps.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <ChevronRight className="h-3 w-3" />
                  Mock Outputs ({mockableSteps.length} steps)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1.5">
                    <p className="text-[11px] text-muted-foreground mb-1.5">
                      Provide mock outputs for agent/manual/external steps. Keys are step IDs.
                    </p>
                    <div className="text-[11px] text-muted-foreground mb-1 space-y-0.5">
                      {mockableSteps.map(s => (
                        <div key={s.id} className="font-mono">
                          &quot;{s.id}&quot;: {'{'}...{'}'} {/* {s.name} ({s.stepType}) */}
                        </div>
                      ))}
                    </div>
                    <textarea
                      className="w-full h-28 text-xs font-mono rounded-md border bg-muted/50 p-2 resize-y mt-1"
                      value={mockOutputsStr}
                      onChange={e => setMockOutputsStr(e.target.value)}
                      placeholder='{"step_id": {"result": "mock value"}}'
                      spellCheck={false}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {/* Validation View */}
        {activeView === 'validation' && validationResult && (
          <div className="p-3 space-y-3">
            {/* Summary */}
            <div className="flex items-center gap-2">
              {validationResult.valid ? (
                <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Valid
                </Badge>
              ) : (
                <Badge variant="destructive" className="bg-red-500/10 text-red-600 border-red-500/20">
                  <XCircle className="h-3 w-3 mr-1" /> Invalid
                </Badge>
              )}
              {validationResult.summary.errors > 0 && (
                <span className="text-xs text-red-500">{validationResult.summary.errors} error(s)</span>
              )}
              {validationResult.summary.warnings > 0 && (
                <span className="text-xs text-yellow-500">{validationResult.summary.warnings} warning(s)</span>
              )}
            </div>

            {/* Diagnostics */}
            {validationResult.diagnostics.length > 0 ? (
              <div className="space-y-1.5">
                {validationResult.diagnostics.map((d, i) => (
                  <DiagnosticItem key={i} diagnostic={d} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No issues found.</p>
            )}

            {/* Graph info */}
            {validationResult.stepGraph.unreachableSteps.length > 0 && (
              <div className="text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 rounded p-2">
                <strong>Unreachable steps:</strong>{' '}
                {validationResult.stepGraph.unreachableSteps.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Simulation Results View */}
        {activeView === 'simulation' && simulationResult && (
          <div className="p-3 space-y-3">
            {/* Summary header */}
            <div className="flex items-center gap-2 flex-wrap">
              {simulationResult.success ? (
                <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Passed
                </Badge>
              ) : (
                <Badge variant="destructive" className="bg-red-500/10 text-red-600 border-red-500/20">
                  <XCircle className="h-3 w-3 mr-1" /> Failed
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {simulationResult.executedSteps}/{simulationResult.totalSteps} steps
              </span>
              {simulationResult.mockedSteps > 0 && (
                <span className="text-xs text-blue-500">{simulationResult.mockedSteps} mocked</span>
              )}
              {simulationResult.failedSteps > 0 && (
                <span className="text-xs text-red-500">{simulationResult.failedSteps} failed</span>
              )}
              <span className="text-xs text-muted-foreground">
                <Clock className="h-3 w-3 inline mr-0.5" />{simulationResult.durationMs}ms
              </span>
            </div>

            {/* Step trace */}
            <div className="space-y-1">
              {simulationResult.trace.map((trace, i) => (
                <TraceStepItem
                  key={`${trace.stepId}-${i}`}
                  trace={trace}
                  isExpanded={expandedTraceSteps.has(trace.stepId)}
                  onToggle={() => toggleTraceStep(trace.stepId)}
                />
              ))}
            </div>

            {/* Final output */}
            {simulationResult.finalOutput && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <Eye className="h-3 w-3" />
                  Final Output
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="text-[11px] font-mono bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-40">
                    {JSON.stringify(simulationResult.finalOutput, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function DiagnosticItem({ diagnostic }: { diagnostic: WorkflowDiagnostic }) {
  const icon = diagnostic.level === 'error' ? XCircle
    : diagnostic.level === 'warning' ? AlertTriangle
    : CheckCircle2
  const colorClass = diagnostic.level === 'error' ? 'text-red-500'
    : diagnostic.level === 'warning' ? 'text-yellow-500'
    : 'text-blue-500'
  const bgClass = diagnostic.level === 'error' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30'
    : diagnostic.level === 'warning' ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900/30'
    : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30'
  const Icon = icon

  return (
    <div className={cn('rounded border p-2 text-xs', bgClass)}>
      <div className="flex items-start gap-1.5">
        <Icon className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', colorClass)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-muted-foreground">{diagnostic.code}</span>
            {diagnostic.stepName && (
              <span className="text-muted-foreground">in &quot;{diagnostic.stepName}&quot;</span>
            )}
          </div>
          <p className="mt-0.5">{diagnostic.message}</p>
          {diagnostic.suggestion && (
            <p className="mt-1 text-muted-foreground italic">{diagnostic.suggestion}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function TraceStepItem({
  trace,
  isExpanded,
  onToggle,
}: {
  trace: SimulationStepTrace
  isExpanded: boolean
  onToggle: () => void
}) {
  const statusIcon = trace.status === 'success' ? CheckCircle2
    : trace.status === 'failed' ? XCircle
    : trace.status === 'mocked' ? Beaker
    : Clock
  const statusColor = trace.status === 'success' ? 'text-green-500'
    : trace.status === 'failed' ? 'text-red-500'
    : trace.status === 'mocked' ? 'text-blue-400'
    : 'text-gray-400'
  const StatusIcon = statusIcon

  return (
    <div className="border rounded text-xs">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
        <StatusIcon className={cn('h-3.5 w-3.5 flex-shrink-0', statusColor)} />
        <span className="font-medium truncate">{trace.stepName}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
          {trace.stepType}
        </Badge>
        {trace.branchTaken && (
          <span className="text-muted-foreground">→ {trace.branchLabel || trace.branchTaken}</span>
        )}
        {trace.durationMs !== undefined && (
          <span className="text-muted-foreground ml-auto">{trace.durationMs}ms</span>
        )}
      </button>

      {isExpanded && (
        <div className="px-2 pb-2 space-y-2 border-t">
          {trace.error && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded p-2 mt-1.5">
              <p className="text-red-600 font-medium">{trace.error}</p>
              {trace.suggestion && (
                <p className="text-red-500/70 mt-1 italic">{trace.suggestion}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mt-1.5">
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Input</span>
              <pre className="font-mono text-[10px] bg-muted/50 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(trace.input, null, 2)}
              </pre>
            </div>
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Output</span>
              <pre className="font-mono text-[10px] bg-muted/50 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(trace.output, null, 2)}
              </pre>
            </div>
          </div>

          {trace.logs && trace.logs.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Console</span>
              <pre className="font-mono text-[10px] bg-gray-900 text-gray-100 rounded p-1.5 mt-0.5 max-h-20 overflow-y-auto">
                {trace.logs.join('\n')}
              </pre>
            </div>
          )}

          {trace.children && trace.children.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                ForEach Children ({trace.children.length})
              </span>
              <div className="mt-1 space-y-1 ml-3 border-l-2 pl-2">
                {trace.children.map((child, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {child.status === 'success' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : child.status === 'mocked' ? (
                      <Beaker className="h-3 w-3 text-blue-400" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span className="truncate">{child.stepName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
