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
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Step types for workflow routing
type WorkflowStepType = 'task' | 'decision' | 'foreach' | 'join' | 'subflow'
type ExecutionMode = 'automated' | 'manual'

interface WorkflowStep {
  id: string
  name: string
  stepType?: WorkflowStepType
  execution?: ExecutionMode
  type?: 'automated' | 'manual' // Legacy
  prompt?: string
  description?: string
  hitlPhase?: string // Legacy
  defaultAssigneeId?: string
  // Decision fields
  branches?: { condition: string | null; targetStepId: string }[]
  defaultBranch?: string
  // ForEach fields
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  // Join fields
  awaitTag?: string
  // Subflow fields
  subflowId?: string
  inputMapping?: Record<string, string>
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

const STEP_TYPES: { type: WorkflowStepType; label: string; icon: React.ElementType; color: string }[] = [
  { type: 'task', label: 'Task', icon: Bot, color: 'text-blue-500' },
  { type: 'decision', label: 'Decision', icon: GitBranch, color: 'text-amber-500' },
  { type: 'foreach', label: 'ForEach', icon: Repeat, color: 'text-green-500' },
  { type: 'join', label: 'Join', icon: Merge, color: 'text-purple-500' },
  { type: 'subflow', label: 'Subflow', icon: WorkflowIcon, color: 'text-pink-500' },
]

function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']

  // Generate node definitions based on step type
  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, "'")

    switch (step.stepType) {
      case 'decision':
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
      case 'task':
      default:
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${label}")`)
        } else {
          lines.push(`    ${nodeId}["${label}"]`)
        }
    }
  })

  // Generate connections
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`

    // For decision nodes with branches, use labeled edges
    if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${branch.targetStepId}`)
        } else {
          lines.push(`    ${nodeId} --> ${branch.targetStepId}`)
        }
      }
    } else if (i < steps.length - 1) {
      // Simple linear connection to next step
      const nextNodeId = steps[i + 1].id || `step${i + 1}`
      lines.push(`    ${nodeId} --> ${nextNodeId}`)
    }
  }

  // Add styling classes
  lines.push('')
  lines.push('    classDef automated fill:#3B82F6,color:#fff')
  lines.push('    classDef manual fill:#8B5CF6,color:#fff')
  lines.push('    classDef decision fill:#F59E0B,color:#fff')
  lines.push('    classDef foreach fill:#10B981,color:#fff')
  lines.push('    classDef join fill:#8B5CF6,color:#fff')
  lines.push('    classDef subflow fill:#EC4899,color:#fff')

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    automated: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    subflow: [],
  }

  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`

    if (step.stepType === 'decision') {
      classGroups.decision.push(nodeId)
    } else if (step.stepType === 'foreach') {
      classGroups.foreach.push(nodeId)
    } else if (step.stepType === 'join') {
      classGroups.join.push(nodeId)
    } else if (step.stepType === 'subflow') {
      classGroups.subflow.push(nodeId)
    } else {
      const execution = step.execution || step.type || 'automated'
      if (execution === 'manual') {
        classGroups.manual.push(nodeId)
      } else {
        classGroups.automated.push(nodeId)
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
      // Also normalize stepType and execution for all steps
      const normalizedSteps = workflow.steps
        ? workflow.steps.map(step => ({
            ...step,
            stepType: step.stepType || 'task',
            execution: step.execution || (step as any).type || 'automated',
          }))
        : (workflow.stages?.map((name, i) => ({
            id: `stage-${i}`,
            name,
            stepType: 'task' as const,
            execution: 'manual' as const,
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
      stepType: 'task',
      execution: 'automated',
      prompt: '',
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

      // Normalize the parsed steps
      const normalizedSteps = parsedSteps.map((step: WorkflowStep) => ({
        ...step,
        stepType: step.stepType || 'task',
        execution: step.execution || step.type || 'automated',
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

                            {step.stepType === 'task' && (
                              <Select
                                value={step.execution || 'automated'}
                                onValueChange={(val) => updateStep(index, { execution: val as ExecutionMode })}
                              >
                                <SelectTrigger className="w-[130px] h-8" onClick={(e) => e.stopPropagation()}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="automated">
                                    <div className="flex items-center gap-2">
                                      <Bot className="h-4 w-4 text-blue-500" />
                                      Automated
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="manual">
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4 text-purple-500" />
                                      Manual
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}

                            {step.prompt && (
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                has prompt
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
                              {/* Prompt - for task steps */}
                              {step.stepType === 'task' && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <Sparkles className="h-4 w-4 text-amber-500" />
                                      AI Prompt Instructions
                                      {step.execution === 'automated' && (
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                          Required for automation
                                        </span>
                                      )}
                                    </label>
                                    {step.prompt && (
                                      <span className="text-xs text-green-600 flex items-center gap-1">
                                        <MessageSquare className="h-3 w-3" />
                                        Configured
                                      </span>
                                    )}
                                  </div>

                                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-amber-800 space-y-1">
                                        <p className="font-medium">What should the AI do at this step?</p>
                                        <p className="text-xs">
                                          Write clear instructions for the AI agent. Be specific about:
                                        </p>
                                        <ul className="text-xs list-disc list-inside space-y-0.5 ml-2">
                                          <li>What action to take (review, analyze, generate, etc.)</li>
                                          <li>What inputs to use (files, previous outputs, task data)</li>
                                          <li>What output format to produce</li>
                                        </ul>
                                      </div>
                                    </div>
                                  </div>

                                  <Textarea
                                    value={step.prompt || ''}
                                    onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                    placeholder={`Example prompts for "${step.name}":

• "Review the code changes in {{task.metadata.files}} and provide feedback on code quality, potential bugs, and suggestions for improvement."

• "Analyze the test results from the previous step. If all tests pass, approve for merge. If any fail, create a detailed report of failures."

• "Generate a summary of changes made in this PR, including affected components and any breaking changes."

Use {{variable}} to reference:
- {{task.title}} - Task title
- {{task.description}} - Task description
- {{task.metadata.X}} - Custom metadata
- {{previousStep.output}} - Output from prior step`}
                                    className={cn(
                                      "min-h-[140px] font-mono text-sm",
                                      !step.prompt && step.execution === 'automated' && "border-amber-300 bg-amber-50/30"
                                    )}
                                  />

                                  <div className="flex items-center justify-between text-xs">
                                    <p className="text-muted-foreground flex items-center gap-1">
                                      <Info className="h-3 w-3" />
                                      This prompt guides the AI daemon when it processes tasks at this workflow stage.
                                    </p>
                                    {!step.prompt && step.execution === 'automated' && (
                                      <span className="text-amber-600 font-medium">
                                        ⚠ No prompt configured
                                      </span>
                                    )}
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
