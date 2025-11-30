'use client'

import { useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EditableCell } from './editable-cell'
import { Task, FieldConfig, LookupValue, User } from '@/lib/api'
import { useTaskChildren, useUpdateTask, useDeleteTask } from '@/hooks/use-tasks'
import { formatDateTime, cn } from '@/lib/utils'

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
  onPageChange: (page: number) => void
}

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
  onPageChange,
}: TaskDataTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  // Get field config map for quick lookup
  const fieldConfigMap = new Map(fieldConfigs.map((fc) => [fc.fieldPath, fc]))

  // Get visible field configs in order
  const visibleFieldConfigs = visibleColumns
    .map((col) => fieldConfigMap.get(col))
    .filter(Boolean) as FieldConfig[]

  const toggleRowExpansion = (taskId: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId)
    } else {
      newExpanded.add(taskId)
    }
    setExpandedRows(newExpanded)
  }

  const toggleRowSelection = (taskId: string) => {
    const newSelected = new Set(selectedRows)
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId)
    } else {
      newSelected.add(taskId)
    }
    setSelectedRows(newSelected)
  }

  const toggleAllSelection = () => {
    if (selectedRows.size === tasks.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(tasks.map((t) => t._id)))
    }
  }

  const handleCellUpdate = async (taskId: string, field: string, value: unknown) => {
    await updateTask.mutateAsync({ id: taskId, data: { [field]: value } })
  }

  const handleDeleteTask = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask.mutateAsync({ id: taskId })
    }
  }

  const renderSortIcon = (field: string) => {
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
  }

  const renderCellValue = (task: Task, fieldConfig: FieldConfig) => {
    const value = task[fieldConfig.fieldPath as keyof Task]
    const resolved = task._resolved?.[fieldConfig.fieldPath as keyof typeof task._resolved]

    // Handle lookup fields (status, priority, etc.)
    if (fieldConfig.lookupType && resolved) {
      const lookup = resolved as { displayName: string; color?: string }
      return (
        <Badge color={lookup.color} variant="outline">
          {lookup.displayName}
        </Badge>
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
        return ref.displayName || ref.name
      }
      // If no resolved value, show dash
      const rawValue = task[fieldConfig.fieldPath as keyof Task]
      return rawValue ? '-' : '-'
    }

    // Handle boolean fields
    if (fieldConfig.fieldType === 'boolean') {
      return value ? 'Yes' : 'No'
    }

    // Handle date fields
    if (fieldConfig.fieldType === 'datetime' || fieldConfig.fieldType === 'date') {
      return formatDateTime(value as string)
    }

    // Handle tags
    if (fieldConfig.fieldType === 'tags' && Array.isArray(value)) {
      return (
        <div className="flex flex-wrap gap-1">
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
      return value?.toString() || '0'
    }

    return value?.toString() || '-'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedRows.size === tasks.length && tasks.length > 0}
                  onCheckedChange={toggleAllSelection}
                />
              </TableHead>
              <TableHead className="w-12" />
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
                  colSpan={visibleFieldConfigs.length + 3}
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
                  renderCellValue={renderCellValue}
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

// Recursive row component for nested tasks
function TaskRow({
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
  renderCellValue,
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
  renderCellValue: (task: Task, fc: FieldConfig) => React.ReactNode
}) {
  const { data: childrenData } = useTaskChildren(isExpanded && task.childCount > 0 ? task._id : null)
  const children = childrenData?.data || []

  return (
    <>
      <TableRow
        className={cn(depth > 0 && 'bg-muted/30')}
        data-state={isSelected ? 'selected' : undefined}
      >
        <TableCell>
          <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} />
        </TableCell>
        <TableCell>
          {task.childCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onToggleExpand}>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <div className="w-6" />
          )}
        </TableCell>
        {fieldConfigs.map((fc) => (
          <TableCell
            key={fc.fieldPath}
            className="relative py-1 px-2"
            style={{ paddingLeft: fc.fieldPath === 'title' ? depth * 24 + 8 : undefined }}
          >
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
      {isExpanded &&
        children.map((child) => (
          <TaskRow
            key={child._id}
            task={child}
            fieldConfigs={fieldConfigs}
            lookups={lookups}
            users={users}
            depth={depth + 1}
            isExpanded={false}
            isSelected={false}
            onToggleExpand={() => {}}
            onToggleSelect={() => {}}
            onCellUpdate={onCellUpdate}
            onEdit={() => {}}
            onDelete={() => {}}
            renderCellValue={renderCellValue}
          />
        ))}
    </>
  )
}
