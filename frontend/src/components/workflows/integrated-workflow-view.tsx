'use client'

import { useState, useCallback, useMemo } from 'react'
import { MermaidInteractive } from '@/components/ui/mermaid-interactive'
import { StepConfigPanel } from './step-config-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Bot,
  User,
  Globe,
  GitBranch,
  Repeat,
  Merge,
  Workflow as WorkflowIcon,
  MousePointerClick,
  Layers,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'

type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow'

interface StepConnection {
  targetStepId: string
  condition?: string | null
  label?: string
}

interface ExternalConfig {
  endpoint?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  payloadTemplate?: string
}

interface WorkflowStep {
  id: string
  name: string
  description?: string
  stepType?: WorkflowStepType
  titleTemplate?: string
  connections?: StepConnection[]
  additionalInstructions?: string
  defaultAssigneeId?: string
  externalConfig?: ExternalConfig
  defaultConnection?: string
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  inputSource?: string
  inputPath?: string
  awaitTag?: string
  minSuccessPercent?: number
  expectedCountPath?: string
  flowId?: string
  inputMapping?: Record<string, string>
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
}

interface LoopScope {
  foreachIndex: number
  joinIndex: number
  foreachStep: WorkflowStep
  joinStep: WorkflowStep
}

interface IntegratedWorkflowViewProps {
  steps: WorkflowStep[]
  workflowId?: string
  users: { _id: string; displayName: string }[]
  onStepsChange: (steps: WorkflowStep[]) => void
  className?: string
}

const STEP_TYPES: { type: WorkflowStepType; label: string; description: string; icon: React.ElementType; color: string }[] = [
  { type: 'agent', label: 'Agent', description: 'AI agent task', icon: Bot, color: 'text-blue-500' },
  { type: 'external', label: 'External', description: 'API/webhook', icon: Globe, color: 'text-orange-500' },
  { type: 'manual', label: 'Manual', description: 'Human task', icon: User, color: 'text-purple-500' },
  { type: 'decision', label: 'Decision', description: 'Route by condition', icon: GitBranch, color: 'text-amber-500' },
  { type: 'foreach', label: 'ForEach', description: 'Loop over items', icon: Repeat, color: 'text-green-500' },
  { type: 'join', label: 'Join', description: 'Aggregate', icon: Merge, color: 'text-indigo-500' },
  { type: 'flow', label: 'Flow', description: 'Nested workflow', icon: WorkflowIcon, color: 'text-pink-500' },
]

function detectLoopScopes(steps: WorkflowStep[]): LoopScope[] {
  const scopes: LoopScope[] = []
  const foreachStack: { index: number; step: WorkflowStep }[] = []

  steps.forEach((step, index) => {
    if (step.stepType === 'foreach') {
      foreachStack.push({ index, step })
    } else if (step.stepType === 'join' && foreachStack.length > 0) {
      const foreach = foreachStack.pop()!
      scopes.push({
        foreachIndex: foreach.index,
        joinIndex: index,
        foreachStep: foreach.step,
        joinStep: step,
      })
    }
  })

  return scopes
}

function generateMermaidFromSteps(steps: WorkflowStep[]): string {
  if (steps.length === 0) return 'flowchart TD\n  Start([Start])'

  const lines: string[] = ['flowchart TD']
  const styles: string[] = []

  // Style definitions
  lines.push('  %% Style classes')
  lines.push('  classDef agent fill:#dbeafe,stroke:#3b82f6,stroke-width:2px')
  lines.push('  classDef external fill:#ffedd5,stroke:#f97316,stroke-width:2px')
  lines.push('  classDef manual fill:#f3e8ff,stroke:#a855f7,stroke-width:2px')
  lines.push('  classDef decision fill:#fef3c7,stroke:#f59e0b,stroke-width:2px')
  lines.push('  classDef foreach fill:#dcfce7,stroke:#22c55e,stroke-width:2px')
  lines.push('  classDef join fill:#e0e7ff,stroke:#6366f1,stroke-width:2px')
  lines.push('  classDef flow fill:#fce7f3,stroke:#ec4899,stroke-width:2px')
  lines.push('')

  // Create nodes
  steps.forEach((step, index) => {
    const id = step.id
    const name = step.name.replace(/"/g, "'")

    let shape: string
    let styleClass: string

    switch (step.stepType) {
      case 'agent':
        shape = `${id}["${name}"]`
        styleClass = 'agent'
        break
      case 'external':
        shape = `${id}{{"${name}"}}`
        styleClass = 'external'
        break
      case 'manual':
        shape = `${id}("${name}")`
        styleClass = 'manual'
        break
      case 'decision':
        shape = `${id}{"${name}"}`
        styleClass = 'decision'
        break
      case 'foreach':
        shape = `${id}[["Each: ${name}"]]`
        styleClass = 'foreach'
        break
      case 'join':
        shape = `${id}[["Join: ${name}"]]`
        styleClass = 'join'
        break
      case 'flow':
        shape = `${id}[["Run: ${name}"]]`
        styleClass = 'flow'
        break
      default:
        shape = `${id}["${name}"]`
        styleClass = 'agent'
    }

    lines.push(`  ${shape}`)
    styles.push(`  class ${id} ${styleClass}`)
  })

  lines.push('')

  // Create connections
  steps.forEach((step, index) => {
    // Check for explicit connections first
    if (step.connections && step.connections.length > 0) {
      step.connections.forEach(conn => {
        if (conn.targetStepId) {
          const label = conn.label || conn.condition
          if (label) {
            lines.push(`  ${step.id} -->|"${label}"| ${conn.targetStepId}`)
          } else {
            lines.push(`  ${step.id} --> ${conn.targetStepId}`)
          }
        }
      })
    } else if (index < steps.length - 1) {
      // Default: connect to next step
      lines.push(`  ${step.id} --> ${steps[index + 1].id}`)
    }
  })

  lines.push('')
  lines.push(...styles)

  return lines.join('\n')
}

export function IntegratedWorkflowView({
  steps,
  workflowId,
  users,
  onStepsChange,
  className,
}: IntegratedWorkflowViewProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    steps.length > 0 ? steps[0].id : null
  )
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)

  // Generate Mermaid diagram from steps
  const mermaidCode = useMemo(() => generateMermaidFromSteps(steps), [steps])

  // Find selected step
  const selectedStepIndex = steps.findIndex(s => s.id === selectedStepId)
  const selectedStep = selectedStepIndex >= 0 ? steps[selectedStepIndex] : null

  // Detect loop scopes
  const loopScopes = useMemo(() => detectLoopScopes(steps), [steps])
  const stepInLoop = useMemo(() => {
    const map = new Map<number, LoopScope>()
    for (const scope of loopScopes) {
      for (let i = scope.foreachIndex + 1; i < scope.joinIndex; i++) {
        map.set(i, scope)
      }
    }
    return map
  }, [loopScopes])

  const loopScope = selectedStepIndex >= 0 ? stepInLoop.get(selectedStepIndex) : undefined
  const isInLoop = !!loopScope

  // Handle node click in diagram
  const handleNodeClick = useCallback((nodeId: string) => {
    // The nodeId from Mermaid might have a prefix, try to find the step
    const step = steps.find(s => s.id === nodeId || nodeId.includes(s.id))
    if (step) {
      setSelectedStepId(step.id)
      setIsPanelCollapsed(false)
    }
  }, [steps])

  // Update a step
  const updateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  // Delete a step
  const deleteStep = useCallback((index: number) => {
    const newSteps = steps.filter((_, i) => i !== index)
    onStepsChange(newSteps)
    // Select the previous step or the first one
    if (newSteps.length > 0) {
      const newIndex = Math.max(0, index - 1)
      setSelectedStepId(newSteps[newIndex].id)
    } else {
      setSelectedStepId(null)
    }
  }, [steps, onStepsChange])

  // Move step up
  const moveStepUp = useCallback((index: number) => {
    if (index === 0) return
    const newSteps = [...steps]
    ;[newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]]
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  // Move step down
  const moveStepDown = useCallback((index: number) => {
    if (index >= steps.length - 1) return
    const newSteps = [...steps]
    ;[newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]]
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  // Add a new step
  const addStep = useCallback((afterIndex: number, type: WorkflowStepType = 'agent') => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)} Step`,
      stepType: type,
    }
    const newSteps = [...steps]
    newSteps.splice(afterIndex + 1, 0, newStep)
    onStepsChange(newSteps)
    setSelectedStepId(newStep.id)
    setIsPanelCollapsed(false)
  }, [steps, onStepsChange])

  // Add first step
  const addFirstStep = useCallback((type: WorkflowStepType) => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)} Step`,
      stepType: type,
    }
    onStepsChange([...steps, newStep])
    setSelectedStepId(newStep.id)
    setIsPanelCollapsed(false)
  }, [steps, onStepsChange])

  // Change step type
  const changeStepType = useCallback((index: number, type: WorkflowStepType) => {
    updateStep(index, { stepType: type })
  }, [updateStep])

  // Handle adding step after a node (from edge + button)
  const handleAddAfter = useCallback((afterStepId: string) => {
    const afterIndex = steps.findIndex(s => s.id === afterStepId)
    if (afterIndex >= 0) {
      addStep(afterIndex)
    }
  }, [steps, addStep])

  return (
    <div className={cn('flex gap-2', className)} style={{ height: '100%', maxHeight: '100%' }}>
      {/* Diagram Panel */}
      <div className={cn(
        'flex flex-col bg-muted/20 border rounded-lg transition-all overflow-hidden',
        isPanelCollapsed ? 'flex-1' : 'flex-[3]'
      )} style={{ height: '100%' }}>
        {/* Diagram Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-background/50 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span>Workflow Diagram</span>
            <span className="text-xs">({steps.length} steps)</span>
          </div>
          <div className="flex items-center gap-1">
            {steps.length === 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add First Step
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {STEP_TYPES.map(st => (
                    <DropdownMenuItem
                      key={st.type}
                      onClick={() => addFirstStep(st.type)}
                    >
                      <st.icon className={cn('h-4 w-4 mr-2', st.color)} />
                      {st.label}
                      <span className="text-xs text-muted-foreground ml-2">
                        {st.description}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
              >
                {isPanelCollapsed ? (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Show Panel
                  </>
                ) : (
                  <>
                    Hide Panel
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Diagram Content */}
        <div className="flex-1 p-4 overflow-auto min-h-0">
          {steps.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No steps yet</p>
                <p className="text-sm">Add your first step to begin building the workflow</p>
              </div>
            </div>
          ) : (
            <MermaidInteractive
              chart={mermaidCode}
              selectedNodeId={selectedStepId}
              stepIds={steps.map(s => s.id)}
              onNodeClick={handleNodeClick}
              onAddAfter={handleAddAfter}
              className="min-h-[200px]"
            />
          )}
        </div>

        {/* Hint */}
        {steps.length > 0 && (
          <div className="px-3 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground flex items-center gap-1.5 flex-shrink-0">
            <MousePointerClick className="h-3 w-3" />
            Click node to edit • Hover arrow for +
          </div>
        )}
      </div>

      {/* Config Panel */}
      {!isPanelCollapsed && (
        <div className="flex-[2] flex flex-col border rounded-lg bg-background overflow-hidden" style={{ height: '100%' }}>
          {selectedStep ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <StepConfigPanel
              step={selectedStep}
              stepIndex={selectedStepIndex}
              allSteps={steps}
              workflowId={workflowId}
              users={users}
              loopScope={loopScope}
              isInLoop={isInLoop}
              onUpdate={(updates) => updateStep(selectedStepIndex, updates)}
              onDelete={() => deleteStep(selectedStepIndex)}
              onMoveUp={() => moveStepUp(selectedStepIndex)}
              onMoveDown={() => moveStepDown(selectedStepIndex)}
              onAddStepAfter={() => addStep(selectedStepIndex)}
              onChangeType={(type) => changeStepType(selectedStepIndex, type)}
            />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
              <div className="text-center">
                <MousePointerClick className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click a step in the diagram to edit</p>
                {steps.length === 0 && (
                  <p className="text-xs mt-1">Or add your first step to get started</p>
                )}
              </div>
            </div>
          )}

          {/* Step list for quick navigation */}
          {steps.length > 0 && (
            <div className="border-t p-2 bg-muted/20 flex-shrink-0">
              <div className="text-xs text-muted-foreground mb-1.5 px-1">Quick select:</div>
              <ScrollArea className="max-h-[120px]">
                <div className="space-y-0.5">
                  {steps.map((step, index) => {
                    const typeInfo = STEP_TYPES.find(t => t.type === step.stepType) || STEP_TYPES[0]
                    const Icon = typeInfo.icon
                    return (
                      <button
                        key={step.id}
                        onClick={() => setSelectedStepId(step.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-sm transition-colors',
                          selectedStepId === step.id
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted'
                        )}
                      >
                        <span className="text-xs text-muted-foreground w-4">{index + 1}.</span>
                        <Icon className={cn('h-3 w-3 flex-shrink-0', typeInfo.color)} />
                        <span className="truncate">{step.name}</span>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
