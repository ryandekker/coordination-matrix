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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Bot,
  User,
  FileCode,
  Eye,
  Upload,
  Download,
  AlertCircle,
  GitBranch,
  Repeat,
  Workflow as WorkflowIcon,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import type {
  Workflow,
  WorkflowStep,
  WorkflowRegularStep,
  WorkflowBranchStep,
  WorkflowForeachStep,
  WorkflowSubworkflowStep,
  WorkflowStepType,
  HITLPhase,
  LegacyWorkflowStep,
} from '@/types/workflow'
import {
  isRegularStep,
  isBranchStep,
  isForeachStep,
  isSubworkflowStep,
  normalizeSteps,
  createStep,
} from '@/types/workflow'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

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

const HITL_PHASES: Array<{ code: HITLPhase; label: string; color: string }> = [
  { code: 'none', label: 'No HITL', color: '#6B7280' },
  { code: 'pre_execution', label: 'Pre-Execution', color: '#3B82F6' },
  { code: 'during_execution', label: 'During Execution', color: '#F59E0B' },
  { code: 'post_execution', label: 'Post-Execution', color: '#10B981' },
  { code: 'on_error', label: 'On Error', color: '#EF4444' },
  { code: 'approval_required', label: 'Approval Required', color: '#8B5CF6' },
]

const STEP_TYPES: Array<{ code: WorkflowStepType; label: string; icon: typeof Bot; color: string }> = [
  { code: 'step', label: 'Step', icon: Bot, color: 'text-blue-500' },
  { code: 'branch', label: 'Branch', icon: GitBranch, color: 'text-amber-500' },
  { code: 'foreach', label: 'Foreach', icon: Repeat, color: 'text-green-500' },
  { code: 'subworkflow', label: 'Subworkflow', icon: WorkflowIcon, color: 'text-cyan-500' },
]

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
  const [importing, setImporting] = useState(false)
  const [entryStepId, setEntryStepId] = useState<string | null>(null)

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
      const normalizedSteps = normalizeSteps(workflow.steps || [])
      setSteps(normalizedSteps)
      setEntryStepId(workflow.entryStepId || (normalizedSteps.length > 0 ? normalizedSteps[0].id : null))
      setMermaidCode(workflow.mermaidDiagram || '')
    } else {
      reset({
        name: '',
        description: '',
        isActive: true,
      })
      setSteps([])
      setEntryStepId(null)
      setMermaidCode('')
    }
  }, [workflow, reset])

  // Generate mermaid diagram from steps
  const generateMermaid = async () => {
    try {
      const response = await fetch(`${API_BASE}/workflows/generate-mermaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps, name: watch('name'), entryStepId }),
      })
      if (response.ok) {
        const data = await response.json()
        setMermaidCode(data.data.mermaidDiagram)
        setMermaidError(null)
      }
    } catch (error) {
      console.error('Failed to generate mermaid:', error)
    }
  }

  // Update mermaid when steps change
  useEffect(() => {
    if (steps.length > 0) {
      generateMermaid()
    } else {
      setMermaidCode('')
    }
  }, [steps, entryStepId])

  // Parse mermaid diagram to steps
  const parseMermaid = async () => {
    if (!mermaidCode.trim()) return

    setImporting(true)
    try {
      const response = await fetch(`${API_BASE}/workflows/parse-mermaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mermaidDiagram: mermaidCode }),
      })
      if (response.ok) {
        const data = await response.json()
        setSteps(data.data.steps)
        setEntryStepId(data.data.entryStepId)
        setMermaidError(null)
      } else {
        setMermaidError('Failed to parse Mermaid diagram')
      }
    } catch (error) {
      setMermaidError('Failed to parse Mermaid diagram')
    } finally {
      setImporting(false)
    }
  }

  const addStep = (type: WorkflowStepType = 'step') => {
    const newStep = createStep(type)
    const newSteps = [...steps, newStep]
    setSteps(newSteps)
    if (!entryStepId) {
      setEntryStepId(newStep.id)
    }
  }

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates } as WorkflowStep
    setSteps(newSteps)
  }

  const removeStep = (index: number) => {
    const stepId = steps[index].id
    const newSteps = steps.filter((_, i) => i !== index)
    setSteps(newSteps)
    if (entryStepId === stepId && newSteps.length > 0) {
      setEntryStepId(newSteps[0].id)
    } else if (newSteps.length === 0) {
      setEntryStepId(null)
    }
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
      entryStepId,
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

  const renderStepEditor = (step: WorkflowStep, index: number) => {
    const stepTypeInfo = STEP_TYPES.find((t) => t.code === step.stepType) || STEP_TYPES[0]
    const StepIcon = stepTypeInfo.icon

    return (
      <div
        key={step.id}
        className={cn(
          'flex flex-col gap-2 p-3 bg-background rounded-lg border',
          step.stepType === 'branch' && 'border-amber-300 bg-amber-50/30',
          step.stepType === 'foreach' && 'border-green-300 bg-green-50/30',
          step.stepType === 'subworkflow' && 'border-cyan-300 bg-cyan-50/30',
          isRegularStep(step) && step.type === 'manual' && 'border-purple-300 bg-purple-50/30'
        )}
      >
        <div className="flex items-center gap-3">
          {/* Move buttons */}
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => moveStep(index, index - 1)}
              disabled={index === 0}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => moveStep(index, index + 1)}
              disabled={index === steps.length - 1}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>

          {/* Step number and icon */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground w-12">
            <StepIcon className={cn('h-4 w-4', stepTypeInfo.color)} />
            {index + 1}.
          </div>

          {/* Step name */}
          <div className="flex-1">
            <Input
              value={step.name}
              onChange={(e) => updateStep(index, { name: e.target.value })}
              placeholder="Step name"
              className="h-8"
            />
          </div>

          {/* Step type selector */}
          <Select
            value={step.stepType}
            onValueChange={(val) => {
              const newStep = createStep(val as WorkflowStepType, step.id)
              newStep.name = step.name
              const newSteps = [...steps]
              newSteps[index] = newStep
              setSteps(newSteps)
            }}
          >
            <SelectTrigger className="w-[130px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STEP_TYPES.map((type) => (
                <SelectItem key={type.code} value={type.code}>
                  <div className="flex items-center gap-2">
                    <type.icon className={cn('h-4 w-4', type.color)} />
                    {type.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Delete button */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive"
            onClick={() => removeStep(index)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Step-type specific fields */}
        {isRegularStep(step) && (
          <div className="flex items-center gap-3 ml-12">
            <Select
              value={step.type}
              onValueChange={(val) =>
                updateStep(index, { type: val as 'automated' | 'manual' })
              }
            >
              <SelectTrigger className="w-[130px] h-8">
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

            <Select
              value={step.hitlPhase}
              onValueChange={(val) => updateStep(index, { hitlPhase: val as HITLPhase })}
            >
              <SelectTrigger className="w-[160px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HITL_PHASES.map((phase) => (
                  <SelectItem key={phase.code} value={phase.code}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: phase.color }}
                      />
                      {phase.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isBranchStep(step) && (
          <div className="flex flex-col gap-2 ml-12">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-20">Condition:</span>
              <Input
                value={step.condition}
                onChange={(e) => updateStep(index, { condition: e.target.value })}
                placeholder="e.g., status === 'approved'"
                className="h-8 flex-1 font-mono text-sm"
              />
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-green-600">Yes</span> → {step.trueBranchStepId || '(next step)'}
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-600">No</span> → {step.falseBranchStepId || '(skip)'}
              </span>
            </div>
          </div>
        )}

        {isForeachStep(step) && (
          <div className="flex flex-col gap-2 ml-12">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-20">Collection:</span>
              <Input
                value={step.collection}
                onChange={(e) => updateStep(index, { collection: e.target.value })}
                placeholder="e.g., items, users, documents"
                className="h-8 flex-1 font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-20">Iterator:</span>
              <Input
                value={step.iterator}
                onChange={(e) => updateStep(index, { iterator: e.target.value })}
                placeholder="e.g., item, user, doc"
                className="h-8 w-40 font-mono text-sm"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Body steps: {step.bodyStepIds.length > 0 ? step.bodyStepIds.join(', ') : '(define in mermaid)'}
            </div>
          </div>
        )}

        {isSubworkflowStep(step) && (
          <div className="flex items-center gap-2 ml-12">
            <span className="text-sm text-muted-foreground w-20">Workflow:</span>
            <Input
              value={step.workflowRef}
              onChange={(e) => updateStep(index, { workflowRef: e.target.value })}
              placeholder="Workflow ID or name"
              className="h-8 flex-1 font-mono text-sm"
            />
          </div>
        )}
      </div>
    )
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
                  <Bot className="h-4 w-4" />
                  Visual Editor
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2">
                  <FileCode className="h-4 w-4" />
                  Mermaid Code
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
                    <p className="text-sm">Add steps or import a Mermaid diagram.</p>
                  </div>
                ) : (
                  steps.map((step, index) => renderStepEditor(step, index))
                )}

                {/* Add step buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStep('step')}
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Step
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStep('branch')}
                    className="flex-1"
                  >
                    <GitBranch className="h-4 w-4 mr-1" />
                    Add Branch
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStep('foreach')}
                    className="flex-1"
                  >
                    <Repeat className="h-4 w-4 mr-1" />
                    Add Foreach
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStep('subworkflow')}
                    className="flex-1"
                  >
                    <WorkflowIcon className="h-4 w-4 mr-1" />
                    Add Subworkflow
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Mermaid Code Tab */}
            <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden mt-0">
              <div className="flex-1 flex flex-col gap-2">
                <textarea
                  value={mermaidCode}
                  onChange={(e) => setMermaidCode(e.target.value)}
                  placeholder={`Enter Mermaid flowchart code here...

Example with branching:
flowchart TD
    A[Data Collection] --> B{Valid Data?}
    B -->|Yes| C[Process Data]
    B -->|No| D[Request Correction]
    C --> E[Output Results]
    D --> A

Example with loop:
flowchart TD
    subgraph loop1["foreach: items as item"]
        P1[Process Item]
        P2((Review Item))
    end
    loop1 --> F[Finish]

Example with subworkflow:
flowchart TD
    A[Start] --> B(["Data Validation Workflow"])
    B --> C[Continue]`}
                  className={cn(
                    'flex-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono',
                    'ring-offset-background placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'resize-none min-h-[200px]'
                  )}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={parseMermaid}
                    disabled={importing || !mermaidCode.trim()}
                  >
                    {importing ? 'Parsing...' : 'Parse to Steps'}
                  </Button>
                  {mermaidError && (
                    <div className="flex items-center gap-1 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      {mermaidError}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground ml-auto">
                    [ ] automated | (( )) manual | {'{ }'} branch | ([...]) subworkflow
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="flex-1 overflow-auto mt-0">
              <div className="bg-white rounded-lg border p-4 min-h-[300px]">
                <Mermaid
                  chart={mermaidCode}
                  onError={(err) => setMermaidError(err)}
                />
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
