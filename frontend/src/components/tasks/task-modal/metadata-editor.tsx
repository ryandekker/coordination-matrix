'use client'

import { Button } from '@/components/ui/button'
import { JsonViewer } from '@/components/ui/json-viewer'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/api'

interface MetadataEditorProps {
  task: Task | null
  isEditMode: boolean
  setIsEditMode: (value: boolean) => void
  metadataError: string | null
  setMetadataError: (error: string | null) => void
  metadataTextareaRef: React.RefObject<HTMLTextAreaElement>
  savedMetadataValueRef: React.MutableRefObject<string>
  currentMetadataValueRef: React.MutableRefObject<string>
  onSave: (parsed: Record<string, unknown>) => Promise<void>
  parseMetadataJson: (value: string) => { valid: boolean; parsed: unknown; error: string | null }
}

export function MetadataEditor({
  task,
  isEditMode,
  setIsEditMode,
  metadataError,
  setMetadataError,
  metadataTextareaRef,
  savedMetadataValueRef,
  currentMetadataValueRef,
  onSave,
  parseMetadataJson,
}: MetadataEditorProps) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Task Metadata</label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px]"
          onClick={() => {
            if (!isEditMode) {
              // Switching to edit mode - store the initial value
              const initialValue = JSON.stringify(task?.metadata || {}, null, 2)
              savedMetadataValueRef.current = initialValue
              currentMetadataValueRef.current = initialValue
              setMetadataError(null)
              // Set textarea value after it mounts
              setTimeout(() => {
                if (metadataTextareaRef.current) {
                  metadataTextareaRef.current.value = initialValue
                }
              }, 0)
            }
            setIsEditMode(!isEditMode)
          }}
        >
          {isEditMode ? 'View' : 'Edit'}
        </Button>
      </div>

      {isEditMode ? (
        // Edit mode - uncontrolled JSON textarea (ref-based to avoid re-render lag)
        <div className="space-y-1">
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
            rows={12}
            className={cn(
              'flex w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono',
              'placeholder:text-muted-foreground resize-y transition-colors',
              'focus-visible:outline-none',
              metadataError
                ? 'border-destructive focus-visible:border-destructive'
                : 'border-input focus-visible:border-primary'
            )}
          />
          <div className="flex items-center justify-between">
            {metadataError ? (
              <p className="text-[10px] text-destructive">{metadataError}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">&nbsp;</p>
            )}
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  currentMetadataValueRef.current = savedMetadataValueRef.current
                  if (metadataTextareaRef.current) {
                    metadataTextareaRef.current.value = savedMetadataValueRef.current
                  }
                  setMetadataError(null)
                  setTimeout(() => {
                    if (metadataTextareaRef.current) {
                      metadataTextareaRef.current.value = currentMetadataValueRef.current
                    }
                  }, 0)
                }}
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={async () => {
                  if (!task) return
                  const currentValue = currentMetadataValueRef.current
                  const { valid, parsed, error } = parseMetadataJson(currentValue)
                  setMetadataError(error)
                  setTimeout(() => {
                    if (metadataTextareaRef.current) {
                      metadataTextareaRef.current.value = currentMetadataValueRef.current
                    }
                  }, 0)
                  if (!valid) return
                  try {
                    await onSave(parsed as Record<string, unknown>)
                    savedMetadataValueRef.current = currentValue
                    setIsEditMode(false)
                  } catch {
                    // Silently fail
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // View mode - collapsible tree view
        <div className="px-3 py-2 text-sm bg-muted/50 rounded-md border max-h-[calc(100vh-300px)] overflow-y-auto">
          <JsonViewer
            data={task?.metadata}
            defaultExpanded={true}
            maxInitialDepth={2}
          />
        </div>
      )}
    </div>
  )
}
