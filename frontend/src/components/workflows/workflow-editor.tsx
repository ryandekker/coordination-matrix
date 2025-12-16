'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useUsers } from '@/hooks/use-tasks'
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
  ArrowDown,
  Globe,
  Link2,
  Zap,
  Database,
  CornerDownRight,
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
  expectedCountPath?: string  // JSONPath to get expected count from input (alternative to items.length)

  // Data flow - general (applies to multiple step types)
  inputPath?: string               // JSONPath to extract data from previous step(s)

  // Join fields
  awaitTag?: string
  minSuccessPercent?: number       // Percentage of tasks that must succeed (0-100)
  // Note: expectedCountPath is shared with ForEach (defined above)

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

// Detect loop scopes (ForEach → Join boundaries)
interface LoopScope {
  foreachIndex: number
  joinIndex: number
  foreachStep: WorkflowStep
  joinStep: WorkflowStep
}

function detectLoopScopes(steps: WorkflowStep[]): LoopScope[] {
  const scopes: LoopScope[] = []
  const foreachStack: { index: number; step: WorkflowStep }[] = []

  steps.forEach((step, index) => {
    if (step.stepType === 'foreach') {
      foreachStack.push({ index, step })
    } else if (step.stepType === 'join' && foreachStack.length > 0) {
      // Match this join with the most recent foreach
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

// Get data flow description for a step
function getDataFlowDescription(step: WorkflowStep, prevStep?: WorkflowStep): { input?: string; output?: string } {
  const result: { input?: string; output?: string } = {}

  // Determine input
  if (step.stepType === 'foreach' && step.itemsPath) {
    result.input = `items from: ${step.itemsPath}`
  } else if (step.stepType === 'join') {
    if (step.inputPath) {
      result.input = `aggregate: ${step.inputPath}`
    } else {
      result.input = 'aggregate all results'
    }
  } else if (step.inputPath) {
    result.input = step.inputPath
  } else if (prevStep) {
    result.input = 'previous output'
  }

  // Determine output
  if (step.stepType === 'foreach') {
    result.output = step.itemVariable ? `{{${step.itemVariable}}}` : '{{item}}'
  } else if (step.stepType === 'join') {
    result.output = 'aggregatedResults[]'
  } else if (step.stepType === 'external') {
    result.output = 'webhook response'
  } else if (step.stepType === 'agent' || step.stepType === 'manual') {
    result.output = 'task output'
  } else if (step.stepType === 'decision') {
    result.output = 'routes to branch'
  }

  return result
}

function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']
  const loopScopes = detectLoopScopes(steps)

  // Build a map of which steps are in which loop scope
  const stepLoopScope = new Map<number, LoopScope>()
  for (const scope of loopScopes) {
    // Steps between foreach (exclusive) and join (exclusive) are in the loop
    for (let i = scope.foreachIndex + 1; i < scope.joinIndex; i++) {
      stepLoopScope.set(i, scope)
    }
  }

  // Track which steps are already rendered in subgraphs
  const renderedInSubgraph = new Set<number>()

  // Generate node definitions with subgraphs for loops
  let currentScopeId: string | null = null

  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, '#quot;')
    const scope = stepLoopScope.get(i)
    const scopeId = scope ? scope.foreachStep.id : null

    // Handle subgraph transitions
    if (scopeId !== currentScopeId) {
      if (currentScopeId !== null) {
        lines.push('    end')
      }
      if (scopeId !== null) {
        const foreachName = scope?.foreachStep.name.replace(/"/g, '') || 'Loop'
        const itemVar = scope?.foreachStep.itemVariable || 'item'
        lines.push(`    subgraph loop_${scopeId}["🔄 Loop: ${foreachName}"]`)
        lines.push(`    direction TB`)
      }
      currentScopeId = scopeId
    }

    const indent = scopeId ? '        ' : '    '

    switch (step.stepType) {
      case 'agent':
        lines.push(`${indent}${nodeId}["${label}"]`)
        break
      case 'external':
        lines.push(`${indent}${nodeId}{{"Trigger: ${label}"}}`)
        break
      case 'manual':
        lines.push(`${indent}${nodeId}("${label}")`)
        break
      case 'decision':
        lines.push(`${indent}${nodeId}{"${label}"}`)
        break
      case 'foreach':
        const itemsPath = step.itemsPath ? ` (${step.itemsPath})` : ''
        lines.push(`${indent}${nodeId}[["Each: ${label}${itemsPath}"]]`)
        break
      case 'join':
        const pct = step.minSuccessPercent !== undefined ? ` @${step.minSuccessPercent}%` : ''
        lines.push(`${indent}${nodeId}[["Join: ${label}${pct}"]]`)
        break
      case 'subflow':
        lines.push(`${indent}${nodeId}[["Run: ${label}"]]`)
        break
      default:
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          lines.push(`${indent}${nodeId}(["${label}"])`)
        } else {
          lines.push(`${indent}${nodeId}["${label}"]`)
        }
    }
  })

  // Close any open subgraph
  if (currentScopeId !== null) {
    lines.push('    end')
  }

  // Generate connections with data flow labels
  lines.push('')
  const connectedFrom = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`
    const nextStep = steps[i + 1]

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

  // Add linear connections with data flow annotations
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`
    const nextStep = steps[i + 1]

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = nextStep.id || `step${i + 1}`

      // Add data flow label for key transitions
      let edgeLabel = ''
      if (step.stepType === 'foreach') {
        edgeLabel = step.itemVariable ? `|"{{${step.itemVariable}}}"| ` : '|"{{item}}"| '
      } else if (step.stepType === 'external' && nextStep.stepType === 'foreach') {
        const itemsPath = nextStep.itemsPath || 'response'
        edgeLabel = `|"${itemsPath}"| `
      } else if (step.stepType === 'join') {
        edgeLabel = '|"aggregatedResults"| '
      }

      lines.push(`    ${nodeId} -->${edgeLabel}${nextNodeId}`)
    }
  }

  // Add styling classes with distinct colors
  lines.push('')
  lines.push('    classDef agent fill:#3B82F6,color:#fff,stroke:#2563EB')
  lines.push('    classDef external fill:#F97316,color:#fff,stroke:#EA580C')
  lines.push('    classDef manual fill:#8B5CF6,color:#fff,stroke:#7C3AED')
  lines.push('    classDef decision fill:#F59E0B,color:#fff,stroke:#D97706')
  lines.push('    classDef foreach fill:#10B981,color:#fff,stroke:#059669')
  lines.push('    classDef join fill:#6366F1,color:#fff,stroke:#4F46E5')
  lines.push('    classDef subflow fill:#EC4899,color:#fff,stroke:#DB2777')

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

  // Add step configuration as comments (preserved on import)
  lines.push('')
  lines.push('    %% Step configuration (preserved on import)')
  steps.forEach((step) => {
    const config: Record<string, unknown> = {}

    if (step.description) config.description = step.description
    if (step.additionalInstructions) config.additionalInstructions = step.additionalInstructions
    if (step.defaultAssigneeId) config.defaultAssigneeId = step.defaultAssigneeId
    if (step.inputPath) config.inputPath = step.inputPath

    // External config
    if (step.externalConfig && Object.keys(step.externalConfig).length > 0) {
      config.externalConfig = step.externalConfig
    }

    // ForEach config
    if (step.stepType === 'foreach') {
      if (step.itemsPath) config.itemsPath = step.itemsPath
      if (step.itemVariable) config.itemVariable = step.itemVariable
      if (step.maxItems) config.maxItems = step.maxItems
      if (step.expectedCountPath) config.expectedCountPath = step.expectedCountPath
    }

    // Join config
    if (step.stepType === 'join') {
      if (step.awaitTag) config.awaitTag = step.awaitTag
      if (step.minSuccessPercent !== undefined) config.minSuccessPercent = step.minSuccessPercent
      if (step.expectedCountPath) config.expectedCountPath = step.expectedCountPath
    }

    // Subflow config
    if (step.stepType === 'subflow') {
      if (step.subflowId) config.subflowId = step.subflowId
      if (step.inputMapping) config.inputMapping = step.inputMapping
    }

    // Decision connections are already in the diagram edges, but save for reference
    if (step.connections && step.connections.length > 0) {
      config.connections = step.connections
    }

    if (Object.keys(config).length > 0) {
      lines.push(`    %% @step(${step.id}): ${JSON.stringify(config)}`)
    }
  })

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

  // Fetch users for default assignee dropdown
  const { data: usersData } = useUsers()
  const users = usersData?.data || []

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
      <DialogContent className="max-w-[90vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
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

          {/* Tabs for Visual/Code */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <TabsList>
                <TabsTrigger value="visual" className="gap-2">
                  <GripVertical className="h-4 w-4" />
                  Steps
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2">
                  <FileCode className="h-4 w-4" />
                  Diagram
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
                      const nextStep = index < steps.length - 1 ? steps[index + 1] : undefined
                      const dataFlow = getDataFlowDescription(step, prevStep)

                      // Check if this step starts or ends a loop scope
                      const startsLoop = loopScopes.some(s => s.foreachIndex === index)
                      const endsLoop = loopScopes.some(s => s.joinIndex === index)
                      const isFirstInLoop = loopScopes.some(s => s.foreachIndex + 1 === index)
                      const isLastInLoop = loopScopes.some(s => s.joinIndex - 1 === index)

                      return (
                        <div key={step.id} className="relative">
                          {/* Data flow indicator from previous step */}
                          {index > 0 && (
                            <div className="flex items-center justify-center py-1">
                              <div className="flex flex-col items-center text-xs text-muted-foreground">
                                <ArrowDown className="h-4 w-4" />
                                {dataFlow.input && (
                                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded mt-0.5">
                                    {dataFlow.input}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Loop scope start indicator */}
                          {startsLoop && (
                            <div className="mb-1 ml-4 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                              <Repeat className="h-3 w-3" />
                              <span className="font-medium">Loop Start</span>
                              {step.itemsPath && (
                                <span className="font-mono bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded">
                                  iterating: {step.itemsPath}
                                </span>
                              )}
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
                                <div className="space-y-3">
                                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-blue-800 dark:text-blue-200">
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
                                      <User className="h-4 w-4 text-muted-foreground" />
                                      Default Assignee
                                      <span className="text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <Select
                                      value={step.defaultAssigneeId || '_none'}
                                      onValueChange={(val) => updateStep(index, { defaultAssigneeId: val === '_none' ? undefined : val })}
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select default assignee" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="_none">No default assignee</SelectItem>
                                        {users.map((user: { _id: string; displayName: string }) => (
                                          <SelectItem key={user._id} value={user._id}>
                                            {user.displayName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      Tasks created from this step will be assigned to this user by default
                                    </p>
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

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <Download className="h-4 w-4 text-muted-foreground" />
                                      Input Path
                                      <span className="text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <Input
                                      value={step.inputPath || ''}
                                      onChange={(e) => updateStep(index, { inputPath: e.target.value })}
                                      placeholder="e.g., output.analysis or aggregatedResults"
                                      className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      JSONPath to extract from the previous step&apos;s output. The extracted data is passed to the agent.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* External step configuration */}
                              {step.stepType === 'external' && (
                                <div className="space-y-3">
                                  <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Globe className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-orange-800 dark:text-orange-200">
                                        <p className="font-medium">External Service Call</p>
                                        <p className="text-xs mt-1">
                                          This step calls an external API or webhook. Configure the endpoint and request details below.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Callback URL info for async flows */}
                                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-blue-800 dark:text-blue-200">
                                        <p className="font-medium">Callback URL (for async responses)</p>
                                        <p className="text-xs mt-1 mb-2">
                                          If the external service needs to send results back asynchronously (e.g., ActivePieces),
                                          include these template variables in your payload:
                                        </p>
                                        <div className="bg-muted/60 rounded p-2 font-mono text-xs space-y-1">
                                          <p><span className="text-blue-600">{"{{systemWebhookUrl}}"}</span> - Webhook endpoint URL</p>
                                          <p><span className="text-blue-600">{"{{callbackSecret}}"}</span> - Auth token for callback</p>
                                          <p><span className="text-blue-600">{"{{workflowRunId}}"}</span> - Current workflow run ID</p>
                                          <p><span className="text-blue-600">{"{{stepId}}"}</span> - This step&apos;s ID</p>
                                          <p><span className="text-blue-600">{"{{taskId}}"}</span> - Current task ID</p>
                                        </div>
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
  "callbackUrl": "{{systemWebhookUrl}}",
  "callbackSecret": "{{callbackSecret}}",
  "workflowRunId": "{{workflowRunId}}",
  "stepId": "{{stepId}}",
  "taskId": "{{taskId}}",
  "data": "{{input.previousStep.output}}"
}`}
                                      className="min-h-[100px] font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Use {"{{input.path.to.value}}"} to reference data from previous steps
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Manual step configuration */}
                              {step.stepType === 'manual' && (
                                <div className="space-y-3">
                                  <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <User className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-purple-800 dark:text-purple-200">
                                        <p className="font-medium">Human Task</p>
                                        <p className="text-xs mt-1">
                                          This step requires human review or action. The task will wait for a person to complete it.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <User className="h-4 w-4 text-muted-foreground" />
                                      Default Assignee
                                      <span className="text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <Select
                                      value={step.defaultAssigneeId || '_none'}
                                      onValueChange={(val) => updateStep(index, { defaultAssigneeId: val === '_none' ? undefined : val })}
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select default assignee" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="_none">No default assignee</SelectItem>
                                        {users.map((user: { _id: string; displayName: string }) => (
                                          <SelectItem key={user._id} value={user._id}>
                                            {user.displayName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      Tasks created from this step will be assigned to this user by default
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* ForEach configuration */}
                              {step.stepType === 'foreach' && (
                                <>
                                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Repeat className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-green-800 dark:text-green-200">
                                        <p className="font-medium">Loop Configuration</p>
                                        <p className="text-xs mt-1">
                                          This step iterates over a collection from the previous step&apos;s output
                                          and creates a subtask for each item. Routing is determined programmatically.
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
                                        Variable name available to downstream steps
                                      </p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium">Max Items</label>
                                      <Input
                                        type="number"
                                        value={step.maxItems || ''}
                                        onChange={(e) => updateStep(index, { maxItems: parseInt(e.target.value) || undefined })}
                                        placeholder="100 (default)"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Safety limit to prevent runaway loops
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Expected Count Path
                                        <span className="text-xs text-muted-foreground">(optional)</span>
                                      </label>
                                      <Input
                                        value={step.expectedCountPath || ''}
                                        onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
                                        placeholder="e.g., response.totalItems"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        JSONPath to expected count from input payload (overrides items.length)
                                      </p>
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Join configuration */}
                              {step.stepType === 'join' && (
                                <>
                                  <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Merge className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-indigo-800 dark:text-indigo-200">
                                        <p className="font-medium">Join / Aggregation Point</p>
                                        <p className="text-xs mt-1">
                                          Waits for parallel tasks from a ForEach loop and aggregates results.
                                          Works with routers inside loops - collects from <strong>all branches</strong>, not just one path.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Multi-branch collection info */}
                                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2 text-sm">
                                    <div className="flex items-start gap-2">
                                      <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-amber-800 dark:text-amber-200 text-xs">
                                        <p className="font-medium">Works with Routers</p>
                                        <p className="mt-0.5">
                                          If there&apos;s a Decision/Router inside the loop, results from ALL branches
                                          are collected. Tasks are matched by the ForEach tag, regardless of which branch processed them.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Min Success %
                                        <span className="text-xs text-muted-foreground">(optional)</span>
                                      </label>
                                      <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={step.minSuccessPercent ?? ''}
                                        onChange={(e) => updateStep(index, {
                                          minSuccessPercent: e.target.value ? parseInt(e.target.value) : undefined
                                        })}
                                        placeholder="100"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Proceed when this % of tasks complete (default: 100%)
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Expected Count Path
                                        <span className="text-xs text-muted-foreground">(optional)</span>
                                      </label>
                                      <Input
                                        value={step.expectedCountPath || ''}
                                        onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
                                        placeholder="e.g., response.totalItems"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        JSONPath to expected count from external step response
                                      </p>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-1">
                                      Input Path
                                      <span className="text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <Input
                                      value={step.inputPath || ''}
                                      onChange={(e) => updateStep(index, { inputPath: e.target.value })}
                                      placeholder="e.g., output.analysis or result.data"
                                      className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      JSONPath to extract from each completed task. Results are aggregated into an array.
                                    </p>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium flex items-center gap-1">
                                      Await Tag Pattern
                                      <span className="text-xs text-muted-foreground">(usually auto-detected)</span>
                                    </label>
                                    <Input
                                      value={step.awaitTag || ''}
                                      onChange={(e) => updateStep(index, { awaitTag: e.target.value })}
                                      placeholder="Auto-detects from ForEach step"
                                      className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      Leave empty to auto-detect tasks from the preceding ForEach step.
                                    </p>
                                  </div>
                                </>
                              )}

                              {/* Decision configuration */}
                              {step.stepType === 'decision' && (
                                <>
                                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-amber-800 dark:text-amber-200">
                                        <p className="font-medium">Decision / Router</p>
                                        <p className="text-xs mt-1">
                                          Routes to different branches based on conditions. All branches can converge
                                          back to the same Join step for aggregation.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Connections Editor */}
                                  <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-2">
                                      <CornerDownRight className="h-4 w-4 text-muted-foreground" />
                                      Branch Routes
                                    </label>

                                    {(step.connections || []).map((conn, connIdx) => (
                                      <div key={connIdx} className="flex items-center gap-2 pl-4 border-l-2 border-amber-300">
                                        <Input
                                          value={conn.condition || conn.label || ''}
                                          onChange={(e) => {
                                            const newConns = [...(step.connections || [])]
                                            newConns[connIdx] = { ...newConns[connIdx], condition: e.target.value, label: e.target.value }
                                            updateStep(index, { connections: newConns })
                                          }}
                                          placeholder="e.g., output.category === 'urgent'"
                                          className="font-mono text-sm flex-1"
                                        />
                                        <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        <Select
                                          value={conn.targetStepId}
                                          onValueChange={(val) => {
                                            const newConns = [...(step.connections || [])]
                                            newConns[connIdx] = { ...newConns[connIdx], targetStepId: val }
                                            updateStep(index, { connections: newConns })
                                          }}
                                        >
                                          <SelectTrigger className="w-[180px]">
                                            <SelectValue placeholder="Select target" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {steps.filter((_, i) => i > index).map(s => (
                                              <SelectItem key={s.id} value={s.id}>
                                                {s.name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 text-destructive"
                                          onClick={() => {
                                            const newConns = (step.connections || []).filter((_, i) => i !== connIdx)
                                            updateStep(index, { connections: newConns })
                                          }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ))}

                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const newConns = [...(step.connections || []), { targetStepId: '', condition: '' }]
                                        updateStep(index, { connections: newConns })
                                      }}
                                      className="ml-4"
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      Add Branch
                                    </Button>
                                  </div>

                                  {/* Info about loops */}
                                  {isInLoop && (
                                    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
                                      <div className="flex items-start gap-2">
                                        <Repeat className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                                        <div className="text-green-800 dark:text-green-200">
                                          <p className="font-medium">Router Inside Loop</p>
                                          <p className="text-xs mt-1">
                                            All branches will be executed for each loop item. Results from all branches
                                            are collected by the Join step - they don&apos;t need to converge to a single path.
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">
                                      Tip: You can also define branches in the Mermaid diagram tab:
                                    </p>
                                    <div className="bg-muted/50 rounded p-2 font-mono text-xs space-y-1">
                                      <p>Router --&gt;|&quot;output.category === &apos;urgent&apos;&quot;| UrgentHandler</p>
                                      <p>Router --&gt;|&quot;default&quot;| NormalHandler</p>
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Subflow configuration */}
                              {step.stepType === 'subflow' && (
                                <>
                                  <div className="bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <WorkflowIcon className="h-4 w-4 text-pink-600 dark:text-pink-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-pink-800 dark:text-pink-200">
                                        <p className="font-medium">Subflow / Nested Workflow</p>
                                        <p className="text-xs mt-1">
                                          Delegates execution to another workflow. Input is passed programmatically
                                          and results are returned when the subflow completes.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

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
                                </>
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

                          {/* Data output indicator */}
                          {dataFlow.output && index < steps.length - 1 && (
                            <div className="flex justify-center pt-1">
                              <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                                outputs: {dataFlow.output}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })
                  })()
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

            {/* Mermaid Editor with Live Preview */}
            <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden mt-0">
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
