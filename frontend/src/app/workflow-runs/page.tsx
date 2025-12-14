'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ChevronRight,
  RefreshCw,
  Ban,
  Workflow,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { workflowRunsApi, workflowsApi, WorkflowRun, WorkflowRunStatus, Workflow as WorkflowType } from '@/lib/api'

const STATUS_CONFIG: Record<WorkflowRunStatus, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  pending: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-50', label: 'Pending' },
  running: { icon: Play, color: 'text-blue-500', bgColor: 'bg-blue-50', label: 'Running' },
  paused: { icon: Pause, color: 'text-amber-500', bgColor: 'bg-amber-50', label: 'Paused' },
  completed: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50', label: 'Failed' },
  cancelled: { icon: Ban, color: 'text-gray-500', bgColor: 'bg-gray-50', label: 'Cancelled' },
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString()
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '-'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  const durationMs = endDate.getTime() - startDate.getTime()

  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`
  if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`
  return `${Math.round(durationMs / 3600000)}h`
}

export default function WorkflowRunsPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [workflowFilter, setWorkflowFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<WorkflowRun | null>(null)
  const [startDialog, setStartDialog] = useState<{ open: boolean; workflow: WorkflowType | null }>({
    open: false,
    workflow: null,
  })
  const [startPayload, setStartPayload] = useState('')
  const [page, setPage] = useState(1)

  // Fetch workflows for filtering and starting
  const { data: workflowsData } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowsApi.list(),
  })

  // Fetch workflow runs
  const { data: runsData, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-runs', statusFilter, workflowFilter, page],
    queryFn: () => workflowRunsApi.list({
      status: statusFilter !== 'all' ? statusFilter as WorkflowRunStatus : undefined,
      workflowId: workflowFilter !== 'all' ? workflowFilter : undefined,
      page,
      limit: 20,
    }),
    refetchInterval: 5000, // Auto-refresh every 5 seconds for live updates
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => workflowRunsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
      setCancelConfirm(null)
    },
  })

  const startMutation = useMutation({
    mutationFn: (data: { workflowId: string; inputPayload?: Record<string, unknown> }) =>
      workflowRunsApi.start(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
      setStartDialog({ open: false, workflow: null })
      setStartPayload('')
    },
  })

  const workflows = workflowsData?.data || []
  const runs = runsData?.data || []
  const pagination = runsData?.pagination

  const handleStartWorkflow = () => {
    if (!startDialog.workflow) return

    let payload: Record<string, unknown> | undefined
    if (startPayload.trim()) {
      try {
        payload = JSON.parse(startPayload)
      } catch {
        alert('Invalid JSON payload')
        return
      }
    }

    startMutation.mutate({
      workflowId: startDialog.workflow._id,
      inputPayload: payload,
    })
  }

  const getWorkflowName = (workflowId: string): string => {
    const workflow = workflows.find(w => w._id === workflowId)
    return workflow?.name || 'Unknown Workflow'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflow Runs</h1>
          <p className="text-muted-foreground">
            Monitor and manage workflow executions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Select
            value={startDialog.workflow?._id || ''}
            onValueChange={(id) => {
              const workflow = workflows.find(w => w._id === id)
              if (workflow) {
                setStartDialog({ open: true, workflow })
              }
            }}
          >
            <SelectTrigger className="w-[200px]">
              <Play className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Start Workflow..." />
            </SelectTrigger>
            <SelectContent>
              {workflows.filter(w => w.isActive).map((workflow) => (
                <SelectItem key={workflow._id} value={workflow._id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <SelectItem key={status} value={status}>
                  <div className="flex items-center gap-2">
                    <config.icon className={cn('h-4 w-4', config.color)} />
                    {config.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Workflow:</span>
          <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflows</SelectItem>
              {workflows.map((workflow) => (
                <SelectItem key={workflow._id} value={workflow._id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Runs List */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load workflow runs</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Workflow className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No workflow runs yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a workflow to see execution history here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => {
            const statusConfig = STATUS_CONFIG[run.status]
            const StatusIcon = statusConfig.icon
            const isActive = run.status === 'running' || run.status === 'pending'

            return (
              <div
                key={run._id}
                className={cn(
                  'rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50',
                  isActive && 'border-blue-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn('p-2 rounded-lg', statusConfig.bgColor)}>
                      <StatusIcon className={cn('h-5 w-5', statusConfig.color)} />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/workflow-runs/${run._id}`}
                          className="font-medium hover:underline"
                        >
                          {getWorkflowName(run.workflowId)}
                        </Link>
                        <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                          {statusConfig.label}
                        </Badge>
                        {isActive && (
                          <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        <span>ID: {run._id.slice(-8)}</span>
                        <span>Started: {formatDate(run.startedAt || run.createdAt)}</span>
                        {run.completedAt && (
                          <span>Completed: {formatDate(run.completedAt)}</span>
                        )}
                        <span>Duration: {formatDuration(run.startedAt || run.createdAt, run.completedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {run.error && (
                      <div className="flex items-center gap-1 text-destructive text-sm">
                        <AlertCircle className="h-4 w-4" />
                        <span className="max-w-[200px] truncate">{run.error}</span>
                      </div>
                    )}

                    {isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCancelConfirm(run)}
                      >
                        <Ban className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}

                    <Link href={`/workflow-runs/${run._id}`}>
                      <Button variant="ghost" size="sm">
                        View Details
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Progress indicator */}
                {(run.completedStepIds.length > 0 || run.currentStepIds.length > 0) && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Progress:</span>
                      <span className="text-green-600">{run.completedStepIds.length} completed</span>
                      {run.currentStepIds.length > 0 && (
                        <span className="text-blue-600">{run.currentStepIds.length} in progress</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Workflow Run</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this workflow run? This will stop all running
              tasks and mark the run as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelConfirm && cancelMutation.mutate(cancelConfirm._id)}
            >
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Start Workflow Dialog */}
      <Dialog open={startDialog.open} onOpenChange={(open) => {
        if (!open) {
          setStartDialog({ open: false, workflow: null })
          setStartPayload('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Workflow: {startDialog.workflow?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Input Payload (JSON)</label>
              <Textarea
                value={startPayload}
                onChange={(e) => setStartPayload(e.target.value)}
                placeholder='{"key": "value"}'
                className="mt-1 font-mono text-sm"
                rows={6}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Provide initial data for the workflow.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartDialog({ open: false, workflow: null })}>
              Cancel
            </Button>
            <Button onClick={handleStartWorkflow} disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Starting...' : 'Start Workflow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
