'use client'

import { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  Plus,
  X,
  CheckCircle,
  Archive,
  ArrowRight,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EditableCell } from './editable-cell'
import { Task, FieldConfig, LookupValue, User } from '@/lib/api'
import { useTaskChildren, useUpdateTask, useDeleteTask, useBulkUpdateTasks, useBulkDeleteTasks, useLookups } from '@/hooks/use-tasks'
import { formatDateTime, cn } from '@/lib/utils'
import { TASK_TYPE_CONFIG, getTaskTypeConfig } from '@/lib/task-type-config'

// Task type icon component with tooltip - uses shared config
const TaskTypeIcon = memo(function TaskTypeIcon({ taskType, batchCounters }: { taskType?: string; batchCounters?: { processedCount?: number; expectedCount?: number } }) {
  const config = getTaskTypeConfig(taskType)
  const Icon = config.icon

  // For foreach tasks, show progress if available
  const showProgress = taskType === 'foreach' && batchCounters?.expectedCount
  const progressText = showProgress
    ? `${batchCounters?.processedCount || 0}/${batchCounters?.expectedCount}`
    : null

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center gap-1">
            <Icon className={cn('h-4 w-4', config.color)} />
            {progressText && (
              <span className="text-xs text-muted-foreground">{progressText}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.label}{progressText ? ` (${progressText})` : ''}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})

// Bulk actions bar component
const BulkActionsBar = memo(function BulkActionsBar({
  selectedCount,
  lookups,
  users,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onArchive,
  onDelete,
  onClearSelection,
  isUpdating,
}: {
  selectedCount: number
  lookups: Record<string, LookupValue[]>
  users: User[]
  onStatusChange: (status: string) => void
  onPriorityChange: (priority: string) => void
  onAssigneeChange: (assigneeId: string | null) => void
  onArchive: () => void
  onDelete: () => void
  onClearSelection: () => void
  isUpdating: boolean
}) {
  const statusOptions = lookups['task_status'] || []
  const urgencyOptions = lookups['urgency'] || []

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 border rounded-md mb-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{selectedCount} selected</span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">
        <Select onValueChange={onStatusChange} disabled={isUpdating}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Set status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((status) => (
              <SelectItem key={status._id} value={status.code}>
                {status.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={onPriorityChange} disabled={isUpdating}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Set urgency" />
          </SelectTrigger>
          <SelectContent>
            {urgencyOptions.map((urgency) => (
              <SelectItem key={urgency._id} value={urgency.code}>
                {urgency.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={(val) => onAssigneeChange(val === '__unassign__' ? null : val)} disabled={isUpdating}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Set assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassign__">Unassigned</SelectItem>
            {users.map((user) => (
              <SelectItem key={user._id} value={user._id}>
                {user.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="h-4 w-px bg-border" />
      <Button
        variant="outline"
        size="sm"
        onClick={onArchive}
        disabled={isUpdating}
        className="h-8"
      >
        <Archive className="h-4 w-4 mr-1" />
        Archive
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={isUpdating}
        className="h-8"
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearSelection}
        className="h-8"
      >
        <X className="h-4 w-4 mr-1" />
        Clear
      </Button>
    </div>
  )
})

interface TaskDataTableProps {
  tasks: Task[]
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  users: User[]
  visibleColumns: string[]
  sortBy: string
  sortOrder: 'asc' | 'desc'
  isLoading: boolean
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  onSort: (field: string) => void
  onEditTask: (task: Task) => void
  onCreateSubtask: (parentTask: Task) => void
  onPageChange: (page: number) => void
  expandAllEnabled: boolean
  onExpandAllChange: (enabled: boolean) => void
}

// Memoized Title cell component with special edit behavior
const TitleCell = memo(function TitleCell({
  task,
  fieldConfig,
  depth,
  isExpanded,
  onToggleExpand,
  onCellUpdate,
  onEdit,
  renderCellValue,
  onNavigateToFlow,
}: {
  task: Task
  fieldConfig: FieldConfig
  depth: number
  isExpanded: boolean
  onToggleExpand: () => void
  onCellUpdate: (taskId: string, field: string, value: unknown) => void
  onEdit: () => void
  renderCellValue: (task: Task, fc: FieldConfig) => React.ReactNode
  onNavigateToFlow?: (taskId: string) => void
}) {
  const [isInlineEditing, setIsInlineEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.title || '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if this is a flow task (nested workflow) - should not be expandable inline
  const isFlowTask = task.taskType === 'flow'
  const hasChildren = task.children && task.children.length > 0

  useEffect(() => {
    if (isInlineEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isInlineEditing])

  const handleSave = useCallback(() => {
    onCellUpdate(task._id, 'title', editValue)
    setIsInlineEditing(false)
  }, [task._id, editValue, onCellUpdate])

  const handleCancel = useCallback(() => {
    setEditValue(task.title || '')
    setIsInlineEditing(false)
  }, [task.title])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleSave, handleCancel])

  // Render the leading button based on task type
  const renderLeadingButton = () => {
    // All tasks with children (including flow tasks) show expand/collapse chevron
    if (hasChildren) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 p-0 flex-shrink-0",
            isFlowTask && "text-pink-500 hover:text-pink-600 hover:bg-pink-50"
          )}
          onClick={onToggleExpand}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      )
    }

    // No children - empty space for alignment
    return <div className="w-6 flex-shrink-0" />
  }

  return (
    <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-1 group">
      {renderLeadingButton()}
      {isInlineEditing ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="h-[20px] text-sm border-0 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-primary px-1 rounded w-full"
        />
      ) : (
        <>
          <div
            className="flex-1 min-w-0 cursor-pointer hover:underline truncate"
            onClick={onEdit}
          >
            {renderCellValue(task, fieldConfig)}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              setIsInlineEditing(true)
            }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  )
})

// Memoized recursive row component for nested tasks
const TaskRow = memo(function TaskRow({
  task,
  fieldConfigs,
  lookups,
  users,
  depth,
  isExpanded,
  isSelected,
  onToggleExpand,
  onToggleSelect,
  onCellUpdate,
  onEdit,
  onDelete,
  onCreateSubtask,
  renderCellValue,
  expandedRows,
  selectedRows,
  pulsingRows,
  toggleRowExpansion,
  toggleRowSelection,
  handleDeleteTask,
  handleEditTask,
  handleCreateSubtask,
  expandAllEnabled,
  onNavigateToFlow,
  isPulsing,
  onTriggerPulse,
}: {
  task: Task
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  users: User[]
  depth: number
  isExpanded: boolean
  isSelected: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
  onCellUpdate: (taskId: string, field: string, value: unknown) => void
  onEdit: () => void
  onDelete: () => void
  onCreateSubtask: () => void
  renderCellValue: (task: Task, fc: FieldConfig) => React.ReactNode
  expandedRows: Set<string>
  selectedRows: Set<string>
  pulsingRows: Set<string>
  toggleRowExpansion: (taskId: string) => void
  toggleRowSelection: (taskId: string) => void
  handleDeleteTask: (taskId: string) => void
  handleEditTask: (task: Task) => void
  handleCreateSubtask: (task: Task) => void
  expandAllEnabled: boolean
  onNavigateToFlow: (taskId: string) => void
  isPulsing: boolean
  onTriggerPulse: (taskId: string) => void
}) {
  const isFlowTask = task.taskType === 'flow'

  // Fetch children when expanded (including flow tasks - they now expand inline)
  const { data: childrenData } = useTaskChildren(isExpanded ? task._id : null)
  const children = childrenData?.data || []
  const hasChildren = isExpanded ? children.length > 0 : task.children && task.children.length > 0

  // Handle expand toggle with pulse animation for flow tasks
  const handleToggleExpand = useCallback(() => {
    onToggleExpand()
    // Trigger pulse when expanding a flow task
    if (isFlowTask && !isExpanded) {
      onTriggerPulse(task._id)
    }
  }, [onToggleExpand, isFlowTask, isExpanded, onTriggerPulse, task._id])

  // Auto-expand children that have grandchildren when expandAllEnabled is true
  useEffect(() => {
    if (expandAllEnabled && isExpanded && children.length > 0) {
      children.forEach(child => {
        if (child.children && child.children.length > 0 && !expandedRows.has(child._id)) {
          toggleRowExpansion(child._id)
        }
      })
    }
  }, [expandAllEnabled, isExpanded, children, expandedRows, toggleRowExpansion])

  return (
    <>
      <TableRow
        className={cn(
          depth > 0 && 'bg-muted/30',
          isPulsing && 'animate-pulse bg-pink-50 dark:bg-pink-950/30'
        )}
        data-state={isSelected ? 'selected' : undefined}
      >
        <TableCell className="w-12 pl-3 pr-0">
          <div className="flex justify-center">
            <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} className="h-5 w-5" />
          </div>
        </TableCell>
        <TableCell className="w-10 text-center">
          <TaskTypeIcon taskType={task.taskType} batchCounters={task.batchCounters} />
        </TableCell>
        {fieldConfigs.map((fc) => (
          <TableCell
            key={fc.fieldPath}
            className="relative py-0.5 px-1"
          >
            {fc.fieldPath === 'title' ? (
              <TitleCell
                task={task}
                fieldConfig={fc}
                depth={depth}
                isExpanded={isExpanded}
                onToggleExpand={handleToggleExpand}
                onCellUpdate={onCellUpdate}
                onEdit={onEdit}
                renderCellValue={renderCellValue}
                onNavigateToFlow={onNavigateToFlow}
              />
            ) : (
              <>
                {fc.isEditable ? (
                  <EditableCell
                    value={task[fc.fieldPath as keyof Task]}
                    fieldConfig={fc}
                    lookups={lookups}
                    users={users}
                    onSave={(value) => onCellUpdate(task._id, fc.fieldPath, value)}
                  >
                    {renderCellValue(task, fc)}
                  </EditableCell>
                ) : (
                  renderCellValue(task, fc)
                )}
              </>
            )}
          </TableCell>
        ))}
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCreateSubtask}>
                <Plus className="mr-2 h-4 w-4" />
                Create Subtask
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {/* Render children inline when expanded (including flow tasks) */}
      {isExpanded &&
        children.map((child) => (
          <TaskRow
            key={child._id}
            task={child}
            fieldConfigs={fieldConfigs}
            lookups={lookups}
            users={users}
            depth={depth + 1}
            isExpanded={expandedRows.has(child._id)}
            isSelected={selectedRows.has(child._id)}
            onToggleExpand={() => toggleRowExpansion(child._id)}
            onToggleSelect={() => toggleRowSelection(child._id)}
            onCellUpdate={onCellUpdate}
            onEdit={() => handleEditTask(child)}
            onDelete={() => handleDeleteTask(child._id)}
            onCreateSubtask={() => handleCreateSubtask(child)}
            renderCellValue={renderCellValue}
            expandedRows={expandedRows}
            selectedRows={selectedRows}
            pulsingRows={pulsingRows}
            toggleRowExpansion={toggleRowExpansion}
            toggleRowSelection={toggleRowSelection}
            handleDeleteTask={handleDeleteTask}
            handleEditTask={handleEditTask}
            handleCreateSubtask={handleCreateSubtask}
            expandAllEnabled={expandAllEnabled}
            onNavigateToFlow={onNavigateToFlow}
            isPulsing={pulsingRows.has(child._id)}
            onTriggerPulse={onTriggerPulse}
          />
        ))}
    </>
  )
})

export function TaskDataTable({
  tasks,
  fieldConfigs,
  lookups,
  users,
  visibleColumns,
  sortBy,
  sortOrder,
  isLoading,
  pagination,
  onSort,
  onEditTask,
  onCreateSubtask,
  onPageChange,
  expandAllEnabled,
  onExpandAllChange,
}: TaskDataTableProps) {
  const router = useRouter()
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [pulsingRows, setPulsingRows] = useState<Set<string>>(new Set())

  // Trigger pulse animation for a row (used when expanding flow tasks)
  const triggerPulse = useCallback((taskId: string) => {
    setPulsingRows(prev => new Set(prev).add(taskId))
    // Remove the pulse after animation completes (1 second)
    setTimeout(() => {
      setPulsingRows(prev => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }, 1000)
  }, [])

  // Navigate to a flow task's own view (shows its children as root-level tasks)
  const handleNavigateToFlow = useCallback((taskId: string) => {
    router.push(`/tasks?parentId=${taskId}`)
  }, [router])

  // Get task IDs that have children (for expand all functionality)
  const tasksWithChildren = useMemo(() => {
    return tasks.filter(t => t.children && t.children.length > 0).map(t => t._id)
  }, [tasks])

  // Track previous expandAllEnabled to detect changes
  const prevExpandAllEnabled = useRef(expandAllEnabled)

  // When expandAllEnabled changes from parent, update expanded rows
  // Only collapse all when explicitly toggling expand all OFF (not on data changes)
  useEffect(() => {
    const wasEnabled = prevExpandAllEnabled.current
    prevExpandAllEnabled.current = expandAllEnabled

    if (expandAllEnabled && !wasEnabled) {
      // Expand all was just enabled - expand all rows with children
      setExpandedRows(new Set(tasksWithChildren))
    } else if (!expandAllEnabled && wasEnabled) {
      // Expand all was just disabled - collapse all rows
      setExpandedRows(new Set())
    }
  }, [expandAllEnabled, tasksWithChildren])

  // When new tasks with children are added while expand all is enabled, expand them
  useEffect(() => {
    if (expandAllEnabled) {
      setExpandedRows(prev => {
        const next = new Set(prev)
        let changed = false
        for (const taskId of tasksWithChildren) {
          if (!next.has(taskId)) {
            next.add(taskId)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [tasksWithChildren, expandAllEnabled])

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const bulkUpdateTasks = useBulkUpdateTasks()
  const bulkDeleteTasks = useBulkDeleteTasks()

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set())
  }, [])

  const handleBulkStatusChange = useCallback(async (status: string) => {
    const taskIds = Array.from(selectedRows)
    try {
      await bulkUpdateTasks.mutateAsync({ taskIds, updates: { status } })
      clearSelection()
    } catch (error) {
      console.error('Bulk status update failed:', error)
    }
  }, [selectedRows, bulkUpdateTasks, clearSelection])

  const handleBulkPriorityChange = useCallback(async (urgency: string) => {
    const taskIds = Array.from(selectedRows)
    try {
      await bulkUpdateTasks.mutateAsync({ taskIds, updates: { urgency } })
      clearSelection()
    } catch (error) {
      console.error('Bulk urgency update failed:', error)
    }
  }, [selectedRows, bulkUpdateTasks, clearSelection])

  const handleBulkDelete = useCallback(async () => {
    if (confirm(`Are you sure you want to delete ${selectedRows.size} task(s)?`)) {
      const taskIds = Array.from(selectedRows)
      try {
        await bulkDeleteTasks.mutateAsync(taskIds)
        clearSelection()
      } catch (error) {
        console.error('Bulk delete failed:', error)
      }
    }
  }, [selectedRows, bulkDeleteTasks, clearSelection])

  const handleBulkArchive = useCallback(async () => {
    const taskIds = Array.from(selectedRows)
    try {
      await bulkUpdateTasks.mutateAsync({ taskIds, updates: { status: 'archived' } })
      clearSelection()
    } catch (error) {
      console.error('Bulk archive failed:', error)
    }
  }, [selectedRows, bulkUpdateTasks, clearSelection])

  const handleBulkAssigneeChange = useCallback(async (assigneeId: string | null) => {
    const taskIds = Array.from(selectedRows)
    try {
      await bulkUpdateTasks.mutateAsync({ taskIds, updates: { assigneeId } })
      clearSelection()
    } catch (error) {
      console.error('Bulk assignee update failed:', error)
    }
  }, [selectedRows, bulkUpdateTasks, clearSelection])

  // Memoized field config map for quick lookup
  const fieldConfigMap = useMemo(
    () => new Map(fieldConfigs.map((fc) => [fc.fieldPath, fc])),
    [fieldConfigs]
  )

  // Memoized visible field configs in order
  const visibleFieldConfigs = useMemo(
    () => visibleColumns
      .map((col) => fieldConfigMap.get(col))
      .filter(Boolean) as FieldConfig[],
    [visibleColumns, fieldConfigMap]
  )

  const toggleRowExpansion = useCallback((taskId: string) => {
    setExpandedRows((prev) => {
      const newExpanded = new Set(prev)
      if (newExpanded.has(taskId)) {
        newExpanded.delete(taskId)
        // If we're collapsing a row, we're no longer in "expand all" mode
        onExpandAllChange(false)
      } else {
        newExpanded.add(taskId)
        // Check if all tasks with children are now expanded
        const allExpanded = tasksWithChildren.every(id => newExpanded.has(id) || id === taskId)
        if (allExpanded) {
          onExpandAllChange(true)
        }
      }
      return newExpanded
    })
  }, [tasksWithChildren, onExpandAllChange])

  const toggleRowSelection = useCallback((taskId: string) => {
    setSelectedRows((prev) => {
      const newSelected = new Set(prev)
      if (newSelected.has(taskId)) {
        newSelected.delete(taskId)
      } else {
        newSelected.add(taskId)
      }
      return newSelected
    })
  }, [])

  const toggleAllSelection = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === tasks.length) {
        return new Set()
      } else {
        return new Set(tasks.map((t) => t._id))
      }
    })
  }, [tasks])

  const handleCellUpdate = useCallback(async (taskId: string, field: string, value: unknown) => {
    await updateTask.mutateAsync({ id: taskId, data: { [field]: value } })
  }, [updateTask])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask.mutateAsync({ id: taskId })
    }
  }, [deleteTask])

  const renderSortIcon = useCallback((field: string) => {
    const config = fieldConfigMap.get(field)
    if (!config?.isSortable) return null

    if (sortBy !== field) {
      return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    )
  }, [fieldConfigMap, sortBy, sortOrder])

  const renderCellValue = useCallback((task: Task, fieldConfig: FieldConfig) => {
    const value = task[fieldConfig.fieldPath as keyof Task]
    const resolved = task._resolved?.[fieldConfig.fieldPath as keyof typeof task._resolved]

    // Handle lookup fields (status, priority, etc.)
    if (fieldConfig.lookupType && resolved) {
      const lookup = resolved as { displayName: string; color?: string }
      return (
        <div className="flex justify-center">
          <Badge color={lookup.color} variant="outline">
            {lookup.displayName}
          </Badge>
        </div>
      )
    }

    // Handle reference fields (user, team)
    if (fieldConfig.fieldType === 'reference') {
      // Try the field path directly first (e.g., assigneeId -> assignee)
      const fieldName = fieldConfig.fieldPath.replace('Id', '')
      // Also try looking up directly by the field path
      const ref = (task._resolved?.[fieldName as keyof typeof task._resolved] ||
        task._resolved?.[fieldConfig.fieldPath as keyof typeof task._resolved]) as
        | { displayName?: string; name?: string }
        | undefined
      if (ref?.displayName || ref?.name) {
        return <div className="text-center">{ref.displayName || ref.name}</div>
      }
      // If no resolved value, show dash
      return <span className="block text-center text-muted-foreground">-</span>
    }

    // Handle boolean fields
    if (fieldConfig.fieldType === 'boolean') {
      return (
        <div className="flex justify-center">
          <Checkbox
            checked={Boolean(value)}
            className="pointer-events-none"
          />
        </div>
      )
    }

    // Handle date fields
    if (fieldConfig.fieldType === 'datetime' || fieldConfig.fieldType === 'date') {
      const formatted = formatDateTime(value as string)
      return <div className="text-center">{formatted}</div>
    }

    // Handle tags
    if (fieldConfig.fieldType === 'tags' && Array.isArray(value)) {
      return (
        <div className="flex justify-center flex-wrap gap-1">
          {(value as string[]).slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {(value as string[]).length > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{(value as string[]).length - 3}
            </Badge>
          )}
        </div>
      )
    }

    // Handle number fields
    if (fieldConfig.fieldType === 'number') {
      return <div className="text-center">{value?.toString() || '0'}</div>
    }

    if (value === null || value === undefined || value === '') {
      return <span className={cn("block text-muted-foreground", fieldConfig.fieldPath !== 'title' && "text-center")}>-</span>
    }
    // Title should be left-aligned, other text fields centered
    if (fieldConfig.fieldPath === 'title') {
      return <span>{value?.toString()}</span>
    }
    return <div className="text-center">{value?.toString()}</div>
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const isUpdating = bulkUpdateTasks.isPending || bulkDeleteTasks.isPending

  return (
    <div className="space-y-4">
      {selectedRows.size > 0 && (
        <BulkActionsBar
          selectedCount={selectedRows.size}
          lookups={lookups}
          users={users}
          onStatusChange={handleBulkStatusChange}
          onPriorityChange={handleBulkPriorityChange}
          onAssigneeChange={handleBulkAssigneeChange}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onClearSelection={clearSelection}
          isUpdating={isUpdating}
        />
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-3 pr-0">
                <div className="flex justify-center">
                  <Checkbox
                    checked={selectedRows.size === tasks.length && tasks.length > 0}
                    onCheckedChange={toggleAllSelection}
                    className="h-5 w-5"
                  />
                </div>
              </TableHead>
              <TableHead className="w-10 text-center">
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground">Type</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Task Type</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              {visibleFieldConfigs.map((fc) => (
                <TableHead
                  key={fc.fieldPath}
                  className={cn(fc.isSortable && 'cursor-pointer')}
                  style={{ width: fc.width, minWidth: fc.minWidth }}
                  onClick={() => fc.isSortable && onSort(fc.fieldPath)}
                >
                  <div className="flex items-center">
                    {fc.displayName}
                    {renderSortIcon(fc.fieldPath)}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleFieldConfigs.length + 4}
                  className="h-24 text-center text-muted-foreground"
                >
                  No tasks found.
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  fieldConfigs={visibleFieldConfigs}
                  lookups={lookups}
                  users={users}
                  depth={0}
                  isExpanded={expandedRows.has(task._id)}
                  isSelected={selectedRows.has(task._id)}
                  onToggleExpand={() => toggleRowExpansion(task._id)}
                  onToggleSelect={() => toggleRowSelection(task._id)}
                  onCellUpdate={handleCellUpdate}
                  onEdit={() => onEditTask(task)}
                  onDelete={() => handleDeleteTask(task._id)}
                  onCreateSubtask={() => onCreateSubtask(task)}
                  renderCellValue={renderCellValue}
                  expandedRows={expandedRows}
                  selectedRows={selectedRows}
                  pulsingRows={pulsingRows}
                  toggleRowExpansion={toggleRowExpansion}
                  toggleRowSelection={toggleRowSelection}
                  handleDeleteTask={handleDeleteTask}
                  handleEditTask={onEditTask}
                  handleCreateSubtask={onCreateSubtask}
                  expandAllEnabled={expandAllEnabled}
                  onNavigateToFlow={handleNavigateToFlow}
                  isPulsing={pulsingRows.has(task._id)}
                  onTriggerPulse={triggerPulse}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} tasks
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
