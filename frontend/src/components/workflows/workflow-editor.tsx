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
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Step types for workflow routing
type WorkflowStepType = 'task' | 'decision' | 'foreach' | 'join' | 'subflow'
type ExecutionMode = 'automated' | 'manual'

interface WorkflowStep {
  id: string
  name: string
  stepType: WorkflowStepType
  execution?: ExecutionMode
  prompt?: string
  description?: string
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
  steps: WorkflowStep[]
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

function generateMermaidFromSteps(steps: WorkflowStep[], name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']

  // Generate node definitions
  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, "'")

    switch (step.stepType) {
      case 'decision':
        lines.push(`    ${nodeId}{${label}}`)
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
        if (step.execution === 'manual') {
          lines.push(`    ${nodeId}(${label})`)
        } else {
          lines.push(`    ${nodeId}[${label}]`)
        }
    }
  })

  // Generate connections (simple linear for now)
  for (let i = 0; i < steps.length - 1; i++) {
    const fromId = steps[i].id || `step${i}`
    const toId = steps[i + 1].id || `step${i + 1}`
    lines.push(`    ${fromId} --> ${toId}`)
  }

  // Add styling
  lines.push('')
  lines.push('    classDef automated fill:#3B82F6,color:#fff')
  lines.push('    classDef manual fill:#8B5CF6,color:#fff')
  lines.push('    classDef decision fill:#F59E0B,color:#fff')

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
      // Convert legacy steps if needed
      const convertedSteps = (workflow.steps || []).map(step => ({
        ...step,
        stepType: step.stepType || 'task',
        execution: step.execution || (step as any).type || 'automated',
      }))
      setSteps(convertedSteps)
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

  const getStepTypeInfo = (stepType: WorkflowStepType) => {
    return STEP_TYPES.find(st => st.type === stepType) || STEP_TYPES[0]
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
                  Mermaid
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Preview
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={exportMermaid}
                  disabled={!mermaidCode}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
                <label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <span>
                      <Upload className="h-4 w-4 mr-1" />
                      Import
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".mmd,.txt"
                    className="hidden"
                    onChange={importMermaidFile}
                  />
                </label>
              </div>
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
                                <div className="space-y-1">
                                  <label className="text-sm font-medium">AI Prompt</label>
                                  <Textarea
                                    value={step.prompt || ''}
                                    onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                    placeholder="Instructions for the AI when processing this step...&#10;&#10;Use {{variable}} syntax to reference data from previous steps."
                                    className="min-h-[100px] font-mono text-sm"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    This prompt will be included when the daemon processes tasks at this stage.
                                  </p>
                                </div>
                              )}

                              {/* ForEach configuration */}
                              {step.stepType === 'foreach' && (
                                <>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium">Items Path</label>
                                      <Input
                                        value={step.itemsPath || ''}
                                        onChange={(e) => updateStep(index, { itemsPath: e.target.value })}
                                        placeholder="output.files"
                                        className="font-mono text-sm"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium">Item Variable</label>
                                      <Input
                                        value={step.itemVariable || ''}
                                        onChange={(e) => updateStep(index, { itemVariable: e.target.value })}
                                        placeholder="file"
                                        className="font-mono text-sm"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Prompt (per item)</label>
                                    <Textarea
                                      value={step.prompt || ''}
                                      onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                      placeholder="Process {{file.name}}..."
                                      className="min-h-[80px] font-mono text-sm"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Max Items (default: 100)</label>
                                    <Input
                                      type="number"
                                      value={step.maxItems || ''}
                                      onChange={(e) => updateStep(index, { maxItems: parseInt(e.target.value) || undefined })}
                                      placeholder="100"
                                      className="w-32"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Join configuration */}
                              {step.stepType === 'join' && (
                                <>
                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Await Tag</label>
                                    <Input
                                      value={step.awaitTag || ''}
                                      onChange={(e) => updateStep(index, { awaitTag: e.target.value })}
                                      placeholder="foreach:{{parentId}}"
                                      className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Tag pattern to wait for. Uses {"{{parentId}}"} to reference the foreach parent.
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Aggregation Prompt</label>
                                    <Textarea
                                      value={step.prompt || ''}
                                      onChange={(e) => updateStep(index, { prompt: e.target.value })}
                                      placeholder="Aggregate the results from all items..."
                                      className="min-h-[80px] font-mono text-sm"
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

            {/* Mermaid Code Tab */}
            <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden mt-0">
              <div className="flex-1 flex flex-col gap-2">
                <textarea
                  value={mermaidCode}
                  onChange={(e) => setMermaidCode(e.target.value)}
                  placeholder={`Enter Mermaid flowchart code here...

Example:
flowchart TD
    A[Fetch Data] --> B{Validate}
    B -->|"valid"| C[Process]
    B -->|"invalid"| D[Reject]
    C --> E[[Each: Review Item]]
    E --> F[[Join: Summarize]]`}
                  className={cn(
                    'flex-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono',
                    'ring-offset-background placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'resize-none min-h-[200px]'
                  )}
                />
                <div className="flex items-center gap-2">
                  {mermaidError && (
                    <div className="flex items-center gap-1 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      {mermaidError}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground ml-auto">
                    [ ] = automated task, ( ) = manual task, {"{ }"} = decision, [[ ]] = foreach/join/subflow
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="flex-1 overflow-auto mt-0">
              <div className="bg-white rounded-lg border p-4 min-h-[300px]">
                {mermaidCode ? (
                  <Mermaid
                    chart={mermaidCode}
                    onError={(err) => setMermaidError(err)}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p>Add steps or enter Mermaid code to preview the diagram</p>
                  </div>
                )}
              </div>
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
