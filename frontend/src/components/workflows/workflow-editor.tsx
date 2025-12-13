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
import { Badge } from '@/components/ui/badge'
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
  GripVertical,
  Bot,
  User,
  FileCode,
  Eye,
  Upload,
  Download,
  AlertCircle,
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface WorkflowStep {
  id: string
  name: string
  type: 'automated' | 'manual'
  hitlPhase: string
  description?: string
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

const HITL_PHASES = [
  { code: 'none', label: 'No HITL', color: '#6B7280' },
  { code: 'pre_execution', label: 'Pre-Execution', color: '#3B82F6' },
  { code: 'during_execution', label: 'During Execution', color: '#F59E0B' },
  { code: 'post_execution', label: 'Post-Execution', color: '#10B981' },
  { code: 'on_error', label: 'On Error', color: '#EF4444' },
  { code: 'approval_required', label: 'Approval Required', color: '#8B5CF6' },
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
      const normalizedSteps = workflow.steps || (workflow.stages?.map((name, i) => ({
        id: `stage-${i}`,
        name,
        type: 'manual' as const,
        hitlPhase: 'none',
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

  // Generate mermaid diagram from steps
  const generateMermaid = async () => {
    try {
      const response = await fetch(`${API_BASE}/workflows/generate-mermaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps, name: watch('name') }),
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
  }, [steps])

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

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `Step ${steps.length + 1}`,
      type: 'automated',
      hitlPhase: 'none',
    }
    setSteps([...steps, newStep])
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
                  steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={cn(
                        'flex items-center gap-3 p-3 bg-background rounded-lg border',
                        step.type === 'manual' && 'border-purple-300 bg-purple-50/50'
                      )}
                    >
                      <div className="flex flex-col gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveStep(index, index - 1)}
                          disabled={index === 0}
                        >
                          ▲
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveStep(index, index + 1)}
                          disabled={index === steps.length - 1}
                        >
                          ▼
                        </Button>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground w-8">
                        {index + 1}.
                      </div>

                      <div className="flex-1">
                        <Input
                          value={step.name}
                          onChange={(e) => updateStep(index, { name: e.target.value })}
                          placeholder="Step name"
                          className="h-8"
                        />
                      </div>

                      <Select
                        value={step.type}
                        onValueChange={(val) =>
                          updateStep(index, { type: val as 'automated' | 'manual' })
                        }
                      >
                        <SelectTrigger className="w-[140px] h-8">
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
                        onValueChange={(val) => updateStep(index, { hitlPhase: val })}
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
                  ))
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
                  placeholder="Enter Mermaid flowchart code here...

Example:
flowchart TD
    A[Data Collection] --> B[AI Analysis]
    B --> C((Human Review))
    C --> D[Publication]"
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
                    Use [ ] for automated, ( ) for manual steps
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
