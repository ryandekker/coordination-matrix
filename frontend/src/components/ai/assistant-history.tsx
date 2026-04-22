'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, History, MessageCircle, Pencil, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useDocuments } from '@/hooks/use-documents'
import { useGroupContext } from '@/lib/group-context'
import { cn } from '@/lib/utils'
import { RichAnswerPanel, parseRichAnswer } from './rich-answer-panel'
import type { Document } from '@/lib/api'

interface AssistantHistoryProps {
  contextType: 'workflow' | 'document'
  contextId: string
  /** When true, the list is collapsed by default. Defaults to false (expanded). */
  defaultCollapsed?: boolean
  className?: string
}

export function AssistantHistory({
  contextType,
  contextId,
  defaultCollapsed = false,
  className,
}: AssistantHistoryProps) {
  const { currentGroupId } = useGroupContext()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useDocuments({
    type: 'output',
    richAnswerContext: contextType,
    richAnswerTargetId: contextId,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
    limit: 25,
    groupId: currentGroupId || undefined,
    enabled: !!contextId,
  })

  const docs = useMemo<Document[]>(() => data?.data || [], [data])

  if (!isLoading && docs.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-col border-b bg-muted/20 flex-shrink-0', !collapsed && 'max-h-[50%]', className)}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-muted/40 transition-colors flex-shrink-0"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Recent answers</span>
          {!isLoading && (
            <span className="text-xs text-muted-foreground">({docs.length})</span>
          )}
        </div>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="px-2 pb-2 space-y-1 overflow-auto min-h-0">
          {docs.map(doc => {
            const isExpanded = expandedId === doc._id
            const richAnswer = isExpanded ? parseRichAnswer(doc.metadata?.richAnswer) : null
            const ra = doc.metadata?.richAnswer as Record<string, unknown> | undefined
            const instruction = typeof ra?.sourceInstruction === 'string' ? ra.sourceInstruction : undefined
            const isEdit = Array.isArray(doc.tags) && doc.tags.includes('ai-edit')

            return (
              <div key={doc._id} className="rounded-md border bg-background overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : doc._id)}
                  className="w-full px-2.5 py-2 flex items-start gap-2 text-left text-xs hover:bg-muted/30 transition-colors"
                >
                  {isEdit ? (
                    <Pencil className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                  ) : (
                    <MessageCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {instruction || doc.title}
                    </div>
                    {doc.summary && (
                      <div className="text-muted-foreground truncate mt-0.5">
                        {doc.summary}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap">
                    {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
                  </span>
                </button>

                {isExpanded && richAnswer && (
                  <div className="border-t p-3 bg-background max-h-[480px] overflow-auto">
                    <RichAnswerPanel data={richAnswer} hideDocumentLink={false} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
