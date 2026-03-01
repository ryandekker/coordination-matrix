'use client'

import { Route, UserPlus, GitBranch, Tag, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RoutingOperationResult {
  action: 'assign' | 'triggerWorkflow' | 'addTags'
  success: boolean
  assigneeId?: string
  workflowId?: string
  workflowRunId?: string
  tags?: string[]
  error?: string
}

interface RoutingOperationsPanelProps {
  operations: RoutingOperationResult[]
}

const actionIcons = {
  assign: UserPlus,
  triggerWorkflow: GitBranch,
  addTags: Tag,
}

const actionLabels = {
  assign: 'Assigned',
  triggerWorkflow: 'Triggered Workflow',
  addTags: 'Tagged',
}

export function RoutingOperationsPanel({ operations }: RoutingOperationsPanelProps) {
  if (!operations || operations.length === 0) return null

  const successCount = operations.filter(op => op.success).length
  const failCount = operations.length - successCount

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Route className="h-4 w-4 text-muted-foreground" />
        <span>Routing Operations</span>
        <span className="text-xs text-muted-foreground">
          {successCount} succeeded{failCount > 0 && `, ${failCount} failed`}
        </span>
      </div>
      <div className="space-y-1.5">
        {operations.map((op, i) => (
          <RoutingOperationRow key={i} operation={op} />
        ))}
      </div>
    </div>
  )
}

function RoutingOperationRow({ operation }: { operation: RoutingOperationResult }) {
  const Icon = actionIcons[operation.action] || Route
  const label = actionLabels[operation.action] || operation.action

  return (
    <div className={cn(
      'flex items-center gap-2 text-xs rounded px-2 py-1.5',
      operation.success
        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
        : 'bg-red-500/10 text-red-700 dark:text-red-400',
    )}>
      {operation.success ? (
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="font-medium">{label}</span>

      {operation.action === 'assign' && operation.assigneeId && (
        <span className="text-muted-foreground truncate">
          to {operation.assigneeId}
        </span>
      )}

      {operation.action === 'triggerWorkflow' && (
        <span className="text-muted-foreground truncate">
          {operation.workflowRunId
            ? `run ${operation.workflowRunId}`
            : operation.workflowId}
        </span>
      )}

      {operation.action === 'addTags' && operation.tags && (
        <span className="text-muted-foreground truncate">
          {operation.tags.join(', ')}
        </span>
      )}

      {!operation.success && operation.error && (
        <span className="text-muted-foreground truncate">
          &mdash; {operation.error}
        </span>
      )}
    </div>
  )
}
