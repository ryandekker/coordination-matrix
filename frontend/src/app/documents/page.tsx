'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useDocuments, useCreateDocument, useDeleteDocument } from '@/hooks/use-documents'
import { useGroupContext } from '@/lib/group-context'
import { useAuth } from '@/lib/auth'
import { Document, DocumentType, DocumentStatus, authFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Plus,
  Search,
  MoreHorizontal,
  FileEdit,
  Eye,
  Trash2,
  Archive,
  History,
  FolderInput,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { DocumentModal } from '@/components/documents/document-modal'
import { useMutation, useQueryClient } from '@tanstack/react-query'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'sop', label: 'SOP' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'plan', label: 'Plan' },
  { value: 'template', label: 'Template' },
  { value: 'reference', label: 'Reference' },
  { value: 'output', label: 'Output' },
  { value: 'custom', label: 'Custom' },
  { value: 'workflow-prompt', label: 'Workflow Prompt' },
]

const DOCUMENT_STATUSES: { value: DocumentStatus; label: string; color: string }[] = [
  { value: 'draft', label: 'Draft', color: 'bg-yellow-500' },
  { value: 'review', label: 'In Review', color: 'bg-blue-500' },
  { value: 'approved', label: 'Approved', color: 'bg-green-500' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-500' },
]

function getStatusBadge(status: DocumentStatus) {
  const statusConfig = DOCUMENT_STATUSES.find((s) => s.value === status)
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={`h-2 w-2 rounded-full ${statusConfig?.color || 'bg-gray-500'}`} />
      {statusConfig?.label || status}
    </Badge>
  )
}

function getTypeBadge(type: DocumentType) {
  const typeConfig = DOCUMENT_TYPES.find((t) => t.value === type)
  return <Badge variant="secondary">{typeConfig?.label || type}</Badge>
}

// Bulk move API function
async function bulkMoveDocuments(documentIds: string[], targetGroupId: string, targetProjectId?: string | null) {
  const response = await authFetch(`${API_BASE}/documents/bulk-move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds, targetGroupId, targetProjectId }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to move documents')
  }
  return response.json()
}

export default function DocumentsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { currentGroupId, groups } = useGroupContext()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('all')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  // Bulk selection state
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [targetGroupId, setTargetGroupId] = useState<string>('')

  // Check if user can bulk move (admin or has multiple groups)
  const isAdmin = user?.role === 'admin'
  const canBulkMove = isAdmin || groups.length > 1

  const { data, isLoading, error } = useDocuments({
    search: search || undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    includeArchived,
    resolveReferences: true,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
    groupId: currentGroupId || undefined,
  })

  const createDocument = useCreateDocument()
  const deleteDocument = useDeleteDocument()

  // Bulk move mutation
  const bulkMoveMutation = useMutation({
    mutationFn: ({ docIds, groupId }: { docIds: string[]; groupId: string }) =>
      bulkMoveDocuments(docIds, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setSelectedDocIds(new Set())
      setMoveDialogOpen(false)
      setTargetGroupId('')
    },
  })

  const documents = useMemo(() => data?.data || [], [data])

  // Selection handlers
  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedDocIds.size === documents.length) {
      setSelectedDocIds(new Set())
    } else {
      setSelectedDocIds(new Set(documents.map((d) => d._id)))
    }
  }

  const clearSelection = () => {
    setSelectedDocIds(new Set())
  }

  const handleBulkMove = () => {
    if (selectedDocIds.size === 0) return
    setMoveDialogOpen(true)
  }

  const confirmBulkMove = () => {
    if (!targetGroupId || selectedDocIds.size === 0) return
    bulkMoveMutation.mutate({
      docIds: Array.from(selectedDocIds),
      groupId: targetGroupId,
    })
  }

  const handleCreateDocument = async () => {
    setSelectedDocument(null)
    setIsCreating(true)
    setModalOpen(true)
  }

  const handleEditDocument = (doc: Document) => {
    setSelectedDocument(doc)
    setIsCreating(false)
    setModalOpen(true)
  }

  const handleViewDocument = (doc: Document) => {
    router.push(`/documents/${doc._id}`)
  }

  const handleArchiveDocument = async (doc: Document) => {
    if (confirm('Are you sure you want to archive this document?')) {
      await deleteDocument.mutateAsync({ id: doc._id, permanent: false })
    }
  }

  const handleDeleteDocument = async (doc: Document) => {
    if (
      confirm(
        'Are you sure you want to permanently delete this document? This cannot be undone.'
      )
    ) {
      await deleteDocument.mutateAsync({ id: doc._id, permanent: true })
    }
  }

  const handleModalClose = () => {
    setModalOpen(false)
    setSelectedDocument(null)
    setIsCreating(false)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <Button onClick={handleCreateDocument}>
          <Plus className="mr-2 h-4 w-4" />
          New Document
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as DocumentType | 'all')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {DOCUMENT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as DocumentStatus | 'all')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {DOCUMENT_STATUSES.filter((s) => s.value !== 'archived').map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded border-gray-300"
          />
          Include archived
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading documents...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-destructive">Error loading documents</div>
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="text-muted-foreground">No documents found</div>
            <Button variant="outline" onClick={handleCreateDocument}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first document
            </Button>
          </div>
        ) : (
          <>
            {/* Bulk Action Bar */}
            {canBulkMove && selectedDocIds.size > 0 && (
              <div className="mb-4 flex items-center gap-4 rounded-lg border bg-muted/50 p-3">
                <span className="text-sm font-medium">
                  {selectedDocIds.size} document{selectedDocIds.size !== 1 ? 's' : ''} selected
                </span>
                <Button size="sm" variant="outline" onClick={handleBulkMove}>
                  <FolderInput className="mr-2 h-4 w-4" />
                  Move to Group
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  <X className="mr-2 h-4 w-4" />
                  Clear Selection
                </Button>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  {canBulkMove && (
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={documents.length > 0 && selectedDocIds.size === documents.length}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all documents"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-[40%]">Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow
                    key={doc._id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleEditDocument(doc)}
                  >
                    {canBulkMove && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedDocIds.has(doc._id)}
                          onCheckedChange={() => toggleDocSelection(doc._id)}
                          aria-label={`Select ${doc.title}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="font-medium">{doc.title}</div>
                    {doc.summary && (
                      <div className="text-sm text-muted-foreground line-clamp-1">
                        {doc.summary}
                      </div>
                    )}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {doc.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {doc.tags.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{doc.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{getTypeBadge(doc.type)}</TableCell>
                  <TableCell>{getStatusBadge(doc.status)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">v{doc.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
                    </div>
                    {doc._resolved?.lastModifiedBy && (
                      <div className="text-xs text-muted-foreground">
                        by {doc._resolved.lastModifiedBy.displayName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleViewDocument(doc)
                          }}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEditDocument(doc)
                          }}
                        >
                          <FileEdit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/documents/${doc._id}/history`)
                          }}
                        >
                          <History className="mr-2 h-4 w-4" />
                          Version History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {doc.status !== 'archived' && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              handleArchiveDocument(doc)
                            }}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteDocument(doc)
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete permanently
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>

      {/* Pagination info */}
      {data?.pagination && (
        <div className="border-t px-6 py-2 text-sm text-muted-foreground">
          Showing {documents.length} of {data.pagination.total} documents
        </div>
      )}

      {/* Document Modal */}
      <DocumentModal
        open={modalOpen}
        onOpenChange={handleModalClose}
        document={selectedDocument}
        isCreating={isCreating}
      />

      {/* Bulk Move Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Documents to Group</DialogTitle>
            <DialogDescription>
              Move {selectedDocIds.size} selected document{selectedDocIds.size !== 1 ? 's' : ''} to a different group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Group</label>
              <Select value={targetGroupId} onValueChange={setTargetGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a group" />
                </SelectTrigger>
                <SelectContent>
                  {groups
                    .filter((g) => g._id !== currentGroupId)
                    .map((group) => (
                      <SelectItem key={group._id} value={group._id}>
                        {group.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {bulkMoveMutation.isError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {bulkMoveMutation.error instanceof Error
                  ? bulkMoveMutation.error.message
                  : 'Failed to move documents'}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmBulkMove}
              disabled={!targetGroupId || bulkMoveMutation.isPending}
            >
              {bulkMoveMutation.isPending ? 'Moving...' : 'Move Documents'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
