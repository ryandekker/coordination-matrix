'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  FileText,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Unlink,
  Plus,
  Loader2,
  FileType,
  Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Document, DocumentStatus, DocumentType } from '@/lib/api'
import Link from 'next/link'

const STATUS_COLORS: Record<DocumentStatus, string> = {
  draft: 'bg-yellow-500',
  review: 'bg-blue-500',
  approved: 'bg-green-500',
  archived: 'bg-gray-500',
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  archived: 'Archived',
}

const TYPE_LABELS: Record<DocumentType, string> = {
  sop: 'SOP',
  strategy: 'Strategy',
  plan: 'Plan',
  template: 'Template',
  reference: 'Reference',
  output: 'Output',
  custom: 'Custom',
  'workflow-prompt': 'Workflow Prompt',
}

interface AttachedDocumentsProps {
  taskId: string
  documents: Document[]
  isLoading: boolean
  onDetach: (documentId: string) => void
  isDetaching?: boolean
  onAttachClick?: () => void
}

export function AttachedDocuments({
  taskId,
  documents,
  isLoading,
  onDetach,
  isDetaching,
  onAttachClick,
}: AttachedDocumentsProps) {
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())
  const [detachDocId, setDetachDocId] = useState<string | null>(null)

  const toggleExpanded = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const handleDetachConfirm = () => {
    if (detachDocId) {
      onDetach(detachDocId)
      setDetachDocId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading documents...</span>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Attached Documents {documents.length > 0 && `(${documents.length})`}
        </label>
        {onAttachClick && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={onAttachClick}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Attach
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach a document to this task</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed rounded-lg">
          <FileText className="h-8 w-8 mb-2 opacity-50" />
          <span className="text-sm">No documents attached</span>
          <span className="text-xs mt-1 opacity-75">
            Documents can be attached to provide context or store outputs
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map(doc => {
            const isExpanded = expandedDocs.has(doc._id)
            return (
              <div
                key={doc._id}
                className="border rounded-lg overflow-hidden bg-card"
              >
                {/* Document Header */}
                <div
                  className={cn(
                    'flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50 transition-colors',
                    isExpanded && 'border-b'
                  )}
                  onClick={() => toggleExpanded(doc._id)}
                >
                  <button className="p-0.5 hover:bg-muted rounded">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium text-sm flex-1 truncate">
                    {doc.title}
                  </span>
                  <Badge
                    variant="outline"
                    className="gap-1 text-xs flex-shrink-0"
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        STATUS_COLORS[doc.status]
                      )}
                    />
                    {STATUS_LABELS[doc.status]}
                  </Badge>
                  <Badge variant="secondary" className="text-xs flex-shrink-0">
                    {TYPE_LABELS[doc.type]}
                  </Badge>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-3 space-y-3">
                    {/* Document meta */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileType className="h-3 w-3" />
                        v{doc.version}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Updated{' '}
                        {formatDistanceToNow(new Date(doc.updatedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {doc._resolved?.createdBy && (
                        <span>by {doc._resolved.createdBy.displayName}</span>
                      )}
                    </div>

                    {/* Summary if present */}
                    {doc.summary && (
                      <p className="text-sm text-muted-foreground bg-muted/50 rounded p-2">
                        {doc.summary}
                      </p>
                    )}

                    {/* Markdown Content */}
                    <div className="border rounded-lg p-4 bg-background max-h-[400px] overflow-auto">
                      <article className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {doc.content}
                        </ReactMarkdown>
                      </article>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" asChild>
                              <Link
                                href={`/documents/${doc._id}`}
                                target="_blank"
                              >
                                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                View Full
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Open document in new tab
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={e => {
                                e.stopPropagation()
                                setDetachDocId(doc._id)
                              }}
                              disabled={isDetaching}
                            >
                              <Unlink className="h-3.5 w-3.5 mr-1" />
                              Detach
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Remove document from this task
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Detach confirmation dialog */}
      <AlertDialog
        open={!!detachDocId}
        onOpenChange={open => !open && setDetachDocId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the document from this task. The document itself
              will not be deleted and can be re-attached later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDetachConfirm}>
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
