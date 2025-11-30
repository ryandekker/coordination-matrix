'use client'

import { Search, Plus, Filter, Columns, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { View, LookupValue } from '@/lib/api'

interface TaskToolbarProps {
  views: View[]
  currentView?: View
  lookups: Record<string, LookupValue[]>
  filters: Record<string, unknown>
  search: string
  onViewChange: (viewId: string) => void
  onFilterChange: (filters: Record<string, unknown>) => void
  onSearchChange: (search: string) => void
  onCreateTask: () => void
  onOpenColumnConfig: () => void
}

export function TaskToolbar({
  views,
  currentView,
  lookups,
  filters,
  search,
  onViewChange,
  onFilterChange,
  onSearchChange,
  onCreateTask,
  onOpenColumnConfig,
}: TaskToolbarProps) {
  const statusOptions = lookups.task_status || []
  const priorityOptions = lookups.priority || []

  const handleStatusFilter = (status: string, checked: boolean) => {
    const currentStatuses = (filters.status as string[]) || []
    const newStatuses = checked
      ? [...currentStatuses, status]
      : currentStatuses.filter((s) => s !== status)
    onFilterChange({
      ...filters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    })
  }

  const handlePriorityFilter = (priority: string, checked: boolean) => {
    const currentPriorities = (filters.priority as string[]) || []
    const newPriorities = checked
      ? [...currentPriorities, priority]
      : currentPriorities.filter((p) => p !== priority)
    onFilterChange({
      ...filters,
      priority: newPriorities.length > 0 ? newPriorities : undefined,
    })
  }

  const handleHITLFilter = (checked: boolean) => {
    onFilterChange({
      ...filters,
      hitlPending: checked || undefined,
    })
  }

  const clearAllFilters = () => {
    onFilterChange({})
    onSearchChange('')
  }

  // Build active filter chips
  const activeFilters: { key: string; label: string; value: string; color?: string }[] = []

  if (search) {
    activeFilters.push({ key: 'search', label: 'Search', value: search })
  }

  const statusFilters = (filters.status as string[]) || []
  statusFilters.forEach((status) => {
    const opt = statusOptions.find((s) => s.code === status)
    if (opt) {
      activeFilters.push({ key: `status-${status}`, label: 'Status', value: opt.displayName, color: opt.color })
    }
  })

  const priorityFilters = (filters.priority as string[]) || []
  priorityFilters.forEach((priority) => {
    const opt = priorityOptions.find((p) => p.code === priority)
    if (opt) {
      activeFilters.push({ key: `priority-${priority}`, label: 'Priority', value: opt.displayName, color: opt.color })
    }
  })

  if (filters.hitlPending) {
    activeFilters.push({ key: 'hitl', label: 'HITL', value: 'Awaiting Review' })
  }

  const removeFilter = (filterKey: string) => {
    if (filterKey === 'search') {
      onSearchChange('')
    } else if (filterKey.startsWith('status-')) {
      const status = filterKey.replace('status-', '')
      handleStatusFilter(status, false)
    } else if (filterKey.startsWith('priority-')) {
      const priority = filterKey.replace('priority-', '')
      handlePriorityFilter(priority, false)
    } else if (filterKey === 'hitl') {
      handleHITLFilter(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
      {/* View Selector */}
      <Select value={currentView?._id} onValueChange={onViewChange}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select view" />
        </SelectTrigger>
        <SelectContent>
          {views
            .filter((view) => view._id)
            .map((view) => (
              <SelectItem key={view._id} value={view._id}>
                {view.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Status
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {statusOptions.map((status) => (
            <DropdownMenuCheckboxItem
              key={status.code}
              checked={((filters.status as string[]) || []).includes(status.code)}
              onCheckedChange={(checked) => handleStatusFilter(status.code, checked)}
            >
              <span
                className="mr-2 h-2 w-2 rounded-full"
                style={{ backgroundColor: status.color }}
              />
              {status.displayName}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Priority Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Priority
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Filter by Priority</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {priorityOptions.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority.code}
              checked={((filters.priority as string[]) || []).includes(priority.code)}
              onCheckedChange={(checked) => handlePriorityFilter(priority.code, checked)}
            >
              <span
                className="mr-2 h-2 w-2 rounded-full"
                style={{ backgroundColor: priority.color }}
              />
              {priority.displayName}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* HITL Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            HITL
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuCheckboxItem
            checked={!!filters.hitlPending}
            onCheckedChange={handleHITLFilter}
          >
            Awaiting Review
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* Column Config */}
      <Button variant="outline" size="sm" onClick={onOpenColumnConfig}>
        <Columns className="mr-2 h-4 w-4" />
        Columns
      </Button>

      {/* Create Task */}
      <Button onClick={onCreateTask}>
        <Plus className="mr-2 h-4 w-4" />
        New Task
      </Button>
      </div>

      {/* Active Filters */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Filters:</span>
          {activeFilters.map((filter) => (
            <Badge
              key={filter.key}
              variant="secondary"
              className="flex items-center gap-1 pl-2 pr-1 py-1"
            >
              {filter.color && (
                <span
                  className="h-2 w-2 rounded-full mr-1"
                  style={{ backgroundColor: filter.color }}
                />
              )}
              <span className="text-xs text-muted-foreground">{filter.label}:</span>
              <span className="text-xs font-medium">{filter.value}</span>
              <button
                onClick={() => removeFilter(filter.key)}
                className="ml-1 hover:bg-muted rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-6 text-xs text-muted-foreground"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
