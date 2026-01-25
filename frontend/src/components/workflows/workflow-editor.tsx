'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useUsers } from '@/hooks/use-tasks'
import { workflowsApi, Workflow as ApiWorkflow } from '@/lib/api'
import { getAuthHeader } from '@/lib/auth'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import { IntegratedWorkflowView } from './integrated-workflow-view'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/api'
import {
  Plus,
  Trash2,
  GripVertical,
  FileCode,
  Upload,
  Download,
  LayoutPanelLeft,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Repeat,
  Merge,
  Sparkles,
  Info,
  MessageSquare,
  RefreshCw,
  ArrowRightFromLine,
  ArrowDown,
  Folder,
  FolderPlus,
  History,
  Palette,
  FileText,
  Settings,
  ToggleLeft,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TokenBrowser } from './token-browser'
import { WorkflowWebhook } from './workflow-webhook'
import { TemplateTextarea } from '@/components/ui/template-textarea'

// Import types, constants, and utilities from editor module
import type { WorkflowStep, WorkflowStepType, Workflow, WorkflowEditorProps, LoopScope } from './editor/types'
import { STEP_TYPES, getStepTypeInfo } from './editor/constants'
import { detectLoopScopes, generateMermaidFromSteps } from './editor/utils'
import { StepConfigPanel } from './step-config-panel'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Types for folders and runs
interface WorkflowFolder {
  _id: string
  name: string
  description?: string
  sortOrder: number
  isExpanded: boolean
}

interface WorkflowRunBrief {
  _id: string
  status: string
  inputPayload?: Record<string, unknown>
  createdAt: string
}

// Fetch functions
async function fetchWorkflowFolders(): Promise<{ data: WorkflowFolder[] }> {
  const response = await authFetch(`${API_BASE}/workflow-folders`)
  if (!response.ok) throw new Error('Failed to fetch folders')
  return response.json()
}

async function createWorkflowFolder(data: { name: string }): Promise<{ data: WorkflowFolder }> {
  const response = await authFetch(`${API_BASE}/workflow-folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create folder')
  return response.json()
}

async function fetchWorkflowRuns(workflowId: string): Promise<{ data: WorkflowRunBrief[] }> {
  const response = await authFetch(`${API_BASE}/workflow-runs?workflowId=${workflowId}&limit=10`)
  if (!response.ok) throw new Error('Failed to fetch runs')
  return response.json()
}

const workflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

type WorkflowFormData = z.infer<typeof workflowSchema>

// Settings section IDs for navigation
const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'title', label: 'Title Template', icon: MessageSquare },
  { id: 'status', label: 'Status', icon: ToggleLeft },
  { id: 'organization', label: 'Organization', icon: Folder },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'payload', label: 'Sample Payload', icon: FileCode },
  { id: 'ai-prompt', label: 'AI Generation', icon: Sparkles },
  { id: 'webhook', label: 'Webhook', icon: ArrowRightFromLine },
] as const

export function WorkflowEditor({
  workflow,
  isOpen,
  onClose,
  onSave,
}: WorkflowEditorProps) {
  const [steps, setSteps] = useState<WorkflowStep[]>([])
  const [rootTaskTitleTemplate, setRootTaskTitleTemplate] = useState('')
  const [samplePayload, setSamplePayload] = useState('')
  const [mermaidCode, setMermaidCode] = useState('')
  const [selectedColor, setSelectedColor] = useState<string | undefined>(undefined)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('integrated')
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Available workflows for Flow step type
  const [availableWorkflows, setAvailableWorkflows] = useState<ApiWorkflow[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)

  // New folder creation
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  // Settings section scroll
  const [activeSettingsSection, setActiveSettingsSection] = useState('general')
  const settingsContainerRef = useRef<HTMLDivElement>(null)

  const queryClient = useQueryClient()

  // Fetch users for default assignee dropdown
  const { data: usersData } = useUsers()
  const users = usersData?.data || []

  // Fetch workflow folders
  const { data: foldersData } = useQuery({
    queryKey: ['workflow-folders'],
    queryFn: fetchWorkflowFolders,
  })
  const folders = foldersData?.data || []

  // Fetch recent runs for this workflow (only if editing existing workflow)
  const { data: runsData } = useQuery({
    queryKey: ['workflow-runs', workflow?._id],
    queryFn: () => fetchWorkflowRuns(workflow!._id!),
    enabled: !!workflow?._id,
  })
  const recentRuns = runsData?.data || []

  // Create folder mutation
  const createFolderMutation = useMutation({
    mutationFn: createWorkflowFolder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-folders'] })
      setSelectedFolderId(data.data._id)
      setNewFolderName('')
      setIsCreatingFolder(false)
    },
  })

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
      setRootTaskTitleTemplate(workflow.rootTaskTitleTemplate || '')
      setSamplePayload(workflow.samplePayload || '')
      setSelectedColor(workflow.color || undefined)
      setSelectedFolderId(workflow.folderId || null)
    } else {
      reset({
        name: '',
        description: '',
        isActive: true,
      })
      setSteps([])
      setMermaidCode('')
      setRootTaskTitleTemplate('')
      setSamplePayload('')
      setSelectedColor(undefined)
      setSelectedFolderId(null)
    }
  }, [workflow, reset])

  // Fetch available workflows for Flow step type (nested workflows)
  useEffect(() => {
    if (isOpen && availableWorkflows.length === 0 && !loadingWorkflows) {
      setLoadingWorkflows(true)
      workflowsApi.list()
        .then(response => {
          if (response.data) {
            // Exclude the current workflow from the list to prevent self-reference
            const filtered = response.data.filter(w => w._id !== workflow?._id)
            setAvailableWorkflows(filtered)
          }
        })
        .catch(err => {
          console.error('Failed to fetch workflows:', err)
        })
        .finally(() => {
          setLoadingWorkflows(false)
        })
    }
  }, [isOpen, workflow?._id])

  // Update mermaid when steps change
  // Extract primitive value to avoid infinite re-renders (watch function changes reference every render)
  const workflowName = watch('name')
  useEffect(() => {
    if (steps.length > 0) {
      const diagram = generateMermaidFromSteps(steps, workflowName)
      setMermaidCode(diagram)
      setMermaidError(null)
    } else {
      setMermaidCode('')
    }
  }, [steps, workflowName])

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

  const insertStepAt = (index: number) => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `Step ${index + 1}`,
      stepType: 'agent',
    }
    const newSteps = [...steps]
    newSteps.splice(index, 0, newStep)
    setSteps(newSteps)
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
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
      rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
      samplePayload: samplePayload || undefined,
      color: selectedColor,
      folderId: selectedFolderId,
    }
    onSave(workflowData)
  }

  // Export complete workflow as JSON (includes all data for full import)
  const exportWorkflowJson = () => {
    const workflowData = {
      name: watch('name') || '',
      description: watch('description') || '',
      isActive: watch('isActive'),
      rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
      samplePayload: samplePayload || undefined,
      steps,
      mermaidDiagram: mermaidCode,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    }
    const blob = new Blob([JSON.stringify(workflowData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${watch('name') || 'workflow'}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Import workflow from file (supports both JSON and Mermaid)
  const importWorkflowFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      const content = e.target?.result as string
      const isJson = file.name.endsWith('.json')

      if (isJson) {
        try {
          const data = JSON.parse(content)

          // Apply workflow-level fields
          if (data.name) setValue('name', data.name)
          if (data.description !== undefined) setValue('description', data.description)
          if (data.isActive !== undefined) setValue('isActive', data.isActive)
          if (data.rootTaskTitleTemplate) setRootTaskTitleTemplate(data.rootTaskTitleTemplate)
          if (data.samplePayload) setSamplePayload(data.samplePayload)

          // Apply steps if present
          if (data.steps && Array.isArray(data.steps)) {
            // Normalize steps
            const normalizedSteps = data.steps.map((step: WorkflowStep) => ({
              ...step,
              stepType: step.stepType || 'agent',
              // Preserve the id for round-trip, but generate new ones if missing
              id: step.id || `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            }))
            setSteps(normalizedSteps)
            setExpandedSteps(new Set(normalizedSteps.map((s: WorkflowStep) => s.id)))
          }

          // Apply mermaid diagram if present
          if (data.mermaidDiagram) {
            setMermaidCode(data.mermaidDiagram)
          }

          setActiveTab('visual')
          setSyncError(null)
        } catch (err) {
          setSyncError('Invalid JSON file: ' + (err instanceof Error ? err.message : 'Unknown error'))
        }
      } else {
        // Mermaid file - just update the code and switch to diagram tab
        setMermaidCode(content)
        setActiveTab('code')
        setSyncError(null)
      }
    }
    reader.readAsText(file)

    // Reset the input so the same file can be selected again
    event.target.value = ''
  }

  // Expand/collapse all steps
  const toggleAllSteps = () => {
    if (expandedSteps.size === steps.length) {
      // All expanded, collapse all
      setExpandedSteps(new Set())
    } else {
      // Some or none expanded, expand all
      setExpandedSteps(new Set(steps.map(s => s.id)))
    }
  }

  const getStepTypeInfo = (stepType?: WorkflowStepType) => {
    return STEP_TYPES.find(st => st.type === (stepType || 'task')) || STEP_TYPES[0]
  }

  // Hidden file input ref for import
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-[90vw] w-full max-h-[90vh] overflow-hidden flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {workflow ? 'Edit Workflow' : 'Create New Workflow'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Tabs for Visual/Code/Settings */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Header row: Workflow name, Tabs, Import/Export */}
            <div className="flex items-center justify-between gap-4 pb-3 border-b mb-3">
              <div className="flex items-center gap-4 flex-1">
                {/* Workflow name input inline with header */}
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <Input
                    {...register('name')}
                    placeholder="Workflow name *"
                    className="h-9 text-base font-medium"
                  />
                  {errors.name && (
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  )}
                </div>

                {/* Tabs in header */}
                <TabsList className="h-9">
                  <TabsTrigger value="integrated" className="gap-1.5 h-7">
                    <LayoutPanelLeft className="h-4 w-4" />
                    Visual
                  </TabsTrigger>
                  <TabsTrigger value="visual" className="gap-1.5 h-7">
                    <GripVertical className="h-4 w-4" />
                    Steps
                  </TabsTrigger>
                  <TabsTrigger value="code" className="gap-1.5 h-7">
                    <FileCode className="h-4 w-4" />
                    Code
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="gap-1.5 h-7">
                    <Info className="h-4 w-4" />
                    Settings
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Import/Export buttons */}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.mmd"
                  onChange={importWorkflowFile}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  Import
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={exportWorkflowJson}
                  className="h-9 gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
            </div>

            {/* Sync error display */}
            {syncError && (
              <div className="mb-2 px-2 py-1.5 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {syncError}
              </div>
            )}

            {/* Settings Tab */}
            <TabsContent value="settings" className="flex-1 overflow-hidden mt-0 min-h-0">
              <div className="flex h-full min-h-0">
                {/* Settings Navigation Sidebar */}
                <div className="w-36 flex-shrink-0 border-r pr-2 mr-4 space-y-1 overflow-y-auto">
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => {
                          setActiveSettingsSection(section.id)
                          const el = document.getElementById(`settings-${section.id}`)
                          const container = settingsContainerRef.current
                          if (el && container) {
                            // Calculate the offset of the element within the scroll container
                            const containerTop = container.getBoundingClientRect().top
                            const elementTop = el.getBoundingClientRect().top
                            const scrollOffset = container.scrollTop + (elementTop - containerTop)
                            container.scrollTo({ top: scrollOffset, behavior: 'smooth' })
                          }
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                          activeSettingsSection === section.id
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{section.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Settings Content */}
                <div
                  ref={settingsContainerRef}
                  className="flex-1 overflow-y-auto space-y-4 pr-2 max-w-2xl"
                >
                  {/* General Section */}
                  <div id="settings-general" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      General
                    </h3>
                    <div className="space-y-2">
                      <label className="text-sm">Description</label>
                      <Input
                        {...register('description')}
                        placeholder="Brief description of this workflow"
                      />
                    </div>
                  </div>

                  {/* Title Template Section */}
                  <div id="settings-title" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      Root Task Title Template
                      <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                    </h3>
                    <div className="flex gap-1">
                      <Input
                        value={rootTaskTitleTemplate}
                        onChange={(e) => setRootTaskTitleTemplate(e.target.value)}
                        placeholder={`e.g., "Process Order: {{input.orderId}}"`}
                        className="font-mono text-sm h-9"
                      />
                      <TokenBrowser
                        workflowId={workflow?._id}
                        previousSteps={[]}
                        currentStepIndex={0}
                        onSelectToken={() => {}}
                        fieldLabel="Root Task Title"
                        fieldValue={rootTaskTitleTemplate}
                        onFieldValueChange={setRootTaskTitleTemplate}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Dynamic title for the workflow&apos;s parent task. Use {`{{input.field}}`} for input data.
                      Defaults to &quot;Workflow: {watch('name') || '{name}'}&quot;.
                    </p>
                  </div>

                  {/* Status Section */}
                  <div id="settings-status" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      Status
                    </h3>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="isActive"
                        checked={watch('isActive')}
                        onCheckedChange={(checked) => setValue('isActive', !!checked)}
                      />
                      <label htmlFor="isActive" className="text-sm">
                        Active - workflow can be triggered
                      </label>
                    </div>
                  </div>

                  {/* Organization Section */}
                  <div id="settings-organization" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      Organization
                    </h3>
                    <div className="space-y-2">
                      <label className="text-sm">Folder</label>
                      <div className="flex gap-2">
                        <Select
                          value={selectedFolderId || 'none'}
                          onValueChange={(val) => setSelectedFolderId(val === 'none' ? null : val)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="No folder" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No folder</SelectItem>
                            {folders.map((folder) => (
                              <SelectItem key={folder._id} value={folder._id}>
                                {folder.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isCreatingFolder ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setIsCreatingFolder(true)}
                            title="Create new folder"
                          >
                            <FolderPlus className="h-4 w-4" />
                          </Button>
                        ) : (
                          <div className="flex gap-1">
                            <Input
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              placeholder="Folder name"
                              className="w-32"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newFolderName.trim()) {
                                  e.preventDefault()
                                  createFolderMutation.mutate({ name: newFolderName.trim() })
                                } else if (e.key === 'Escape') {
                                  setIsCreatingFolder(false)
                                  setNewFolderName('')
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              disabled={!newFolderName.trim() || createFolderMutation.isPending}
                              onClick={() => createFolderMutation.mutate({ name: newFolderName.trim() })}
                            >
                              {createFolderMutation.isPending ? '...' : 'Add'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setIsCreatingFolder(false)
                                setNewFolderName('')
                              }}
                            >
                              ✕
                            </Button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Organize workflows into folders for easier navigation
                      </p>
                    </div>
                  </div>

                  {/* Color Section */}
                  <div id="settings-color" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                      Color
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Optional color to identify this workflow in lists
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedColor(undefined)}
                        className={cn(
                          'w-7 h-7 rounded-full border-2 flex items-center justify-center',
                          !selectedColor ? 'border-primary ring-2 ring-primary ring-offset-2' : 'border-muted hover:border-muted-foreground'
                        )}
                        title="No color"
                      >
                        <span className="text-xs text-muted-foreground">✕</span>
                      </button>
                      {[
                        { name: 'Sky', value: '#BAE6FD' },
                        { name: 'Lavender', value: '#DDD6FE' },
                        { name: 'Rose', value: '#FECDD3' },
                        { name: 'Mint', value: '#A7F3D0' },
                        { name: 'Peach', value: '#FED7AA' },
                        { name: 'Coral', value: '#FECACA' },
                        { name: 'Lemon', value: '#FEF08A' },
                        { name: 'Periwinkle', value: '#C7D2FE' },
                        { name: 'Aqua', value: '#99F6E4' },
                        { name: 'Stone', value: '#D6D3D1' },
                      ].map(color => (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => setSelectedColor(color.value)}
                          className={cn(
                            'w-7 h-7 rounded-full border',
                            selectedColor === color.value ? 'ring-2 ring-primary ring-offset-2 border-black/20' : 'border-black/10 hover:border-black/30'
                          )}
                          style={{ backgroundColor: color.value }}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Sample Payload Section */}
                  <div id="settings-payload" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                      Sample Payload
                      <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Define a sample JSON payload that shows what data this workflow expects when triggered.
                    </p>
                    {/* Fill from previous run */}
                    {recentRuns.length > 0 && (
                      <div className="flex items-center gap-2">
                        <History className="h-4 w-4 text-muted-foreground" />
                        <Select
                          onValueChange={(runId) => {
                            const run = recentRuns.find(r => r._id === runId)
                            if (run?.inputPayload) {
                              setSamplePayload(JSON.stringify(run.inputPayload, null, 2))
                            }
                          }}
                        >
                          <SelectTrigger className="flex-1 h-8 text-xs">
                            <SelectValue placeholder="Fill from previous run..." />
                          </SelectTrigger>
                          <SelectContent>
                            {recentRuns.map((run) => (
                              <SelectItem key={run._id} value={run._id}>
                                <span className="font-mono text-xs">
                                  {new Date(run.createdAt).toLocaleDateString()} - {run.status}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <TemplateTextarea
                      value={samplePayload}
                      onChange={setSamplePayload}
                      placeholder={'{\n  "orderId": "ORD-12345",\n  "customerName": "John Doe",\n  "items": [\n    { "sku": "ABC123", "quantity": 2 }\n  ]\n}'}
                      minHeight="120px"
                      maxHeight="300px"
                      showTokenBrowser={false}
                    />
                    <p className="text-xs text-muted-foreground">
                      Access payload fields in templates using {`{{input.fieldName}}`}, e.g., {`{{input.orderId}}`}
                    </p>
                  </div>

                  {/* AI Prompt Helper Section */}
                  <div id="settings-ai-prompt" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      AI Workflow Generation
                    </h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Generate workflow definitions using AI. Copy the prompt below and paste it into your AI tool,
                      or use the context endpoint to build custom integrations.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={async () => {
                          try {
                            const response = await fetch(`${API_BASE}/workflows/ai-prompt?format=mermaid&includeContext=true`, {
                              headers: getAuthHeader(),
                            })
                            const data = await response.json()
                            await navigator.clipboard.writeText(data.data.prompt)
                            // Could add a toast notification here
                          } catch (err) {
                            console.error('Failed to copy AI prompt:', err)
                          }
                        }}
                      >
                        <Sparkles className="h-3 w-3" />
                        Copy AI Prompt (Mermaid)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={async () => {
                          try {
                            const response = await fetch(`${API_BASE}/workflows/ai-prompt?format=json&includeContext=true`, {
                              headers: getAuthHeader(),
                            })
                            const data = await response.json()
                            await navigator.clipboard.writeText(data.data.prompt)
                          } catch (err) {
                            console.error('Failed to copy AI prompt:', err)
                          }
                        }}
                      >
                        <Sparkles className="h-3 w-3" />
                        Copy AI Prompt (JSON)
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      API: <code className="bg-muted px-1 rounded">GET /api/workflows/ai-prompt-context</code> for structured context data.
                    </p>
                  </div>

                  {/* Webhook Trigger Section */}
                  <div id="settings-webhook" className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <ArrowRightFromLine className="h-4 w-4 text-muted-foreground" />
                      Webhook Trigger
                    </h3>
                    <WorkflowWebhook
                      workflowId={workflow?._id}
                      workflowName={watch('name')}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Integrated View Tab - Diagram + Step Config */}
            <TabsContent value="integrated" className="flex-1 mt-0 overflow-hidden min-h-0">
              <IntegratedWorkflowView
                steps={steps}
                workflowId={workflow?._id}
                users={users}
                onStepsChange={(newSteps) => {
                  setSteps(newSteps)
                  // Auto-generate Mermaid when steps change
                  setMermaidCode(generateMermaidFromSteps(newSteps, watch('name')))
                }}
                className="flex-1 min-h-0"
              />
            </TabsContent>

            {/* Visual Editor Tab - context actions */}
            <TabsContent value="visual" className="flex-1 flex flex-col overflow-hidden mt-0">
              {/* Visual tab toolbar */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addStep}
                    className="h-9 gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Step
                  </Button>
                  {steps.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllSteps}
                      className="h-9 gap-1.5 text-muted-foreground"
                    >
                      <ChevronsUpDown className="h-4 w-4" />
                      {expandedSteps.size === steps.length ? 'Collapse All' : 'Expand All'}
                    </Button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {steps.length} step{steps.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Steps list */}
              <div className="flex-1 overflow-auto">
              <div className="space-y-0 p-2 bg-muted/30 rounded-lg">
                {steps.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No steps defined yet.</p>
                    <p className="text-sm">Add steps to build your workflow.</p>
                  </div>
                ) : (
                  (() => {
                    // Compute loop scopes for visual grouping
                    const loopScopes = detectLoopScopes(steps)
                    const stepInLoop = new Map<number, LoopScope>()
                    for (const scope of loopScopes) {
                      for (let i = scope.foreachIndex + 1; i < scope.joinIndex; i++) {
                        stepInLoop.set(i, scope)
                      }
                    }

                    return steps.map((step, index) => {
                      const typeInfo = getStepTypeInfo(step.stepType)
                      const TypeIcon = typeInfo.icon
                      const isExpanded = expandedSteps.has(step.id)
                      const loopScope = stepInLoop.get(index)
                      const isInLoop = !!loopScope
                      const prevStep = index > 0 ? steps[index - 1] : undefined

                      // Check if this step starts or ends a loop scope
                      const startsLoop = loopScopes.some(s => s.foreachIndex === index)
                      const endsLoop = loopScopes.some(s => s.joinIndex === index)

                      return (
                        <div key={step.id} className="relative">
                          {/* Insert button between steps */}
                          {index > 0 && (
                            <div className="flex items-center justify-center py-2 gap-2">
                              <ArrowDown className="h-4 w-4 text-muted-foreground" />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => insertStepAt(index)}
                                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-primary hover:text-primary-foreground"
                                title="Insert step here"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Insert
                              </Button>
                            </div>
                          )}

                          {/* Loop scope start indicator */}
                          {startsLoop && (
                            <div className="mb-1 ml-4 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                              <Repeat className="h-3 w-3" />
                              <span className="font-medium">Loop Start</span>
                            </div>
                          )}

                          <Collapsible
                            open={isExpanded}
                            onOpenChange={() => toggleStepExpanded(step.id)}
                          >
                            <div
                              className={cn(
                                'bg-background rounded-lg border transition-all',
                                step.execution === 'manual' && 'border-purple-300',
                                isInLoop && 'ml-6 border-l-4 border-l-green-400 dark:border-l-green-600',
                                startsLoop && 'border-green-400 dark:border-green-600 border-2',
                                endsLoop && 'border-indigo-400 dark:border-indigo-600 border-2'
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
                                className="h-9"
                              />
                            </div>

                            <Select
                              value={step.stepType}
                              onValueChange={(val) => updateStep(index, { stepType: val as WorkflowStepType })}
                            >
                              <SelectTrigger className="w-[130px] h-9" onClick={(e) => e.stopPropagation()}>
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
                              className="h-9 w-9 p-0 text-destructive"
                              onClick={(e) => { e.stopPropagation(); removeStep(index) }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Step Details (Expanded) - uses unified StepConfigPanel */}
                          <CollapsibleContent>
                            <div className="border-t bg-muted/20">
                              <StepConfigPanel
                                step={step}
                                stepIndex={index}
                                allSteps={steps}
                                workflowId={workflow?._id}
                                users={users}
                                loopScope={loopScope}
                                isInLoop={isInLoop}
                                availableWorkflows={availableWorkflows}
                                loadingWorkflows={loadingWorkflows}
                                onUpdate={(updates) => updateStep(index, updates)}
                                onDelete={() => removeStep(index)}
                                onMoveUp={() => moveStep(index, index - 1)}
                                onMoveDown={() => moveStep(index, index + 1)}
                                onAddStepAfter={() => insertStepAt(index + 1)}
                                onChangeType={(type) => updateStep(index, { stepType: type })}
                              />
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>

                          {/* Loop scope end indicator */}
                          {endsLoop && (
                            <div className="mt-1 ml-4 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400">
                              <Merge className="h-3 w-3" />
                              <span className="font-medium">Loop End - Results Aggregated</span>
                              {step.minSuccessPercent !== undefined && step.minSuccessPercent < 100 && (
                                <span className="font-mono bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                                  proceeds at {step.minSuccessPercent}% complete
                                </span>
                              )}
                            </div>
                          )}

                        </div>
                      )
                    })
                  })()
                )}

              </div>
              </div>
            </TabsContent>

            {/* Mermaid Editor with Live Preview */}
            <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden mt-0">
              {/* Convert to Steps toolbar */}
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={syncMermaidToSteps}
                    disabled={isSyncing || !mermaidCode.trim()}
                    className="gap-1.5"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Converting...
                      </>
                    ) : (
                      <>
                        <ArrowRightFromLine className="h-4 w-4" />
                        Convert to Steps
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Parse Mermaid diagram and create workflow steps
                  </span>
                </div>
                {syncError && (
                  <span className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {syncError}
                  </span>
                )}
              </div>
              <MermaidLiveEditor
                value={mermaidCode}
                onChange={setMermaidCode}
                onError={setMermaidError}
                className="flex-1"
                minHeight="500px"
                initialLayout="split"
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
