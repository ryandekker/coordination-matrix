// Shared types and utilities for requests page
import type {
  ExternalJob,
  BatchJob,
  WebhookDelivery,
  WebhookTaskAttempt,
  WorkflowCallback,
} from '@/lib/api'
import {
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  ArrowLeftRight,
  Eye,
  Loader2,
  RefreshCw,
} from 'lucide-react'

// Unified request type for the list
export type RequestType = 'external' | 'batch' | 'webhook_delivery' | 'webhook_task' | 'workflow_callback'
export type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'awaiting_responses' | 'manual_review' | 'success' | 'retrying' | 'in_progress' | 'waiting'

export interface UnifiedRequest {
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
export const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
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

export const ITEM_STATUS_CONFIG: Record<string, { color: string; bgColor: string }> = {
  pending: { color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
  received: { color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/50' },
  processing: { color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/50' },
  completed: { color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-950/50' },
  failed: { color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/50' },
  skipped: { color: 'text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
}

// Utility functions
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString()
}

export function formatRelativeTime(dateString: string | null | undefined): string {
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

export function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '-'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  const durationMs = endDate.getTime() - startDate.getTime()

  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`
  if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`
  return `${Math.round(durationMs / 3600000)}h`
}

// Conversion functions
export function toUnifiedRequest(job: ExternalJob): UnifiedRequest {
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

export function toBatchUnifiedRequest(job: BatchJob): UnifiedRequest {
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

export function toWebhookDeliveryUnifiedRequest(delivery: WebhookDelivery): UnifiedRequest {
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

export function toWebhookTaskUnifiedRequest(attempt: WebhookTaskAttempt): UnifiedRequest {
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

export function toWorkflowCallbackUnifiedRequest(callback: WorkflowCallback): UnifiedRequest {
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
