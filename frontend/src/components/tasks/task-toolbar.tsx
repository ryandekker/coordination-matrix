'use client'

import { useState, useMemo } from 'react'
import { Search, Plus, Filter, Columns, ChevronDown, X, Bookmark, Tag } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { View, LookupValue, User, Task } from '@/lib/api'

interface TaskToolbarProps {
  views: View[]
  currentView?: View
  lookups: Record<string, LookupValue[]>
  users: User[]
  tasks?: Task[]
  filters: Record<string, unknown>
  search: string
  sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>
  onViewChange: (viewId: string) => void
  onFilterChange: (filters: Record<string, unknown>) => void
  onSearchChange: (search: string) => void
  onCreateTask: () => void
  onOpenColumnConfig: () => void
  onSaveSearch?: (name: string, filters: Record<string, unknown>, sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>) => Promise<void>
  onUpdateSearch?: (viewId: string, filters: Record<string, unknown>, sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>) => Promise<void>
}

export function TaskToolbar({
  views,
  currentView,
  lookups,
  users,
  tasks = [],
  filters,
  search,
  sorting,
  onViewChange,
  onFilterChange,
  onSearchChange,
  onCreateTask,
  onOpenColumnConfig,
  onSaveSearch,
  onUpdateSearch,
}: TaskToolbarProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMode, setSaveMode] = useState<'new' | 'update'>('new')

  const statusOptions = lookups.task_status || []
  const urgencyOptions = lookups.urgency || []

  // Get unique tags from tasks for filter dropdown
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>()
    tasks.forEach((task) => {
      if (task.tags && Array.isArray(task.tags)) {
        task.tags.forEach((tag) => tagSet.add(tag))
      }
    })
    return Array.from(tagSet).sort()
  }, [tasks])

  const hasActiveFilters = Object.keys(filters).length > 0 || search.length > 0

  // Check if we're viewing a non-system, user-created view
  const canUpdateCurrentView = currentView && !currentView.isSystem && currentView.name !== 'All Tasks'

  const openSaveModal = () => {
    // Default to update mode if we're on a user-created view
    if (canUpdateCurrentView) {
      setSaveMode('update')
      setSaveName(currentView?.name || '')
    } else {
      setSaveMode('new')
      setSaveName('')
    }
    setIsSaveModalOpen(true)
  }

  const handleSaveSearch = async () => {
    if (saveMode === 'update' && canUpdateCurrentView && onUpdateSearch) {
      setIsSaving(true)
      try {
        const filtersToSave = { ...filters }
        if (search) {
          filtersToSave.search = search
        }
        await onUpdateSearch(currentView!._id, filtersToSave, sorting)
        setIsSaveModalOpen(false)
      } finally {
        setIsSaving(false)
      }
    } else if (saveMode === 'new' && saveName.trim() && onSaveSearch) {
      setIsSaving(true)
      try {
        const filtersToSave = { ...filters }
        if (search) {
          filtersToSave.search = search
        }
        await onSaveSearch(saveName.trim(), filtersToSave, sorting)
        setIsSaveModalOpen(false)
        setSaveName('')
      } finally {
        setIsSaving(false)
      }
    }
  }

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

  const handleUrgencyFilter = (urgency: string, checked: boolean) => {
    const currentUrgencies = (filters.urgency as string[]) || []
    const newUrgencies = checked
      ? [...currentUrgencies, urgency]
      : currentUrgencies.filter((u) => u !== urgency)
    onFilterChange({
      ...filters,
      urgency: newUrgencies.length > 0 ? newUrgencies : undefined,
    })
  }

  const handleAssigneeFilter = (assigneeId: string, checked: boolean) => {
    const currentAssignees = (filters.assigneeId as string[]) || []
    const newAssignees = checked
      ? [...currentAssignees, assigneeId]
      : currentAssignees.filter((a) => a !== assigneeId)
    onFilterChange({
      ...filters,
      assigneeId: newAssignees.length > 0 ? newAssignees : undefined,
    })
  }

  const handleTagFilter = (tag: string, checked: boolean) => {
    const currentTags = (filters.tags as string[]) || []
    const newTags = checked
      ? [...currentTags, tag]
      : currentTags.filter((t) => t !== tag)
    onFilterChange({
      ...filters,
      tags: newTags.length > 0 ? newTags : undefined,
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

  const urgencyFilters = (filters.urgency as string[]) || []
  urgencyFilters.forEach((urgency) => {
    const opt = urgencyOptions.find((u) => u.code === urgency)
    if (opt) {
      activeFilters.push({ key: `urgency-${urgency}`, label: 'Urgency', value: opt.displayName, color: opt.color })
    }
  })

  const assigneeFilters = (filters.assigneeId as string[]) || []
  assigneeFilters.forEach((assigneeId) => {
    const user = users.find((u) => u._id === assigneeId)
    if (user) {
      activeFilters.push({ key: `assignee-${assigneeId}`, label: 'Assignee', value: user.displayName })
    }
  })

  const tagFilters = (filters.tags as string[]) || []
  tagFilters.forEach((tag) => {
    activeFilters.push({ key: `tag-${tag}`, label: 'Tag', value: tag })
  })

  const removeFilter = (filterKey: string) => {
    if (filterKey === 'search') {
      onSearchChange('')
    } else if (filterKey.startsWith('status-')) {
      const status = filterKey.replace('status-', '')
      handleStatusFilter(status, false)
    } else if (filterKey.startsWith('urgency-')) {
      const urgency = filterKey.replace('urgency-', '')
      handleUrgencyFilter(urgency, false)
    } else if (filterKey.startsWith('assignee-')) {
      const assigneeId = filterKey.replace('assignee-', '')
      handleAssigneeFilter(assigneeId, false)
    } else if (filterKey.startsWith('tag-')) {
      const tag = filterKey.replace('tag-', '')
      handleTagFilter(tag, false)
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

      {/* Urgency Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Urgency
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Filter by Urgency</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {urgencyOptions.map((urgency) => (
            <DropdownMenuCheckboxItem
              key={urgency.code}
              checked={((filters.urgency as string[]) || []).includes(urgency.code)}
              onCheckedChange={(checked) => handleUrgencyFilter(urgency.code, checked)}
            >
              <span
                className="mr-2 h-2 w-2 rounded-full"
                style={{ backgroundColor: urgency.color }}
              />
              {urgency.displayName}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Assignee Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Assignee
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
          <DropdownMenuLabel>Filter by Assignee</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {users.filter(u => u.isActive).map((user) => (
            <DropdownMenuCheckboxItem
              key={user._id}
              checked={((filters.assigneeId as string[]) || []).includes(user._id)}
              onCheckedChange={(checked) => handleAssigneeFilter(user._id, checked)}
            >
              {user.displayName}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Tag className="mr-2 h-4 w-4" />
              Tags
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
            <DropdownMenuLabel>Filter by Tag</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableTags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag}
                checked={((filters.tags as string[]) || []).includes(tag)}
                onCheckedChange={(checked) => handleTagFilter(tag, checked)}
              >
                {tag}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="flex-1" />

      {/* Save Search */}
      {(onSaveSearch || onUpdateSearch) && hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={openSaveModal}>
          <Bookmark className="mr-2 h-4 w-4" />
          Save Search
        </Button>
      )}

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

      {/* Save Search Modal */}
      <Dialog open={isSaveModalOpen} onOpenChange={setIsSaveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Search</DialogTitle>
            <DialogDescription>
              {canUpdateCurrentView
                ? 'Update the current saved search or create a new one.'
                : 'Save your current filters as a reusable search. It will appear in the sidebar.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Save Mode Selection */}
            {canUpdateCurrentView && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Save Option</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={saveMode === 'update' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSaveMode('update')}
                    className="flex-1"
                  >
                    Update "{currentView?.name}"
                  </Button>
                  <Button
                    type="button"
                    variant={saveMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSaveMode('new')
                      setSaveName('')
                    }}
                    className="flex-1"
                  >
                    Save as New
                  </Button>
                </div>
              </div>
            )}

            {/* Name Input - only show for new saves */}
            {saveMode === 'new' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Name *</label>
                <Input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g., Urgent Pending Tasks"
                  autoFocus
                />
              </div>
            )}

            {/* Current Filters Preview */}
            {activeFilters.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Current Filters</label>
                <div className="flex flex-wrap gap-1">
                  {activeFilters.map((filter) => (
                    <Badge key={filter.key} variant="secondary" className="text-xs">
                      {filter.label}: {filter.value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSearch}
              disabled={isSaving || (saveMode === 'new' && !saveName.trim())}
            >
              {isSaving ? 'Saving...' : saveMode === 'update' ? 'Update Search' : 'Save Search'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
