'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface Tag {
  _id: string
  name: string
  displayName: string
  color: string
  description?: string | null
  isActive: boolean
}

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

const defaultColors = [
  '#6B7280', '#3B82F6', '#10B981', '#F59E0B', '#F97316',
  '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
]

async function fetchTags(): Promise<{ data: Tag[] }> {
  const response = await authFetch(`${API_BASE}/tags`)
  if (!response.ok) throw new Error('Failed to fetch tags')
  return response.json()
}

async function createTag(data: { name: string; displayName?: string; color: string }): Promise<{ data: Tag }> {
  const response = await authFetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create tag')
  }
  return response.json()
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Add tags...',
  className,
  disabled = false,
}: TagInputProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTagColor, setNewTagColor] = useState('#6B7280')
  const [createError, setCreateError] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // Fetch all available tags
  const { data: tagsData, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  })

  const createMutation = useMutation({
    mutationFn: createTag,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      // Add the new tag to selection
      if (result.data?.name) {
        onChange([...value, result.data.name])
      }
      setShowCreateModal(false)
      setInputValue('')
      setNewTagColor('#6B7280')
      setCreateError(null)
    },
    onError: (error: Error) => {
      setCreateError(error.message)
    },
  })

  const allTags = tagsData?.data || []

  // Create a map of tag names to their data for quick lookup
  const tagMap = allTags.reduce((acc, tag) => {
    acc[tag.name] = tag
    return acc
  }, {} as Record<string, Tag>)

  // Filter tags based on input value (exclude already selected)
  const filteredTags = allTags.filter((tag) => {
    const matchesSearch = tag.name.toLowerCase().includes(inputValue.toLowerCase()) ||
      tag.displayName.toLowerCase().includes(inputValue.toLowerCase())
    const notSelected = !value.includes(tag.name)
    return matchesSearch && notSelected
  })

  // Check if we should show "Create new tag" option
  const normalizedInput = inputValue.toLowerCase().trim().replace(/\s+/g, '-')
  const exactMatch = allTags.find((t) => t.name === normalizedInput)
  const showCreateOption = inputValue.trim() && !exactMatch && !value.includes(normalizedInput)

  // Combined list for keyboard navigation
  const optionsList = [
    ...filteredTags.map(t => ({ type: 'existing' as const, tag: t })),
    ...(showCreateOption ? [{ type: 'create' as const, name: normalizedInput }] : []),
  ]

  // Handle adding a tag
  const addTag = useCallback((tagName: string) => {
    if (!value.includes(tagName)) {
      onChange([...value, tagName])
    }
    setInputValue('')
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }, [value, onChange])

  // Handle removing a tag
  const removeTag = useCallback((tagName: string) => {
    onChange(value.filter((t) => t !== tagName))
  }, [value, onChange])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, optionsList.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < optionsList.length) {
        const option = optionsList[highlightedIndex]
        if (option.type === 'existing') {
          addTag(option.tag.name)
        } else {
          setShowCreateModal(true)
        }
      } else if (inputValue.trim()) {
        // If no option is highlighted, try to add exact match or open create modal
        const match = allTags.find((t) =>
          t.name === normalizedInput || t.displayName.toLowerCase() === inputValue.toLowerCase()
        )
        if (match) {
          addTag(match.name)
        } else {
          setShowCreateModal(true)
        }
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag on backspace if input is empty
      removeTag(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }, [highlightedIndex, optionsList, inputValue, value, addTag, removeTag, allTags, normalizedInput])

  // Handle creating a new tag
  const handleCreateTag = useCallback(() => {
    if (!inputValue.trim()) return
    setCreateError(null)
    createMutation.mutate({
      name: normalizedInput,
      displayName: inputValue.trim(),
      color: newTagColor,
    })
  }, [inputValue, normalizedInput, newTagColor, createMutation])

  // Reset highlighted index when options change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [inputValue])

  // Focus input when clicking container
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex flex-wrap gap-1.5 min-h-[36px] px-2 py-1.5 rounded-md border border-input bg-background',
          'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary',
          'cursor-text transition-colors',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={handleContainerClick}
      >
        {/* Selected tags */}
        {value.map((tagName) => {
          const tagData = tagMap[tagName]
          const color = tagData?.color || '#6B7280'
          const displayName = tagData?.displayName || tagName
          return (
            <Badge
              key={tagName}
              variant="secondary"
              className="gap-1 px-2 py-0.5 text-xs cursor-default"
              style={{
                backgroundColor: `${color}20`,
                color: color,
                borderColor: `${color}40`,
              }}
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {displayName}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTag(tagName)
                  }}
                  className="ml-0.5 rounded-full hover:bg-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          )
        })}

        {/* Input */}
        <Popover open={isOpen && !disabled} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                if (!isOpen) setIsOpen(true)
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={value.length === 0 ? placeholder : ''}
              disabled={disabled}
              className={cn(
                'flex-1 min-w-[100px] h-6 bg-transparent text-sm outline-none',
                'placeholder:text-muted-foreground/60'
              )}
            />
          </PopoverTrigger>
          <PopoverContent
            className="w-[280px] p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : optionsList.length === 0 ? (
              <div className="py-3 px-3 text-sm text-muted-foreground text-center">
                {inputValue ? 'No matching tags' : 'Start typing to search or create tags'}
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto py-1">
                {filteredTags.map((tag, index) => (
                  <button
                    key={tag._id}
                    type="button"
                    onClick={() => addTag(tag.name)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                      'hover:bg-muted transition-colors',
                      highlightedIndex === index && 'bg-muted'
                    )}
                  >
                    <span
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1">{tag.displayName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{tag.name}</span>
                  </button>
                ))}
                {showCreateOption && (
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                      'hover:bg-muted transition-colors border-t',
                      highlightedIndex === filteredTags.length && 'bg-muted'
                    )}
                  >
                    <Plus className="h-3 w-3 text-primary" />
                    <span>Create &quot;{normalizedInput}&quot;</span>
                  </button>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Create Tag Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => {
              setShowCreateModal(false)
              setCreateError(null)
            }}
          />
          <div className="relative bg-background rounded-lg border shadow-lg p-4 w-[320px] space-y-4">
            <h3 className="font-semibold text-sm">Create New Tag</h3>

            {createError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
                {createError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="tag-name"
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Will be saved as: <span className="font-mono">{normalizedInput}</span>
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <div className="flex flex-wrap gap-2">
                {defaultColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'w-6 h-6 rounded border-2 transition-all',
                      newTagColor === color ? 'border-primary scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewTagColor(color)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Preview</label>
              <div className="p-3 bg-muted rounded">
                <Badge
                  style={{
                    backgroundColor: `${newTagColor}20`,
                    color: newTagColor,
                    borderColor: `${newTagColor}40`,
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full mr-1"
                    style={{ backgroundColor: newTagColor }}
                  />
                  {inputValue || 'Preview'}
                </Badge>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowCreateModal(false)
                  setCreateError(null)
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleCreateTag}
                disabled={createMutation.isPending || !inputValue.trim()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Create Tag'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
