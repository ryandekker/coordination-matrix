'use client'

import { useState, useRef, useEffect, ReactNode, useCallback, memo } from 'react'
import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldConfig, LookupValue, User, Task, Workflow, tasksApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { UserChip } from '@/components/ui/user-chip'

// Debounce hook for search
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

interface EditableCellProps {
  value: unknown
  fieldConfig: FieldConfig
  lookups: Record<string, LookupValue[]>
  users?: User[]
  workflows?: Workflow[]
  task?: Task
  onSave: (value: unknown) => void
  children: ReactNode
  isTitle?: boolean
}

export const EditableCell = memo(function EditableCell({
  value,
  fieldConfig,
  lookups,
  users = [],
  workflows = [],
  task,
  onSave,
  children,
  isTitle = false,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState<unknown>(value)
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current && fieldConfig.fieldType !== 'text' && fieldConfig.fieldType !== 'textarea') {
      inputRef.current.focus()
      inputRef.current.select()
    } else if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing, fieldConfig.fieldType])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSave = useCallback(() => {
    onSave(editValue)
    setIsEditing(false)
    setSearchQuery('')
  }, [editValue, onSave])

  const handleCancel = useCallback(() => {
    setEditValue(value)
    setIsEditing(false)
    setSearchQuery('')
  }, [value])

  // Handle click outside to save - only for non-portaled field types
  // Select fields use portaled dropdowns (via radix-ui), so clicks on dropdown items
  // would incorrectly trigger this handler (portal renders outside containerRef)
  const usesPortaledUI = fieldConfig.fieldType === 'select'

  useEffect(() => {
    // Skip click-outside handler for fields with portaled UI - they handle their own close logic
    if (!isEditing || usesPortaledUI) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleSave()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isEditing, usesPortaledUI, handleSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleSave, handleCancel])

  // Memoized click handler for boolean fields
  const handleBooleanToggle = useCallback(() => {
    const newValue = !value
    onSave(newValue)
  }, [value, onSave])

  const handleBooleanKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleBooleanToggle()
    }
  }, [handleBooleanToggle])

  // Special handling for boolean fields - direct toggle without edit mode
  if (fieldConfig.fieldType === 'boolean') {
    return (
      <div
        className="editable-cell cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors flex justify-center"
        onClick={handleBooleanToggle}
        onKeyDown={handleBooleanKeyDown}
        tabIndex={0}
        role="button"
      >
        {children}
      </div>
    )
  }

  const inputClassName = 'h-[20px] text-sm border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:outline-none px-0 rounded-none w-full truncate'

  // Handle reference fields (user selection) - show popup on click
  if (fieldConfig.fieldType === 'reference' && fieldConfig.referenceCollection === 'users' && isEditing) {
    const filteredUsers = users.filter((user) =>
      user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase()))
    )

    return (
      <div className="relative w-full">
        <div className="cursor-pointer py-0.5">{children}</div>
        <div ref={containerRef} className="absolute left-0 top-0 z-50 bg-popover border rounded-md shadow-lg min-w-[220px]">
          <Command>
            <CommandInput
              placeholder="Search users..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-8"
            />
            <CommandList className="max-h-[200px]">
              <CommandEmpty>No users found</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="_unassigned"
                  onSelect={() => {
                    onSave(null)
                    setIsEditing(false)
                    setSearchQuery('')
                  }}
                >
                  <UserChip user={null} size="sm" />
                </CommandItem>
                {filteredUsers.map((user) => (
                  <CommandItem
                    key={user._id}
                    value={user._id}
                    onSelect={() => {
                      onSave(user._id)
                      setIsEditing(false)
                      setSearchQuery('')
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        editValue === user._id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col">
                      <UserChip user={user} size="sm" />
                      {user.email && (
                        <span className="text-xs text-muted-foreground ml-5">{user.email}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </div>
    )
  }

  // Handle parent task reference fields
  if (fieldConfig.fieldType === 'reference' && fieldConfig.referenceCollection === 'tasks') {
    return (
      <ParentTaskSelector
        containerRef={containerRef}
        currentValue={editValue as string | null}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelect={(taskId) => {
          onSave(taskId)
          setIsEditing(false)
          setSearchQuery('')
        }}
        onCancel={() => {
          setIsEditing(false)
          setSearchQuery('')
        }}
      />
    )
  }

  // Handle workflowStage field with dropdown
  if (fieldConfig.fieldPath === 'workflowStage' && task) {
    const workflow = workflows.find(w => w._id === task.workflowId)
    const workflowStages = workflow?.steps?.map(s => s.name) || workflow?.stages || []
    const hasWorkflow = !!task.workflowId && workflowStages.length > 0

    if (isEditing && hasWorkflow) {
      return (
        <div className="relative w-full">
          <div className="cursor-pointer py-0.5">{children}</div>
          <div ref={containerRef} className="absolute left-0 top-0 z-50 min-w-[180px]">
            <Select
              value={editValue as string || '_none'}
              onValueChange={(val) => {
                const newValue = val === '_none' ? '' : val
                setEditValue(newValue)
                onSave(newValue)
                setIsEditing(false)
              }}
              open={true}
              onOpenChange={(open) => !open && handleCancel()}
            >
              <SelectTrigger className="sr-only">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {workflowStages.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    }

    // Non-editing state: clickable to edit if has workflow, otherwise just display
    return (
      <div
        className={cn(
          "py-0.5 rounded transition-colors",
          hasWorkflow ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
        )}
        onClick={() => hasWorkflow && setIsEditing(true)}
        title={!hasWorkflow ? "Assign a workflow to set stage" : undefined}
      >
        {children}
      </div>
    )
  }

  // Render different editors based on field type
  switch (fieldConfig.fieldType) {
    case 'select':
      const options = fieldConfig.lookupType
        ? lookups[fieldConfig.lookupType] || []
        : fieldConfig.options || []

      if (isEditing) {
        return (
          <div className="relative w-full">
            <div className="cursor-pointer py-0.5">{children}</div>
            <div ref={containerRef} className="absolute left-0 top-0 z-50 min-w-[180px]">
              <Select
                value={editValue as string}
                onValueChange={(val) => {
                  setEditValue(val)
                  onSave(val)
                  setIsEditing(false)
                }}
                open={true}
                onOpenChange={(open) => !open && handleCancel()}
              >
                <SelectTrigger className="sr-only">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options
                    .filter((opt) => {
                      const optValue = 'code' in opt ? opt.code : opt.value
                      return optValue !== undefined && optValue !== null && optValue !== ''
                    })
                    .map((opt) => {
                      const optValue = 'code' in opt ? opt.code : opt.value
                      const optLabel = 'displayName' in opt ? opt.displayName : opt.label
                      return (
                        <SelectItem key={optValue} value={optValue}>
                          {optLabel}
                        </SelectItem>
                      )
                    })}
                </SelectContent>
              </Select>
            </div>
          </div>
        )
      }
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors flex justify-center"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'reference':
      // Handle reference fields (non-user references)
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'number':
      if (isEditing) {
        return (
          <div ref={containerRef} className="relative min-h-[24px]">
            <Input
              ref={inputRef}
              type="number"
              value={editValue as number}
              onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className={inputClassName}
            />
          </div>
        )
      }
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate min-h-[24px]"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'datetime':
    case 'date':
      if (isEditing) {
        return (
          <div ref={containerRef} className="relative min-h-[24px]">
            <Input
              ref={inputRef}
              type={fieldConfig.fieldType === 'datetime' ? 'datetime-local' : 'date'}
              value={
                editValue
                  ? new Date(editValue as string).toISOString().slice(0, fieldConfig.fieldType === 'datetime' ? 16 : 10)
                  : ''
              }
              onChange={(e) => setEditValue(e.target.value ? new Date(e.target.value).toISOString() : null)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className={cn(inputClassName, 'min-w-[180px]')}
            />
          </div>
        )
      }
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate min-h-[24px]"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'tags':
      if (isEditing) {
        return (
          <div ref={containerRef} className="relative min-h-[24px]">
            <Input
              ref={inputRef}
              value={Array.isArray(editValue) ? (editValue as string[]).join(', ') : ''}
              onChange={(e) =>
                setEditValue(
                  e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              placeholder="tag1, tag2"
              className={cn(inputClassName, 'min-w-[200px]')}
            />
          </div>
        )
      }
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate min-h-[24px]"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'textarea':
      if (isEditing) {
        return (
          <div ref={containerRef} className="relative min-h-[60px]">
            <textarea
              ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
              value={editValue as string}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCancel()
                if (e.key === 'Enter' && e.metaKey) handleSave()
              }}
              onBlur={handleSave}
              className="flex min-h-[60px] min-w-[300px] rounded-sm bg-transparent px-1 py-1 text-sm focus-visible:outline-none focus-visible:ring-0 w-full"
            />
          </div>
        )
      }
      return (
        <div
          className="cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate min-h-[24px]"
          onClick={() => setIsEditing(true)}
        >
          {children}
        </div>
      )

    case 'text':
    default:
      // For title fields, don't render as input (click will open modal)
      if (isTitle) {
        return (
          <div className="truncate w-full">
            {children}
          </div>
        )
      }

      // Always render as input, looks like text until focused
      return (
        <div
          ref={containerRef}
          className="relative cursor-text hover:bg-muted/30 py-0.5 rounded transition-colors w-full"
        >
          <Input
            ref={inputRef}
            value={(editValue as string) || ''}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            onFocus={() => setIsEditing(true)}
            className={inputClassName}
          />
        </div>
      )
  }
})

// Memoized Parent Task Selector Component with debounced search
const ParentTaskSelector = memo(function ParentTaskSelector({
  containerRef,
  currentValue,
  searchQuery,
  onSearchChange,
  onSelect,
  onCancel,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  currentValue: string | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelect: (taskId: string | null) => void
  onCancel: () => void
}) {
  // Debounce search query to prevent excessive API calls
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  // Fetch tasks for selection with debounced search
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks-search', debouncedSearchQuery],
    queryFn: async () => {
      const params: Record<string, string> = {
        limit: '20',
        resolveReferences: 'false',
      }
      if (debouncedSearchQuery) {
        params.search = debouncedSearchQuery
      }
      return tasksApi.list(params)
    },
    staleTime: 30 * 1000, // Cache for 30 seconds
  })

  const tasks = tasksData?.data || []

  return (
    <div ref={containerRef} className="absolute left-0 top-0 z-50 bg-popover border rounded-md shadow-lg min-w-[280px]">
      <Command>
        <CommandInput
          placeholder="Search tasks..."
          value={searchQuery}
          onValueChange={onSearchChange}
          className="h-8"
        />
        <CommandList className="max-h-[250px]">
          {isLoading ? (
            <div className="p-2 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <>
              <CommandEmpty>No tasks found</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="_none"
                  onSelect={() => onSelect(null)}
                  className="text-muted-foreground"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      currentValue === null ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  No parent (root task)
                </CommandItem>
                {tasks.map((task: Task) => (
                  <CommandItem
                    key={task._id}
                    value={task._id}
                    onSelect={() => onSelect(task._id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        currentValue === task._id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate">{task.title}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {task.status} • {task._id.slice(-6)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </div>
  )
})
