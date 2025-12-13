'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Workflow,
  Play,
  Pause,
  ChevronRight,
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
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { WorkflowEditor } from '@/components/workflows/workflow-editor'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

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

async function fetchWorkflows(): Promise<{ data: WorkflowData[] }> {
  const response = await fetch(`${API_BASE}/workflows`)
  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }
  return response.json()
}

async function createWorkflow(data: Partial<WorkflowData>): Promise<{ data: WorkflowData }> {
  const response = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create workflow')
  return response.json()
}

async function updateWorkflow(id: string, data: Partial<WorkflowData>): Promise<{ data: WorkflowData }> {
  const response = await fetch(`${API_BASE}/workflows/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update workflow')
  return response.json()
}

async function deleteWorkflow(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/workflows/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete workflow')
}

async function duplicateWorkflow(id: string): Promise<{ data: WorkflowData }> {
  const response = await fetch(`${API_BASE}/workflows/${id}/duplicate`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('Failed to duplicate workflow')
  return response.json()
}

// Get icon for step type
function getStepIcon(step: WorkflowStep) {
  const stepType = step.stepType || 'task'
  const execution = step.execution || step.type || 'automated'

  switch (stepType) {
    case 'decision':
      return <GitBranch className="h-4 w-4 text-amber-500" />
    case 'foreach':
      return <Repeat className="h-4 w-4 text-green-500" />
    case 'join':
      return <Merge className="h-4 w-4 text-purple-500" />
    case 'subflow':
      return <Workflow className="h-4 w-4 text-pink-500" />
    case 'task':
    default:
      return execution === 'manual' ? (
        <User className="h-4 w-4 text-purple-500" />
      ) : (
        <Bot className="h-4 w-4 text-blue-500" />
      )
  }
}

// Get step type label
function getStepTypeLabel(step: WorkflowStep): string {
  const stepType = step.stepType || 'task'
  const execution = step.execution || step.type || 'automated'

  switch (stepType) {
    case 'decision':
      return 'Decision'
    case 'foreach':
      return 'ForEach'
    case 'join':
      return 'Join'
    case 'subflow':
      return 'Subflow'
    case 'task':
    default:
      return execution === 'manual' ? 'Manual' : 'Automated'
  }
}

export default function WorkflowsPage() {
  const queryClient = useQueryClient()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<WorkflowData | null>(null)

  const { data: workflowsData, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  })

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

  // Normalize workflows to ensure steps array exists
  // Legacy workflows may have 'stages' (string[]) instead of 'steps' (WorkflowStep[])
  const workflows = (workflowsData?.data || []).map(w => ({
    ...w,
    steps: w.steps || (w.stages?.map((name, i) => ({
      id: `stage-${i}`,
      name,
      type: 'manual' as const,
      hitlPhase: 'none',
    })) || []),
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
    steps: WorkflowStep[]
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
        <div className="grid gap-6">
          {workflows.map((workflow) => {
            const automatedCount = workflow.steps.filter(
              (s) => (s.stepType || 'task') === 'task' && (s.execution || s.type) !== 'manual'
            ).length
            const manualCount = workflow.steps.filter(
              (s) => (s.stepType || 'task') === 'task' && (s.execution || s.type) === 'manual'
            ).length
            const promptCount = workflow.steps.filter((s) => s.prompt).length

            return (
              <div
                key={workflow._id}
                className="rounded-lg border bg-card p-6 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{workflow.name}</h3>
                      <Badge
                        variant="outline"
                        className={cn(
                          'cursor-pointer',
                          workflow.isActive
                            ? 'text-green-600 border-green-600'
                            : 'text-gray-500 border-gray-500'
                        )}
                        onClick={() => handleToggleActive(workflow)}
                      >
                        {workflow.isActive ? (
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
                    </div>
                    <p className="text-sm text-muted-foreground">{workflow.description}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditEditor(workflow)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateMutation.mutate(workflow._id)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteConfirm(workflow)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Step visualization */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {workflow.steps.map((step, index) => (
                    <div key={step.id || index} className="flex items-center">
                      <div
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg border p-3 min-w-[140px]',
                          (step.execution || step.type) === 'manual'
                            ? 'border-purple-300 bg-purple-50'
                            : step.stepType === 'decision'
                            ? 'border-amber-300 bg-amber-50'
                            : step.stepType === 'foreach' || step.stepType === 'join'
                            ? 'border-green-300 bg-green-50'
                            : 'border-gray-200'
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
                          {step.prompt && (
                            <FileText className="h-3 w-3 text-muted-foreground" title="Has prompt" />
                          )}
                        </div>
                      </div>
                      {index < workflow.steps.length - 1 && (
                        <ChevronRight className="h-5 w-5 text-muted-foreground mx-1 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                  {workflow.steps.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No steps defined</p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{workflow.steps.length} steps</span>
                  <span>{automatedCount} automated</span>
                  <span>{manualCount} manual</span>
                  {promptCount > 0 && (
                    <span className="text-blue-600">{promptCount} with prompts</span>
                  )}
                </div>
              </div>
            )
          })}
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
    </div>
  )
}
