'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, WebhookConfig, WebhookMethod, WebhookAttempt, tasksApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface WebhookTaskConfigProps {
  task: Task
  isEditMode: boolean
  webhookConfig?: WebhookConfig
  onConfigChange: (config: WebhookConfig) => void
}

const HTTP_METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function WebhookTaskConfig({
  task,
  isEditMode,
  webhookConfig,
  onConfigChange,
}: WebhookTaskConfigProps) {
  const queryClient = useQueryClient()
  const [isExecuting, setIsExecuting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [headersText, setHeadersText] = useState(() => {
    if (webhookConfig?.headers) {
      return JSON.stringify(webhookConfig.headers, null, 2)
    }
    return '{}'
  })
  const [headersError, setHeadersError] = useState<string | null>(null)

  const isWebhookTask = task.taskType === 'webhook'
  const canRetry = task.status === 'failed' && isWebhookTask
  const attempts = webhookConfig?.attempts || []
  const lastAttempt = attempts[attempts.length - 1]

  const handleExecute = async () => {
    setIsExecuting(true)
    try {
      await tasksApi.executeWebhook(task._id)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
    } catch (error) {
      console.error('Failed to execute webhook:', error)
    } finally {
      setIsExecuting(false)
    }
  }

  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      await tasksApi.retryWebhook(task._id)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
    } catch (error) {
      console.error('Failed to retry webhook:', error)
    } finally {
      setIsRetrying(false)
    }
  }

  const handleHeadersChange = (value: string) => {
    setHeadersText(value)
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setHeadersError('Headers must be a JSON object')
        return
      }
      setHeadersError(null)
      onConfigChange({
        ...webhookConfig!,
        headers: parsed,
      })
    } catch {
      setHeadersError('Invalid JSON')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-500'
      case 'failed':
        return 'text-red-500'
      case 'pending':
        return 'text-yellow-500'
      default:
        return 'text-muted-foreground'
    }
  }

  // Config editing section (only shown when editing)
  if (isEditMode && isWebhookTask) {
    return (
      <div className="space-y-3 pt-2 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Webhook Configuration</label>
          {task.status === 'pending' && webhookConfig?.url && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? 'Executing...' : 'Execute Now'}
            </Button>
          )}
          {canRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleRetry}
              disabled={isRetrying}
            >
              {isRetrying ? 'Retrying...' : 'Retry'}
            </Button>
          )}
        </div>

        {/* URL and Method */}
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <Select
            value={webhookConfig?.method || 'POST'}
            onValueChange={(val) =>
              onConfigChange({
                ...webhookConfig!,
                method: val as WebhookMethod,
              })
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((method) => (
                <SelectItem key={method} value={method}>
                  {method}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={webhookConfig?.url || ''}
            onChange={(e) =>
              onConfigChange({
                ...webhookConfig!,
                url: e.target.value,
              })
            }
            placeholder="https://api.example.com/webhook"
            className="h-8 text-sm"
          />
        </div>

        {/* Headers */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Headers (JSON)</label>
          <textarea
            value={headersText}
            onChange={(e) => handleHeadersChange(e.target.value)}
            placeholder='{"Authorization": "Bearer token"}'
            rows={3}
            className={cn(
              'flex w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono',
              'placeholder:text-muted-foreground resize-y transition-colors',
              'focus-visible:outline-none',
              headersError
                ? 'border-destructive focus-visible:border-destructive'
                : 'border-input focus-visible:border-primary'
            )}
          />
          {headersError && (
            <p className="text-[10px] text-destructive">{headersError}</p>
          )}
        </div>

        {/* Body (only for non-GET methods) */}
        {webhookConfig?.method !== 'GET' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Request Body</label>
            <textarea
              value={webhookConfig?.body || ''}
              onChange={(e) =>
                onConfigChange({
                  ...webhookConfig!,
                  body: e.target.value,
                })
              }
              placeholder='{"key": "value"}'
              rows={4}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono',
                'placeholder:text-muted-foreground resize-y transition-colors',
                'focus-visible:outline-none focus-visible:border-primary'
              )}
            />
          </div>
        )}

        {/* Advanced Options */}
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Max Retries</label>
            <Input
              type="number"
              min={0}
              max={10}
              value={webhookConfig?.maxRetries ?? 3}
              onChange={(e) =>
                onConfigChange({
                  ...webhookConfig!,
                  maxRetries: parseInt(e.target.value) || 0,
                })
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Retry Delay (ms)</label>
            <Input
              type="number"
              min={100}
              step={100}
              value={webhookConfig?.retryDelayMs ?? 1000}
              onChange={(e) =>
                onConfigChange({
                  ...webhookConfig!,
                  retryDelayMs: parseInt(e.target.value) || 1000,
                })
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Timeout (ms)</label>
            <Input
              type="number"
              min={1000}
              step={1000}
              value={webhookConfig?.timeoutMs ?? 30000}
              onChange={(e) =>
                onConfigChange({
                  ...webhookConfig!,
                  timeoutMs: parseInt(e.target.value) || 30000,
                })
              }
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Execution Status */}
        {attempts.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <label className="text-xs font-medium text-muted-foreground">Execution History</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {attempts.map((attempt, index) => (
                <AttemptRow key={index} attempt={attempt} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Read-only display for non-edit mode or non-webhook tasks
  if (isWebhookTask && webhookConfig) {
    return (
      <div className="space-y-2 pt-2 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Webhook</label>
          <div className="flex items-center gap-2">
            {lastAttempt && (
              <span className={cn('text-xs', getStatusColor(lastAttempt.status))}>
                {lastAttempt.status === 'success' ? 'Succeeded' : lastAttempt.status === 'failed' ? 'Failed' : 'Pending'}
              </span>
            )}
            {canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? 'Retrying...' : 'Retry'}
              </Button>
            )}
          </div>
        </div>
        <div className="px-3 py-2 text-xs bg-muted/50 rounded-md border space-y-1">
          <div className="flex gap-2">
            <span className="font-mono text-primary">{webhookConfig.method}</span>
            <span className="break-all">{webhookConfig.url}</span>
          </div>
          {lastAttempt && (
            <div className="text-muted-foreground">
              Last attempt: {format(new Date(lastAttempt.startedAt), 'MMM d, HH:mm:ss')}
              {lastAttempt.httpStatus && ` (HTTP ${lastAttempt.httpStatus})`}
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}

function AttemptRow({ attempt }: { attempt: WebhookAttempt }) {
  const [expanded, setExpanded] = useState(false)

  const statusColors = {
    success: 'bg-green-500/20 text-green-600',
    failed: 'bg-red-500/20 text-red-600',
    pending: 'bg-yellow-500/20 text-yellow-600',
  }

  return (
    <div className="text-xs bg-muted/30 rounded border p-2 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">#{attempt.attemptNumber}</span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', statusColors[attempt.status])}>
            {attempt.status}
          </span>
          {attempt.httpStatus && (
            <span className="text-muted-foreground">HTTP {attempt.httpStatus}</span>
          )}
          {attempt.durationMs && (
            <span className="text-muted-foreground">{attempt.durationMs}ms</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1 text-[10px]"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide' : 'Details'}
        </Button>
      </div>
      <div className="text-muted-foreground">
        {format(new Date(attempt.startedAt), 'MMM d, HH:mm:ss')}
        {attempt.completedAt && (
          <span> - {formatDistanceToNow(new Date(attempt.completedAt), { addSuffix: true })}</span>
        )}
      </div>
      {expanded && (
        <div className="pt-1 space-y-1">
          {attempt.errorMessage && (
            <div className="p-1.5 bg-red-500/10 rounded text-red-600 break-all">
              {attempt.errorMessage}
            </div>
          )}
          {attempt.responseBody !== undefined && attempt.responseBody !== null && (
            <div className="p-1.5 bg-muted rounded font-mono text-[10px] break-all max-h-24 overflow-y-auto">
              {typeof attempt.responseBody === 'string'
                ? attempt.responseBody
                : JSON.stringify(attempt.responseBody as object, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
