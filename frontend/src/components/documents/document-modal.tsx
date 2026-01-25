'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Document, DocumentType, DocumentStatus } from '@/lib/api'
import {
  useCreateDocument,
  useUpdateDocument,
  useDocumentVersions,
} from '@/hooks/use-documents'
import { useGroupContext } from '@/lib/group-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Save, History, Loader2, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

// Dynamic import for ByteMD editor to avoid SSR issues
const Editor = dynamic(
  () => import('@bytemd/react').then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        Loading editor...
      </div>
    ),
  }
)

// Import ByteMD styles
import 'bytemd/dist/index.css'

const DOCUMENT_TYPES: { value: DocumentType; label: string; description: string }[] = [
  { value: 'sop', label: 'SOP', description: 'Standard operating procedures and how-to guides' },
  { value: 'strategy', label: 'Strategy', description: 'Strategic plans and campaign documents' },
  { value: 'plan', label: 'Plan', description: 'Implementation plans and roadmaps' },
  { value: 'template', label: 'Template', description: 'Reusable document templates' },
  { value: 'reference', label: 'Reference', description: 'Reference materials and style guides' },
  { value: 'output', label: 'Output', description: 'Agent-generated deliverables' },
  { value: 'custom', label: 'Custom', description: 'Other document types' },
  { value: 'workflow-prompt', label: 'Workflow Prompt', description: 'Reusable prompts for workflow agent steps' },
]

const DOCUMENT_STATUSES: { value: DocumentStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
]

interface DocumentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Document | null
  isCreating: boolean
}

export function DocumentModal({
  open,
  onOpenChange,
  document,
  isCreating,
}: DocumentModalProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [type, setType] = useState<DocumentType>('custom')
  const [status, setStatus] = useState<DocumentStatus>('draft')
  const [tags, setTags] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const lastSavedRef = useRef<{
    title: string
    content: string
    summary: string
    type: DocumentType
    status: DocumentStatus
    tags: string
  } | null>(null)

  const createDocument = useCreateDocument()
  const updateDocument = useUpdateDocument()
  const { data: versionsData } = useDocumentVersions(document?._id || null)
  const { currentGroupId } = useGroupContext()

  // Initialize form when document changes
  useEffect(() => {
    if (document) {
      setTitle(document.title)
      setContent(document.content)
      setSummary(document.summary || '')
      setType(document.type)
      setStatus(document.status)
      setTags(document.tags?.join(', ') || '')
      lastSavedRef.current = {
        title: document.title,
        content: document.content,
        summary: document.summary || '',
        type: document.type,
        status: document.status,
        tags: document.tags?.join(', ') || '',
      }
    } else {
      setTitle('')
      setContent('')
      setSummary('')
      setType('custom')
      setStatus('draft')
      setTags('')
      lastSavedRef.current = null
    }
    setHasChanges(false)
  }, [document])

  // Track changes
  useEffect(() => {
    if (!lastSavedRef.current) {
      setHasChanges(isCreating && (title.trim() !== '' || content.trim() !== ''))
      return
    }
    const changed =
      title !== lastSavedRef.current.title ||
      content !== lastSavedRef.current.content ||
      summary !== lastSavedRef.current.summary ||
      type !== lastSavedRef.current.type ||
      status !== lastSavedRef.current.status ||
      tags !== lastSavedRef.current.tags
    setHasChanges(changed)
  }, [title, content, summary, type, status, tags, isCreating])

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    setIsSaving(true)
    try {
      const tagArray = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '')

      if (isCreating) {
        await createDocument.mutateAsync({
          title: title.trim(),
          content,
          summary: summary.trim() || undefined,
          type,
          status,
          tags: tagArray.length > 0 ? tagArray : undefined,
          groupId: currentGroupId || undefined,
        })
        toast.success('Document created')
        onOpenChange(false)
      } else if (document) {
        await updateDocument.mutateAsync({
          id: document._id,
          data: {
            title: title.trim(),
            content,
            summary: summary.trim() || undefined,
            type,
            status,
            tags: tagArray,
          },
        })
        lastSavedRef.current = { title, content, summary, type, status, tags }
        setHasChanges(false)
        toast.success('Document saved')
      }
    } catch (error) {
      toast.error('Failed to save document')
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }, [
    title,
    content,
    summary,
    type,
    status,
    tags,
    isCreating,
    document,
    createDocument,
    updateDocument,
    onOpenChange,
  ])

  // Auto-save debounce (only for edits, not creates)
  useEffect(() => {
    if (!hasChanges || isCreating || !document) return

    const timeout = setTimeout(() => {
      handleSave()
    }, 2000)

    return () => clearTimeout(timeout)
  }, [hasChanges, isCreating, document, handleSave])

  const versions = versionsData?.data || []

  // GFM plugin for GitHub Flavored Markdown
  const plugins = typeof window !== 'undefined'
    ? (() => {
        try {
          const gfm = require('@bytemd/plugin-gfm')
          return [typeof gfm.default === 'function' ? gfm.default() : gfm()]
        } catch {
          return []
        }
      })()
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0 [&>button]:hidden">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isCreating ? 'New document title...' : 'Document title'}
                className="text-xl font-semibold border-0 px-0 focus-visible:ring-0 h-auto py-0 bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {hasChanges && (
                <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400">
                  Unsaved
                </Badge>
              )}
              {document && (
                <Badge variant="secondary">v{document.version}</Badge>
              )}
              <Button onClick={handleSave} disabled={isSaving || !hasChanges} size="sm">
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {isCreating ? 'Create' : 'Save'}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main content area - Editor */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r overflow-hidden">
            {showHistory ? (
              /* History View */
              <div className="flex-1 overflow-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Version History
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => setShowHistory(false)}>
                    Back to Editor
                  </Button>
                </div>
                {versions.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No version history available
                  </div>
                ) : (
                  <div className="space-y-4">
                    {versions.map((version) => (
                      <div
                        key={version._id}
                        className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">v{version.version}</Badge>
                            <span className="font-medium">{version.title}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(version.modifiedAt), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                        {version.changeDescription && (
                          <p className="text-sm text-muted-foreground mt-2">
                            {version.changeDescription}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          by {version.modifiedByName || 'Unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Editor View */
              <div className="flex-1 min-h-0 overflow-hidden bytemd-container">
                <Editor
                  value={content}
                  plugins={plugins}
                  onChange={(v) => setContent(v)}
                />
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-72 flex-shrink-0 p-6 space-y-6 overflow-auto">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as DocumentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div>{t.label}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_TYPES.find(t => t.value === type)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as DocumentStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Summary</Label>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief description for search"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Used for semantic search matching
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags"
              />
              <p className="text-xs text-muted-foreground">
                e.g., marketing, social-media, q4
              </p>
            </div>

            {document && (
              <div className="space-y-4 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  <History className="h-4 w-4" />
                  {showHistory ? 'Back to Editor' : `History (${versions.length})`}
                </Button>
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Created: </span>
                    {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Updated: </span>
                    {formatDistanceToNow(new Date(document.updatedAt), { addSuffix: true })}
                  </div>
                  {document._resolved?.createdBy && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Author: </span>
                      {document._resolved.createdBy.displayName}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
