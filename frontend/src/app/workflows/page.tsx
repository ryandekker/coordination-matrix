'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  RowSelectionState,
} from '@tanstack/react-table'
import {
  Workflow,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  User,
  Users,
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
  CheckCircle2,
  XCircle,
  Search,
  X,
  Book,
  Folder,
  FolderOpen,
  Circle,
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
import { authFetch, Group, SYSTEM_USER_ID } from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { useGroupContext } from '@/lib/group-context'
import { useAuth } from '@/lib/auth'

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

// Lazy-load API docs dialog
const WorkflowApiDocs = dynamic(
  () => import('@/components/workflows/workflow-api-docs').then(mod => ({ default: mod.WorkflowApiDocs })),
  { ssr: false }
)

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Updated step types - aligned with workflow-editor
type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument' | 'code'

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

  // ForEach/Join/Flow fields
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  awaitTag?: string
  flowId?: string
  inputMapping?: Record<string, string>

  // Legacy compatibility
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
}

interface StepCounts {
  total: number
  agent: number
  manual: number
  other: number
}

interface WorkflowFolder {
  _id: string
  name: string
  description?: string
  sortOrder: number
  isExpanded: boolean
}

interface WorkflowData {
  _id: string
  name: string
  description: string
  isActive: boolean
  steps?: WorkflowStep[]
  stages?: string[]  // Legacy format - simple stage names
  mermaidDiagram?: string
  folderId?: string | null
  groupId?: string | null
  color?: string
  createdAt: string
  updatedAt?: string
}

// Brief workflow data (without full steps array)
interface BriefWorkflowData {
  _id: string
  name: string
  description: string
  isActive: boolean
  stepCounts: StepCounts
  mermaidDiagram?: string
  folderId?: string | null
  groupId?: string | null
  color?: string
  createdAt: string
  updatedAt?: string
}

// Pastel color palette for workflows
const WORKFLOW_COLORS = [
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
] as const

interface WorkflowStats {
  runCount: number
  lastRunAt: string | null
  completedCount: number
  failedCount: number
}

interface WorkflowListItem extends BriefWorkflowData {
  stats?: WorkflowStats
  // Steps are loaded on-demand when expanded
  steps?: WorkflowStep[]
}

async function fetchWorkflows(groupId?: string): Promise<{ data: BriefWorkflowData[] }> {
  // Use brief=true to get step counts instead of full steps array
  const params = new URLSearchParams({ includeInactive: 'true', brief: 'true' })
  if (groupId) {
    params.set('groupId', groupId)
  }
  const response = await authFetch(`${API_BASE}/workflows?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }
  return response.json()
}

async function fetchWorkflowFolders(): Promise<{ data: WorkflowFolder[] }> {
  const response = await authFetch(`${API_BASE}/workflow-folders`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflow folders')
  }
  return response.json()
}

async function createWorkflowFolder(data: Partial<WorkflowFolder>): Promise<{ data: WorkflowFolder }> {
  const response = await authFetch(`${API_BASE}/workflow-folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create folder')
  return response.json()
}

async function updateWorkflowFolder(id: string, data: Partial<WorkflowFolder>): Promise<{ data: WorkflowFolder }> {
  const response = await authFetch(`${API_BASE}/workflow-folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update folder')
  return response.json()
}

async function deleteWorkflowFolder(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/workflow-folders/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete folder')
}

async function fetchWorkflowById(id: string): Promise<{ data: WorkflowData }> {
  const response = await authFetch(`${API_BASE}/workflows/${id}`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflow')
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

// Get step type icon (inline helper)
function getStepTypeIcon(stepType: WorkflowStepType | undefined, execution?: string, type?: string) {
  const effectiveType = stepType || (execution === 'manual' || type === 'manual' ? 'manual' : 'agent')
  switch (effectiveType) {
    case 'agent': return <Bot className="h-3 w-3 text-blue-500" />
    case 'external': return <Globe className="h-3 w-3 text-orange-500" />
    case 'manual': return <User className="h-3 w-3 text-purple-500" />
    case 'decision': return <GitBranch className="h-3 w-3 text-amber-500" />
    case 'foreach': return <Repeat className="h-3 w-3 text-green-500" />
    case 'join': return <Merge className="h-3 w-3 text-indigo-500" />
    case 'flow': return <Workflow className="h-3 w-3 text-pink-500" />
    default: return <Bot className="h-3 w-3 text-blue-500" />
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

// Fetch all groups (for admins)
async function fetchAllGroups(): Promise<Group[]> {
  const response = await authFetch(`${API_BASE}/groups?all=true`)
  if (!response.ok) {
    throw new Error('Failed to fetch groups')
  }
  const data = await response.json()
  return data.data || []
}

export default function WorkflowsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { currentGroupId, groups } = useGroupContext()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Fetch all groups for admins
  const [allGroups, setAllGroups] = useState<Group[]>([])
  React.useEffect(() => {
    if (isAdmin) {
      fetchAllGroups()
        .then(setAllGroups)
        .catch(console.error)
    }
  }, [isAdmin])

  // Use all groups for admins, otherwise use groups from context
  const availableGroups = isAdmin ? allGroups : groups
  const showGroupSelector = isAdmin || groups.length > 1

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<WorkflowData | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [isApiDocsOpen, setIsApiDocsOpen] = useState(false)
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

  // Filter and selection state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null) // null = all, 'unfiled' = no folder
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  // Initialize collapsed folders from localStorage (tracks COLLAPSED folders)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('workflow-collapsed-folders')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  // Folder management state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<WorkflowFolder | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<WorkflowFolder | null>(null)

  const { data: workflowsData, isLoading, error } = useQuery({
    queryKey: ['workflows', currentGroupId],
    queryFn: () => fetchWorkflows(currentGroupId || undefined),
  })

  const { data: foldersData } = useQuery({
    queryKey: ['workflow-folders'],
    queryFn: fetchWorkflowFolders,
  })

  const { data: statsData } = useQuery({
    queryKey: ['workflow-stats'],
    queryFn: fetchWorkflowStats,
    staleTime: 60000, // Cache for 60 seconds
    refetchOnWindowFocus: true, // Refetch when user returns to the page
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const users = usersData?.data || []
  const folders = foldersData?.data || []
  // Use the data directly from query to avoid creating new object references
  const statsMap = statsData?.data

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
      router.push(`/workflow-runs?id=${data.run._id}`)
    },
  })

  // Bulk action mutations
  const bulkEnableMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => updateWorkflow(id, { isActive: true })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setRowSelection({})
    },
  })

  const bulkDisableMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => updateWorkflow(id, { isActive: false })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setRowSelection({})
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteWorkflow(id)))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setRowSelection({})
      setBulkDeleteConfirm(false)
    },
  })

  // Folder mutations
  const createFolderMutation = useMutation({
    mutationFn: createWorkflowFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-folders'] })
      setFolderDialogOpen(false)
      setNewFolderName('')
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkflowFolder> }) =>
      updateWorkflowFolder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-folders'] })
      setEditingFolder(null)
      setNewFolderName('')
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: deleteWorkflowFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-folders'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setDeleteFolderConfirm(null)
      if (selectedFolderId === deleteFolderConfirm?._id) {
        setSelectedFolderId(null)
      }
    },
  })

  // Bulk move to folder
  const bulkMoveToFolderMutation = useMutation({
    mutationFn: async ({ ids, folderId }: { ids: string[]; folderId: string | null }) => {
      await Promise.all(ids.map(id => updateWorkflow(id, { folderId })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setRowSelection({})
    },
  })

  // Bulk move to group
  const bulkMoveToGroupMutation = useMutation({
    mutationFn: async ({ ids, groupId }: { ids: string[]; groupId: string | null }) => {
      await Promise.all(ids.map(id => updateWorkflow(id, { groupId })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setRowSelection({})
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

  // State for lazily loaded workflow steps
  const [loadedSteps, setLoadedSteps] = useState<Record<string, WorkflowStep[]>>({})
  const [loadingSteps, setLoadingSteps] = useState<Set<string>>(new Set())

  // Normalize workflows and add stats
  // Then apply filters
  const workflows = useMemo<WorkflowListItem[]>(() => {
    let result = (workflowsData?.data || []).map(w => {
      // Handle both brief response (stepCounts) and full response (steps array)
      // This provides backwards compatibility if backend hasn't been updated yet
      const briefData = w as BriefWorkflowData
      const fullData = w as unknown as WorkflowData & { stepCounts?: StepCounts }

      // If stepCounts is missing but steps array exists, compute counts
      let stepCounts = briefData.stepCounts
      if (!stepCounts && fullData.steps) {
        const steps = fullData.steps
        let agentCount = 0, manualCount = 0, otherCount = 0
        for (const s of steps) {
          if (s.stepType === 'agent') agentCount++
          else if (s.stepType === 'manual') manualCount++
          else if (s.stepType) otherCount++
          else if (s.execution === 'manual' || s.type === 'manual') manualCount++
          else agentCount++
        }
        stepCounts = { total: steps.length, agent: agentCount, manual: manualCount, other: otherCount }
      }

      return {
        ...w,
        stepCounts: stepCounts ?? { total: 0, agent: 0, manual: 0, other: 0 },
        stats: statsMap?.[w._id],
        // Include loaded steps if available
        steps: loadedSteps[w._id],
      }
    })

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(w =>
        w.name.toLowerCase().includes(query) ||
        w.description?.toLowerCase().includes(query)
      )
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(w =>
        statusFilter === 'active' ? w.isActive : !w.isActive
      )
    }

    // Apply folder filter
    if (selectedFolderId === 'unfiled') {
      result = result.filter(w => !w.folderId)
    } else if (selectedFolderId) {
      result = result.filter(w => w.folderId === selectedFolderId)
    }

    return result
  }, [workflowsData?.data, statsMap, searchQuery, statusFilter, selectedFolderId, loadedSteps])

  // Group workflows by folder when no folder filter is selected
  const workflowsByFolder = useMemo(() => {
    // Only compute when showing all folders (no folder filter)
    if (selectedFolderId !== null) return null

    const grouped: { folder: WorkflowFolder | null; workflows: WorkflowListItem[] }[] = []

    // Get workflows in each folder
    const folderMap = new Map<string | null, WorkflowListItem[]>()
    folderMap.set(null, []) // Unfiled

    for (const folder of folders) {
      folderMap.set(folder._id, [])
    }

    for (const workflow of workflows) {
      const folderId = workflow.folderId || null
      if (!folderMap.has(folderId)) {
        folderMap.set(folderId, [])
      }
      folderMap.get(folderId)!.push(workflow)
    }

    // Build result: folders first (sorted by sortOrder), then unfiled
    for (const folder of folders.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const folderWorkflows = folderMap.get(folder._id) || []
      if (folderWorkflows.length > 0) {
        grouped.push({ folder, workflows: folderWorkflows })
      }
    }

    // Add unfiled workflows at the end
    const unfiledWorkflows = folderMap.get(null) || []
    if (unfiledWorkflows.length > 0 || grouped.length === 0) {
      grouped.push({ folder: null, workflows: unfiledWorkflows })
    }

    return grouped
  }, [workflows, folders, selectedFolderId])

  // Toggle folder expansion (tracks collapsed folders - default is expanded)
  const toggleFolderExpanded = useCallback((folderId: string | null) => {
    const key = folderId || '__unfiled__'
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      // Persist to localStorage
      try {
        localStorage.setItem('workflow-collapsed-folders', JSON.stringify(Array.from(next)))
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }, [])

  // Check if folder is expanded (default to expanded, set tracks collapsed folders)
  const isFolderExpanded = useCallback((folderId: string | null) => {
    const key = folderId || '__unfiled__'
    // expandedFolders tracks COLLAPSED folders (confusing name, but keeps state minimal)
    return !expandedFolders.has(key)
  }, [expandedFolders])

  // Get selected workflow IDs
  const selectedWorkflowIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter(key => rowSelection[key])
      .map(index => workflows[parseInt(index)]?._id)
      .filter(Boolean) as string[]
  }, [rowSelection, workflows])

  const selectedCount = selectedWorkflowIds.length

  const openCreateEditor = useCallback(() => {
    setEditingWorkflow(null)
    setIsEditorOpen(true)
  }, [])

  // Fetch full workflow data before opening editor (since list view only has brief data)
  const openEditEditor = useCallback(async (workflow: WorkflowListItem | WorkflowData) => {
    try {
      const { data: fullWorkflow } = await fetchWorkflowById(workflow._id)
      setEditingWorkflow(fullWorkflow)
      setIsEditorOpen(true)
    } catch {
      // Fallback to whatever data we have
      setEditingWorkflow(workflow as WorkflowData)
      setIsEditorOpen(true)
    }
  }, [])

  const closeEditor = useCallback(() => {
    setIsEditorOpen(false)
    setEditingWorkflow(null)
  }, [])

  const handleSave = useCallback((workflow: {
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
  }, [updateMutation, createMutation])

  const handleToggleActive = useCallback((workflow: WorkflowListItem) => {
    updateMutation.mutate({
      id: workflow._id,
      data: { isActive: !workflow.isActive },
    })
  }, [updateMutation])

  // Load steps for a workflow (on-demand)
  const loadWorkflowSteps = useCallback(async (id: string) => {
    if (loadedSteps[id] || loadingSteps.has(id)) return

    setLoadingSteps(prev => new Set(prev).add(id))
    try {
      const { data: fullWorkflow } = await fetchWorkflowById(id)
      setLoadedSteps(prev => ({
        ...prev,
        [id]: fullWorkflow.steps || [],
      }))
    } finally {
      setLoadingSteps(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [loadedSteps, loadingSteps])

  // Toggle row expansion and fetch steps if expanding
  const toggleRowExpanded = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // Fetch steps when expanding
        loadWorkflowSteps(id)
      }
      return next
    })
  }, [loadWorkflowSteps])

  // Table columns - memoized to prevent TanStack Table from reinitializing on every render
  const columns = useMemo<ColumnDef<WorkflowListItem>[]>(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <div className="flex justify-center">
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
            className="h-5 w-5"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            className="h-5 w-5"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'expander',
      header: () => null,
      cell: ({ row }) => {
        const isExpanded = expandedRows.has(row.original._id)
        const isLoading = loadingSteps.has(row.original._id)
        const hasSteps = (row.original.stepCounts?.total ?? 0) > 0
        if (!hasSteps) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => toggleRowExpanded(row.original._id)}
          >
            {isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            ) : isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )
      },
    },
    {
      accessorKey: 'name',
      header: 'Workflow',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.color && (
            <div
              className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10"
              style={{ backgroundColor: row.original.color }}
              title="Workflow color"
            />
          )}
          <button
            className="font-medium text-left hover:underline focus:outline-none focus:underline"
            onClick={() => openEditEditor(row.original)}
          >
            {row.original.name}
          </button>
        </div>
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
        const stepCounts = row.original.stepCounts ?? { total: 0, agent: 0, manual: 0, other: 0 }

        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{stepCounts.total}</span>
            {stepCounts.agent > 0 && (
              <span className="text-blue-600 flex items-center gap-1">
                <Bot className="h-3 w-3" />
                {stepCounts.agent}
              </span>
            )}
            {stepCounts.manual > 0 && (
              <span className="text-purple-600 flex items-center gap-1">
                <User className="h-3 w-3" />
                {stepCounts.manual}
              </span>
            )}
            {stepCounts.other > 0 && (
              <span className="text-gray-500">+{stepCounts.other}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'runs',
      header: () => <span className="block text-center">Runs</span>,
      cell: ({ row }) => {
        const stats = row.original.stats
        if (!stats || stats.runCount === 0) {
          return <span className="block text-center text-muted-foreground">-</span>
        }
        return (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span>{stats.runCount}</span>
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
      header: () => <span className="block text-center">Last Run</span>,
      cell: ({ row }) => {
        const stats = row.original.stats
        if (!stats || !stats.lastRunAt) {
          return <span className="block text-center text-muted-foreground">-</span>
        }
        return (
          <span className="block text-center text-sm text-muted-foreground">
            {formatRelativeTime(stats.lastRunAt)}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {/* Direct Edit button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={(e) => { e.stopPropagation(); openEditEditor(row.original) }}
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>

          {/* Direct Run button (if active) */}
          {row.original.isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={(e) => { e.stopPropagation(); setRunDialog({ open: true, workflow: row.original }) }}
            >
              <Play className="h-4 w-4 mr-1" />
              Run
            </Button>
          )}

          {/* More actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => duplicateMutation.mutate(row.original._id)}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleActive(row.original)}>
                {row.original.isActive ? (
                  <>
                    <Pause className="mr-2 h-4 w-4" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Activate
                  </>
                )}
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
        </div>
      ),
    },
  ], [handleToggleActive, openEditEditor, duplicateMutation, expandedRows, toggleRowExpanded, loadingSteps])

  const table = useReactTable({
    data: workflows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
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
        <div className="flex items-center gap-2">
          <Link href="/workflows/multi-edit">
            <Button variant="outline">
              <FileText className="mr-2 h-4 w-4" />
              Multi-Edit
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsApiDocsOpen(true)}>
            <Book className="mr-2 h-4 w-4" />
            API Docs
          </Button>
          <Button onClick={openCreateEditor}>
            <Plus className="mr-2 h-4 w-4" />
            Create Workflow
          </Button>
        </div>
      </div>

      {/* Filters and bulk actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">
              <div className="flex items-center gap-2">
                <Play className="h-3 w-3 text-green-500" />
                Active
              </div>
            </SelectItem>
            <SelectItem value="inactive">
              <div className="flex items-center gap-2">
                <Pause className="h-3 w-3 text-gray-500" />
                Inactive
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Folder filter */}
        <Select value={selectedFolderId || 'all'} onValueChange={(v) => setSelectedFolderId(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[160px]">
            <div className="flex items-center gap-2">
              <Folder className="h-3 w-3" />
              <SelectValue placeholder="Folder" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Folders</SelectItem>
            <SelectItem value="unfiled">No Folder</SelectItem>
            {folders.map(folder => (
              <SelectItem key={folder._id} value={folder._id}>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-3 w-3 text-muted-foreground" />
                  {folder.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Create Folder */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setEditingFolder(null); setNewFolderName(''); setFolderDialogOpen(true); }}
        >
          <Folder className="h-4 w-4 mr-1" />
          New Folder
        </Button>

        {/* Manage existing folders */}
        {folders.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Settings2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {folders.map(folder => (
                <DropdownMenuItem
                  key={folder._id}
                  onClick={() => { setEditingFolder(folder); setNewFolderName(folder.name); setFolderDialogOpen(true); }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit "{folder.name}"
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Clear filters */}
        {(searchQuery || statusFilter !== 'all' || selectedFolderId) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearchQuery(''); setStatusFilter('all'); setSelectedFolderId(null); }}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}

        {/* Bulk actions (only shown when rows are selected) */}
        {selectedCount > 0 && (
          <div className="flex items-center gap-2 ml-auto border-l pl-3">
            <span className="text-sm text-muted-foreground">
              {selectedCount} selected
            </span>
            <Link href={`/workflows/multi-edit?ids=${selectedWorkflowIds.join(',')}`}>
              <Button
                variant="default"
                size="sm"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit Selected
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkEnableMutation.mutate(selectedWorkflowIds)}
              disabled={bulkEnableMutation.isPending}
            >
              <Play className="h-4 w-4 mr-1" />
              Enable
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkDisableMutation.mutate(selectedWorkflowIds)}
              disabled={bulkDisableMutation.isPending}
            >
              <Pause className="h-4 w-4 mr-1" />
              Disable
            </Button>
            {/* Move to folder dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Folder className="h-4 w-4 mr-1" />
                  Move to Folder
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => bulkMoveToFolderMutation.mutate({ ids: selectedWorkflowIds, folderId: null })}
                >
                  No Folder
                </DropdownMenuItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {folders.map(folder => (
                  <DropdownMenuItem
                    key={folder._id}
                    onClick={() => bulkMoveToFolderMutation.mutate({ ids: selectedWorkflowIds, folderId: folder._id })}
                  >
                    <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground" />
                    {folder.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Move to group dropdown - only show if user is admin or has multiple groups */}
            {showGroupSelector && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Users className="h-4 w-4 mr-1" />
                    Move to Group
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => bulkMoveToGroupMutation.mutate({ ids: selectedWorkflowIds, groupId: null })}
                  >
                    <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                    No Group
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {availableGroups.map(group => (
                    <DropdownMenuItem
                      key={group._id}
                      onClick={() => bulkMoveToGroupMutation.mutate({ ids: selectedWorkflowIds, groupId: group._id })}
                    >
                      <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                      {group.displayName}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setBulkDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        )}
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
                  {headerGroup.headers.map(header => {
                    let className: string | undefined
                    if (header.column.id === 'select') {
                      className = 'w-12 pr-0'
                    } else if (header.column.id === 'expander') {
                      className = 'w-10'
                    }
                    return (
                    <TableHead
                      key={header.id}
                      className={className}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )})}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {workflowsByFolder ? (
                // Grouped view - show folders with nested workflows
                workflowsByFolder.map(({ folder, workflows: folderWorkflows }) => {
                  const folderId = folder?._id || null
                  const folderKey = folderId || '__unfiled__'
                  const isExpanded = isFolderExpanded(folderId)
                  const folderRows = table.getRowModel().rows.filter(row =>
                    (row.original.folderId || null) === folderId
                  )

                  return (
                    <React.Fragment key={folderKey}>
                      {/* Folder header row */}
                      <TableRow
                        className="bg-muted/50 hover:bg-muted/60 cursor-pointer"
                        onClick={() => toggleFolderExpanded(folderId)}
                      >
                        <TableCell colSpan={columns.length} className="py-2">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            {folder && (
                              <FolderOpen className="h-4 w-4 text-amber-500" />
                            )}
                            <span className={cn("font-medium", !folder && "text-muted-foreground")}>
                              {folder ? folder.name : 'No Folder'}
                            </span>
                            <Badge variant="secondary" className="ml-1">
                              {folderWorkflows.length}
                            </Badge>
                            {folder && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 ml-auto opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingFolder(folder)
                                  setNewFolderName(folder.name)
                                  setFolderDialogOpen(true)
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Folder contents */}
                      {isExpanded && folderRows.map(row => {
                        const isWorkflowExpanded = expandedRows.has(row.original._id)
                        const isLoading = loadingSteps.has(row.original._id)
                        const steps = row.original.steps || []
                        return (
                          <React.Fragment key={row.id}>
                            <TableRow className="bg-background">
                              {row.getVisibleCells().map(cell => (
                                <TableCell
                                  key={cell.id}
                                  className={cn(
                                    cell.column.id === 'select' ? 'w-12 pr-0' : undefined,
                                    cell.column.id === 'name' ? 'pl-8' : undefined
                                  )}
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                              ))}
                            </TableRow>
                            {isWorkflowExpanded && (
                              <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={columns.length} className="p-0">
                                  <div className="px-4 py-3 ml-6">
                                    {isLoading ? (
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                                        Loading steps...
                                      </div>
                                    ) : steps.length > 0 ? (
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="text-left text-muted-foreground">
                                            <th className="pb-2 pl-1 w-8">#</th>
                                            <th className="pb-2 w-8"></th>
                                            <th className="pb-2">Step Name</th>
                                            <th className="pb-2 w-24">Type</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {steps.map((step, idx) => (
                                            <tr key={step.id || idx} className="border-t border-border/50">
                                              <td className="py-1.5 pl-1 text-muted-foreground">{idx + 1}</td>
                                              <td className="py-1.5">{getStepTypeIcon(step.stepType, step.execution, step.type)}</td>
                                              <td className="py-1.5">{step.name}</td>
                                              <td className="py-1.5 text-muted-foreground capitalize">
                                                {step.stepType || (step.execution === 'manual' || step.type === 'manual' ? 'manual' : 'agent')}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <div className="text-sm text-muted-foreground italic">No steps defined</div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </React.Fragment>
                  )
                })
              ) : (
                // Flat view - when a folder filter is selected
                table.getRowModel().rows.map(row => {
                  const isExpanded = expandedRows.has(row.original._id)
                  const isLoading = loadingSteps.has(row.original._id)
                  const steps = row.original.steps || []
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow>
                        {row.getVisibleCells().map(cell => (
                          <TableCell
                            key={cell.id}
                            className={cell.column.id === 'select' ? 'w-12 pr-0' : undefined}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={columns.length} className="p-0">
                            <div className="px-4 py-3">
                              {isLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                                  Loading steps...
                                </div>
                              ) : steps.length > 0 ? (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-muted-foreground">
                                      <th className="pb-2 pl-1 w-8">#</th>
                                      <th className="pb-2 w-8"></th>
                                      <th className="pb-2">Step Name</th>
                                      <th className="pb-2 w-24">Type</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {steps.map((step, idx) => (
                                      <tr key={step.id || idx} className="border-t border-border/50">
                                        <td className="py-1.5 pl-1 text-muted-foreground">{idx + 1}</td>
                                        <td className="py-1.5">{getStepTypeIcon(step.stepType, step.execution, step.type)}</td>
                                        <td className="py-1.5">{step.name}</td>
                                        <td className="py-1.5 text-muted-foreground capitalize">
                                          {step.stepType || (step.execution === 'manual' || step.type === 'manual' ? 'manual' : 'agent')}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div className="text-sm text-muted-foreground italic">No steps defined</div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })
              )}
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

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Workflow{selectedCount !== 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount} selected workflow{selectedCount !== 1 ? 's' : ''}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(selectedWorkflowIds)}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete All'}
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
                      {users.filter((user) => user._id !== SYSTEM_USER_ID).map((user) => (
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

      {/* API Documentation Dialog */}
      <WorkflowApiDocs
        isOpen={isApiDocsOpen}
        onClose={() => setIsApiDocsOpen(false)}
        workflows={workflows.map(w => ({ _id: w._id, name: w.name }))}
      />

      {/* Folder Create/Edit Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setFolderDialogOpen(false)
          setEditingFolder(null)
          setNewFolderName('')
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingFolder ? 'Edit Folder' : 'Create Folder'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Folder Name</label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g., Sales, Operations"
                className="mt-1"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editingFolder && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => {
                  setFolderDialogOpen(false)
                  setDeleteFolderConfirm(editingFolder)
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => {
              setFolderDialogOpen(false)
              setEditingFolder(null)
              setNewFolderName('')
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newFolderName.trim()) return
                if (editingFolder) {
                  updateFolderMutation.mutate({ id: editingFolder._id, data: { name: newFolderName.trim() } })
                } else {
                  createFolderMutation.mutate({ name: newFolderName.trim() })
                }
              }}
              disabled={!newFolderName.trim() || createFolderMutation.isPending || updateFolderMutation.isPending}
            >
              {(createFolderMutation.isPending || updateFolderMutation.isPending) ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <AlertDialog open={!!deleteFolderConfirm} onOpenChange={(open) => !open && setDeleteFolderConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder: {deleteFolderConfirm?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this folder? Workflows in this folder will be moved to &quot;Unfiled&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolderConfirm && deleteFolderMutation.mutate(deleteFolderConfirm._id)}
              disabled={deleteFolderMutation.isPending}
            >
              {deleteFolderMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
