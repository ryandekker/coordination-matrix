'use client'

import { useState } from 'react'
import { Task, TaskStepConfig as TaskStepConfigType, StepOutput } from '@/lib/api'
import { StepConfigPanel } from '@/components/workflows/step-config-panel'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { getAuthHeader } from '@/lib/auth'
import {
  Settings2,
  Download,
  Upload,
  ChevronUp,
  ChevronDown,
  Play,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  GitBranch,
  Database,
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface StepConfigTabProps {
  task: Task
  onConfigChange: (config: TaskStepConfigType) => void
  onRerun?: () => void
}

// Workflow step types (matching step-config-panel.tsx)
type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument' | 'code'

// Convert TaskStepConfig to a WorkflowStep-like structure for StepConfigPanel
function taskConfigToWorkflowStep(config: TaskStepConfigType, stepId: string): Parameters<typeof StepConfigPanel>[0]['step'] {
  // Safely cast step type
  const stepType = config.stepType as WorkflowStepType | undefined

  return {
    id: stepId,
    name: config.stepName || 'Step',
    description: config.stepDescription,
    stepType: stepType,
    titleTemplate: config.titleTemplate,
    additionalInstructions: config.additionalInstructions,
    defaultAssigneeId: config.defaultAssigneeId,
    promptDocumentIds: config.promptDocumentIds,
    // External step config
    externalConfig: config.externalEndpoint ? {
      endpoint: config.externalEndpoint,
      method: config.externalMethod as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined,
      headers: config.externalHeaders,
      payloadTemplate: config.externalPayloadTemplate,
      waitForCallback: config.waitForCallback,
    } : undefined,
    // ForEach step config
    itemsPath: config.itemsPath,
    itemVariable: config.itemVariable,
    maxItems: config.maxItems,
    expectedCountPath: config.expectedCountPath,
    // Join step config
    inputPath: config.joinInputPath || config.inputPath,
    awaitStepId: config.awaitStepId,
    joinBoundary: config.joinBoundary,
    // Flow step config
    flowId: config.flowId,
    inputMapping: config.inputMapping,
    // FindDocument step config - cast to expected type
    findDocumentConfig: config.findDocumentConfig as Parameters<typeof StepConfigPanel>[0]['step']['findDocumentConfig'],
    // Input config
    inputConfig: config.inputConfig,
    inputSource: config.inputSource,
  }
}

// Component to display step output details
function StepOutputSection({ output }: { output: StepOutput }) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">Output Produced</span>
          {output.durationMs && (
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {output.durationMs}ms
            </Badge>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-3">
        {/* Summary */}
        {output.summary && (
          <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
            {output.summary}
          </div>
        )}

        {/* Selected Branch (for decision steps) */}
        {output.selectedBranch && (
          <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
            <GitBranch className="h-4 w-4 text-amber-500" />
            <span>Selected branch: <strong>{output.selectedBranch.targetStepId}</strong></span>
            {output.selectedBranch.condition && (
              <code className="text-xs text-muted-foreground">
                ({output.selectedBranch.condition})
              </code>
            )}
          </div>
        )}

        {/* Aggregated Results (for join steps) */}
        {output.aggregatedResults && output.aggregatedResults.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Aggregated Results ({output.aggregatedResults.length})</label>
            <div className="max-h-32 overflow-auto">
              <JsonViewer data={output.aggregatedResults} defaultExpanded={false} />
            </div>
          </div>
        )}

        {/* ForEach Meta */}
        {output.foreachMeta && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" />
            <span>
              {output.foreachMeta.totalItems} items from{' '}
              <code className="bg-muted px-1 rounded">{output.foreachMeta.itemsPath}</code>
            </span>
          </div>
        )}

        {/* Console Logs (for code steps) */}
        {output.logs && output.logs.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Console Output</label>
            <div className="bg-gray-900 text-gray-100 p-2 rounded font-mono text-xs max-h-24 overflow-auto">
              {output.logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* HTTP Response (for external steps) */}
        {output.httpResponse && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              HTTP Response ({output.httpResponse.status})
            </label>
            <div className="max-h-32 overflow-auto">
              <JsonViewer data={output.httpResponse.body} defaultExpanded={false} />
            </div>
          </div>
        )}

        {/* Nested Workflow (for flow steps) */}
        {output.nestedWorkflow && (
          <div className="flex items-center gap-2 text-sm bg-pink-50 dark:bg-pink-950/30 p-2 rounded">
            <span>Nested workflow: {output.nestedWorkflow.runId}</span>
            <Badge variant={output.nestedWorkflow.status === 'completed' ? 'default' : 'secondary'}>
              {output.nestedWorkflow.status}
            </Badge>
          </div>
        )}

        {/* Documents (for findDocument steps) */}
        {output.documents && output.documents.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Found Documents ({output.documents.length})</label>
            <div className="space-y-1">
              {output.documents.map((doc, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                  <span className="truncate flex-1">{doc.title}</span>
                  <Badge variant="outline" className="text-xs">{doc.type}</Badge>
                  {doc.score !== undefined && (
                    <span className="text-xs text-muted-foreground">{(doc.score * 100).toFixed(0)}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Data Output */}
        {output.data !== undefined && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Output Data</label>
            <div className="max-h-48 overflow-auto">
              <JsonViewer data={output.data} defaultExpanded={true} />
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function StepConfigTab({ task, onConfigChange, onRerun }: StepConfigTabProps) {
  const [inputOpen, setInputOpen] = useState(true)
  const [configOpen, setConfigOpen] = useState(true)
  const [isRerunning, setIsRerunning] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const handleRerun = async () => {
    if (!task._id) return

    setIsRerunning(true)
    setRerunError(null)

    try {
      const response = await fetch(`${API_BASE}/tasks/${task._id}/rerun`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to rerun task')
      }

      // Call the parent callback if provided
      onRerun?.()
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : 'Failed to rerun task')
    } finally {
      setIsRerunning(false)
    }
  }

  // Check if task can be rerun (completed or failed workflow tasks)
  const canRerun = task.workflowRunId &&
    (task.status === 'completed' || task.status === 'failed') &&
    task.stepConfig

  if (!task.stepConfig && !task.stepInput && !task.stepOutput) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full min-h-[200px] text-center">
        <Settings2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          No step configuration available
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {task.workflowRunId
            ? 'This task was created before step config tracking was added'
            : 'Step configuration is only available for workflow tasks'
          }
        </p>
      </div>
    )
  }

  // Convert task step config to workflow step for StepConfigPanel
  const workflowStep = task.stepConfig
    ? taskConfigToWorkflowStep(task.stepConfig, task.workflowStage || 'step-0')
    : null

  return (
    <div className="p-4 space-y-3">
      {/* Step Input Section */}
      {task.stepInput && (
        <Collapsible open={inputOpen} onOpenChange={setInputOpen} className="border rounded-lg">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">Input Received</span>
              <Badge variant="secondary" className="text-xs">
                {Object.keys(task.stepInput).length} fields
              </Badge>
            </div>
            {inputOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="max-h-64 overflow-auto">
              <JsonViewer data={task.stepInput} defaultExpanded={true} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Step Output Section */}
      {task.stepOutput && (
        <StepOutputSection output={task.stepOutput} />
      )}

      {/* Step Configuration Section - using shared StepConfigPanel in readOnly mode */}
      {workflowStep && (
        <Collapsible open={configOpen} onOpenChange={setConfigOpen} className="border rounded-lg">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Step Configuration</span>
            </div>
            {configOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            <StepConfigPanel
              step={workflowStep}
              stepIndex={0}
              allSteps={[workflowStep]}
              users={[]}
              isInLoop={false}
              onUpdate={() => {}}
              onDelete={() => {}}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              onAddStepAfter={() => {}}
              onChangeType={() => {}}
              readOnly={true}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Rerun Section */}
      {canRerun && (
        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Rerun Step</span>
            </div>
            {task.status === 'completed' && (
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                <Check className="h-3 w-3 mr-1" />
                Completed
              </Badge>
            )}
            {task.status === 'failed' && (
              <Badge variant="secondary" className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                <AlertCircle className="h-3 w-3 mr-1" />
                Failed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Rerun this step with the same input. This will reset the task to pending status.
          </p>
          {rerunError && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded">
              {rerunError}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRerun}
            disabled={isRerunning}
            className="w-full"
          >
            {isRerunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Rerunning...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Rerun This Step
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
