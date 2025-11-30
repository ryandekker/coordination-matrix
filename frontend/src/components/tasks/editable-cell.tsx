'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
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
import { FieldConfig, LookupValue, User, Task, tasksApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'

interface EditableCellProps {
  value: unknown
  fieldConfig: FieldConfig
  lookups: Record<string, LookupValue[]>
  users?: User[]
  onSave: (value: unknown) => void
  children: ReactNode
}

export function EditableCell({
  value,
  fieldConfig,
  lookups,
  users = [],
  onSave,
  children,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState<unknown>(value)
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  // Handle click outside to save
  useEffect(() => {
    if (!isEditing) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleSave()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isEditing, editValue])

  const handleSave = () => {
    onSave(editValue)
    setIsEditing(false)
    setSearchQuery('')
  }

  const handleCancel = () => {
    setEditValue(value)
    setIsEditing(false)
    setSearchQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  // Special handling for boolean fields - direct toggle without edit mode
  if (fieldConfig.fieldType === 'boolean' && !isEditing) {
    return (
      <div
        className="editable-cell cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate"
        onClick={() => {
          const newValue = !value
          onSave(newValue)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const newValue = !value
            onSave(newValue)
          }
        }}
        tabIndex={0}
        role="button"
      >
        {children}
      </div>
    )
  }

  if (!isEditing) {
    return (
      <div
        className="editable-cell cursor-pointer hover:bg-muted/50 py-0.5 rounded transition-colors truncate min-h-[24px]"
        onClick={() => setIsEditing(true)}
        onKeyDown={(e) => e.key === 'Enter' && setIsEditing(true)}
        tabIndex={0}
        role="button"
      >
        {children}
      </div>
    )
  }

  const inputClassName = 'h-[24px] text-sm border-0 bg-muted/30 shadow-none focus-visible:ring-1 focus-visible:ring-primary px-1 rounded-sm'

  // Handle reference fields (user selection)
  if (fieldConfig.fieldType === 'reference' && fieldConfig.referenceCollection === 'users') {
    const filteredUsers = users.filter((user) =>
      user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
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
                className="text-muted-foreground"
              >
                Unassigned
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
                    <span>{user.displayName}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
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

  // Render different editors based on field type
  switch (fieldConfig.fieldType) {
    case 'select':
      const options = fieldConfig.lookupType
        ? lookups[fieldConfig.lookupType] || []
        : fieldConfig.options || []

      return (
        <div ref={containerRef} className="absolute left-0 top-0 z-50 min-w-full">
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
            <SelectTrigger className="h-6 border-0 bg-muted/50 shadow-none text-sm px-1 min-w-[140px]">
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
      )

    case 'boolean':
      // This case should not be reached due to early return above
      // But keep it for safety
      return null

    case 'number':
      return (
        <div ref={containerRef} className="relative min-h-[24px]">
          <Input
            ref={inputRef}
            type="number"
            value={editValue as number}
            onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className={cn(inputClassName, 'min-w-[120px] absolute left-0 top-0 z-50')}
          />
        </div>
      )

    case 'datetime':
    case 'date':
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
            className={cn(inputClassName, 'min-w-[180px] absolute left-0 top-0 z-50')}
          />
        </div>
      )

    case 'tags':
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
            className={cn(inputClassName, 'min-w-[200px] absolute left-0 top-0 z-50')}
          />
        </div>
      )

    case 'textarea':
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
            className={cn(
              'flex min-h-[60px] min-w-[300px] rounded-sm bg-muted/30 px-1 py-1 text-sm absolute left-0 top-0 z-50',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'
            )}
          />
        </div>
      )

    case 'text':
    default:
      return (
        <div ref={containerRef} className="relative min-h-[24px]">
          <Input
            ref={inputRef}
            value={(editValue as string) || ''}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className={cn(inputClassName, 'min-w-[250px] w-auto absolute left-0 top-0 z-50')}
          />
        </div>
      )
  }
}

// Parent Task Selector Component
function ParentTaskSelector({
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
  // Fetch tasks for selection - debounce search
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks-search', searchQuery],
    queryFn: async () => {
      const params: Record<string, string> = {
        limit: '20',
        resolveReferences: 'false',
      }
      if (searchQuery) {
        params.search = searchQuery
      }
      return tasksApi.getAll(params)
    },
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
}
