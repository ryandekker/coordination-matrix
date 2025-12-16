'use client'

import { useState, useMemo, Suspense } from 'react'
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
  RefreshCw,
  Ban,
  ArrowLeftRight,
  Eye,
  Loader2,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  SkipForward,
  ExternalLink,
  Globe,
  Layers,
  Send,
  Filter,
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
  externalJobsApi,
  workflowsApi,
  BatchJob,
  BatchJobStatus,
  BatchItem,
  BatchJobWithItems,
  ReviewDecision,
  Workflow,
  ExternalJob,
} from '@/lib/api'

// Unified request type for the list
type RequestType = 'external' | 'batch'
type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'awaiting_responses' | 'manual_review'

interface UnifiedRequest {
  _id: string
  type: RequestType
  name: string
  status: RequestStatus
  createdAt: string
  completedAt?: string
  // External job fields
  jobType?: string
  attempts?: number
  maxAttempts?: number
  error?: string
  taskId?: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  // Batch job fields
  expectedCount?: number
  receivedCount?: number
  processedCount?: number
  failedCount?: number
  workflowId?: string
  requiresManualReview?: boolean
  original: ExternalJob | BatchJob
}

// Status configurations
const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
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

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
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

// Convert external job to unified format
function toUnifiedRequest(job: ExternalJob): UnifiedRequest {
  return {
    _id: job._id,
    type: 'external',
    name: job.type,
    status: job.status as RequestStatus,
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? undefined,
    jobType: job.type,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    error: job.error,
    taskId: job.taskId,
    payload: job.payload,
    result: job.result,
    original: job,
  }
}

// Convert batch job to unified format
function toBatchUnifiedRequest(job: BatchJob): UnifiedRequest {
  return {
    _id: job._id,
    type: 'batch',
    name: job.name || job.type || `Batch ${job._id.slice(-8)}`,
    status: job.status as RequestStatus,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expectedCount: job.expectedCount,
    receivedCount: job.receivedCount,
    processedCount: job.processedCount,
    failedCount: job.failedCount,
    workflowId: job.workflowId,
    taskId: job.taskId,
    requiresManualReview: job.requiresManualReview,
    original: job,
  }
}

// ============================================================================
// External Job Detail View
// ============================================================================
function ExternalJobDetail({ jobId }: { jobId: string }) {
  const router = useRouter()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['external-job', jobId],
    queryFn: async () => {
      const response = await fetch(`/api/external-jobs/${jobId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (!response.ok) throw new Error('Failed to fetch')
      return response.json()
    },
    refetchInterval: (query) => {
      const job = query.state.data as ExternalJob | undefined
      if (job && (job.status === 'processing' || job.status === 'pending')) {
        return 3000
      }
      return false
    },
  })

  const job = data as ExternalJob | undefined

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
          <p className="text-destructive">Failed to load external job</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon
  const isActive = job.status === 'processing' || job.status === 'pending'

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
              <Badge variant="outline" className="text-xs">
                <Globe className="h-3 w-3 mr-1" />
                External
              </Badge>
              <h1 className="text-2xl font-bold">{job.type}</h1>
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

        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Created</p>
          <p className="font-medium">{formatDate(job.createdAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Started</p>
          <p className="font-medium">{formatDate(job.startedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="font-medium">{formatDate(job.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Duration</p>
          <p className="font-medium">{formatDuration(job.startedAt, job.completedAt)}</p>
        </div>
      </div>

      {/* Attempts info */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-2">Execution</h2>
        <div className="flex items-center gap-4 text-sm">
          <span>Attempts: {job.attempts} / {job.maxAttempts}</span>
          <span>Type: {job.type}</span>
        </div>
      </div>

      {/* Error info */}
      {job.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-destructive/80 mt-1">{job.error}</p>
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

      {/* Payload and Result */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {job.payload && Object.keys(job.payload).length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold mb-2">Request Payload</h2>
            <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-64">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>
        )}
        {job.result && Object.keys(job.result).length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold mb-2">Response Result</h2>
            <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-64">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Batch Job Detail View
// ============================================================================
function BatchJobDetail({ requestId }: { requestId: string }) {
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
          <p className="text-destructive">Failed to load batch job</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending
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
              <Badge variant="outline" className="text-xs">
                <Layers className="h-3 w-3 mr-1" />
                Batch
              </Badge>
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

// ============================================================================
// Unified Request List
// ============================================================================
function RequestsList() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState<'all' | 'external' | 'batch'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<BatchJob | null>(null)

  // Fetch external jobs
  const { data: externalJobsData, isLoading: externalLoading, refetch: refetchExternal } = useQuery({
    queryKey: ['external-jobs-list'],
    queryFn: () => externalJobsApi.list({ limit: '100' }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'external',
  })

  // Fetch batch jobs
  const { data: batchJobsData, isLoading: batchLoading, refetch: refetchBatch } = useQuery({
    queryKey: ['batch-jobs-list'],
    queryFn: () => batchJobsApi.list({ limit: 100 }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'batch',
  })

  // Fetch workflows for batch job names
  const { data: workflowsData } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowsApi.list(),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => batchJobsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-jobs-list'] })
      setCancelConfirm(null)
    },
  })

  const workflows = workflowsData?.data || []

  const getWorkflowName = (workflowId: string | undefined): string => {
    if (!workflowId) return '-'
    const workflow = workflows.find((w: Workflow) => w._id === workflowId)
    return workflow?.name || 'Unknown'
  }

  // Combine and sort requests
  const unifiedRequests = useMemo(() => {
    const requests: UnifiedRequest[] = []

    // Add external jobs
    if ((typeFilter === 'all' || typeFilter === 'external') && externalJobsData?.data) {
      requests.push(...externalJobsData.data.map(toUnifiedRequest))
    }

    // Add batch jobs
    if ((typeFilter === 'all' || typeFilter === 'batch') && batchJobsData?.data) {
      requests.push(...batchJobsData.data.map(toBatchUnifiedRequest))
    }

    // Filter by status
    let filtered = requests
    if (statusFilter !== 'all') {
      filtered = requests.filter(r => r.status === statusFilter)
    }

    // Sort by createdAt descending
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [externalJobsData, batchJobsData, typeFilter, statusFilter])

  const isLoading = externalLoading || batchLoading

  const handleRefresh = () => {
    refetchExternal()
    refetchBatch()
  }

  // Count active requests
  const activeCount = unifiedRequests.filter(r =>
    r.status === 'pending' || r.status === 'processing' || r.status === 'awaiting_responses'
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requests</h1>
          <p className="text-muted-foreground">Track external jobs and batch callbacks</p>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-blue-600">
              {activeCount} active
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Type:</span>
          <Select value={typeFilter} onValueChange={(v: 'all' | 'external' | 'batch') => setTypeFilter(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="external">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  External Jobs
                </div>
              </SelectItem>
              <SelectItem value="batch">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Batch Jobs
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

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
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : unifiedRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <ArrowLeftRight className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No requests</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Requests from workflows will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {unifiedRequests.map((request) => {
            const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending
            const StatusIcon = statusConfig.icon
            const isActive = request.status === 'pending' || request.status === 'processing' || request.status === 'awaiting_responses'
            const needsReview = request.status === 'manual_review'
            const isBatch = request.type === 'batch'
            const batchJob = isBatch ? request.original as BatchJob : null
            const progressPercent = batchJob && batchJob.expectedCount > 0
              ? Math.round((batchJob.processedCount / batchJob.expectedCount) * 100)
              : 0

            return (
              <div
                key={`${request.type}-${request._id}`}
                className={cn(
                  'rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50',
                  isActive && 'border-blue-300',
                  needsReview && 'border-purple-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn('p-2 rounded-lg', statusConfig.bgColor)}>
                      <StatusIcon className={cn('h-5 w-5', statusConfig.color, request.status === 'processing' && 'animate-spin')} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {isBatch ? (
                            <><Layers className="h-3 w-3 mr-1" />Batch</>
                          ) : (
                            <><Globe className="h-3 w-3 mr-1" />External</>
                          )}
                        </Badge>
                        <Link
                          href={`/requests?type=${request.type}&id=${request._id}`}
                          className="font-medium hover:underline"
                        >
                          {request.name}
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
                        <span>{formatRelativeTime(request.createdAt)}</span>
                        {isBatch && batchJob?.workflowId && (
                          <span>Workflow: {getWorkflowName(batchJob.workflowId)}</span>
                        )}
                        {!isBatch && request.attempts !== undefined && (
                          <span>Attempts: {request.attempts}/{request.maxAttempts}</span>
                        )}
                        {request.error && (
                          <span className="text-destructive truncate max-w-[200px]" title={request.error}>
                            {request.error}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isBatch && isActive && (
                      <Button variant="outline" size="sm" onClick={() => setCancelConfirm(batchJob)}>
                        <Ban className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}

                    <Link href={`/requests?type=${request.type}&id=${request._id}`}>
                      <Button variant="ghost" size="sm">
                        View
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Progress bar for batch jobs */}
                {isBatch && batchJob && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-muted-foreground">
                        {batchJob.processedCount} / {batchJob.expectedCount} responses
                      </span>
                      <span className="text-muted-foreground">{progressPercent}%</span>
                    </div>
                    <Progress value={progressPercent} className="h-1.5" />
                    {batchJob.failedCount > 0 && (
                      <p className="text-sm text-destructive mt-1">
                        {batchJob.failedCount} failed
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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

// ============================================================================
// Main Component - Route based on query params
// ============================================================================
function RequestsContent() {
  const searchParams = useSearchParams()
  const requestId = searchParams.get('id')
  const requestType = searchParams.get('type')

  if (requestId) {
    if (requestType === 'external') {
      return <ExternalJobDetail jobId={requestId} />
    }
    return <BatchJobDetail requestId={requestId} />
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
