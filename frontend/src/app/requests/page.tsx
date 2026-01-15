'use client'

import { useState, useMemo, Suspense, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEventStream, EventData } from '@/hooks/use-event-stream'
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
  EyeOff,
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
  Phone,
  Copy,
  Check,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { JsonViewer } from '@/components/ui/json-viewer'
import { cn } from '@/lib/utils'
import {
  batchJobsApi,
  externalJobsApi,
  workflowsApi,
  workflowRunsApi,
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
  WorkflowRequest,
  LookupValue,
  User,
} from '@/lib/api'

// Import shared types and utilities from components
import {
  type RequestType,
  type RequestStatus,
  type UnifiedRequest,
  STATUS_CONFIG,
  ITEM_STATUS_CONFIG,
  formatDate,
  formatRelativeTime,
  formatDuration,
  toUnifiedRequest,
  toBatchUnifiedRequest,
  toWebhookDeliveryUnifiedRequest,
  toWebhookTaskUnifiedRequest,
  toWorkflowCallbackUnifiedRequest,
  toWorkflowRequestUnifiedRequest,
} from './components/types'

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
// Helper: Sensitive header detection
// ============================================================================
const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'api-key', 'x-auth-token', 'cookie', 'x-csrf-token']

function isSensitiveHeader(key: string): boolean {
  return SENSITIVE_HEADERS.includes(key.toLowerCase())
}

// ============================================================================
// Helper: Copy to clipboard button
// ============================================================================
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 px-2 text-xs">
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          {label}
        </>
      )}
    </Button>
  )
}

// ============================================================================
// Helper: Header value display with show/hide for sensitive values
// ============================================================================
function HeaderValue({ headerKey, value }: { headerKey: string; value: string }) {
  const [showValue, setShowValue] = useState(false)
  const isSensitive = isSensitiveHeader(headerKey)

  if (!isSensitive) {
    return <span className="break-all">{value}</span>
  }

  return (
    <span className="flex items-center gap-1">
      <span className="break-all font-mono">
        {showValue ? value : '••••••••••••••••'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 hover:bg-transparent"
        onClick={() => setShowValue(!showValue)}
      >
        {showValue ? (
          <EyeOff className="h-3 w-3 text-muted-foreground" />
        ) : (
          <Eye className="h-3 w-3 text-muted-foreground" />
        )}
      </Button>
    </span>
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

  // Build copyable request/response data
  const requestData = {
    method: attempt.method,
    url: attempt.url,
    headers: attempt.headers,
    body: attempt.requestBody,
  }
  const responseData = {
    status: attempt.httpStatus,
    body: attempt.responseBody,
    error: attempt.errorMessage,
  }
  const fullData = { request: requestData, response: responseData }

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

        <div className="flex items-center gap-2">
          <CopyButton text={JSON.stringify(fullData, null, 2)} label="Copy All" />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
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
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Request</h2>
          <CopyButton text={JSON.stringify(requestData, null, 2)} label="Copy Request" />
        </div>
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
                <div key={key} className="flex text-xs font-mono items-center">
                  <span className="text-muted-foreground min-w-[150px]">{key}:</span>
                  <HeaderValue headerKey={key} value={value} />
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

      {/* Error info - improved dark mode styling */}
      {attempt.errorMessage && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-red-700 dark:text-red-300">Error</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1 break-words whitespace-pre-wrap">{attempt.errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Response Body */}
      {attempt.responseBody !== undefined && attempt.responseBody !== null && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Response Body</h2>
            <CopyButton
              text={typeof attempt.responseBody === 'string' ? attempt.responseBody : JSON.stringify(attempt.responseBody, null, 2)}
              label="Copy Response"
            />
          </div>
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
          <p className="text-sm text-muted-foreground">Request Status</p>
          <Badge variant={callback.status === 'success' ? 'default' : 'destructive'}>
            {String(callback.status)}
          </Badge>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Task Type</p>
          <p className="font-medium">{String(callback.taskType)}</p>
        </div>
      </div>

      {/* Error message for failed callbacks */}
      {callback.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <h2 className="font-semibold text-destructive mb-2">Error</h2>
          <p className="text-sm">{callback.error}</p>
        </div>
      )}

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

      {/* Created Tasks */}
      {callback.createdTaskIds && callback.createdTaskIds.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Created Tasks ({callback.createdTaskIds.length})</h2>
          <div className="space-y-2">
            {callback.createdTaskIds.map((taskId) => (
              <div key={taskId} className="flex items-center justify-between py-1 border-b last:border-0">
                <code className="text-sm font-mono text-muted-foreground">{taskId}</code>
                <Link
                  href={`/tasks?taskId=${taskId}`}
                  className="text-primary hover:underline flex items-center gap-1 text-sm"
                >
                  View <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Workflow Request Detail View (Logged Inbound Requests)
// ============================================================================
function WorkflowRequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-request', requestId],
    queryFn: () => workflowRunsApi.getRequest(requestId),
  })

  const request = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/requests')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">Failed to load workflow request</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon
  const isStart = request.type === 'workflow_start'

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
                <Zap className="h-3 w-3 mr-1" />
                {isStart ? 'Workflow Start' : 'Workflow Callback'}
              </Badge>
              <h1 className="text-2xl font-bold">
                {request.workflowName || (isStart ? 'Workflow Trigger' : 'Workflow Callback')}
              </h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className="h-4 w-4 mr-1" />
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {request.method} {request.url}
            </p>
          </div>
        </div>
      </div>

      {/* Error */}
      {request.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-destructive">Error: </span>
              <span className="text-destructive/90">{request.error}</span>
            </div>
          </div>
        </div>
      )}

      {/* Request Info */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold mb-4">Request Details</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Type:</span>
            <span className="ml-2">{isStart ? 'Start Workflow' : 'Callback'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Actor Type:</span>
            <span className="ml-2">{request.actorType}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Received:</span>
            <span className="ml-2">{formatDate(request.receivedAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Processed:</span>
            <span className="ml-2">{formatDate(request.processedAt)}</span>
          </div>
          {request.source && (
            <div>
              <span className="text-muted-foreground">Source:</span>
              <span className="ml-2">{request.source}</span>
            </div>
          )}
          {request.externalId && (
            <div>
              <span className="text-muted-foreground">External ID:</span>
              <span className="ml-2 font-mono text-xs">{request.externalId}</span>
            </div>
          )}
        </div>
      </div>

      {/* Workflow Run Link */}
      {request.workflowRunId && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Created Workflow Run</h2>
          <div className="flex items-center justify-between">
            <code className="text-sm font-mono text-muted-foreground">{request.workflowRunId}</code>
            <Link
              href={`/workflows?runId=${request.workflowRunId}`}
              className="text-primary hover:underline flex items-center gap-1"
            >
              View Workflow Run <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Root Task Link */}
      {request.rootTaskId && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Root Task</h2>
          <div className="flex items-center justify-between">
            <code className="text-sm font-mono text-muted-foreground">{request.rootTaskId}</code>
            <Link
              href={`/tasks?taskId=${request.rootTaskId}`}
              className="text-primary hover:underline flex items-center gap-1"
            >
              View Task <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Headers */}
      {request.headers && Object.keys(request.headers).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Request Headers</h2>
          <pre className="text-sm bg-muted p-3 rounded-md overflow-x-auto">
            {JSON.stringify(request.headers, null, 2)}
          </pre>
        </div>
      )}

      {/* Body */}
      {request.body && Object.keys(request.body).length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-2">Request Body</h2>
          <pre className="text-sm bg-muted p-3 rounded-md overflow-x-auto max-h-96">
            {JSON.stringify(request.body, null, 2)}
          </pre>
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'external' | 'batch' | 'webhook_delivery' | 'webhook_task' | 'workflow_callback' | 'workflow_request'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<BatchJob | null>(null)

  // Real-time updates - invalidate request queries when tasks change
  const handleEvent = useCallback((event: EventData) => {
    // Task changes may affect external jobs, batch jobs, and workflow callbacks
    queryClient.invalidateQueries({ queryKey: ['external-jobs-list'] })
    queryClient.invalidateQueries({ queryKey: ['batch-jobs-list'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-callbacks-list'] })
    queryClient.invalidateQueries({ queryKey: ['webhook-attempts-list'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-requests-list'] })
  }, [queryClient])

  useEventStream({ onEvent: handleEvent })

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

  // Fetch external jobs - reduced polling since SSE handles most updates
  const { data: externalJobsData, isLoading: externalLoading, refetch: refetchExternal } = useQuery({
    queryKey: ['external-jobs-list', taskFilterParams],
    queryFn: () => externalJobsApi.list({
      limit: '100',
      ...taskFilterParams,
    }),
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
    enabled: typeFilter === 'all' || typeFilter === 'external',
  })

  // Fetch batch jobs - reduced polling since SSE handles most updates
  const { data: batchJobsData, isLoading: batchLoading, refetch: refetchBatch } = useQuery({
    queryKey: ['batch-jobs-list', taskFilterParams],
    queryFn: () => batchJobsApi.list({
      limit: 100,
      ...taskFilterParams,
    }),
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
    enabled: typeFilter === 'all' || typeFilter === 'batch',
  })

  // Fetch webhook deliveries (no task filters for system webhooks)
  const { data: webhookDeliveriesData, isLoading: deliveriesLoading, refetch: refetchDeliveries } = useQuery({
    queryKey: ['webhook-deliveries-list'],
    queryFn: () => webhooksApi.getAllDeliveries({ limit: 100 }),
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
    enabled: typeFilter === 'all' || typeFilter === 'webhook_delivery',
  })

  // Fetch webhook task attempts
  const { data: webhookAttemptsData, isLoading: attemptsLoading, refetch: refetchAttempts } = useQuery({
    queryKey: ['webhook-attempts-list', taskFilterParams],
    queryFn: () => tasksApi.getWebhookAttempts({
      limit: 100,
      ...taskFilterParams,
    }),
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
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
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
    enabled: typeFilter === 'all' || typeFilter === 'workflow_callback',
  })

  // Fetch workflow requests (logged inbound requests)
  const { data: workflowRequestsData, isLoading: workflowRequestsLoading, refetch: refetchWorkflowRequests } = useQuery({
    queryKey: ['workflow-requests-list'],
    queryFn: () => workflowRunsApi.listRequests({ limit: 100 }),
    refetchInterval: 30000, // Fallback polling - SSE handles real-time
    enabled: typeFilter === 'all' || typeFilter === 'workflow_request',
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

    // Add workflow requests (logged inbound requests)
    if ((typeFilter === 'all' || typeFilter === 'workflow_request') && workflowRequestsData?.data) {
      requests.push(...workflowRequestsData.data.map(toWorkflowRequestUnifiedRequest))
    }

    // Filter by status
    let filtered = requests
    if (statusFilter !== 'all') {
      filtered = requests.filter(r => r.status === statusFilter)
    }

    // Sort by createdAt descending
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [externalJobsData, batchJobsData, webhookDeliveriesData, webhookAttemptsData, workflowCallbacksData, workflowRequestsData, typeFilter, statusFilter])

  const isLoading = externalLoading || batchLoading || deliveriesLoading || attemptsLoading || callbacksLoading || workflowRequestsLoading

  const handleRefresh = () => {
    refetchExternal()
    refetchBatch()
    refetchDeliveries()
    refetchAttempts()
    refetchCallbacks()
    refetchWorkflowRequests()
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
              <SelectItem value="workflow_request">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Workflow Triggers
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
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[180px]">Date</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
                const isWorkflowRequest = request.type === 'workflow_request'
                const batchJob = isBatch ? request.original as BatchJob : null
                const workflowCallback = isWorkflowCallback ? request.original as WorkflowCallback : null
                const workflowRequest = isWorkflowRequest ? request.original as WorkflowRequest : null

                // Get type icon and label
                const getTypeInfo = () => {
                  if (isBatch) return { icon: Layers, label: 'Batch' }
                  if (isExternal) return { icon: Globe, label: 'External' }
                  if (isWebhookDelivery) return { icon: Send, label: 'Webhook' }
                  if (isWebhookTask) return { icon: ArrowLeftRight, label: 'Task' }
                  if (isWorkflowCallback) return { icon: Phone, label: 'Callback' }
                  if (isWorkflowRequest) return { icon: Zap, label: 'Trigger' }
                  return { icon: ArrowLeftRight, label: 'Unknown' }
                }
                const typeInfo = getTypeInfo()
                const TypeIcon = typeInfo.icon

                // Build details string
                const getDetails = () => {
                  const parts: string[] = []
                  if (isWebhookTask && request.method && request.url) {
                    try {
                      parts.push(`${request.method} ${new URL(request.url).hostname}`)
                    } catch {
                      parts.push(`${request.method} ${request.url}`)
                    }
                  }
                  if (isWebhookTask && request.httpStatus) {
                    parts.push(`HTTP ${request.httpStatus}`)
                  }
                  if (isWebhookTask && request.durationMs !== undefined) {
                    parts.push(`${request.durationMs}ms`)
                  }
                  if (isExternal && request.attempts !== undefined) {
                    parts.push(`${request.attempts}/${request.maxAttempts} attempts`)
                  }
                  if (isWebhookDelivery && request.eventType) {
                    parts.push(`Event: ${request.eventType}`)
                  }
                  if (isWebhookDelivery && request.statusCode) {
                    parts.push(`HTTP ${request.statusCode}`)
                  }
                  if (isBatch && batchJob) {
                    parts.push(`${batchJob.processedCount}/${batchJob.expectedCount}`)
                  }
                  if (isWorkflowCallback && workflowCallback) {
                    parts.push(workflowCallback.taskType)
                  }
                  if (isWorkflowRequest && workflowRequest) {
                    if (workflowRequest.type === 'workflow_start') {
                      parts.push('Start workflow')
                    } else {
                      parts.push('Callback')
                    }
                    if (workflowRequest.actorType && workflowRequest.actorType !== 'anonymous') {
                      parts.push(`via ${workflowRequest.actorType}`)
                    }
                  }
                  if (request.error) {
                    parts.push(request.error.substring(0, 50) + (request.error.length > 50 ? '...' : ''))
                  }
                  return parts.join(' • ')
                }

                return (
                  <TableRow
                    key={`${request.type}-${request._id}`}
                    className={cn(
                      'hover:bg-muted/50',
                      isActive && 'bg-blue-50/50 dark:bg-blue-950/20',
                      needsReview && 'bg-purple-50/50 dark:bg-purple-950/20'
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{typeInfo.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/requests?type=${request.type}&id=${request._id}`}
                        className="font-medium hover:underline text-sm"
                      >
                        {request.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={cn('h-3.5 w-3.5', statusConfig.color, (request.status === 'processing' || request.status === 'retrying') && 'animate-spin')} />
                        <span className={cn('text-xs', statusConfig.color)}>{statusConfig.label}</span>
                        {isActive && (
                          <span className="relative flex h-1.5 w-1.5 ml-1">
                            <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="text-foreground">{formatDate(request.createdAt)}</div>
                        <div className="text-muted-foreground">{formatRelativeTime(request.createdAt)}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        'text-xs font-mono',
                        request.error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                      )} title={request.error || getDetails()}>
                        {getDetails()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {isBatch && isActive && (
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setCancelConfirm(batchJob)}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Link href={`/requests?type=${request.type}&id=${request._id}`}>
                          <Button variant="ghost" size="sm" className="h-7 px-2">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
    if (requestType === 'workflow_request') {
      return <WorkflowRequestDetail requestId={requestId} />
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
