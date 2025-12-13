'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Mermaid } from '@/components/ui/mermaid'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  Plus,
  Trash2,
  GripVertical,
  Bot,
  User,
  FileCode,
  Eye,
  Upload,
  Download,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Repeat,
  Merge,
  Workflow as WorkflowIcon,
  Sparkles,
  Info,
  MessageSquare,
  Lightbulb,
  RefreshCw,
  ArrowRight,
  Globe,
  Link2,
  Zap,
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Step types for workflow routing
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - external: External service/webhook call - no prompting, has endpoint config
// - manual: Human-in-the-loop task
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection
// - join: Fan-in aggregation point
// - subflow: Delegate to another workflow
type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'subflow'

// Connection between steps (for non-linear flows)
interface StepConnection {
  targetStepId: string
  condition?: string | null
  label?: string
}

// External service configuration
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
  stepType?: WorkflowStepType  // Optional for backward compatibility

  // Non-linear flow: explicit connections to next steps
  connections?: StepConnection[]

  // Agent step configuration
  additionalInstructions?: string
  defaultAssigneeId?: string

  // External step configuration
  externalConfig?: ExternalConfig

  // Decision step configuration
  defaultConnection?: string

  // ForEach fields
  itemsPath?: string
  itemVariable?: string
  maxItems?: number

  // Join fields
  awaitTag?: string

  // Subflow fields
  subflowId?: string
  inputMapping?: Record<string, string>

  // Legacy compatibility
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
}

interface Workflow {
  _id?: string
  name: string
  description: string
  isActive: boolean
  steps?: WorkflowStep[]
  stages?: string[]  // Legacy format
  mermaidDiagram?: string
}

const workflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

type WorkflowFormData = z.infer<typeof workflowSchema>

interface WorkflowEditorProps {
  workflow: Workflow | null
  isOpen: boolean
  onClose: () => void
  onSave: (workflow: Workflow) => void
}

const STEP_TYPES: { type: WorkflowStepType; label: string; description: string; icon: React.ElementType; color: string; bgColor: string }[] = [
  { type: 'agent', label: 'Agent', description: 'AI agent task', icon: Bot, color: 'text-blue-500', bgColor: 'bg-blue-50' },
  { type: 'external', label: 'External', description: 'API/webhook call', icon: Globe, color: 'text-orange-500', bgColor: 'bg-orange-50' },
  { type: 'manual', label: 'Manual', description: 'Human task', icon: User, color: 'text-purple-500', bgColor: 'bg-purple-50' },
  { type: 'decision', label: 'Decision', description: 'Route by condition', icon: GitBranch, color: 'text-amber-500', bgColor: 'bg-amber-50' },
  { type: 'foreach', label: 'ForEach', description: 'Loop over items', icon: Repeat, color: 'text-green-500', bgColor: 'bg-green-50' },
  { type: 'join', label: 'Join', description: 'Aggregate results', icon: Merge, color: 'text-indigo-500', bgColor: 'bg-indigo-50' },
  { type: 'subflow', label: 'Subflow', description: 'Run sub-workflow', icon: WorkflowIcon, color: 'text-pink-500', bgColor: 'bg-pink-50' },
]

function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']

  // Generate node definitions based on step type
  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, "'")

    switch (step.stepType) {
      case 'agent':
        // Square brackets for agent tasks (AI)
        lines.push(`    ${nodeId}["${label}"]`)
        break
      case 'external':
        // Hexagon for external/API tasks
        lines.push(`    ${nodeId}{{"${label}"}}`)
        break
      case 'manual':
        // Round brackets for manual/HITL tasks
        lines.push(`    ${nodeId}("${label}")`)
        break
      case 'decision':
        // Diamond for decision/routing
        lines.push(`    ${nodeId}{"${label}"}`)
        break
      case 'foreach':
        lines.push(`    ${nodeId}[["Each: ${label}"]]`)
        break
      case 'join':
        lines.push(`    ${nodeId}[["Join: ${label}"]]`)
        break
      case 'subflow':
        lines.push(`    ${nodeId}[["Run: ${label}"]]`)
        break
      default:
        // Legacy support: check execution mode
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${label}")`)
        } else {
          lines.push(`    ${nodeId}["${label}"]`)
        }
    }
  })

  // Generate connections - use explicit connections if available, otherwise linear
  const connectedFrom = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`

    // Use explicit connections if defined
    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`    ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`)
        } else {
          lines.push(`    ${nodeId} --> ${conn.targetStepId}`)
        }
      }
      connectedFrom.add(nodeId)
    }
    // Legacy: use branches for decision nodes
    else if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${branch.targetStepId}`)
        } else {
          lines.push(`    ${nodeId} --> ${branch.targetStepId}`)
        }
      }
      connectedFrom.add(nodeId)
    }
  }

  // Add linear connections for nodes without explicit connections
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = steps[i + 1].id || `step${i + 1}`
      lines.push(`    ${nodeId} --> ${nextNodeId}`)
    }
  }

  // Add styling classes with distinct colors for each type
  lines.push('')
  lines.push('    classDef agent fill:#3B82F6,color:#fff')       // Blue - AI agent
  lines.push('    classDef external fill:#F97316,color:#fff')    // Orange - External/API
  lines.push('    classDef manual fill:#8B5CF6,color:#fff')      // Purple - Human/HITL
  lines.push('    classDef decision fill:#F59E0B,color:#fff')    // Amber - Decision
  lines.push('    classDef foreach fill:#10B981,color:#fff')     // Green - Loop
  lines.push('    classDef join fill:#6366F1,color:#fff')        // Indigo - Join
  lines.push('    classDef subflow fill:#EC4899,color:#fff')     // Pink - Subflow

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    agent: [],
    external: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    subflow: [],
  }

  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`

    switch (step.stepType) {
      case 'agent':
        classGroups.agent.push(nodeId)
        break
      case 'external':
        classGroups.external.push(nodeId)
        break
      case 'manual':
        classGroups.manual.push(nodeId)
        break
      case 'decision':
        classGroups.decision.push(nodeId)
        break
      case 'foreach':
        classGroups.foreach.push(nodeId)
        break
      case 'join':
        classGroups.join.push(nodeId)
        break
      case 'subflow':
        classGroups.subflow.push(nodeId)
        break
      default:
        // Legacy support
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          classGroups.manual.push(nodeId)
        } else {
          classGroups.agent.push(nodeId)
        }
    }
  })

  // Output class assignments
  for (const [className, nodeIds] of Object.entries(classGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${className}`)
    }
  }

  return lines.join('\n')
}

export function WorkflowEditor({
  workflow,
  isOpen,
  onClose,
  onSave,
}: WorkflowEditorProps) {
  const [steps, setSteps] = useState<WorkflowStep[]>([])
  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('visual')
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<WorkflowFormData>({
    resolver: zodResolver(workflowSchema),
    defaultValues: {
      name: '',
      description: '',
      isActive: true,
    },
  })

  useEffect(() => {
    if (workflow) {
      reset({
        name: workflow.name,
        description: workflow.description || '',
        isActive: workflow.isActive,
      })
      // Support both 'steps' (new format) and 'stages' (legacy format)
      // Normalize stepType for all steps, mapping legacy types to new taxonomy
      const normalizedSteps = workflow.steps
        ? workflow.steps.map(step => {
            // Map legacy 'task' type to new types based on execution mode
            let stepType = step.stepType
            if (!stepType || stepType === 'task' as any) {
              const execution = step.execution || (step as any).type || 'automated'
              stepType = execution === 'manual' ? 'manual' : 'agent'
            }
            return {
              ...step,
              stepType,
              // Map legacy prompt to additionalInstructions
              additionalInstructions: step.additionalInstructions || step.prompt,
            }
          })
        : (workflow.stages?.map((name, i) => ({
            id: `stage-${i}`,
            name,
            stepType: 'manual' as const,
          })) || [])
      setSteps(normalizedSteps)
      setMermaidCode(workflow.mermaidDiagram || '')
    } else {
      reset({
        name: '',
        description: '',
        isActive: true,
      })
      setSteps([])
      setMermaidCode('')
    }
  }, [workflow, reset])

  // Update mermaid when steps change
  useEffect(() => {
    if (steps.length > 0) {
      const diagram = generateMermaidFromSteps(steps, watch('name'))
      setMermaidCode(diagram)
      setMermaidError(null)
    } else {
      setMermaidCode('')
    }
  }, [steps, watch])

  const toggleStepExpanded = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) {
        next.delete(stepId)
      } else {
        next.add(stepId)
      }
      return next
    })
  }

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `Step ${steps.length + 1}`,
      stepType: 'agent',
    }
    setSteps([...steps, newStep])
    // Auto-expand new step
    setExpandedSteps(prev => new Set(prev).add(newStep.id))
  }

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    setSteps(newSteps)
  }

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index))
  }

  const moveStep = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= steps.length) return
    const newSteps = [...steps]
    const [moved] = newSteps.splice(fromIndex, 1)
    newSteps.splice(toIndex, 0, moved)
    setSteps(newSteps)
  }

  // Sync Mermaid code to steps by calling backend parse API
  const syncMermaidToSteps = async () => {
    if (!mermaidCode.trim()) {
      setSyncError('No Mermaid code to parse')
      return
    }

    setIsSyncing(true)
    setSyncError(null)

    try {
      const response = await fetch(`${API_BASE}/workflows/parse-mermaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mermaidDiagram: mermaidCode }),
      })

      if (!response.ok) {
        throw new Error(`Failed to parse: ${response.statusText}`)
      }

      const result = await response.json()
      const parsedSteps = result.data?.steps || []

      if (parsedSteps.length === 0) {
        setSyncError('No steps found in diagram. Check your Mermaid syntax.')
        return
      }

      // Normalize the parsed steps - new types don't need execution field
      const normalizedSteps = parsedSteps.map((step: WorkflowStep) => ({
        ...step,
        stepType: step.stepType || 'agent',
      }))

      setSteps(normalizedSteps)
      // Expand all newly created steps
      setExpandedSteps(new Set(normalizedSteps.map((s: WorkflowStep) => s.id)))
      setActiveTab('visual')
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Failed to parse Mermaid')
    } finally {
      setIsSyncing(false)
    }
  }

  const onSubmit = (data: WorkflowFormData) => {
    const workflowData: Workflow = {
      ...data,
      _id: workflow?._id,
      steps,
      mermaidDiagram: mermaidCode,
      description: data.description || '',
    }
    onSave(workflowData)
  }

  const exportMermaid = () => {
    const blob = new Blob([mermaidCode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${watch('name') || 'workflow'}.mmd`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importMermaidFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setMermaidCode(content)
      setActiveTab('code')
    }
    reader.readAsText(file)
  }

  const getStepTypeInfo = (stepType?: WorkflowStepType) => {
    return STEP_TYPES.find(st => st.type === (stepType || 'task')) || STEP_TYPES[0]
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {workflow ? 'Edit Workflow' : 'Create New Workflow'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input {...register('name')} placeholder="Workflow name" />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                {...register('description')}
                placeholder="Brief description"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <Checkbox
              id="isActive"
              checked={watch('isActive')}
              onCheckedChange={(checked) => setValue('isActive', !!checked)}
            />
            <label htmlFor="isActive" className="text-sm font-medium">
              Active
            </label>
          </div>

          {/* Tabs for Visual/Code/Preview */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <TabsList>
                <TabsTrigger value="visual" className="gap-2">
                  <GripVertical className="h-4 w-4" />
                  Steps
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2">
                  <FileCode className="h-4 w-4" />
                  Diagram Editor
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Full Preview
                </TabsTrigger>
              </TabsList>

              {/* Sync button - converts Mermaid code to steps */}
              {activeTab === 'code' && (
                <div className="flex items-center gap-2">
                  {syncError && (
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {syncError}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={syncMermaidToSteps}
                    disabled={isSyncing || !mermaidCode.trim()}
                    className="gap-2"
                  >
                    {isSyncing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {isSyncing ? 'Parsing...' : 'Import to Steps'}
                  </Button>
                </div>
              )}
            </div>

            {/* Visual Editor Tab */}
            <TabsContent value="visual" className="flex-1 overflow-auto mt-0">
              <div className="space-y-2 p-2 bg-muted/30 rounded-lg">
                {steps.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No steps defined yet.</p>
                    <p className="text-sm">Add steps to build your workflow.</p>
                  </div>
                ) : (
                  steps.map((step, index) => {
                    const typeInfo = getStepTypeInfo(step.stepType)
                    const TypeIcon = typeInfo.icon
                    const isExpanded = expandedSteps.has(step.id)

                    return (
                      <Collapsible
                        key={step.id}
                        open={isExpanded}
                        onOpenChange={() => toggleStepExpanded(step.id)}
                      >
                        <div
                          className={cn(
                            'bg-background rounded-lg border',
                            step.execution === 'manual' && 'border-purple-300'
                          )}
                        >
                          {/* Step Header */}
                          <div className="flex items-center gap-3 p-3">
                            <div className="flex flex-col gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={(e) => { e.stopPropagation(); moveStep(index, index - 1) }}
                                disabled={index === 0}
                              >
                                ▲
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={(e) => { e.stopPropagation(); moveStep(index, index + 1) }}
                                disabled={index === steps.length - 1}
                              >
                                ▼
                              </Button>
                            </div>

                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>

                            <div className="flex items-center gap-2 text-sm text-muted-foreground w-8">
                              {index + 1}.
                            </div>

                            <TypeIcon className={cn('h-4 w-4', typeInfo.color)} />

                            <div className="flex-1">
                              <Input
                                value={step.name}
                                onChange={(e) => updateStep(index, { name: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Step name"
                                className="h-8"
                              />
                            </div>

                            <Select
                              value={step.stepType}
                              onValueChange={(val) => updateStep(index, { stepType: val as WorkflowStepType })}
                            >
                              <SelectTrigger className="w-[130px] h-8" onClick={(e) => e.stopPropagation()}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STEP_TYPES.map((st) => (
                                  <SelectItem key={st.type} value={st.type}>
                                    <div className="flex items-center gap-2">
                                      <st.icon className={cn('h-4 w-4', st.color)} />
                                      {st.label}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {(step.additionalInstructions || step.prompt) && (
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                has instructions
                              </span>
                            )}

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive"
                              onClick={(e) => { e.stopPropagation(); removeStep(index) }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Step Details (Expanded) */}
                          <CollapsibleContent>
                            <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                              {/* Agent step configuration */}
                              {(step.stepType === 'agent' || (!step.stepType && step.execution !== 'manual')) && (
                                <div className="space-y-2">
                                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Bot className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-blue-800">
                                        <p className="font-medium">AI Agent Task</p>
                                        <p className="text-xs mt-1">
                                          This step is handled by an AI agent. The agent already knows how to handle most tasks -
                                          additional instructions are optional and provide extra context.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <Sparkles className="h-4 w-4 text-amber-500" />
                                      Additional Instructions
                                      <span className="text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <Textarea
                                      value={step.additionalInstructions || step.prompt || ''}
                                      onChange={(e) => updateStep(index, { additionalInstructions: e.target.value })}
                                      placeholder={`Add extra context for the agent if needed. Examples:

• "Focus on security vulnerabilities in this review"
• "Use the company style guide for formatting"
• "Include test coverage recommendations"

The agent will receive task context automatically.`}
                                      className="min-h-[100px] font-mono text-sm"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* External step configuration */}
                              {step.stepType === 'external' && (
                                <div className="space-y-3">
                                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Globe className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-orange-800">
                                        <p className="font-medium">External Service Call</p>
                                        <p className="text-xs mt-1">
                                          This step calls an external API or webhook. Configure the endpoint and request details below.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-4 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium">Method</label>
                                      <Select
                                        value={step.externalConfig?.method || 'POST'}
                                        onValueChange={(val) => updateStep(index, {
                                          externalConfig: { ...step.externalConfig, method: val as any }
                                        })}
                                      >
                                        <SelectTrigger className="h-8">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="GET">GET</SelectItem>
                                          <SelectItem value="POST">POST</SelectItem>
                                          <SelectItem value="PUT">PUT</SelectItem>
                                          <SelectItem value="PATCH">PATCH</SelectItem>
                                          <SelectItem value="DELETE">DELETE</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="col-span-3 space-y-1">
                                      <label className="text-sm font-medium">Endpoint URL</label>
                                      <Input
                                        value={step.externalConfig?.endpoint || ''}
                                        onChange={(e) => updateStep(index, {
                                          externalConfig: { ...step.externalConfig, endpoint: e.target.value }
                                        })}
                                        placeholder="https://api.example.com/webhook"
                                        className="font-mono text-sm h-8"
                                      />
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Payload Template (JSON)</label>
                                    <Textarea
                                      value={step.externalConfig?.payloadTemplate || ''}
                                      onChange={(e) => updateStep(index, {
                                        externalConfig: { ...step.externalConfig, payloadTemplate: e.target.value }
                                      })}
                                      placeholder={`{
  "taskId": "{{task._id}}",
  "title": "{{task.title}}",
  "data": "{{previousStep.output}}"
}`}
                                      className="min-h-[80px] font-mono text-sm"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Manual step configuration */}
                              {step.stepType === 'manual' && (
                                <div className="space-y-2">
                                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <User className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-purple-800">
                                        <p className="font-medium">Human Task</p>
                                        <p className="text-xs mt-1">
                                          This step requires human review or action. The task will wait for a person to complete it.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* ForEach configuration */}
                              {step.stepType === 'foreach' && (
                                <>
                                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Repeat className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-green-800">
                                        <p className="font-medium">Loop Configuration</p>
                                        <p className="text-xs mt-1">
                                          This step will iterate over a collection and create a subtask for each item.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Items Path
                                        <span className="text-xs text-muted-foreground">(JSONPath)</span>
                                      </label>
                                      <Input
                                        value={step.itemsPath || ''}
                                        onChange={(e) => updateStep(index, { itemsPath: e.target.value })}
                                        placeholder="e.g., output.files or results.items"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Path to the array in the previous step&apos;s output
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Item Variable Name
                                      </label>
                                      <Input
                                        value={step.itemVariable || ''}
                                        onChange={(e) => updateStep(index, { itemVariable: e.target.value })}
                                        placeholder="e.g., file, item, record"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Use as {"{{variable}}"} in prompt below
                                      </p>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <Sparkles className="h-4 w-4 text-amber-500" />
                                      Per-Item Prompt
                                    </label>
                                    <Textarea
                                      value={step.prompt || ''}
                                      onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                      placeholder={`This prompt runs for EACH item in the collection.

Example: "Review the file {{file.path}} and check for:
- Code style consistency
- Potential bugs
- Security vulnerabilities

Provide a structured report with severity levels."`}
                                      className="min-h-[100px] font-mono text-sm"
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Max Items</label>
                                    <Input
                                      type="number"
                                      value={step.maxItems || ''}
                                      onChange={(e) => updateStep(index, { maxItems: parseInt(e.target.value) || undefined })}
                                      placeholder="100 (default)"
                                      className="w-40"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Safety limit to prevent runaway loops
                                    </p>
                                  </div>
                                </>
                              )}

                              {/* Join configuration */}
                              {step.stepType === 'join' && (
                                <>
                                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Merge className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-purple-800">
                                        <p className="font-medium">Join / Aggregation Point</p>
                                        <p className="text-xs mt-1">
                                          This step waits for all parallel tasks to complete, then aggregates results.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-1">
                                      Await Tag Pattern
                                    </label>
                                    <Input
                                      value={step.awaitTag || ''}
                                      onChange={(e) => updateStep(index, { awaitTag: e.target.value })}
                                      placeholder="e.g., foreach:{{parentId}}"
                                      className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Pattern to match tasks to wait for. Use {"{{parentId}}"} to reference the loop&apos;s parent task.
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <Sparkles className="h-4 w-4 text-amber-500" />
                                      Aggregation Prompt
                                    </label>
                                    <Textarea
                                      value={step.prompt || ''}
                                      onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                      placeholder={`Combine the results from all completed subtasks.

Example: "Review all the individual file reviews completed by the foreach step. Create a consolidated report that:

1. Summarizes the overall code quality
2. Lists critical issues by priority
3. Provides a final recommendation (approve/request changes)

The results from each subtask are available in {{subtasks}}."`}
                                      className="min-h-[120px] font-mono text-sm"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Decision - branches would need more complex UI */}
                              {step.stepType === 'decision' && (
                                <div className="space-y-1">
                                  <p className="text-sm text-muted-foreground">
                                    Decision branches are defined in the Mermaid diagram using edge labels.
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Example: A --&gt;|"output.score &gt;= 80"| B
                                  </p>
                                </div>
                              )}

                              {/* Subflow configuration */}
                              {step.stepType === 'subflow' && (
                                <div className="space-y-1">
                                  <label className="text-sm font-medium">Subflow ID</label>
                                  <Input
                                    value={step.subflowId || ''}
                                    onChange={(e) => updateStep(index, { subflowId: e.target.value })}
                                    placeholder="workflow-id"
                                    className="font-mono text-sm"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    The ID of the workflow to delegate to.
                                  </p>
                                </div>
                              )}

                              {/* Description - for all types */}
                              <div className="space-y-1">
                                <label className="text-sm font-medium">Description</label>
                                <Input
                                  value={step.description || ''}
                                  onChange={(e) => updateStep(index, { description: e.target.value })}
                                  placeholder="Optional description for documentation"
                                />
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    )
                  })
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addStep}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Step
                </Button>
              </div>
            </TabsContent>

            {/* Combined Mermaid Editor with Live Preview */}
            <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden mt-0">
              <MermaidLiveEditor
                value={mermaidCode}
                onChange={setMermaidCode}
                onError={setMermaidError}
                className="flex-1"
                minHeight="350px"
                initialLayout="split"
              />
            </TabsContent>

            {/* Preview Tab - Full Preview */}
            <TabsContent value="preview" className="flex-1 overflow-auto mt-0">
              <MermaidLiveEditor
                value={mermaidCode}
                onChange={setMermaidCode}
                onError={setMermaidError}
                className="flex-1"
                minHeight="350px"
                initialLayout="preview"
              />
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {workflow ? 'Update Workflow' : 'Create Workflow'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
