'use client'

import { useRef, useState, useCallback } from 'react'
import { Copy, Check, Pencil, X, Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { JsonViewer } from '@/components/ui/json-viewer'
import { Task } from '@/lib/api'
import { cn } from '@/lib/utils'

interface MetadataTabProps {
  task: Task
  onSave: (parsed: Record<string, unknown>) => Promise<void>
}

export function MetadataTab({ task, onSave }: MetadataTabProps) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const metadataTextareaRef = useRef<HTMLTextAreaElement>(null)
  const savedMetadataValueRef = useRef<string>('')
  const currentMetadataValueRef = useRef<string>('')

  const metadata = task.metadata as Record<string, unknown> | undefined
  const hasMetadata = metadata && Object.keys(metadata).length > 0

  // Format metadata for display/copy
  const formattedMetadata = hasMetadata
    ? JSON.stringify(metadata, null, 2)
    : ''

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formattedMetadata)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const parseMetadataJson = useCallback((value: string): { valid: boolean; parsed: unknown; error: string | null } => {
    const trimmed = value.trim()
    if (!trimmed) {
      return { valid: true, parsed: {}, error: null }
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, parsed: null, error: 'Must be a JSON object' }
      }
      return { valid: true, parsed, error: null }
    } catch {
      return { valid: false, parsed: null, error: 'Invalid JSON' }
    }
  }, [])

  const enterEditMode = useCallback(() => {
    const initialValue = JSON.stringify(metadata || {}, null, 2)
    savedMetadataValueRef.current = initialValue
    currentMetadataValueRef.current = initialValue
    setMetadataError(null)
    setIsEditMode(true)
    setTimeout(() => {
      if (metadataTextareaRef.current) {
        metadataTextareaRef.current.value = initialValue
        metadataTextareaRef.current.focus()
      }
    }, 0)
  }, [metadata])

  const handleReset = useCallback(() => {
    currentMetadataValueRef.current = savedMetadataValueRef.current
    if (metadataTextareaRef.current) {
      metadataTextareaRef.current.value = savedMetadataValueRef.current
    }
    setMetadataError(null)
  }, [])

  const handleSave = useCallback(async () => {
    const currentValue = currentMetadataValueRef.current
    const { valid, parsed, error } = parseMetadataJson(currentValue)
    setMetadataError(error)

    if (!valid) {
      setTimeout(() => {
        if (metadataTextareaRef.current) {
          metadataTextareaRef.current.value = currentMetadataValueRef.current
        }
      }, 0)
      return
    }

    try {
      await onSave(parsed as Record<string, unknown>)
      savedMetadataValueRef.current = currentValue
      setIsEditMode(false)
    } catch {
      // Silently fail
    }
  }, [parseMetadataJson, onSave])

  const handleCancel = useCallback(() => {
    setIsEditMode(false)
    setMetadataError(null)
  }, [])

  // Edit mode
  if (isEditMode) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Edit Metadata</h3>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1.5"
              onClick={handleReset}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="text-xs">Reset</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1.5"
              onClick={handleCancel}
            >
              <X className="h-3.5 w-3.5" />
              <span className="text-xs">Cancel</span>
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-7 px-2 gap-1.5"
              onClick={handleSave}
            >
              <Save className="h-3.5 w-3.5" />
              <span className="text-xs">Save</span>
            </Button>
          </div>
        </div>

        <textarea
          ref={metadataTextareaRef}
          onInput={(e) => {
            currentMetadataValueRef.current = (e.target as HTMLTextAreaElement).value
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation()
            }
          }}
          placeholder='{"key": "value"}'
          rows={16}
          className={cn(
            'flex w-full rounded-md border bg-background px-3 py-2 text-xs font-mono',
            'placeholder:text-muted-foreground resize-y transition-colors',
            'focus-visible:outline-none',
            metadataError
              ? 'border-destructive focus-visible:border-destructive'
              : 'border-input focus-visible:border-primary'
          )}
        />

        {metadataError && (
          <p className="text-xs text-destructive">{metadataError}</p>
        )}
      </div>
    )
  }

  // View mode - no metadata
  if (!hasMetadata) {
    return (
      <div className="p-4 flex flex-col items-center justify-center min-h-[200px] text-center">
        <p className="text-sm text-muted-foreground mb-3">
          No metadata available
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={enterEditMode}
          className="gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          Add Metadata
        </Button>
      </div>
    )
  }

  // View mode - has metadata
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Task Metadata</h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 gap-1.5"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />
                <span className="text-xs">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span className="text-xs">Copy</span>
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={enterEditMode}
            className="h-7 px-2 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="text-xs">Edit</span>
          </Button>
        </div>
      </div>

      <div className="p-3 bg-muted/50 rounded-lg border">
        <JsonViewer
          data={metadata}
          defaultExpanded={true}
          maxInitialDepth={3}
        />
      </div>
    </div>
  )
}
