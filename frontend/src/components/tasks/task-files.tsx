'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
import { filesApi, FileDocument } from '@/lib/api'
import { cn } from '@/lib/utils'

interface TaskFilesProps {
  taskId: string
  className?: string
  compact?: boolean
}

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
    case 'ai-tool': return 'AI'
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

export function TaskFiles({ taskId, className, compact = false }: TaskFilesProps) {
  const queryClient = useQueryClient()
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set())
  const [makePermanent, setMakePermanent] = useState(false)

  // Fetch files for this task
  const { data, isLoading, error } = useQuery({
    queryKey: ['task-files', taskId],
    queryFn: async () => {
      const response = await filesApi.getTaskFiles(taskId)
      return response.data
    },
  })

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return filesApi.upload(file, {
        attachToType: 'task',
        attachToId: taskId,
        source: 'user',
        permanent: makePermanent,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-files', taskId] })
    },
  })

  // Toggle permanent mutation
  const togglePermanentMutation = useMutation({
    mutationFn: async ({ id, permanent }: { id: string; permanent: boolean }) => {
      return filesApi.update(id, { permanent })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-files', taskId] })
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await filesApi.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-files', taskId] })
    },
  })

  // Handle file drop
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      const fileKey = `${file.name}-${file.size}`
      setUploadingFiles(prev => new Set(prev).add(fileKey))
      try {
        await uploadMutation.mutateAsync(file)
      } finally {
        setUploadingFiles(prev => {
          const next = new Set(prev)
          next.delete(fileKey)
          return next
        })
      }
    }
  }, [uploadMutation])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  })

  const files = data || []
  const isUploading = uploadingFiles.size > 0

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Upload area */}
      <div className="p-4 border-b border-border">
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            isUploading && 'opacity-50 pointer-events-none'
          )}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Uploading...</span>
            </div>
          ) : (
            <>
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragActive ? 'Drop files here' : 'Drag & drop files or click to upload'}
              </p>
            </>
          )}
        </div>

        {/* Permanent checkbox */}
        <div className="flex items-center gap-2 mt-3">
          <Checkbox
            id="make-permanent"
            checked={makePermanent}
            onCheckedChange={(checked) => setMakePermanent(checked === true)}
          />
          <label htmlFor="make-permanent" className="text-xs text-muted-foreground cursor-pointer">
            Keep files permanently (otherwise expires in 3 days)
          </label>
        </div>
      </div>

      {/* Files list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading files...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-destructive">
            <AlertCircle className="h-5 w-5 mr-2" />
            Failed to load files
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <File className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No files attached</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => (
              <FileItem
                key={file._id}
                file={file}
                compact={compact}
                onTogglePermanent={(permanent) => {
                  togglePermanentMutation.mutate({ id: file._id, permanent })
                }}
                onDelete={() => deleteMutation.mutate(file._id)}
                isUpdating={togglePermanentMutation.isPending || deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface FileItemProps {
  file: FileDocument
  compact?: boolean
  onTogglePermanent: (permanent: boolean) => void
  onDelete: () => void
  isUpdating: boolean
}

function FileItem({ file, compact, onTogglePermanent, onDelete, isUpdating }: FileItemProps) {
  const Icon = getFileIcon(file.mimeType)
  const isImage = file.mimeType.startsWith('image/')

  return (
    <div className="p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        {/* Thumbnail or icon */}
        <div className="flex-shrink-0">
          {isImage ? (
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              <img
                src={file.url}
                alt={file.filename}
                className="w-12 h-12 object-cover rounded border border-border hover:border-primary transition-colors"
              />
            </a>
          ) : (
            <div className="w-12 h-12 flex items-center justify-center bg-muted rounded">
              <Icon className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium truncate hover:underline flex items-center gap-1"
            >
              {file.filename}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(file.createdAt), 'MMM d, yyyy')}
            </span>
            <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', getSourceColor(file.source))}>
              {getSourceLabel(file.source)}
            </Badge>
          </div>

          {!compact && file.expiresAt && !file.permanent && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Expires {format(new Date(file.expiresAt), 'MMM d, yyyy')}
            </p>
          )}

          {!compact && file.sourceDetails?.toolName && (
            <p className="text-xs text-muted-foreground mt-1">
              Generated by {file.sourceDetails.toolName}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onTogglePermanent(!file.permanent)}
                  disabled={isUpdating}
                >
                  {file.permanent ? (
                    <Lock className="h-4 w-4 text-green-600" />
                  ) : (
                    <Unlock className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {file.permanent ? 'Stored permanently' : 'Click to keep permanently'}
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
                      disabled={isUpdating}
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
                <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
