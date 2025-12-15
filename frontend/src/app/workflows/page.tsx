'use client'

import { useState, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table'
import {
  Workflow,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  User,
  Bot,
  Plus,
  Pencil,
  Trash2,
  Copy,
  MoreHorizontal,
  GitBranch,
  Repeat,
  Merge,
  FileText,
  Globe,
  Settings2,
  Hash,
  Calendar,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
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
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/api'

// Lazy-load WorkflowEditor to reduce initial bundle size (includes heavy mermaid dependency)
const WorkflowEditor = dynamic(
  () => import('@/components/workflows/workflow-editor').then(mod => ({ default: mod.WorkflowEditor })),
  {
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    ),
    ssr: false, // Mermaid doesn't work with SSR
  }
)

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Updated step types - aligned with workflow-editor
type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'subflow'

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

  // Non-linear flow connections
  connections?: StepConnection[]

  // Agent step configuration
  additionalInstructions?: string
  defaultAssigneeId?: string

  // External step configuration
  externalConfig?: ExternalConfig

  // Decision step configuration
  defaultConnection?: string

  // ForEach/Join/Subflow fields
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  awaitTag?: string
  subflowId?: string
  inputMapping?: Record<string, string>

  // Legacy compatibility
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
}

interface WorkflowData {
  _id: string
  name: string
  description: string
  isActive: boolean
  steps?: WorkflowStep[]
  stages?: string[]  // Legacy format - simple stage names
  mermaidDiagram?: string
  createdAt: string
  updatedAt?: string
}

interface WorkflowStats {
  runCount: number
  lastRunAt: string | null
  completedCount: number
  failedCount: number
}

interface WorkflowWithStats extends WorkflowData {
  steps: WorkflowStep[]
  stats?: WorkflowStats
}

async function fetchWorkflows(): Promise<{ data: WorkflowData[] }> {
  const response = await authFetch(`${API_BASE}/workflows`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }
  return response.json()
}

async function fetchWorkflowStats(): Promise<{ data: Record<string, WorkflowStats> }> {
  const response = await authFetch(`${API_BASE}/workflows/stats`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflow stats')
  }
  return response.json()
}

async function createWorkflow(data: Partial<WorkflowData>): Promise<{ data: WorkflowData }> {
  const response = await authFetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create workflow')
  return response.json()
}

async function updateWorkflow(id: string, data: Partial<WorkflowData>): Promise<{ data: WorkflowData }> {
  const response = await authFetch(`${API_BASE}/workflows/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update workflow')
  return response.json()
}

async function deleteWorkflow(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/workflows/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete workflow')
}

async function duplicateWorkflow(id: string): Promise<{ data: WorkflowData }> {
  const response = await authFetch(`${API_BASE}/workflows/${id}/duplicate`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('Failed to duplicate workflow')
  return response.json()
}

// Get icon for step type
function getStepIcon(step: WorkflowStep) {
  // Normalize step type - handle legacy 'task' type
  const stepType = step.stepType || (step.execution === 'manual' || step.type === 'manual' ? 'manual' : 'agent')

  switch (stepType) {
    case 'agent':
      return <Bot className="h-4 w-4 text-blue-500" />
    case 'external':
      return <Globe className="h-4 w-4 text-orange-500" />
    case 'manual':
      return <User className="h-4 w-4 text-purple-500" />
    case 'decision':
      return <GitBranch className="h-4 w-4 text-amber-500" />
    case 'foreach':
      return <Repeat className="h-4 w-4 text-green-500" />
    case 'join':
      return <Merge className="h-4 w-4 text-indigo-500" />
    case 'subflow':
      return <Workflow className="h-4 w-4 text-pink-500" />
    default:
      return <Bot className="h-4 w-4 text-blue-500" />
  }
}

// Get step type label
function getStepTypeLabel(step: WorkflowStep): string {
  // Normalize step type - handle legacy 'task' type
  const stepType = step.stepType || (step.execution === 'manual' || step.type === 'manual' ? 'manual' : 'agent')

  switch (stepType) {
    case 'agent':
      return 'Agent'
    case 'external':
      return 'External'
    case 'manual':
      return 'Manual'
    case 'decision':
      return 'Decision'
    case 'foreach':
      return 'ForEach'
    case 'join':
      return 'Join'
    case 'subflow':
      return 'Subflow'
    default:
      return 'Agent'
  }
}

interface WorkflowTaskDefaults {
  assigneeId?: string
  urgency?: 'low' | 'normal' | 'high' | 'urgent'
  tags?: string[]
}

async function startWorkflowRun(
  workflowId: string,
  inputPayload?: Record<string, unknown>,
  taskDefaults?: WorkflowTaskDefaults,
  externalId?: string,
  source?: string
): Promise<{ run: { _id: string } }> {
  const response = await authFetch(`${API_BASE}/workflow-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      inputPayload,
      taskDefaults: taskDefaults && Object.keys(taskDefaults).length > 0 ? taskDefaults : undefined,
      externalId: externalId || undefined,
      source: source || undefined,
    }),
  })
  if (!response.ok) throw new Error('Failed to start workflow')
  return response.json()
}

async function fetchUsers(): Promise<{ data: { _id: string; displayName: string; isAgent?: boolean }[] }> {
  const response = await authFetch(`${API_BASE}/users`)
  if (!response.ok) throw new Error('Failed to fetch users')
  return response.json()
}

// Format relative time
function formatRelativeTime(date: string | null): string {
  if (!date) return 'Never'
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}

// Expanded row content showing steps
function StepsDetail({ workflow }: { workflow: WorkflowWithStats }) {
  if (!workflow.steps || workflow.steps.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground italic">
        No steps defined
      </div>
    )
  }

  return (
    <div className="p-4 bg-muted/30">
      <div className="mb-2 text-sm font-medium text-muted-foreground">Workflow Steps</div>
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {workflow.steps.map((step, index) => {
          const effectiveType = step.stepType || (step.execution === 'manual' || step.type === 'manual' ? 'manual' : 'agent')
          const getBorderStyle = () => {
            switch (effectiveType) {
              case 'agent': return 'border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800'
              case 'external': return 'border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800'
              case 'manual': return 'border-purple-300 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800'
              case 'decision': return 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800'
              case 'foreach': return 'border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800'
              case 'join': return 'border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800'
              case 'subflow': return 'border-pink-300 bg-pink-50 dark:bg-pink-950/30 dark:border-pink-800'
              default: return 'border-gray-200 bg-gray-50 dark:bg-gray-900/30 dark:border-gray-700'
            }
          }
          return (
            <div key={step.id || index} className="flex items-center">
              <div
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 min-w-[120px]',
                  getBorderStyle()
                )}
              >
                <div className="flex items-center gap-2">
                  {getStepIcon(step)}
                  <span className="text-sm font-medium">{step.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs">
                    {getStepTypeLabel(step)}
                  </Badge>
                  {(step.prompt || step.additionalInstructions) && (
                    <span title="Has instructions">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                    </span>
                  )}
                </div>
              </div>
              {index < workflow.steps.length - 1 && (
                <ChevronRight className="h-5 w-5 text-muted-foreground mx-1 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>
      {workflow.description && (
        <div className="mt-3 text-sm text-muted-foreground">
          {workflow.description}
        </div>
      )}
    </div>
  )
}

export default function WorkflowsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<WorkflowData | null>(null)
  const [runDialog, setRunDialog] = useState<{ open: boolean; workflow: WorkflowData | null }>({
    open: false,
    workflow: null,
  })
  const [runPayload, setRunPayload] = useState('')
  const [runAssignee, setRunAssignee] = useState('')
  const [runUrgency, setRunUrgency] = useState('')
  const [runTags, setRunTags] = useState('')
  const [runExternalId, setRunExternalId] = useState('')
  const [runSource, setRunSource] = useState('')

  const { data: workflowsData, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  })

  const { data: statsData } = useQuery({
    queryKey: ['workflow-stats'],
    queryFn: fetchWorkflowStats,
    staleTime: 30000, // Cache for 30 seconds
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const users = usersData?.data || []
  const statsMap = statsData?.data || {}

  const createMutation = useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      closeEditor()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkflowData> }) =>
      updateWorkflow(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      closeEditor()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setDeleteConfirm(null)
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: duplicateWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
  })

  const runMutation = useMutation({
    mutationFn: ({
      workflowId,
      inputPayload,
      taskDefaults,
      externalId,
      source,
    }: {
      workflowId: string
      inputPayload?: Record<string, unknown>
      taskDefaults?: WorkflowTaskDefaults
      externalId?: string
      source?: string
    }) => startWorkflowRun(workflowId, inputPayload, taskDefaults, externalId, source),
    onSuccess: (data) => {
      setRunDialog({ open: false, workflow: null })
      resetRunForm()
      queryClient.invalidateQueries({ queryKey: ['workflow-stats'] })
      router.push(`/workflow-runs/${data.run._id}`)
    },
  })

  const resetRunForm = () => {
    setRunPayload('')
    setRunAssignee('')
    setRunUrgency('')
    setRunTags('')
    setRunExternalId('')
    setRunSource('')
  }

  const handleRunWorkflow = () => {
    if (!runDialog.workflow) return

    let payload: Record<string, unknown> | undefined
    if (runPayload.trim()) {
      try {
        payload = JSON.parse(runPayload)
      } catch {
        alert('Invalid JSON payload')
        return
      }
    }

    // Build task defaults
    const taskDefaults: WorkflowTaskDefaults = {}
    if (runAssignee) taskDefaults.assigneeId = runAssignee
    if (runUrgency) taskDefaults.urgency = runUrgency as WorkflowTaskDefaults['urgency']
    if (runTags.trim()) taskDefaults.tags = runTags.split(',').map(t => t.trim()).filter(Boolean)

    runMutation.mutate({
      workflowId: runDialog.workflow._id,
      inputPayload: payload,
      taskDefaults: Object.keys(taskDefaults).length > 0 ? taskDefaults : undefined,
      externalId: runExternalId.trim() || undefined,
      source: runSource.trim() || undefined,
    })
  }

  // Normalize workflows to ensure steps array exists and add stats
  const workflows: WorkflowWithStats[] = (workflowsData?.data || []).map(w => ({
    ...w,
    steps: (w.steps || (w.stages?.map((name, i) => ({
      id: `stage-${i}`,
      name,
      type: 'manual' as const,
      hitlPhase: 'none',
    })) || [])) as WorkflowStep[],
    stats: statsMap[w._id],
  }))

  const openCreateEditor = () => {
    setEditingWorkflow(null)
    setIsEditorOpen(true)
  }

  const openEditEditor = (workflow: WorkflowData) => {
    setEditingWorkflow(workflow)
    setIsEditorOpen(true)
  }

  const closeEditor = () => {
    setIsEditorOpen(false)
    setEditingWorkflow(null)
  }

  const handleSave = (workflow: {
    _id?: string
    name: string
    description: string
    isActive: boolean
    steps?: WorkflowStep[]
    mermaidDiagram?: string
  }) => {
    if (workflow._id) {
      updateMutation.mutate({ id: workflow._id, data: workflow })
    } else {
      createMutation.mutate(workflow)
    }
  }

  const handleToggleActive = (workflow: WorkflowData) => {
    updateMutation.mutate({
      id: workflow._id,
      data: { isActive: !workflow.isActive },
    })
  }

  // Table columns
  const columns: ColumnDef<WorkflowWithStats>[] = [
    {
      id: 'expander',
      header: () => null,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={(e) => {
            e.stopPropagation()
            row.toggleExpanded()
          }}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Workflow',
      cell: ({ row }) => (
        <div className="font-medium">{row.original.name}</div>
      ),
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={cn(
            'cursor-pointer',
            row.original.isActive
              ? 'text-green-600 border-green-600'
              : 'text-gray-500 border-gray-500'
          )}
          onClick={(e) => {
            e.stopPropagation()
            handleToggleActive(row.original)
          }}
        >
          {row.original.isActive ? (
            <>
              <Play className="mr-1 h-3 w-3" />
              Active
            </>
          ) : (
            <>
              <Pause className="mr-1 h-3 w-3" />
              Inactive
            </>
          )}
        </Badge>
      ),
    },
    {
      id: 'steps',
      header: 'Steps',
      cell: ({ row }) => {
        const steps = row.original.steps
        const agentCount = steps.filter(
          (s) => s.stepType === 'agent' || (!s.stepType && s.execution !== 'manual' && s.type !== 'manual')
        ).length
        const manualCount = steps.filter(
          (s) => s.stepType === 'manual' || (!s.stepType && (s.execution === 'manual' || s.type === 'manual'))
        ).length
        const otherCount = steps.length - agentCount - manualCount

        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{steps.length}</span>
            {agentCount > 0 && (
              <span className="text-blue-600 flex items-center gap-1">
                <Bot className="h-3 w-3" />
                {agentCount}
              </span>
            )}
            {manualCount > 0 && (
              <span className="text-purple-600 flex items-center gap-1">
                <User className="h-3 w-3" />
                {manualCount}
              </span>
            )}
            {otherCount > 0 && (
              <span className="text-gray-500">+{otherCount}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'runs',
      header: 'Runs',
      cell: ({ row }) => {
        const stats = row.original.stats
        if (!stats || stats.runCount === 0) {
          return <span className="text-muted-foreground">-</span>
        }
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3 text-muted-foreground" />
              {stats.runCount}
            </span>
            {stats.completedCount > 0 && (
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {stats.completedCount}
              </span>
            )}
            {stats.failedCount > 0 && (
              <span className="text-red-600 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {stats.failedCount}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'lastRun',
      header: 'Last Run',
      cell: ({ row }) => {
        const stats = row.original.stats
        if (!stats || !stats.lastRunAt) {
          return <span className="text-muted-foreground">Never</span>
        }
        return (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatRelativeTime(stats.lastRunAt)}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.original.isActive && (
              <>
                <DropdownMenuItem onClick={() => setRunDialog({ open: true, workflow: row.original })}>
                  <Play className="mr-2 h-4 w-4" />
                  Run Workflow
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => openEditEditor(row.original)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicateMutation.mutate(row.original._id)}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setDeleteConfirm(row.original)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const table = useReactTable({
    data: workflows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">
            Define and manage AI workflow pipelines with automated and manual steps
          </p>
        </div>
        <Button onClick={openCreateEditor}>
          <Plus className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load workflows</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['workflows'] })}
          >
            Retry
          </Button>
        </div>
      ) : workflows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Workflow className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No workflows yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your first workflow to define AI task pipelines with prompts for each stage.
          </p>
          <Button className="mt-4" onClick={openCreateEditor}>
            <Plus className="mr-2 h-4 w-4" />
            Create Workflow
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map(row => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => row.toggleExpanded()}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="p-0">
                        <StepsDetail workflow={row.original} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Workflow Editor Modal */}
      <WorkflowEditor
        workflow={editingWorkflow}
        isOpen={isEditorOpen}
        onClose={closeEditor}
        onSave={handleSave}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteConfirm?.name}&rdquo;? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm._id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Run Workflow Dialog */}
      <Dialog open={runDialog.open} onOpenChange={(open) => {
        if (!open) {
          setRunDialog({ open: false, workflow: null })
          resetRunForm()
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Workflow: {runDialog.workflow?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Task Defaults */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Task Defaults
              </h4>
              <p className="text-xs text-muted-foreground">
                These settings apply to all tasks created in this workflow run.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Assignee</label>
                  <Select value={runAssignee || "none"} onValueChange={(v) => setRunAssignee(v === "none" ? "" : v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select assignee..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No default assignee</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user._id} value={user._id}>
                          {user.displayName} {user.isAgent && '(Agent)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Urgency</label>
                  <Select value={runUrgency || "none"} onValueChange={(v) => setRunUrgency(v === "none" ? "" : v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select urgency..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No default urgency</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Tags</label>
                <Input
                  value={runTags}
                  onChange={(e) => setRunTags(e.target.value)}
                  placeholder="tag1, tag2, tag3"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Comma-separated list of tags to apply to all tasks.
                </p>
              </div>
            </div>

            {/* Collapsible Advanced Options */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                Advanced Options
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">External ID</label>
                    <Input
                      value={runExternalId}
                      onChange={(e) => setRunExternalId(e.target.value)}
                      placeholder="External reference..."
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      ID for correlating with external systems.
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Source</label>
                    <Input
                      value={runSource}
                      onChange={(e) => setRunSource(e.target.value)}
                      placeholder="e.g., api, webhook, ui"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Where this run was triggered from.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Input Payload (JSON)</label>
                  <Textarea
                    value={runPayload}
                    onChange={(e) => setRunPayload(e.target.value)}
                    placeholder='{"key": "value"}'
                    className="mt-1 font-mono text-sm"
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Custom data that flows through the workflow steps.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setRunDialog({ open: false, workflow: null })
              resetRunForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleRunWorkflow} disabled={runMutation.isPending}>
              <Play className="mr-2 h-4 w-4" />
              {runMutation.isPending ? 'Starting...' : 'Start Run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
