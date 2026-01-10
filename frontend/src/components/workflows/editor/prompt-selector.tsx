'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  FileText,
  Plus,
  X,
  Search,
  Info,
  Loader2,
  GripVertical,
} from 'lucide-react'
import { documentsApi, Document } from '@/lib/api'

interface PromptSelectorProps {
  selectedPromptIds: string[]
  onChange: (promptIds: string[]) => void
  className?: string
}

// Cache for loaded prompts to avoid refetching
const promptCache = new Map<string, Document>()

export function PromptSelector({
  selectedPromptIds,
  onChange,
  className,
}: PromptSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [prompts, setPrompts] = useState<Document[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPrompts, setSelectedPrompts] = useState<Document[]>([])

  // Load available prompts
  const loadPrompts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await documentsApi.listWorkflowPrompts({
        status: ['approved', 'draft', 'review'],
        search: search || undefined,
      })
      const docs = response.data || []
      setPrompts(docs)
      // Update cache
      docs.forEach(doc => promptCache.set(doc._id, doc))
    } catch (error) {
      console.error('Failed to load workflow prompts:', error)
    } finally {
      setLoading(false)
    }
  }, [search])

  // Load prompts when popover opens or search changes
  useEffect(() => {
    if (open) {
      loadPrompts()
    }
  }, [open, loadPrompts])

  // Load selected prompts data
  useEffect(() => {
    const loadSelectedPrompts = async () => {
      const loaded: Document[] = []
      const toFetch: string[] = []

      for (const id of selectedPromptIds) {
        const cached = promptCache.get(id)
        if (cached) {
          loaded.push(cached)
        } else {
          toFetch.push(id)
        }
      }

      // Fetch any prompts not in cache
      for (const id of toFetch) {
        try {
          const response = await documentsApi.get(id)
          if (response.data) {
            loaded.push(response.data)
            promptCache.set(id, response.data)
          }
        } catch (error) {
          console.error(`Failed to load prompt ${id}:`, error)
        }
      }

      // Sort by original order
      const orderedPrompts = selectedPromptIds
        .map(id => loaded.find(p => p._id === id))
        .filter((p): p is Document => p !== undefined)

      setSelectedPrompts(orderedPrompts)
    }

    loadSelectedPrompts()
  }, [selectedPromptIds])

  const handleSelect = (prompt: Document) => {
    if (!selectedPromptIds.includes(prompt._id)) {
      onChange([...selectedPromptIds, prompt._id])
    }
    setOpen(false)
    setSearch('')
  }

  const handleRemove = (promptId: string) => {
    onChange(selectedPromptIds.filter(id => id !== promptId))
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const newIds = [...selectedPromptIds]
    ;[newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]]
    onChange(newIds)
  }

  const handleMoveDown = (index: number) => {
    if (index === selectedPromptIds.length - 1) return
    const newIds = [...selectedPromptIds]
    ;[newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]]
    onChange(newIds)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      case 'draft':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'review':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
    }
  }

  // Filter out already selected prompts
  const availablePrompts = prompts.filter(p => !selectedPromptIds.includes(p._id))

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        Prompt Library
        <span className="text-xs text-muted-foreground">(optional)</span>
      </label>

      {/* Selected prompts */}
      {selectedPrompts.length > 0 && (
        <div className="space-y-1.5">
          {selectedPrompts.map((prompt, index) => (
            <div
              key={prompt._id}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border text-sm group"
            >
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="h-3 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <GripVertical className="h-3 w-3 rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === selectedPrompts.length - 1}
                  className="h-3 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <GripVertical className="h-3 w-3 rotate-90" />
                </button>
              </div>
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate">{prompt.title}</span>
              <Badge variant="secondary" className={cn('text-xs', getStatusColor(prompt.status))}>
                {prompt.status}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => handleRemove(prompt._id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add prompt button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start text-muted-foreground"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add prompt from library...
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search prompts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <ScrollArea className="h-[200px]">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : availablePrompts.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {prompts.length === 0 ? (
                  <>No workflow prompts found.<br />Create one in Documents.</>
                ) : (
                  'All prompts already selected'
                )}
              </div>
            ) : (
              <div className="p-1">
                {availablePrompts.map((prompt) => (
                  <button
                    key={prompt._id}
                    type="button"
                    onClick={() => handleSelect(prompt)}
                    className="w-full flex items-start gap-2 p-2 rounded-md hover:bg-muted text-left"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{prompt.title}</span>
                        <Badge variant="secondary" className={cn('text-xs flex-shrink-0', getStatusColor(prompt.status))}>
                          {prompt.status}
                        </Badge>
                      </div>
                      {prompt.summary && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {prompt.summary}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Info text */}
      {selectedPrompts.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Selected prompts are prepended to additional instructions when tasks are created.
            {selectedPrompts.length > 1 && ' Drag to reorder.'}
          </span>
        </div>
      )}
    </div>
  )
}
