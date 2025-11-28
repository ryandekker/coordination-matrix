'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Workflow, Play, Pause, ChevronRight, User, Bot, Plus, Pencil, Trash2, Copy, MoreHorizontal } from 'lucide-react'
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

interface WorkflowStep {
  id: string
  name: string
  type: 'automated' | 'manual'
  hitlPhase: string
  description?: string
}

interface WorkflowData {
  _id: string
  name: string
  description: string
  isActive: boolean
  steps: WorkflowStep[]
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

  const workflows = workflowsData?.data || []

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

  const handleSave = (workflow: { _id?: string; name: string; description: string; isActive: boolean; steps: WorkflowStep[]; mermaidDiagram?: string }) => {
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

  const hitlPhaseLabels: Record<string, string> = {
    none: 'No HITL',
    pre_execution: 'Pre-Execution',
    during_execution: 'During',
    post_execution: 'Post-Execution',
    on_error: 'On Error',
    approval_required: 'Approval',
  }

  const hitlPhaseColors: Record<string, string> = {
    none: '#6B7280',
    pre_execution: '#3B82F6',
    during_execution: '#F59E0B',
    post_execution: '#10B981',
    on_error: '#EF4444',
    approval_required: '#8B5CF6',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">
            Define and manage AI workflow pipelines with human-in-the-loop checkpoints
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
            Create your first workflow to define AI task pipelines with HITL checkpoints.
          </p>
          <Button className="mt-4" onClick={openCreateEditor}>
            <Plus className="mr-2 h-4 w-4" />
            Create Workflow
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          {workflows.map((workflow) => (
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

              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {workflow.steps.map((step, index) => (
                  <div key={step.id || index} className="flex items-center">
                    <div
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border p-3 min-w-[140px]',
                        step.type === 'manual' ? 'border-purple-300 bg-purple-50' : 'border-gray-200'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {step.type === 'automated' ? (
                          <Bot className="h-4 w-4 text-blue-500" />
                        ) : (
                          <User className="h-4 w-4 text-purple-500" />
                        )}
                        <span className="text-sm font-medium">{step.name}</span>
                      </div>
                      {step.hitlPhase !== 'none' && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: hitlPhaseColors[step.hitlPhase], color: hitlPhaseColors[step.hitlPhase] }}
                        >
                          {hitlPhaseLabels[step.hitlPhase]}
                        </Badge>
                      )}
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

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{workflow.steps.length} steps</span>
                <span>
                  {workflow.steps.filter((s) => s.type === 'manual').length} manual checkpoints
                </span>
                <span>
                  {workflow.steps.filter((s) => s.hitlPhase !== 'none').length} HITL points
                </span>
              </div>
            </div>
          ))}
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
              Are you sure you want to delete &ldquo;{deleteConfirm?.name}&rdquo;? This action cannot be undone.
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
