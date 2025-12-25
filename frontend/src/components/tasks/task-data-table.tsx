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
import { Task, FieldConfig, LookupValue, User, Workflow } from '@/lib/api'
import { useTaskChildren, useUpdateTask, useDeleteTask, useBulkUpdateTasks, useBulkDeleteTasks, useLookups, useCreateTask } from '@/hooks/use-tasks'
import { formatDateTime, cn } from '@/lib/utils'
import { TASK_TYPE_CONFIG, getTaskTypeConfig } from '@/lib/task-type-config'
import { UserChip } from '@/components/ui/user-chip'

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
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Set assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassign__">
              <UserChip user={null} size="sm" />
            </SelectItem>
            {users.map((user) => (
              <SelectItem key={user._id} value={user._id}>
                <UserChip user={user} size="sm" />
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
  workflows: Workflow[]
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
  autoExpandIds?: string[]
  hasActiveFilters?: boolean
}

// Helper to organize flat filtered results into a tree structure
// When filtering, both parent and child may match - group children under matching parents
function organizeTasksIntoTree(tasks: Task[]): Task[] {
  if (tasks.length === 0) return []

  // Create a map of all task IDs for quick lookup
  const taskMap = new Map<string, Task>()
  for (const task of tasks) {
    taskMap.set(task._id, { ...task, children: [] })
  }

  // Separate tasks into root-level and those that should be nested under a parent
  const rootTasks: Task[] = []
  const childrenByParent = new Map<string, Task[]>()

  for (const task of tasks) {
    const taskCopy = taskMap.get(task._id)!
    const parentId = task.parentId?.toString()

    // If this task has a parent that's also in the results, it should be nested
    if (parentId && taskMap.has(parentId)) {
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, [])
      }
      childrenByParent.get(parentId)!.push(taskCopy)
    } else {
      // No parent in results, or no parent at all - show at root level
      rootTasks.push(taskCopy)
    }
  }

  // Attach children to their parents
  childrenByParent.forEach((children, parentId) => {
    const parent = taskMap.get(parentId)
    if (parent) {
      parent.children = children
    }
  })

  return rootTasks
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
  onAddSubtask,
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
  onAddSubtask?: () => void
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
          className="h-6 w-6 p-0 flex-shrink-0"
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
            className="flex-1 min-w-0 max-w-[300px] cursor-pointer hover:underline truncate"
            onClick={onEdit}
            title={task.title}
          >
            {renderCellValue(task, fieldConfig)}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation()
                setIsInlineEditing(true)
              }}
              title="Edit title"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            {onAddSubtask && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddSubtask()
                }}
                title="Add subtask"
              >
                <Plus className="h-3 w-3" />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
})

// Inline task creation row component
const InlineTaskRow = memo(function InlineTaskRow({
  parentId,
  depth,
  fieldConfigs,
  colSpan,
  onSubmit,
  onCancel,
  isCreating,
}: {
  parentId: string | null
  depth: number
  fieldConfigs: FieldConfig[]
  colSpan: number
  onSubmit: (title: string) => void
  onCancel: () => void
  isCreating: boolean
}) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isSubmittingRef = useRef(false)

  const prevIsCreatingRef = useRef(isCreating)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
    }
  }, [])

  // Refocus when isCreating transitions from true to false (creation complete)
  useEffect(() => {
    if (prevIsCreatingRef.current && !isCreating) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 0)
    }
    prevIsCreatingRef.current = isCreating
  }, [isCreating])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && title.trim()) {
      e.preventDefault()
      isSubmittingRef.current = true
      onSubmit(title.trim())
      setTitle('')
      // Re-focus immediately
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true })
      })
      // Keep submitting flag true longer than blur delay (150ms)
      setTimeout(() => {
        isSubmittingRef.current = false
      }, 200)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [title, onSubmit, onCancel])

  const handleBlur = useCallback(() => {
    // Small delay to allow click on another element to register
    setTimeout(() => {
      // Don't cancel if:
      // 1. We just submitted (isSubmittingRef is true)
      // 2. The input is still/again focused (we refocused after submit)
      // 3. There's text in the input
      if (isSubmittingRef.current) return
      if (inputRef.current && document.activeElement === inputRef.current) return
      if (!title.trim()) {
        onCancel()
      }
    }, 150)
  }, [title, onCancel])

  return (
    <TableRow className={cn(depth > 0 && 'bg-muted/30', 'bg-blue-50/50 dark:bg-blue-950/20')}>
      <TableCell className="w-12 pl-3 pr-0">
        <div className="flex justify-center">
          <div className="h-5 w-5" />
        </div>
      </TableCell>
      <TableCell className="w-10 p-0">
        <div className="flex justify-center">
          <Plus className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell colSpan={colSpan} className="py-0.5 px-1">
        <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-1">
          <div className="w-6 flex-shrink-0" />
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={parentId ? "New subtask title... (Enter to save, Esc to cancel)" : "New task title... (Enter to save, Esc to cancel)"}
            disabled={isCreating}
            className="h-7 text-sm border-blue-200 dark:border-blue-800 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-blue-400 px-2 rounded flex-1"
          />
          {isCreating && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
          )}
        </div>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  )
})

// Memoized recursive row component for nested tasks
const TaskRow = memo(function TaskRow({
  task,
  fieldConfigs,
  lookups,
  users,
  workflows,
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
  inlineCreationParentId,
  onStartInlineCreation,
  onCancelInlineCreation,
  onSubmitInlineCreation,
  isCreatingTask,
}: {
  task: Task
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  users: User[]
  workflows: Workflow[]
  depth: number
  isExpanded: boolean
  isSelected: boolean
  onToggleExpand: () => void
  onToggleSelect: (isShiftKey?: boolean) => void
  onCellUpdate: (taskId: string, field: string, value: unknown) => void
  onEdit: () => void
  onDelete: () => void
  onCreateSubtask: () => void
  renderCellValue: (task: Task, fc: FieldConfig) => React.ReactNode
  expandedRows: Set<string>
  selectedRows: Set<string>
  pulsingRows: Set<string>
  toggleRowExpansion: (taskId: string) => void
  toggleRowSelection: (taskId: string, isShiftKey?: boolean) => void
  handleDeleteTask: (taskId: string) => void
  handleEditTask: (task: Task) => void
  handleCreateSubtask: (task: Task) => void
  expandAllEnabled: boolean
  onNavigateToFlow: (taskId: string) => void
  isPulsing: boolean
  onTriggerPulse: (taskId: string, shouldScroll?: boolean) => void
  inlineCreationParentId: string | null
  onStartInlineCreation: (parentId: string) => void
  onCancelInlineCreation: () => void
  onSubmitInlineCreation: (title: string, parentId: string | null) => void
  isCreatingTask: boolean
}) {
  const isFlowTask = task.taskType === 'flow'

  // Pagination state for children
  const [childrenPage, setChildrenPage] = useState(1)
  const CHILDREN_PAGE_SIZE = 20

  // Check if children are pre-attached (from filtering) - they have _id property
  const hasPreAttachedChildren = task.children && task.children.length > 0 && task.children[0]._id

  // Fetch children when expanded (including flow tasks - they now expand inline)
  // Skip fetching if we already have pre-attached children from filtering
  const { data: childrenData } = useTaskChildren(isExpanded && !hasPreAttachedChildren ? task._id : null, {
    page: childrenPage,
    limit: CHILDREN_PAGE_SIZE,
  })

  // Use pre-attached children if available, otherwise use fetched children
  const children = hasPreAttachedChildren ? (task.children || []) : (childrenData?.data || [])
  const childrenPagination = childrenData?.pagination
  const hasChildren = hasPreAttachedChildren || (isExpanded ? children.length > 0 : task.children && task.children.length > 0)
  const hasMoreChildren = !hasPreAttachedChildren && childrenPagination && childrenPagination.totalPages > 1

  // Reset to page 1 when collapsing
  useEffect(() => {
    if (!isExpanded) {
      setChildrenPage(1)
    }
  }, [isExpanded])

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

  // Flow tasks that are children (depth > 0) appear as placeholders
  // They also appear at root level, so this is just a reference/link
  const isFlowPlaceholder = isFlowTask && depth > 0

  return (
    <>
      <TableRow
        className={cn(
          depth > 0 && 'bg-muted/30',
          isPulsing && depth === 0 && 'animate-pulse-bg border-b-2 border-pink-400'
        )}
        data-state={isSelected ? 'selected' : undefined}
        data-task-id={task._id}
      >
        <TableCell className="w-12 pl-3 pr-0">
          <div className="flex justify-center">
            <Checkbox
                checked={isSelected}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSelect(e.shiftKey)
                }}
                className="h-5 w-5"
              />
          </div>
        </TableCell>
        <TableCell className="w-10 p-0">
          {isFlowPlaceholder ? (
            <button
              className="w-full h-full flex flex-col items-center justify-center py-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                // Highlight this flow task at the root level and scroll to it
                onTriggerPulse(task._id, true)
              }}
            >
              <span className="mt-1">
                <TaskTypeIcon taskType={task.taskType} batchCounters={task.batchCounters} />
              </span>
              <span className="text-[10px] text-pink-500">ref →</span>
            </button>
          ) : (
            <div className="flex justify-center">
              <TaskTypeIcon taskType={task.taskType} batchCounters={task.batchCounters} />
            </div>
          )}
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
                onAddSubtask={() => onStartInlineCreation(task._id)}
              />
            ) : (
              <>
                {fc.isEditable ? (
                  <EditableCell
                    value={task[fc.fieldPath as keyof Task]}
                    fieldConfig={fc}
                    lookups={lookups}
                    users={users}
                    workflows={workflows}
                    task={task}
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
            workflows={workflows}
            depth={depth + 1}
            isExpanded={expandedRows.has(child._id)}
            isSelected={selectedRows.has(child._id)}
            onToggleExpand={() => toggleRowExpansion(child._id)}
            onToggleSelect={(isShiftKey) => toggleRowSelection(child._id, isShiftKey)}
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
            inlineCreationParentId={inlineCreationParentId}
            onStartInlineCreation={onStartInlineCreation}
            onCancelInlineCreation={onCancelInlineCreation}
            onSubmitInlineCreation={onSubmitInlineCreation}
            isCreatingTask={isCreatingTask}
          />
        ))}
      {/* Pagination row for children when there are multiple pages */}
      {isExpanded && hasMoreChildren && childrenPagination && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={fieldConfigs.length + 3} className="py-1">
            <div
              style={{ paddingLeft: (depth + 1) * 16 + 24 }}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span>
                Showing {(childrenPagination.page - 1) * childrenPagination.limit + 1}–
                {Math.min(childrenPagination.page * childrenPagination.limit, childrenPagination.total)} of{' '}
                {childrenPagination.total} subtasks
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setChildrenPage(p => Math.max(1, p - 1))}
                  disabled={childrenPagination.page <= 1}
                >
                  ← Prev
                </Button>
                <span className="px-1">
                  Page {childrenPagination.page} of {childrenPagination.totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setChildrenPage(p => Math.min(childrenPagination.totalPages, p + 1))}
                  disabled={childrenPagination.page >= childrenPagination.totalPages}
                >
                  Next →
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
      {/* Render inline creation row for this task's subtasks */}
      {inlineCreationParentId === task._id && (
        <InlineTaskRow
          parentId={task._id}
          depth={depth + 1}
          fieldConfigs={fieldConfigs}
          colSpan={fieldConfigs.length}
          onSubmit={(title) => onSubmitInlineCreation(title, task._id)}
          onCancel={onCancelInlineCreation}
          isCreating={isCreatingTask}
        />
      )}
    </>
  )
})

export function TaskDataTable({
  tasks,
  fieldConfigs,
  lookups,
  users,
  workflows,
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
  autoExpandIds,
  hasActiveFilters = false,
}: TaskDataTableProps) {
  const router = useRouter()
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set(autoExpandIds || []))
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [pulsingRows, setPulsingRows] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  // Inline creation state: null = not creating, string = parentId being created under (empty string = root level)
  const [inlineCreationParentId, setInlineCreationParentId] = useState<string | null>(null)

  const createTask = useCreateTask()

  // When filters are active, organize flat results into a tree (children under matching parents)
  // and default to collapsed state
  const organizedTasks = useMemo(() => {
    if (hasActiveFilters) {
      return organizeTasksIntoTree(tasks)
    }
    return tasks
  }, [tasks, hasActiveFilters])

  // Track previous hasActiveFilters to detect changes
  const prevHasActiveFilters = useRef(hasActiveFilters)

  // When filters become active, collapse all rows
  useEffect(() => {
    const wasFiltering = prevHasActiveFilters.current
    prevHasActiveFilters.current = hasActiveFilters

    if (hasActiveFilters && !wasFiltering) {
      // Filters just became active - collapse all rows
      setExpandedRows(new Set())
    }
  }, [hasActiveFilters])

  // Highlight a row (clears others, persists until another is clicked)
  // Clear first to restart animation if same row is clicked again
  const triggerPulse = useCallback((taskId: string, shouldScroll = false) => {
    setPulsingRows(new Set())
    requestAnimationFrame(() => {
      setPulsingRows(new Set([taskId]))
      if (shouldScroll) {
        setTimeout(() => {
          const row = document.querySelector(`[data-task-id="${taskId}"]`)
          row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 0)
      }
    })
  }, [])

  // Wrapper for onEditTask that also triggers pulse
  const handleEditTaskWithPulse = useCallback((task: Task) => {
    triggerPulse(task._id)
    onEditTask(task)
  }, [triggerPulse, onEditTask])

  // Navigate to a flow task's own view (shows its children as root-level tasks)
  const handleNavigateToFlow = useCallback((taskId: string) => {
    router.push(`/tasks?parentId=${taskId}`)
  }, [router])

  // Get task IDs that have children (for expand all functionality)
  const tasksWithChildren = useMemo(() => {
    return organizedTasks.filter(t => t.children && t.children.length > 0).map(t => t._id)
  }, [organizedTasks])

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

  // Auto-expand rows when autoExpandIds changes (e.g., viewing a parent task)
  useEffect(() => {
    if (autoExpandIds && autoExpandIds.length > 0) {
      setExpandedRows(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of autoExpandIds) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [autoExpandIds])

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const bulkUpdateTasks = useBulkUpdateTasks()
  const bulkDeleteTasks = useBulkDeleteTasks()

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set())
  }, [])

  // Helper: Flatten visible tasks in display order (respecting expanded state)
  const flattenVisibleTasks = useCallback((taskList: Task[], expanded: Set<string>): string[] => {
    const result: string[] = []
    const traverse = (items: Task[]) => {
      for (const task of items) {
        result.push(task._id)
        if (expanded.has(task._id) && task.children && task.children.length > 0) {
          traverse(task.children)
        }
      }
    }
    traverse(taskList)
    return result
  }, [])

  // Helper: Collect a task ID and all its descendant IDs recursively
  const collectAllDescendantIds = useCallback((task: Task): string[] => {
    const result: string[] = [task._id]
    if (task.children && task.children.length > 0) {
      for (const child of task.children) {
        result.push(...collectAllDescendantIds(child))
      }
    }
    return result
  }, [])

  // Helper: Find a task by ID in the task tree
  const findTaskById = useCallback((taskList: Task[], taskId: string): Task | null => {
    for (const task of taskList) {
      if (task._id === taskId) return task
      if (task.children && task.children.length > 0) {
        const found = findTaskById(task.children, taskId)
        if (found) return found
      }
    }
    return null
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

  const toggleRowSelection = useCallback((taskId: string, isShiftKey = false) => {
    if (isShiftKey && lastSelectedId && lastSelectedId !== taskId) {
      // Shift+click: select range between lastSelectedId and taskId, including children
      const visibleOrder = flattenVisibleTasks(tasks, expandedRows)
      const fromIndex = visibleOrder.indexOf(lastSelectedId)
      const toIndex = visibleOrder.indexOf(taskId)

      if (fromIndex !== -1 && toIndex !== -1) {
        const [startIndex, endIndex] = fromIndex < toIndex
          ? [fromIndex, toIndex]
          : [toIndex, fromIndex]

        // Get all task IDs in the range
        const rangeIds = visibleOrder.slice(startIndex, endIndex + 1)

        // For each task in the range, also include all its descendants
        const allIds = new Set<string>()
        rangeIds.forEach((id) => {
          allIds.add(id)
          // Find the task and collect all its descendants
          const task = findTaskById(tasks, id)
          if (task && task.children && task.children.length > 0) {
            collectAllDescendantIds(task).forEach((childId) => {
              allIds.add(childId)
            })
          }
        })

        setSelectedRows((prev) => {
          const newSelected = new Set(prev)
          allIds.forEach((id) => {
            newSelected.add(id)
          })
          return newSelected
        })
      }
    } else {
      // Regular click: toggle single row
      setSelectedRows((prev) => {
        const newSelected = new Set(prev)
        if (newSelected.has(taskId)) {
          newSelected.delete(taskId)
        } else {
          newSelected.add(taskId)
        }
        return newSelected
      })
    }
    // Always update last selected ID
    setLastSelectedId(taskId)
  }, [lastSelectedId, tasks, expandedRows, flattenVisibleTasks, findTaskById, collectAllDescendantIds])

  const toggleAllSelection = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === organizedTasks.length) {
        return new Set()
      } else {
        return new Set(organizedTasks.map((t) => t._id))
      }
    })
  }, [organizedTasks])

  const handleCellUpdate = useCallback(async (taskId: string, field: string, value: unknown) => {
    await updateTask.mutateAsync({ id: taskId, data: { [field]: value } })
  }, [updateTask])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask.mutateAsync({ id: taskId })
    }
  }, [deleteTask])

  // Inline creation handlers
  const handleStartInlineCreation = useCallback((parentId: string) => {
    setInlineCreationParentId(parentId)
    // Auto-expand the parent if not already expanded
    if (!expandedRows.has(parentId)) {
      setExpandedRows(prev => new Set([...Array.from(prev), parentId]))
    }
  }, [expandedRows])

  const handleCancelInlineCreation = useCallback(() => {
    setInlineCreationParentId(null)
  }, [])

  const handleSubmitInlineCreation = useCallback(async (title: string, parentId: string | null) => {
    try {
      await createTask.mutateAsync({
        title,
        status: 'pending',
        parentId: parentId || undefined,
      })
      // Keep the inline row open for adding more tasks (don't clear inlineCreationParentId)
    } catch (error) {
      console.error('Failed to create task:', error)
    }
  }, [createTask])

  // Start root-level inline creation
  const handleStartRootInlineCreation = useCallback(() => {
    setInlineCreationParentId('')  // Empty string = root level
  }, [])

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
    if (fieldConfig.lookupType) {
      let lookup = resolved as { displayName: string; color?: string; code?: string } | undefined

      // Check if resolved value matches current value - if not, it's stale from optimistic update
      // In this case, fall back to looking up from the lookups prop
      const isStaleResolved = lookup && value && typeof value === 'string' && lookup.code !== value

      if ((!lookup || isStaleResolved) && value && typeof value === 'string') {
        const lookupValues = lookups[fieldConfig.lookupType] || []
        const found = lookupValues.find(lv => lv.code === value)
        if (found) {
          lookup = { displayName: found.displayName, color: found.color, code: found.code }
        }
      }

      if (lookup) {
        return (
          <div className="flex justify-center">
            <Badge color={lookup.color} variant="outline">
              {lookup.displayName}
            </Badge>
          </div>
        )
      }
      // If still no lookup found, show the raw value in a basic badge
      if (value && typeof value === 'string') {
        return (
          <div className="flex justify-center">
            <Badge variant="outline">
              {value}
            </Badge>
          </div>
        )
      }
    }

    // Handle reference fields (user, team)
    if (fieldConfig.fieldType === 'reference') {
      // Try the field path directly first (e.g., assigneeId -> assignee)
      const fieldName = fieldConfig.fieldPath.replace('Id', '')
      // Also try looking up directly by the field path
      const ref = (task._resolved?.[fieldName as keyof typeof task._resolved] ||
        task._resolved?.[fieldConfig.fieldPath as keyof typeof task._resolved]) as
        | User
        | { displayName?: string; name?: string }
        | undefined

      // For user references, use UserChip
      if (fieldConfig.referenceCollection === 'users') {
        if (ref && '_id' in ref) {
          return (
            <div className="flex justify-center">
              <UserChip user={ref as User} size="sm" />
            </div>
          )
        }
        // No assignee - show unassigned
        return (
          <div className="flex justify-center">
            <UserChip user={null} size="sm" />
          </div>
        )
      }

      // For other references (teams, etc.), show displayName or name
      const refDisplay = ref as { displayName?: string; name?: string } | undefined
      if (refDisplay?.displayName || refDisplay?.name) {
        return <div className="text-center">{refDisplay.displayName || refDisplay.name}</div>
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
  }, [lookups])

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
                    checked={selectedRows.size === organizedTasks.length && organizedTasks.length > 0}
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
                    {fc.fieldPath === 'title' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 ml-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStartRootInlineCreation()
                        }}
                        title="Add new task"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Root-level inline creation row - shown at TOP */}
            {inlineCreationParentId === '' && (
              <InlineTaskRow
                parentId={null}
                depth={0}
                fieldConfigs={visibleFieldConfigs}
                colSpan={visibleFieldConfigs.length}
                onSubmit={(title) => handleSubmitInlineCreation(title, null)}
                onCancel={handleCancelInlineCreation}
                isCreating={createTask.isPending}
              />
            )}
            {organizedTasks.length === 0 && inlineCreationParentId !== '' ? (
              <TableRow>
                <TableCell
                  colSpan={visibleFieldConfigs.length + 4}
                  className="h-24 text-center text-muted-foreground"
                >
                  No tasks found. Click the + button in the Title header to add one.
                </TableCell>
              </TableRow>
            ) : (
              organizedTasks.map((task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  fieldConfigs={visibleFieldConfigs}
                  lookups={lookups}
                  users={users}
                  workflows={workflows}
                  depth={0}
                  isExpanded={expandedRows.has(task._id)}
                  isSelected={selectedRows.has(task._id)}
                  onToggleExpand={() => toggleRowExpansion(task._id)}
                  onToggleSelect={(isShiftKey) => toggleRowSelection(task._id, isShiftKey)}
                  onCellUpdate={handleCellUpdate}
                  onEdit={() => handleEditTaskWithPulse(task)}
                  onDelete={() => handleDeleteTask(task._id)}
                  onCreateSubtask={() => onCreateSubtask(task)}
                  renderCellValue={renderCellValue}
                  expandedRows={expandedRows}
                  selectedRows={selectedRows}
                  pulsingRows={pulsingRows}
                  toggleRowExpansion={toggleRowExpansion}
                  toggleRowSelection={toggleRowSelection}
                  handleDeleteTask={handleDeleteTask}
                  handleEditTask={handleEditTaskWithPulse}
                  handleCreateSubtask={onCreateSubtask}
                  expandAllEnabled={expandAllEnabled}
                  onNavigateToFlow={handleNavigateToFlow}
                  isPulsing={pulsingRows.has(task._id)}
                  onTriggerPulse={triggerPulse}
                  inlineCreationParentId={inlineCreationParentId}
                  onStartInlineCreation={handleStartInlineCreation}
                  onCancelInlineCreation={handleCancelInlineCreation}
                  onSubmitInlineCreation={handleSubmitInlineCreation}
                  isCreatingTask={createTask.isPending}
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
