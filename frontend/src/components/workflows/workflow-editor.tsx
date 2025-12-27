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
import { IntegratedWorkflowView } from './integrated-workflow-view'
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
  LayoutPanelLeft,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
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
  ArrowRightFromLine,
  ArrowDown,
  Globe,
  Link2,
  Zap,
  Database,
  CornerDownRight,
} from 'lucide-react'
import { TokenBrowser } from './token-browser'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Step types for workflow routing
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - external: External service/webhook call - no prompting, has endpoint config
// - manual: Human-in-the-loop task
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection
// - join: Fan-in aggregation point
// - flow: Delegate to another workflow (nested)
type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow'

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

  // Dynamic title template - supports {{input.field}}, {{item}}, {{_index}}, etc.
  titleTemplate?: string

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

  // Data flow - general (applies to multiple step types)
  inputSource?: string               // Step ID to get input from (default: previous step)
  inputPath?: string                 // JSONPath to extract data from source step

  // Join fields
  awaitTag?: string
  minSuccessPercent?: number       // Percentage of tasks that must succeed (0-100)

  // Shared by ForEach and Join
  expectedCountPath?: string       // JSONPath to expected count from input/external step response

  // Flow fields (nested workflow)
  flowId?: string
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

  // Dynamic title template for the root task - supports {{input.field}} variables
  rootTaskTitleTemplate?: string
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
  { type: 'agent', label: 'Agent', description: 'AI agent task', icon: Bot, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  { type: 'external', label: 'External', description: 'API/webhook call', icon: Globe, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  { type: 'manual', label: 'Manual', description: 'Human task', icon: User, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
  { type: 'decision', label: 'Decision', description: 'Route by condition', icon: GitBranch, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  { type: 'foreach', label: 'ForEach', description: 'Loop over items', icon: Repeat, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  { type: 'join', label: 'Join', description: 'Aggregate results', icon: Merge, color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
  { type: 'flow', label: 'Flow', description: 'Nested workflow', icon: WorkflowIcon, color: 'text-pink-500', bgColor: 'bg-pink-500/10' },
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

// Get available outputs from a step (for variable picker)
function getStepOutputs(step: WorkflowStep): { path: string; description: string }[] {
  const outputs: { path: string; description: string }[] = []

  switch (step.stepType) {
    case 'external':
      outputs.push(
        { path: 'output', description: 'Full webhook response' },
        { path: 'output.data', description: 'Response data field' },
        { path: 'output.status', description: 'Response status' },
      )
      break
    case 'foreach':
      outputs.push(
        { path: step.itemVariable || 'item', description: 'Current loop item' },
        { path: '_index', description: 'Current item index (0-based)' },
        { path: '_total', description: 'Total items in loop' },
      )
      break
    case 'join':
      outputs.push(
        { path: 'aggregatedResults', description: 'Array of all completed task outputs' },
        { path: 'aggregatedResults[0]', description: 'First result' },
        { path: 'completedCount', description: 'Number of completed tasks' },
        { path: 'expectedCount', description: 'Total expected tasks' },
      )
      break
    case 'agent':
    case 'manual':
      outputs.push(
        { path: 'output', description: 'Task output/response' },
        { path: 'output.result', description: 'Result field (if set)' },
        { path: 'metadata', description: 'Full task metadata' },
      )
      break
    case 'decision':
      outputs.push(
        { path: 'selectedBranch', description: 'Which branch was selected' },
        { path: 'condition', description: 'Evaluated condition' },
      )
      break
    default:
      outputs.push({ path: 'output', description: 'Step output' })
  }

  return outputs
}

// Get the full input path with step reference
function buildInputPath(sourceStepId: string | undefined, path: string): string {
  if (!sourceStepId || sourceStepId === 'previous') {
    return path
  }
  if (sourceStepId === 'trigger') {
    return `trigger.${path}`
  }
  return `steps.${sourceStepId}.${path}`
}

// Parse input path to extract source and path
function parseInputPath(inputPath: string | undefined): { source: string; path: string } {
  if (!inputPath) return { source: 'previous', path: '' }

  if (inputPath.startsWith('steps.')) {
    const parts = inputPath.split('.')
    return { source: parts[1], path: parts.slice(2).join('.') }
  }
  if (inputPath.startsWith('trigger.')) {
    return { source: 'trigger', path: inputPath.slice(8) }
  }
  return { source: 'previous', path: inputPath }
}

function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']
  const metadataComments: string[] = []  // Collect metadata comments to add at the end
  const loopScopes = detectLoopScopes(steps)

  // Build a map of which steps are in which loop scope
  const stepLoopScope = new Map<number, LoopScope>()
  for (const scope of loopScopes) {
    // Steps between foreach (exclusive) and join (exclusive) are in the loop
    for (let i = scope.foreachIndex + 1; i < scope.joinIndex; i++) {
      stepLoopScope.set(i, scope)
    }
  }

  // Generate node definitions (no subgraphs - they break mermaid rendering)
  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, '#quot;')
    const isInLoop = stepLoopScope.has(i)

    // Collect step metadata to preserve in comments
    // Exclude fields that are represented in the Mermaid shape itself (id, name, stepType, connections)
    const metadata: Record<string, unknown> = {}

    // Common fields
    if (step.description) metadata.description = step.description
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId
    if (step.inputPath) metadata.inputPath = step.inputPath

    // Agent/manual step fields
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions

    // External step fields
    if (step.externalConfig && Object.keys(step.externalConfig).length > 0) {
      metadata.externalConfig = step.externalConfig
    }

    // Decision step fields
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection

    // ForEach step fields
    if (step.itemsPath) metadata.itemsPath = step.itemsPath
    if (step.itemVariable) metadata.itemVariable = step.itemVariable
    if (step.maxItems) metadata.maxItems = step.maxItems

    // Join step fields
    if (step.awaitTag) metadata.awaitTag = step.awaitTag
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent

    // Shared by ForEach and Join
    if (step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath

    // Flow step fields
    if (step.flowId) metadata.flowId = step.flowId
    if (step.inputMapping && Object.keys(step.inputMapping).length > 0) {
      metadata.inputMapping = step.inputMapping
    }

    // Queue metadata comment if there's any data to preserve (will add at the end)
    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`    %% @step(${nodeId}): ${JSON.stringify(metadata)}`)
    }

    switch (step.stepType) {
      case 'agent':
        lines.push(`    ${nodeId}["${label}"]`)
        break
      case 'external':
        lines.push(`    ${nodeId}{{"${label}"}}`)
        break
      case 'manual':
        lines.push(`    ${nodeId}("${label}")`)
        break
      case 'decision':
        lines.push(`    ${nodeId}{"${label}"}`)
        break
      case 'foreach':
        const itemsPath = step.itemsPath ? ` (${step.itemsPath})` : ''
        lines.push(`    ${nodeId}[["Each: ${label}${itemsPath}"]]`)
        break
      case 'join':
        const pct = step.minSuccessPercent !== undefined ? ` @${step.minSuccessPercent}%` : ''
        lines.push(`    ${nodeId}[["Join: ${label}${pct}"]]`)
        break
      case 'flow':
        lines.push(`    ${nodeId}[["Run: ${label}"]]`)
        break
      default:
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          lines.push(`${nodeId}(["${label}"])`)
        } else {
          lines.push(`    ${nodeId}["${label}"]`)
        }
    }
  })

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

  // Add linear connections
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`
    const nextStep = steps[i + 1]

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = nextStep.id || `step${i + 1}`

      if (step.stepType === 'foreach' && nextStep.stepType === 'join') {
        // Dashed line for parallel execution
        lines.push(`    ${nodeId} -.-> ${nextNodeId}`)
      } else {
        lines.push(`    ${nodeId} --> ${nextNodeId}`)
      }
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
  lines.push('    classDef flow fill:#EC4899,color:#fff,stroke:#DB2777')

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    agent: [],
    external: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    flow: [],
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
      case 'flow':
        classGroups.flow.push(nodeId)
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

  // Add step metadata comments at the end (keeps diagram structure clean at the top)
  if (metadataComments.length > 0) {
    lines.push('')
    lines.push('    %% Step configuration (preserved on import)')
    lines.push(...metadataComments)
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
  const [rootTaskTitleTemplate, setRootTaskTitleTemplate] = useState('')
  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('integrated')
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Available workflows for Flow step type
  const [availableWorkflows, setAvailableWorkflows] = useState<ApiWorkflow[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)

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
      setRootTaskTitleTemplate(workflow.rootTaskTitleTemplate || '')
    } else {
      reset({
        name: '',
        description: '',
        isActive: true,
      })
      setSteps([])
      setMermaidCode('')
      setRootTaskTitleTemplate('')
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
            <TabsContent value="settings" className="flex-1 overflow-auto mt-0">
              <div className="space-y-4 p-4 bg-muted/30 rounded-lg max-w-2xl">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    {...register('description')}
                    placeholder="Brief description of this workflow"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    Root Task Title Template
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
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
                      onSelectToken={(token) => {
                        setRootTaskTitleTemplate(prev => prev + token)
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dynamic title for the workflow&apos;s parent task. Use {`{{input.field}}`} for input data.
                    Defaults to &quot;Workflow: {watch('name') || '{name}'}&quot;.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    id="isActive"
                    checked={watch('isActive')}
                    onCheckedChange={(checked) => setValue('isActive', !!checked)}
                  />
                  <label htmlFor="isActive" className="text-sm font-medium">
                    Active
                  </label>
                </div>

                {/* AI Prompt Helper Section */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    <h3 className="text-sm font-medium">AI Workflow Generation</h3>
                  </div>
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

                          {/* Step Details (Expanded) */}
                          <CollapsibleContent>
                            <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                              {/* Task Title Template - available for all step types */}
                              <div className="space-y-1">
                                <label className="text-sm font-medium flex items-center gap-2">
                                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                  Task Title Template
                                  <span className="text-xs text-muted-foreground">(optional)</span>
                                </label>
                                <div className="flex gap-1">
                                  <Input
                                    value={step.titleTemplate || ''}
                                    onChange={(e) => updateStep(index, { titleTemplate: e.target.value })}
                                    placeholder={`e.g., "Review: {{item.name}}" or "Process {{input.customerName}}"`}
                                    className="font-mono text-sm"
                                  />
                                  <TokenBrowser
                                    workflowId={workflow?._id}
                                    previousSteps={steps.slice(0, index).map(s => ({
                                      id: s.id,
                                      name: s.name,
                                      stepType: s.stepType,
                                      itemVariable: s.itemVariable,
                                    }))}
                                    currentStepIndex={index}
                                    loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                                    onSelectToken={(token) => {
                                      const current = step.titleTemplate || ''
                                      updateStep(index, { titleTemplate: current + token })
                                    }}
                                    variant="text"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Dynamic title for tasks created from this step. Use {`{{input.field}}`} for input data{isInLoop ? `, {{${loopScope?.foreachStep.itemVariable || 'item'}}} for loop items, {{_index}} for position` : ''}.
                                  If empty, uses the step name.
                                </p>
                              </div>

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

                                    {/* Token Browser for instructions */}
                                    <div className="flex items-center gap-2 mt-2">
                                      <TokenBrowser
                                        workflowId={workflow?._id}
                                        previousSteps={steps.slice(0, index).map(s => ({
                                          id: s.id,
                                          name: s.name,
                                          stepType: s.stepType,
                                          itemVariable: s.itemVariable,
                                        }))}
                                        currentStepIndex={index}
                                        loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                                        onSelectToken={(token) => {
                                          const current = step.additionalInstructions || ''
                                          updateStep(index, { additionalInstructions: current + token })
                                        }}
                                        variant="text"
                                      />
                                    </div>
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
                                        <SelectTrigger className="h-9">
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
                                        className="font-mono text-sm h-9"
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
                                    <div className="flex items-center gap-2 mt-1">
                                      <TokenBrowser
                                        workflowId={workflow?._id}
                                        previousSteps={steps.slice(0, index).map(s => ({
                                          id: s.id,
                                          name: s.name,
                                          stepType: s.stepType,
                                          itemVariable: s.itemVariable,
                                        }))}
                                        currentStepIndex={index}
                                        loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                                        onSelectToken={(token) => {
                                          const current = step.externalConfig?.payloadTemplate || ''
                                          updateStep(index, {
                                            externalConfig: { ...step.externalConfig, payloadTemplate: current + token }
                                          })
                                        }}
                                        variant="text"
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        Click to insert token at end of payload
                                      </span>
                                    </div>
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
                                          Iterates over a collection and creates a task for each item.
                                          <strong> You need a step AFTER this</strong> that processes each item.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Warning if no step between ForEach and Join */}
                                  {(() => {
                                    const nextStepIdx = index + 1
                                    const nextStep = steps[nextStepIdx]
                                    if (nextStep?.stepType === 'join') {
                                      return (
                                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-3 text-sm">
                                          <div className="flex items-start gap-2">
                                            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                                            <div className="text-red-800 dark:text-red-200">
                                              <p className="font-medium">Missing Loop Body Step!</p>
                                              <p className="text-xs mt-1">
                                                You need a step between ForEach and Join that processes each item.
                                                Add an Agent or Manual step after this ForEach to handle each {step.itemVariable || 'item'}.
                                              </p>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="mt-2 h-7 text-xs border-red-300 text-red-700 hover:bg-red-100"
                                                onClick={() => {
                                                  const newStep: WorkflowStep = {
                                                    id: `step-${Date.now()}`,
                                                    name: `Process ${step.itemVariable || 'Item'}`,
                                                    stepType: 'agent',
                                                    additionalInstructions: `Process the {{${step.itemVariable || 'item'}}} provided in the input.`,
                                                  }
                                                  const newSteps = [...steps]
                                                  newSteps.splice(index + 1, 0, newStep)
                                                  setSteps(newSteps)
                                                }}
                                              >
                                                <Plus className="h-3 w-3 mr-1" />
                                                Add Processing Step
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    }
                                    return null
                                  })()}

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Items Path
                                        <span className="text-xs text-muted-foreground">(JSONPath)</span>
                                      </label>
                                      <div className="flex gap-1">
                                        <Input
                                          value={step.itemsPath || ''}
                                          onChange={(e) => updateStep(index, { itemsPath: e.target.value })}
                                          placeholder="e.g., output.emails"
                                          className="font-mono text-sm"
                                        />
                                        <TokenBrowser
                                          workflowId={workflow?._id}
                                          previousSteps={steps.slice(0, index).map(s => ({
                                            id: s.id,
                                            name: s.name,
                                            stepType: s.stepType,
                                            itemVariable: s.itemVariable,
                                          }))}
                                          currentStepIndex={index}
                                          onSelectToken={(token) => updateStep(index, { itemsPath: token })}
                                          wrapInBraces={false}
                                        />
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Path to array in previous step&apos;s output
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium flex items-center gap-1">
                                        Item Variable Name
                                      </label>
                                      <Input
                                        value={step.itemVariable || ''}
                                        onChange={(e) => updateStep(index, { itemVariable: e.target.value })}
                                        placeholder="e.g., email, item, record"
                                        className="font-mono text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Use <code className="bg-muted px-1 rounded">{`{{${step.itemVariable || 'item'}}}`}</code> in next steps
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
                                      <div className="flex gap-1">
                                        <Input
                                          value={step.expectedCountPath || ''}
                                          onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
                                          placeholder="e.g., response.totalItems"
                                          className="font-mono text-sm"
                                        />
                                        <TokenBrowser
                                          workflowId={workflow?._id}
                                          previousSteps={steps.slice(0, index).map(s => ({
                                            id: s.id,
                                            name: s.name,
                                            stepType: s.stepType,
                                            itemVariable: s.itemVariable,
                                          }))}
                                          currentStepIndex={index}
                                          onSelectToken={(token) => updateStep(index, { expectedCountPath: token })}
                                          wrapInBraces={false}
                                        />
                                      </div>
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

                                  {/* How completion tracking works */}
                                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-sm">
                                    <div className="flex items-start gap-2">
                                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-blue-800 dark:text-blue-200 text-xs">
                                        <p className="font-medium">How Join Knows Tasks Are Complete</p>
                                        <p className="mt-0.5">
                                          The ForEach step sets <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">expectedCount</code> when spawning tasks.
                                          Each task completion increments <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">completedCount</code>.
                                          Join fires when <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">completedCount/expectedCount &gt;= minSuccess%</code>.
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
                                      <div className="flex gap-1">
                                        <Input
                                          value={step.expectedCountPath || ''}
                                          onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
                                          placeholder="e.g., response.totalItems"
                                          className="font-mono text-sm"
                                        />
                                        <TokenBrowser
                                          workflowId={workflow?._id}
                                          previousSteps={steps.slice(0, index).map(s => ({
                                            id: s.id,
                                            name: s.name,
                                            stepType: s.stepType,
                                            itemVariable: s.itemVariable,
                                          }))}
                                          currentStepIndex={index}
                                          onSelectToken={(token) => updateStep(index, { expectedCountPath: token })}
                                          wrapInBraces={false}
                                        />
                                      </div>
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
                                    <div className="flex gap-1">
                                      <Input
                                        value={step.inputPath || ''}
                                        onChange={(e) => updateStep(index, { inputPath: e.target.value })}
                                        placeholder="e.g., output.analysis or result.data"
                                        className="font-mono text-sm"
                                      />
                                      <TokenBrowser
                                        workflowId={workflow?._id}
                                        previousSteps={steps.slice(0, index).map(s => ({
                                          id: s.id,
                                          name: s.name,
                                          stepType: s.stepType,
                                          itemVariable: s.itemVariable,
                                        }))}
                                        currentStepIndex={index}
                                        loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                                        onSelectToken={(token) => updateStep(index, { inputPath: token })}
                                        wrapInBraces={false}
                                        forJoinInputPath={true}
                                      />
                                    </div>
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
                                          className="h-9 w-9 p-0 text-destructive"
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

                              {/* Flow configuration (nested workflow) */}
                              {step.stepType === 'flow' && (
                                <>
                                  <div className="bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                      <WorkflowIcon className="h-4 w-4 text-pink-600 dark:text-pink-400 mt-0.5 flex-shrink-0" />
                                      <div className="text-pink-800 dark:text-pink-200">
                                        <p className="font-medium">Nested Workflow</p>
                                        <p className="text-xs mt-1">
                                          Delegates execution to another workflow. Input is passed programmatically
                                          and results are returned when the flow completes.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-sm font-medium">Target Workflow</label>
                                    <Select
                                      value={step.flowId || ''}
                                      onValueChange={(value) => updateStep(index, { flowId: value })}
                                    >
                                      <SelectTrigger className="h-9">
                                        <SelectValue placeholder={loadingWorkflows ? 'Loading...' : 'Select a workflow'} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {availableWorkflows.length === 0 && !loadingWorkflows && (
                                          <SelectItem value="_none" disabled>No workflows available</SelectItem>
                                        )}
                                        {availableWorkflows.map((wf) => (
                                          <SelectItem key={wf._id} value={wf._id}>
                                            {wf.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      The workflow to delegate execution to.
                                    </p>
                                  </div>
                                </>
                              )}

                              {/* Input Source - for steps that receive data */}
                              {index > 0 && step.stepType !== 'foreach' && (
                                <div className="space-y-2 border-t pt-3 mt-3">
                                  <div className="flex items-center gap-2">
                                    <Database className="h-4 w-4 text-muted-foreground" />
                                    <label className="text-sm font-medium">Input Data Source</label>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <label className="text-xs text-muted-foreground">From Step</label>
                                      <Select
                                        value={step.inputSource || 'previous'}
                                        onValueChange={(val) => updateStep(index, { inputSource: val })}
                                      >
                                        <SelectTrigger className="h-9 text-sm">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="previous">
                                            <span className="flex items-center gap-2">
                                              <ArrowDown className="h-3 w-3" />
                                              Previous Step ({steps[index - 1]?.name || 'N/A'})
                                            </span>
                                          </SelectItem>
                                          <SelectItem value="trigger">
                                            <span className="flex items-center gap-2">
                                              <Zap className="h-3 w-3" />
                                              Workflow Trigger (initial payload)
                                            </span>
                                          </SelectItem>
                                          {steps.slice(0, index).map((s, i) => (
                                            <SelectItem key={s.id} value={s.id}>
                                              <span className="flex items-center gap-2 text-xs">
                                                {(() => {
                                                  const ti = getStepTypeInfo(s.stepType)
                                                  const Icon = ti.icon
                                                  return <Icon className={cn('h-3 w-3', ti.color)} />
                                                })()}
                                                Step {i + 1}: {s.name}
                                              </span>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-xs text-muted-foreground">Data Path</label>
                                      <div className="flex gap-1">
                                        <Input
                                          value={parseInputPath(step.inputPath).path}
                                          onChange={(e) => {
                                            const newPath = buildInputPath(step.inputSource, e.target.value)
                                            updateStep(index, { inputPath: newPath })
                                          }}
                                          placeholder="e.g., output.data"
                                          className="h-9 text-sm font-mono"
                                        />
                                        <TokenBrowser
                                          workflowId={workflow?._id}
                                          previousSteps={steps.slice(0, index).map(s => ({
                                            id: s.id,
                                            name: s.name,
                                            stepType: s.stepType,
                                            itemVariable: s.itemVariable,
                                          }))}
                                          currentStepIndex={index}
                                          loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                                          onSelectToken={(token) => {
                                            const newPath = buildInputPath(step.inputSource, token)
                                            updateStep(index, { inputPath: newPath })
                                          }}
                                          wrapInBraces={false}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  {step.inputPath && (
                                    <div className="text-xs font-mono bg-muted/50 px-2 py-1 rounded text-muted-foreground">
                                      Full path: {step.inputPath}
                                    </div>
                                  )}
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
