'use client'

import { FileText, Search, Pencil, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface DocumentOperationResult {
  action: 'create' | 'update' | 'search'
  success: boolean
  documentId?: string
  title?: string
  query?: string
  resultsCount?: number
  results?: Array<{ documentId: string; title: string; score: number }>
  error?: string
}

interface DocumentOperationsPanelProps {
  operations: DocumentOperationResult[]
}

const actionIcons = {
  create: FileText,
  update: Pencil,
  search: Search,
}

const actionLabels = {
  create: 'Created',
  update: 'Updated',
  search: 'Searched',
}

export function DocumentOperationsPanel({ operations }: DocumentOperationsPanelProps) {
  if (!operations || operations.length === 0) return null

  const successCount = operations.filter(op => op.success).length
  const failCount = operations.length - successCount

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span>Document Operations</span>
        <span className="text-xs text-muted-foreground">
          {successCount} succeeded{failCount > 0 && `, ${failCount} failed`}
        </span>
      </div>
      <div className="space-y-1.5">
        {operations.map((op, i) => (
          <DocumentOperationRow key={i} operation={op} />
        ))}
      </div>
    </div>
  )
}

function DocumentOperationRow({ operation }: { operation: DocumentOperationResult }) {
  const Icon = actionIcons[operation.action] || FileText
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

      {/* Create/Update: show document title with link */}
      {(operation.action === 'create' || operation.action === 'update') && operation.documentId && (
        <Link
          href={`/documents/${operation.documentId}`}
          className="inline-flex items-center gap-1 hover:underline truncate"
        >
          <span className="truncate">{operation.title || operation.documentId}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0" />
        </Link>
      )}

      {/* Search: show query and result count */}
      {operation.action === 'search' && (
        <span className="truncate">
          &ldquo;{operation.query}&rdquo;
          {operation.resultsCount !== undefined && (
            <span className="text-muted-foreground ml-1">
              ({operation.resultsCount} result{operation.resultsCount !== 1 ? 's' : ''})
            </span>
          )}
        </span>
      )}

      {/* Error message */}
      {!operation.success && operation.error && (
        <span className="text-muted-foreground truncate">
          &mdash; {operation.error}
        </span>
      )}
    </div>
  )
}
