'use client'

import { useState, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  Ban,
  ArrowLeftRight,
  Eye,
  Play,
  Loader2,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  SkipForward,
  ExternalLink,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import {
  batchJobsApi,
  workflowsApi,
  BatchJob,
  BatchJobStatus,
  BatchItem,
  BatchJobWithItems,
  ReviewDecision,
  Workflow,
} from '@/lib/api'

const STATUS_CONFIG: Record<BatchJobStatus, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  pending: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50', label: 'Pending' },
  processing: { icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50', label: 'Processing' },
  awaiting_responses: { icon: ArrowLeftRight, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50', label: 'Awaiting' },
  completed: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50', label: 'Failed' },
  cancelled: { icon: Ban, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50', label: 'Cancelled' },
  manual_review: { icon: Eye, color: 'text-purple-500', bgColor: 'bg-purple-50 dark:bg-purple-950/50', label: 'Review Needed' },
}

const ITEM_STATUS_CONFIG: Record<string, { color: string; bgColor: string }> = {
  pending: { color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
  received: { color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50' },
  processing: { color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50' },
  completed: { color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50' },
  failed: { color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50' },
  skipped: { color: 'text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
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

// Detail view component
function RequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [reviewDialog, setReviewDialog] = useState(false)
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>('approved')
  const [reviewNotes, setReviewNotes] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['batch-job', requestId],
    queryFn: () => batchJobsApi.get(requestId, true),
    refetchInterval: (query) => {
      const job = query.state.data?.data as BatchJob | undefined
      if (job && (job.status === 'processing' || job.status === 'awaiting_responses' || job.status === 'pending')) {
        return 3000
      }
      return false
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => batchJobsApi.cancel(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-job', requestId] })
      setCancelConfirm(false)
    },
  })

  const reviewMutation = useMutation({
    mutationFn: () => batchJobsApi.submitReview(requestId, reviewDecision, reviewNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-job', requestId] })
      setReviewDialog(false)
      setReviewNotes('')
    },
  })

  const job = data?.data as BatchJobWithItems | undefined
  const items = (job as BatchJobWithItems)?.items || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/requests')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load request</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[job.status]
  const StatusIcon = statusConfig.icon
  const isActive = job.status === 'processing' || job.status === 'awaiting_responses' || job.status === 'pending'
  const needsReview = job.status === 'manual_review'
  const progressPercent = job.expectedCount > 0 ? Math.round((job.processedCount / job.expectedCount) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/requests')}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{job.name || job.type || 'Batch Request'}</h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className={cn('h-4 w-4 mr-1', job.status === 'processing' && 'animate-spin')} />
                {statusConfig.label}
              </Badge>
              {isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">ID: {job._id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {needsReview && (
            <Button size="sm" onClick={() => setReviewDialog(true)}>
              <Eye className="h-4 w-4 mr-2" />
              Review
            </Button>
          )}
          {isActive && (
            <Button variant="destructive" size="sm" onClick={() => setCancelConfirm(true)}>
              <Ban className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Progress section */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-3">Progress</h2>
        <div className="space-y-3">
          <Progress value={progressPercent} className="h-2" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Expected</p>
              <p className="font-medium text-lg">{job.expectedCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Received</p>
              <p className="font-medium text-lg">{job.receivedCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Processed</p>
              <p className="font-medium text-lg text-green-600">{job.processedCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Failed</p>
              <p className="font-medium text-lg text-red-600">{job.failedCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Success Rate</p>
              <p className="font-medium text-lg">
                {job.processedCount > 0
                  ? Math.round(((job.processedCount - job.failedCount) / job.processedCount) * 100)
                  : 0}
                %
              </p>
            </div>
          </div>
          {job.minSuccessPercent > 0 && (
            <p className="text-sm text-muted-foreground">
              Minimum success required: {job.minSuccessPercent}%
            </p>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Created</p>
          <p className="font-medium">{formatDate(job.createdAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="font-medium">{formatDate(job.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Duration</p>
          <p className="font-medium">{formatDuration(job.createdAt, job.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Type</p>
          <p className="font-medium">{job.type || '-'}</p>
        </div>
      </div>

      {/* Review info */}
      {job.reviewDecision && (
        <div className={cn(
          'rounded-lg border p-4',
          job.reviewDecision === 'approved' && 'border-green-300 bg-green-50 dark:bg-green-950/20',
          job.reviewDecision === 'rejected' && 'border-red-300 bg-red-50 dark:bg-red-950/20',
          job.reviewDecision === 'proceed_with_partial' && 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'
        )}>
          <div className="flex items-start gap-2">
            {job.reviewDecision === 'approved' && <ThumbsUp className="h-5 w-5 text-green-500 flex-shrink-0" />}
            {job.reviewDecision === 'rejected' && <ThumbsDown className="h-5 w-5 text-red-500 flex-shrink-0" />}
            {job.reviewDecision === 'proceed_with_partial' && <SkipForward className="h-5 w-5 text-amber-500 flex-shrink-0" />}
            <div>
              <p className="font-medium">
                Review Decision: {job.reviewDecision.replace(/_/g, ' ')}
              </p>
              {job.reviewNotes && (
                <p className="text-sm text-muted-foreground mt-1">{job.reviewNotes}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Related task */}
      {job.taskId && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Related Task</h2>
          <Link
            href={`/tasks?taskId=${job.taskId}`}
            className="text-primary hover:underline flex items-center gap-1"
          >
            View Task <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Items table */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Items ({items.length})</h2>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No items received yet.
          </div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>External ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: BatchItem) => {
                  const itemStatusConfig = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.pending
                  return (
                    <TableRow key={item._id}>
                      <TableCell className="font-mono text-sm">{item.itemKey}</TableCell>
                      <TableCell className="font-mono text-sm">{item.externalId || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs', itemStatusConfig.color)}>
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(item.receivedAt)}</TableCell>
                      <TableCell className="text-sm">{formatDate(item.completedAt)}</TableCell>
                      <TableCell className="text-sm text-destructive max-w-xs truncate">
                        {item.error || '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Input/Output Payloads */}
      {(job.inputPayload || job.aggregateResult) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {job.inputPayload && Object.keys(job.inputPayload).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Input Payload</h2>
              <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-48">
                {JSON.stringify(job.inputPayload, null, 2)}
              </pre>
            </div>
          )}
          {job.aggregateResult && Object.keys(job.aggregateResult).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Aggregate Result</h2>
              <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-48">
                {JSON.stringify(job.aggregateResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Cancel dialog */}
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this batch request? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelMutation.mutate()}
            >
              Cancel Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Review dialog */}
      <Dialog open={reviewDialog} onOpenChange={setReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Request</DialogTitle>
            <DialogDescription>
              This request requires manual review. Choose how to proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <RadioGroup value={reviewDecision} onValueChange={(v: string) => setReviewDecision(v as ReviewDecision)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="approved" id="approved" />
                <Label htmlFor="approved" className="flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-green-500" />
                  Approve - Continue with all results
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="proceed_with_partial" id="partial" />
                <Label htmlFor="partial" className="flex items-center gap-2">
                  <SkipForward className="h-4 w-4 text-amber-500" />
                  Proceed with partial - Continue despite failures
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="rejected" id="rejected" />
                <Label htmlFor="rejected" className="flex items-center gap-2">
                  <ThumbsDown className="h-4 w-4 text-red-500" />
                  Reject - Fail this request
                </Label>
              </div>
            </RadioGroup>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add any notes about your decision..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// List view component
function RequestsList() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [workflowFilter, setWorkflowFilter] = useState<string>('all')
  const [reviewFilter, setReviewFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<BatchJob | null>(null)
  const [page, setPage] = useState(1)

  const { data: workflowsData } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowsApi.list(),
  })

  const { data: requestsData, isLoading, error, refetch } = useQuery({
    queryKey: ['batch-jobs', statusFilter, workflowFilter, reviewFilter, page],
    queryFn: () => batchJobsApi.list({
      status: statusFilter !== 'all' ? statusFilter as BatchJobStatus : undefined,
      workflowId: workflowFilter !== 'all' ? workflowFilter : undefined,
      requiresManualReview: reviewFilter === 'needs_review' ? true : undefined,
      page,
      limit: 20,
    }),
    refetchInterval: 5000,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => batchJobsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-jobs'] })
      setCancelConfirm(null)
    },
  })

  const workflows = workflowsData?.data || []
  const requests = requestsData?.data || []
  const pagination = requestsData?.pagination

  const getWorkflowName = (workflowId: string | undefined): string => {
    if (!workflowId) return '-'
    const workflow = workflows.find((w: Workflow) => w._id === workflowId)
    return workflow?.name || 'Unknown'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requests</h1>
          <p className="text-muted-foreground">Track batch requests and external callbacks</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
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
          <Select value={workflowFilter} onValueChange={(v) => { setWorkflowFilter(v); setPage(1) }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflows</SelectItem>
              {workflows.map((workflow: Workflow) => (
                <SelectItem key={workflow._id} value={workflow._id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Review:</span>
          <Select value={reviewFilter} onValueChange={(v) => { setReviewFilter(v); setPage(1) }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="needs_review">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Needs Review
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load requests</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <ArrowLeftRight className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No requests yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Batch requests will appear here when workflows create them.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((job: BatchJob) => {
            const statusConfig = STATUS_CONFIG[job.status]
            const StatusIcon = statusConfig.icon
            const isActive = job.status === 'processing' || job.status === 'awaiting_responses' || job.status === 'pending'
            const needsReview = job.status === 'manual_review'
            const progressPercent = job.expectedCount > 0 ? Math.round((job.processedCount / job.expectedCount) * 100) : 0

            return (
              <div
                key={job._id}
                className={cn(
                  'rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50',
                  isActive && 'border-blue-300',
                  needsReview && 'border-purple-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn('p-2 rounded-lg', statusConfig.bgColor)}>
                      <StatusIcon className={cn('h-5 w-5', statusConfig.color, job.status === 'processing' && 'animate-spin')} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/requests?id=${job._id}`}
                          className="font-medium hover:underline"
                        >
                          {job.name || job.type || `Request ${job._id.slice(-8)}`}
                        </Link>
                        <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                          {statusConfig.label}
                        </Badge>
                        {needsReview && (
                          <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Needs Review
                          </Badge>
                        )}
                        {isActive && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
                        <span>ID: {job._id.slice(-8)}</span>
                        {job.type && <span>Type: {job.type}</span>}
                        <span>Workflow: {getWorkflowName(job.workflowId)}</span>
                        <span>Created: {formatDate(job.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isActive && (
                      <Button variant="outline" size="sm" onClick={() => setCancelConfirm(job)}>
                        <Ban className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}

                    <Link href={`/requests?id=${job._id}`}>
                      <Button variant="ghost" size="sm">
                        View Details
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      Progress: {job.processedCount} / {job.expectedCount}
                    </span>
                    <span className="text-muted-foreground">{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-1.5" />
                  {job.failedCount > 0 && (
                    <p className="text-sm text-destructive mt-1">
                      {job.failedCount} failed
                    </p>
                  )}
                </div>
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

      {/* Cancel dialog */}
      <AlertDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this batch request? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelConfirm && cancelMutation.mutate(cancelConfirm._id)}
            >
              Cancel Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Main component that switches between views based on URL params
function RequestsContent() {
  const searchParams = useSearchParams()
  const requestId = searchParams.get('id')

  if (requestId) {
    return <RequestDetail requestId={requestId} />
  }

  return <RequestsList />
}

// Export wrapped in Suspense for useSearchParams
export default function RequestsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <RequestsContent />
    </Suspense>
  )
}
