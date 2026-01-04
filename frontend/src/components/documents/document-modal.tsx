'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Document, DocumentType, DocumentStatus } from '@/lib/api'
import {
  useCreateDocument,
  useUpdateDocument,
  useDocumentVersions,
} from '@/hooks/use-documents'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  Save,
  Eye,
  History,
  FileEdit,
  Loader2,
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'sop', label: 'SOP' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'plan', label: 'Plan' },
  { value: 'template', label: 'Template' },
  { value: 'reference', label: 'Reference' },
  { value: 'output', label: 'Output' },
  { value: 'custom', label: 'Custom' },
]

const DOCUMENT_STATUSES: { value: DocumentStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
]

// Toolbar component for the editor
function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/30">
      <Toggle
        size="sm"
        pressed={editor.isActive('bold')}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        aria-label="Bold"
      >
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('italic')}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Italic"
      >
        <Italic className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('strike')}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
        aria-label="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('code')}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
        aria-label="Code"
      >
        <Code className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 1 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        aria-label="Heading 1"
      >
        <Heading1 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 2 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 3 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label="Heading 3"
      >
        <Heading3 className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Toggle
        size="sm"
        pressed={editor.isActive('bulletList')}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        aria-label="Bullet List"
      >
        <List className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('orderedList')}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label="Ordered List"
      >
        <ListOrdered className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('blockquote')}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        aria-label="Quote"
      >
        <Quote className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('codeBlock')}
        onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
        aria-label="Code Block"
      >
        <Code className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo className="h-4 w-4" />
      </Button>
    </div>
  )
}

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
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'history'>('edit')
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

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing your document...',
      }),
    ],
    content: '',
    immediatelyRender: false, // Avoid SSR hydration mismatches
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      // Convert to markdown-like text (simplified)
      const html = editor.getHTML()
      setContent(html)
    },
  })

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
      // Set editor content
      if (editor) {
        editor.commands.setContent(document.content || '')
      }
    } else {
      setTitle('')
      setContent('')
      setSummary('')
      setType('custom')
      setStatus('draft')
      setTags('')
      lastSavedRef.current = null
      if (editor) {
        editor.commands.setContent('')
      }
    }
    setHasChanges(false)
  }, [document, editor])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0 [&>button]:hidden">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">
              {isCreating ? 'New Document' : 'Edit Document'}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {hasChanges && (
                <Badge variant="outline" className="text-yellow-600">
                  Unsaved changes
                </Badge>
              )}
              {document && (
                <Badge variant="outline">v{document.version}</Badge>
              )}
              <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {isCreating ? 'Create' : 'Save'}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                <span className="sr-only">Close</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0 border-r">
            {/* Title input */}
            <div className="px-6 py-3 border-b">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Document title"
                className="text-lg font-medium border-0 px-0 focus-visible:ring-0"
              />
            </div>

            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as 'edit' | 'preview' | 'history')}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="px-6 border-b">
                <TabsList className="bg-transparent h-10">
                  <TabsTrigger value="edit" className="gap-2">
                    <FileEdit className="h-4 w-4" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="gap-2">
                    <Eye className="h-4 w-4" />
                    Preview
                  </TabsTrigger>
                  {!isCreating && (
                    <TabsTrigger value="history" className="gap-2">
                      <History className="h-4 w-4" />
                      History ({versions.length})
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <TabsContent value="edit" className="flex-1 m-0 overflow-hidden flex flex-col">
                <EditorToolbar editor={editor} />
                <div className="flex-1 overflow-auto">
                  <EditorContent editor={editor} className="h-full" />
                </div>
              </TabsContent>

              <TabsContent value="preview" className="flex-1 m-0 overflow-auto p-6">
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <div dangerouslySetInnerHTML={{ __html: content }} />
                </article>
              </TabsContent>

              <TabsContent value="history" className="flex-1 m-0 overflow-auto p-6">
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
              </TabsContent>
            </Tabs>
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
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                placeholder="Brief description of this document"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags"
              />
              <p className="text-xs text-muted-foreground">
                Separate multiple tags with commas
              </p>
            </div>

            {document && (
              <div className="space-y-2 pt-4 border-t">
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
