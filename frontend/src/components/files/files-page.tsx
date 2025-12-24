'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import { format } from 'date-fns'
import {
  Upload,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileCode,
  FileSpreadsheet,
  Download,
  Trash2,
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  ExternalLink,
  Search,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { filesApi, FileDocument, FileSource } from '@/lib/api'
import { cn } from '@/lib/utils'
import Link from 'next/link'

// Get appropriate icon for file type
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.startsWith('audio/')) return FileAudio
  if (mimeType.startsWith('text/')) return FileText
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) return FileSpreadsheet
  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html')) return FileCode
  return File
}

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Get source label
function getSourceLabel(source: string): string {
  switch (source) {
    case 'user': return 'User'
    case 'ai-tool': return 'AI Tool'
    case 'webhook': return 'Webhook'
    case 'workflow-step': return 'Workflow'
    default: return source
  }
}

// Get source color
function getSourceColor(source: string): string {
  switch (source) {
    case 'user': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'ai-tool': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
    case 'webhook': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    case 'workflow-step': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  }
}

export function FilesPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<FileSource | 'all'>('all')
  const [permanentFilter, setPermanentFilter] = useState<'all' | 'permanent' | 'temp'>('all')
  const [mimeTypeFilter, setMimeTypeFilter] = useState<string>('all')
  const limit = 20

  // Fetch files
  const { data, isLoading, error } = useQuery({
    queryKey: ['files', page, search, sourceFilter, permanentFilter, mimeTypeFilter],
    queryFn: async () => {
      const params: Parameters<typeof filesApi.list>[0] = {
        page,
        limit,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }
      if (search) params.search = search
      if (sourceFilter !== 'all') params.source = sourceFilter
      if (permanentFilter === 'permanent') params.permanent = true
      if (permanentFilter === 'temp') params.permanent = false
      if (mimeTypeFilter !== 'all') params.mimeType = mimeTypeFilter

      return filesApi.list(params)
    },
  })

  // Toggle permanent mutation
  const togglePermanentMutation = useMutation({
    mutationFn: async ({ id, permanent }: { id: string; permanent: boolean }) => {
      return filesApi.update(id, { permanent })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await filesApi.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })

  const files = data?.data || []
  const pagination = data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 }

  const clearFilters = () => {
    setSearch('')
    setSourceFilter('all')
    setPermanentFilter('all')
    setMimeTypeFilter('all')
    setPage(1)
  }

  const hasActiveFilters = search || sourceFilter !== 'all' || permanentFilter !== 'all' || mimeTypeFilter !== 'all'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Files</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage files attached to tasks and workflows
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {pagination.total} file{pagination.total !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9"
            />
          </div>

          <Select
            value={sourceFilter}
            onValueChange={(value) => {
              setSourceFilter(value as FileSource | 'all')
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="ai-tool">AI Tool</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="workflow-step">Workflow</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={permanentFilter}
            onValueChange={(value) => {
              setPermanentFilter(value as 'all' | 'permanent' | 'temp')
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Storage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Files</SelectItem>
              <SelectItem value="permanent">Permanent</SelectItem>
              <SelectItem value="temp">Temporary</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={mimeTypeFilter}
            onValueChange={(value) => {
              setMimeTypeFilter(value)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="image/">Images</SelectItem>
              <SelectItem value="video/">Videos</SelectItem>
              <SelectItem value="audio/">Audio</SelectItem>
              <SelectItem value="application/pdf">PDF</SelectItem>
              <SelectItem value="text/">Text</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading files...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-destructive">
            <AlertCircle className="h-6 w-6 mr-2" />
            Failed to load files
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <File className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No files found</p>
            <p className="text-sm mt-1">
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'Upload files by attaching them to tasks'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="w-[100px]">Size</TableHead>
                <TableHead className="w-[100px]">Source</TableHead>
                <TableHead className="w-[150px]">Attached To</TableHead>
                <TableHead className="w-[120px]">Created</TableHead>
                <TableHead className="w-[120px]">Expires</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => {
                const Icon = getFileIcon(file.mimeType)
                const isImage = file.mimeType.startsWith('image/')

                return (
                  <TableRow key={file._id}>
                    <TableCell>
                      {isImage ? (
                        <a href={file.url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={file.url}
                            alt={file.filename}
                            className="w-10 h-10 object-cover rounded border border-border hover:border-primary transition-colors"
                          />
                        </a>
                      ) : (
                        <div className="w-10 h-10 flex items-center justify-center bg-muted rounded">
                          <Icon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline flex items-center gap-1"
                      >
                        {file.filename}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </a>
                      {file.sourceDetails?.toolName && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Generated by {file.sourceDetails.toolName}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatFileSize(file.size)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={cn('text-xs', getSourceColor(file.source))}
                      >
                        {getSourceLabel(file.source)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {file.attachedTo.type === 'task' ? (
                        <Link
                          href={`/tasks?taskId=${file.attachedTo.id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          View Task
                        </Link>
                      ) : (
                        <Link
                          href={`/workflow-runs?runId=${file.attachedTo.id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          View Run
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(file.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      {file.permanent ? (
                        <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Permanent
                        </span>
                      ) : file.expiresAt ? (
                        <span className="text-sm text-amber-600 dark:text-amber-400">
                          {format(new Date(file.expiresAt), 'MMM d')}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => togglePermanentMutation.mutate({
                                  id: file._id,
                                  permanent: !file.permanent,
                                })}
                                disabled={togglePermanentMutation.isPending}
                              >
                                {file.permanent ? (
                                  <Lock className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Unlock className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {file.permanent ? 'Remove permanent status' : 'Make permanent'}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                asChild
                              >
                                <a href={file.url} download={file.filename}>
                                  <Download className="h-4 w-4 text-muted-foreground" />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <AlertDialog>
                          <TooltipProvider>
                            <Tooltip>
                              <AlertDialogTrigger asChild>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    disabled={deleteMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                              </AlertDialogTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete file?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete &quot;{file.filename}&quot;. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(file._id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex-shrink-0 border-t border-border px-6 py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} files
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                Page {page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
