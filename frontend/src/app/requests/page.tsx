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
import { JsonViewer } from '@/components/ui/json-viewer'
import { cn } from '@/lib/utils'
import {
  batchJobsApi,
  externalJobsApi,
  workflowsApi,
  webhooksApi,
  tasksApi,
  lookupsApi,
  usersApi,
  BatchJob,
  BatchJobStatus,
  BatchItem,
  BatchJobWithItems,
  ReviewDecision,
  Workflow,
  ExternalJob,
  WebhookDelivery,
  WebhookTaskAttempt,
  WorkflowCallback,
  LookupValue,
  User,
} from '@/lib/api'
import { Phone } from 'lucide-react'

// Unified request type for the list
type RequestType = 'external' | 'batch' | 'webhook_delivery' | 'webhook_task' | 'workflow_callback'
type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'awaiting_responses' | 'manual_review' | 'success' | 'retrying' | 'in_progress' | 'waiting'

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
  // Webhook delivery fields
  webhookName?: string
  webhookUrl?: string
  eventType?: string
  statusCode?: number
  // Webhook task attempt fields
  taskTitle?: string
  httpStatus?: number
  durationMs?: number
  url?: string
  method?: string
  requestHeaders?: Record<string, string>
  requestBody?: unknown
  // Workflow callback fields (inbound requests)
  workflowRunId?: string
  workflowStepId?: string
  original: ExternalJob | BatchJob | WebhookDelivery | WebhookTaskAttempt | WorkflowCallback
}

// Status configurations
const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  pending: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50', label: 'Pending' },
  processing: { icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50', label: 'Processing' },
  in_progress: { icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50', label: 'In Progress' },
  waiting: { icon: Clock, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50', label: 'Waiting' },
  awaiting_responses: { icon: ArrowLeftRight, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50', label: 'Awaiting' },
  completed: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50', label: 'Completed' },
  success: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50', label: 'Success' },
  failed: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50', label: 'Failed' },
  retrying: { icon: RefreshCw, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50', label: 'Retrying' },
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

// Convert webhook delivery to unified format
function toWebhookDeliveryUnifiedRequest(delivery: WebhookDelivery): UnifiedRequest {
  return {
    _id: delivery._id,
    type: 'webhook_delivery',
    name: delivery.webhookName || `Webhook ${delivery.webhookId.slice(-8)}`,
    status: delivery.status as RequestStatus,
    createdAt: delivery.createdAt,
    completedAt: delivery.completedAt ?? undefined,
    webhookName: delivery.webhookName,
    webhookUrl: delivery.webhookUrl,
    eventType: delivery.eventType,
    statusCode: delivery.statusCode,
    error: delivery.error,
    attempts: delivery.attempts,
    maxAttempts: delivery.maxAttempts,
    payload: delivery.payload,
    original: delivery,
  }
}

// Convert webhook task attempt to unified format
function toWebhookTaskUnifiedRequest(attempt: WebhookTaskAttempt): UnifiedRequest {
  return {
    _id: attempt._id,
    type: 'webhook_task',
    name: attempt.taskTitle || `Webhook Task`,
    status: attempt.status as RequestStatus,
    createdAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    taskId: attempt.taskId,
    taskTitle: attempt.taskTitle,
    httpStatus: attempt.httpStatus,
    durationMs: attempt.durationMs,
    url: attempt.url,
    method: attempt.method,
    requestHeaders: attempt.headers,
    requestBody: attempt.requestBody,
    error: attempt.errorMessage,
    original: attempt,
  }
}

// Convert workflow callback to unified format
function toWorkflowCallbackUnifiedRequest(callback: WorkflowCallback): UnifiedRequest {
  return {
    _id: callback._id,
    type: 'workflow_callback',
    name: `${callback.method} ${callback.url}`,
    status: callback.status as RequestStatus,
    createdAt: callback.receivedAt,
    taskId: callback.taskId,
    taskTitle: callback.taskTitle,
    workflowRunId: callback.workflowRunId,
    workflowStepId: callback.workflowStepId,
    url: callback.url,
    method: callback.method,
    requestHeaders: callback.headers,
    requestBody: callback.body,
    original: callback,
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
            <div className="bg-muted rounded p-3 overflow-auto max-h-64">
              <JsonViewer data={job.payload} defaultExpanded={true} maxInitialDepth={2} />
            </div>
          </div>
        )}
        {job.result && Object.keys(job.result).length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold mb-2">Response Result</h2>
            <div className="bg-muted rounded p-3 overflow-auto max-h-64">
              <JsonViewer data={job.result} defaultExpanded={true} maxInitialDepth={2} />
            </div>
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
// Webhook Delivery Detail View
// ============================================================================
function WebhookDeliveryDetail({ deliveryId }: { deliveryId: string }) {
  const router = useRouter()

  const { data: deliveriesData, isLoading, error, refetch } = useQuery({
    queryKey: ['webhook-delivery', deliveryId],
    queryFn: () => webhooksApi.getAllDeliveries({ limit: 100 }),
    refetchInterval: (query) => {
      const deliveries = query.state.data?.data || []
      const delivery = deliveries.find((d: WebhookDelivery) => d._id === deliveryId)
      if (delivery && (delivery.status === 'pending' || delivery.status === 'retrying')) {
        return 3000
      }
      return false
    },
  })

  const delivery: WebhookDelivery | undefined = deliveriesData?.data?.find((d: WebhookDelivery) => d._id === deliveryId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !delivery) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/requests')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load webhook delivery</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[delivery.status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon
  const isActive = delivery.status === 'pending' || delivery.status === 'retrying'

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
                <Send className="h-3 w-3 mr-1" />
                Webhook Delivery
              </Badge>
              <h1 className="text-2xl font-bold">{delivery.webhookName || 'Webhook'}</h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className={cn('h-4 w-4 mr-1', isActive && 'animate-spin')} />
                {statusConfig.label}
              </Badge>
              {isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">ID: {delivery._id}</p>
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
          <p className="text-sm text-muted-foreground">Event Type</p>
          <p className="font-medium">{delivery.eventType}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Created</p>
          <p className="font-medium">{formatDate(delivery.createdAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="font-medium">{formatDate(delivery.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">HTTP Status</p>
          <p className="font-medium">{delivery.statusCode || '-'}</p>
        </div>
      </div>

      {/* Webhook URL */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-2">Webhook URL</h2>
        <p className="font-mono text-sm break-all">{delivery.webhookUrl || '-'}</p>
      </div>

      {/* Attempts info */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-2">Delivery Status</h2>
        <div className="flex items-center gap-4 text-sm">
          <span>Attempts: {delivery.attempts} / {delivery.maxAttempts}</span>
          {delivery.nextRetryAt && (
            <span>Next Retry: {formatDate(delivery.nextRetryAt)}</span>
          )}
        </div>
      </div>

      {/* Error info */}
      {delivery.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-destructive/80 mt-1">{delivery.error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Payload */}
      {delivery.payload && Object.keys(delivery.payload).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Payload</h2>
          <div className="bg-muted rounded p-3 overflow-auto max-h-64">
            <JsonViewer data={delivery.payload} defaultExpanded={true} maxInitialDepth={2} />
          </div>
        </div>
      )}

      {/* Response */}
      {delivery.responseBody && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Response</h2>
          <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-64">
            {delivery.responseBody}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Webhook Task Attempt Detail View
// ============================================================================
function WebhookTaskDetail({ attemptId }: { attemptId: string }) {
  const router = useRouter()

  const { data: attemptsData, isLoading, error, refetch } = useQuery({
    queryKey: ['webhook-attempt', attemptId],
    queryFn: () => tasksApi.getWebhookAttempts({ limit: 100 }),
    refetchInterval: (query) => {
      const attempts = query.state.data?.data || []
      const attempt = attempts.find((a: WebhookTaskAttempt) => a._id === attemptId)
      if (attempt && attempt.status === 'pending') {
        return 3000
      }
      return false
    },
  })

  const attempt: WebhookTaskAttempt | undefined = attemptsData?.data?.find((a: WebhookTaskAttempt) => a._id === attemptId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !attempt) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/requests')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load webhook attempt</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[attempt.status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon
  const isActive = attempt.status === 'pending'

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
                <ArrowLeftRight className="h-3 w-3 mr-1" />
                Webhook Task
              </Badge>
              <h1 className="text-2xl font-bold">{attempt.taskTitle}</h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className={cn('h-4 w-4 mr-1', isActive && 'animate-spin')} />
                {statusConfig.label}
              </Badge>
              {isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">Attempt #{attempt.attemptNumber}</p>
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
          <p className="text-sm text-muted-foreground">Started</p>
          <p className="font-medium">{formatDate(attempt.startedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="font-medium">{formatDate(attempt.completedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Duration</p>
          <p className="font-medium">{attempt.durationMs !== undefined ? `${attempt.durationMs}ms` : '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">HTTP Status</p>
          <p className="font-medium">{attempt.httpStatus || '-'}</p>
        </div>
      </div>

      {/* Request details */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-2">Request</h2>
        <div className="flex items-center gap-2 text-sm mb-3">
          <Badge variant="secondary">{attempt.method}</Badge>
          <span className="font-mono break-all">{attempt.url}</span>
        </div>

        {/* Request Headers */}
        {attempt.headers && Object.keys(attempt.headers).length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Headers</h3>
            <div className="space-y-1">
              {Object.entries(attempt.headers).map(([key, value]) => (
                <div key={key} className="flex text-xs font-mono">
                  <span className="text-muted-foreground min-w-[150px]">{key}:</span>
                  <span className="break-all">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request Body */}
        {attempt.requestBody !== undefined && attempt.requestBody !== null && (
          <div className="mt-3 pt-3 border-t">
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">Body</h3>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48">
              {typeof attempt.requestBody === 'string'
                ? attempt.requestBody
                : JSON.stringify(attempt.requestBody, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Related task */}
      {attempt.taskId && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Related Task</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{attempt.taskTitle}</p>
              <p className="text-sm text-muted-foreground">Status: {attempt.taskStatus}</p>
            </div>
            <Link
              href={`/tasks?taskId=${attempt.taskId}`}
              className="text-primary hover:underline flex items-center gap-1"
            >
              View Task <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Error info */}
      {attempt.errorMessage && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-destructive/80 mt-1">{attempt.errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Response Body */}
      {attempt.responseBody !== undefined && attempt.responseBody !== null && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Response Body</h2>
          <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-64">
            {typeof attempt.responseBody === 'string'
              ? attempt.responseBody
              : JSON.stringify(attempt.responseBody, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Workflow Callback Detail View
// ============================================================================
function WorkflowCallbackDetail({ callbackId }: { callbackId: string }) {
  const router = useRouter()

  const { data: callbacksData, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-callback', callbackId],
    queryFn: () => tasksApi.getWorkflowCallbacks({ limit: 100 }),
  })

  const foundCallback: WorkflowCallback | undefined = callbacksData?.data?.find((c) => c._id === callbackId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !foundCallback) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/requests')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load callback request</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // After the guard, foundCallback is guaranteed to be WorkflowCallback
  const callback = foundCallback

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
                <Phone className="h-3 w-3 mr-1" />
                Inbound Callback
              </Badge>
              <h1 className="text-2xl font-bold">{String(callback.method)} Request</h1>
            </div>
            <p className="text-muted-foreground text-sm">Task: {String(callback.taskTitle)}</p>
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
          <p className="text-sm text-muted-foreground">Received At</p>
          <p className="font-medium">{formatDate(callback.receivedAt)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Method</p>
          <p className="font-medium">{String(callback.method)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Task Type</p>
          <p className="font-medium">{String(callback.taskType)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Task Status</p>
          <p className="font-medium">{String(callback.taskStatus)}</p>
        </div>
      </div>

      {/* Request URL */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-2">Request URL</h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{String(callback.method)}</Badge>
          <code className="font-mono text-sm break-all">{String(callback.url)}</code>
        </div>
      </div>

      {/* Request Headers */}
      {callback.headers && Object.keys(callback.headers).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Request Headers</h2>
          <div className="space-y-1">
            {Object.entries(callback.headers).map(([key, value]) => (
              <div key={key} className="flex text-sm font-mono">
                <span className="text-muted-foreground min-w-[200px]">{key}:</span>
                <span className="break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request Body */}
      {callback.body !== undefined && callback.body !== null && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Request Body</h2>
          <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-64">
            {typeof callback.body === 'string'
              ? callback.body
              : JSON.stringify(callback.body, null, 2)}
          </pre>
        </div>
      )}

      {/* Related task */}
      {callback.taskId && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Related Task</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{String(callback.taskTitle)}</p>
              <p className="text-sm text-muted-foreground">Status: {String(callback.taskStatus)}</p>
            </div>
            <Link
              href={`/tasks?taskId=${callback.taskId}`}
              className="text-primary hover:underline flex items-center gap-1"
            >
              View Task <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Unified Request List
// ============================================================================
function RequestsList() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState<'all' | 'external' | 'batch' | 'webhook_delivery' | 'webhook_task' | 'workflow_callback'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<BatchJob | null>(null)

  // Fetch lookups for task types
  const { data: lookupsData } = useQuery({
    queryKey: ['lookups'],
    queryFn: () => lookupsApi.getAll(),
  })

  // Fetch users for assignee filter
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  const taskTypes = lookupsData?.data?.taskType || []
  const users = usersData?.data || []

  // Build filter params for queries
  const taskFilterParams = {
    taskStatus: taskStatusFilter !== 'all' ? taskStatusFilter : undefined,
    taskType: taskTypeFilter !== 'all' ? taskTypeFilter : undefined,
    assigneeId: assigneeFilter !== 'all' ? assigneeFilter : undefined,
  }

  // Fetch external jobs
  const { data: externalJobsData, isLoading: externalLoading, refetch: refetchExternal } = useQuery({
    queryKey: ['external-jobs-list', taskFilterParams],
    queryFn: () => externalJobsApi.list({
      limit: '100',
      ...taskFilterParams,
    }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'external',
  })

  // Fetch batch jobs
  const { data: batchJobsData, isLoading: batchLoading, refetch: refetchBatch } = useQuery({
    queryKey: ['batch-jobs-list', taskFilterParams],
    queryFn: () => batchJobsApi.list({
      limit: 100,
      ...taskFilterParams,
    }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'batch',
  })

  // Fetch webhook deliveries (no task filters for system webhooks)
  const { data: webhookDeliveriesData, isLoading: deliveriesLoading, refetch: refetchDeliveries } = useQuery({
    queryKey: ['webhook-deliveries-list'],
    queryFn: () => webhooksApi.getAllDeliveries({ limit: 100 }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'webhook_delivery',
  })

  // Fetch webhook task attempts
  const { data: webhookAttemptsData, isLoading: attemptsLoading, refetch: refetchAttempts } = useQuery({
    queryKey: ['webhook-attempts-list', taskFilterParams],
    queryFn: () => tasksApi.getWebhookAttempts({
      limit: 100,
      ...taskFilterParams,
    }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'webhook_task',
  })

  // Fetch workflow callbacks (inbound requests)
  const { data: workflowCallbacksData, isLoading: callbacksLoading, refetch: refetchCallbacks } = useQuery({
    queryKey: ['workflow-callbacks-list', taskFilterParams],
    queryFn: () => tasksApi.getWorkflowCallbacks({
      limit: 100,
      taskStatus: taskFilterParams.taskStatus,
      taskType: taskFilterParams.taskType,
    }),
    refetchInterval: 5000,
    enabled: typeFilter === 'all' || typeFilter === 'workflow_callback',
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

    // Add webhook deliveries
    if ((typeFilter === 'all' || typeFilter === 'webhook_delivery') && webhookDeliveriesData?.data) {
      requests.push(...webhookDeliveriesData.data.map(toWebhookDeliveryUnifiedRequest))
    }

    // Add webhook task attempts
    if ((typeFilter === 'all' || typeFilter === 'webhook_task') && webhookAttemptsData?.data) {
      requests.push(...webhookAttemptsData.data.map(toWebhookTaskUnifiedRequest))
    }

    // Add workflow callbacks
    if ((typeFilter === 'all' || typeFilter === 'workflow_callback') && workflowCallbacksData?.data) {
      requests.push(...workflowCallbacksData.data.map(toWorkflowCallbackUnifiedRequest))
    }

    // Filter by status
    let filtered = requests
    if (statusFilter !== 'all') {
      filtered = requests.filter(r => r.status === statusFilter)
    }

    // Sort by createdAt descending
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [externalJobsData, batchJobsData, webhookDeliveriesData, webhookAttemptsData, workflowCallbacksData, typeFilter, statusFilter])

  const isLoading = externalLoading || batchLoading || deliveriesLoading || attemptsLoading || callbacksLoading

  const handleRefresh = () => {
    refetchExternal()
    refetchBatch()
    refetchDeliveries()
    refetchAttempts()
    refetchCallbacks()
  }

  // Count active requests
  const activeCount = unifiedRequests.filter(r =>
    r.status === 'pending' || r.status === 'processing' || r.status === 'awaiting_responses' || r.status === 'retrying' || r.status === 'in_progress' || r.status === 'waiting'
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requests</h1>
          <p className="text-muted-foreground">Track external jobs, batch callbacks, and webhooks</p>
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
          <Select value={typeFilter} onValueChange={(v: 'all' | 'external' | 'batch' | 'webhook_delivery' | 'webhook_task' | 'workflow_callback') => setTypeFilter(v)}>
            <SelectTrigger className="w-[180px]">
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
              <SelectItem value="webhook_delivery">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Webhook Deliveries
                </div>
              </SelectItem>
              <SelectItem value="webhook_task">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4" />
                  Webhook Tasks
                </div>
              </SelectItem>
              <SelectItem value="workflow_callback">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Workflow Callbacks
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

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Task Status:</span>
          <Select value={taskStatusFilter} onValueChange={setTaskStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {taskTypes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Task Type:</span>
            <Select value={taskTypeFilter} onValueChange={setTaskTypeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {taskTypes.map((type: LookupValue) => (
                  <SelectItem key={type.code} value={type.code}>
                    {type.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {users.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Assigned To:</span>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map((user: User) => (
                  <SelectItem key={user._id} value={user._id}>
                    {user.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
            const isActive = request.status === 'pending' || request.status === 'processing' || request.status === 'awaiting_responses' || request.status === 'retrying' || request.status === 'in_progress' || request.status === 'waiting'
            const needsReview = request.status === 'manual_review'
            const isBatch = request.type === 'batch'
            const isExternal = request.type === 'external'
            const isWebhookDelivery = request.type === 'webhook_delivery'
            const isWebhookTask = request.type === 'webhook_task'
            const isWorkflowCallback = request.type === 'workflow_callback'
            const batchJob = isBatch ? request.original as BatchJob : null
            const workflowCallback = isWorkflowCallback ? request.original as WorkflowCallback : null
            const progressPercent = batchJob && batchJob.expectedCount > 0
              ? Math.round((batchJob.processedCount / batchJob.expectedCount) * 100)
              : 0

            // Get type badge content
            const getTypeBadge = () => {
              if (isBatch) return <><Layers className="h-3 w-3 mr-1" />Batch</>
              if (isExternal) return <><Globe className="h-3 w-3 mr-1" />External</>
              if (isWebhookDelivery) return <><Send className="h-3 w-3 mr-1" />Webhook</>
              if (isWebhookTask) return <><ArrowLeftRight className="h-3 w-3 mr-1" />Task Webhook</>
              if (isWorkflowCallback) return <><Phone className="h-3 w-3 mr-1" />Callback</>
              return null
            }

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
                      <StatusIcon className={cn('h-5 w-5', statusConfig.color, (request.status === 'processing' || request.status === 'retrying') && 'animate-spin')} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {getTypeBadge()}
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
                        {isExternal && request.attempts !== undefined && (
                          <span>Attempts: {request.attempts}/{request.maxAttempts}</span>
                        )}
                        {isWebhookDelivery && request.eventType && (
                          <span>Event: {request.eventType}</span>
                        )}
                        {isWebhookDelivery && request.statusCode && (
                          <span>HTTP {request.statusCode}</span>
                        )}
                        {isWebhookTask && request.method && request.url && (
                          <span className="font-mono text-xs">{request.method} {new URL(request.url).hostname}</span>
                        )}
                        {isWebhookTask && request.httpStatus && (
                          <span>HTTP {request.httpStatus}</span>
                        )}
                        {isWebhookTask && request.durationMs !== undefined && (
                          <span>{request.durationMs}ms</span>
                        )}
                        {isWorkflowCallback && workflowCallback && (
                          <>
                            <span className="font-mono text-xs truncate max-w-[300px]">{workflowCallback.url}</span>
                            <span className="text-xs">{workflowCallback.taskType}</span>
                          </>
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
    if (requestType === 'webhook_delivery') {
      return <WebhookDeliveryDetail deliveryId={requestId} />
    }
    if (requestType === 'webhook_task') {
      return <WebhookTaskDetail attemptId={requestId} />
    }
    if (requestType === 'workflow_callback') {
      return <WorkflowCallbackDetail callbackId={requestId} />
    }
    // Default to batch
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
