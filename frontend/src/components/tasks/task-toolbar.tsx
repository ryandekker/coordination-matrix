'use client'

import { useState, useMemo, useCallback } from 'react'
import { Search, Filter, Columns, ChevronDown, X, Bookmark, Tag as TagIcon, ChevronsDownUp, ChevronsUpDown, Archive, Workflow as WorkflowIcon, FolderKanban, GitBranch } from 'lucide-react'
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
import { View, ViewFolder, LookupValue, User, Task, Tag, Workflow, Project, isSystemUser } from '@/lib/api'
import { UserChip } from '@/components/ui/user-chip'

interface TaskToolbarProps {
  currentView?: View
  viewFolders?: ViewFolder[]
  lookups: Record<string, LookupValue[]>
  users: User[]
  tasks?: Task[]
  availableTags?: Tag[]
  workflows?: Workflow[]
  projects?: Project[]
  filters: Record<string, unknown>
  search: string
  sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>
  onFilterChange: (filters: Record<string, unknown>) => void
  onSearchChange: (search: string) => void
  onOpenColumnConfig: () => void
  onSaveSearch?: (name: string, filters: Record<string, unknown>, sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>, folderId?: string | null) => Promise<void>
  onUpdateSearch?: (viewId: string, filters: Record<string, unknown>, sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>) => Promise<void>
  hasAnyChildren?: boolean
  expandAllEnabled?: boolean
  onExpandAllChange?: (enabled: boolean) => void
  nestWorkflowsEnabled?: boolean
  onNestWorkflowsChange?: (enabled: boolean) => void
}

export function TaskToolbar({
  currentView,
  viewFolders = [],
  lookups,
  users,
  tasks = [],
  availableTags = [],
  workflows = [],
  projects = [],
  filters,
  search,
  sorting,
  onFilterChange,
  onSearchChange,
  onOpenColumnConfig,
  onSaveSearch,
  onUpdateSearch,
  hasAnyChildren,
  expandAllEnabled,
  onExpandAllChange,
  nestWorkflowsEnabled,
  onNestWorkflowsChange,
}: TaskToolbarProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMode, setSaveMode] = useState<'new' | 'update'>('new')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [workflowSearchTerm, setWorkflowSearchTerm] = useState('')
  const [assigneeSearchTerm, setAssigneeSearchTerm] = useState('')
  const [tagSearchTerm, setTagSearchTerm] = useState('')
  const [projectSearchTerm, setProjectSearchTerm] = useState('')

  const statusOptions = lookups.task_status || []
  const urgencyOptions = lookups.urgency || []

  // Filter users by search term (exclude system user from assignment options)
  const filteredUsers = useMemo(() => {
    const activeUsers = users.filter(u => u.isActive && !isSystemUser(u))
    if (!assigneeSearchTerm.trim()) {
      return activeUsers
    }
    const searchLower = assigneeSearchTerm.toLowerCase()
    return activeUsers.filter(u =>
      u.displayName.toLowerCase().includes(searchLower) ||
      (u.email && u.email.toLowerCase().includes(searchLower))
    )
  }, [users, assigneeSearchTerm])

  // Filter tags by search term
  const filteredTags = useMemo(() => {
    if (!tagSearchTerm.trim()) {
      return availableTags
    }
    const searchLower = tagSearchTerm.toLowerCase()
    return availableTags.filter(t =>
      t.name.toLowerCase().includes(searchLower) ||
      t.displayName.toLowerCase().includes(searchLower)
    )
  }, [availableTags, tagSearchTerm])

  // Filter projects by search term (only active projects)
  const filteredProjects = useMemo(() => {
    const activeProjects = projects.filter(p => p.status === 'active')
    if (!projectSearchTerm.trim()) {
      return activeProjects
    }
    const searchLower = projectSearchTerm.toLowerCase()
    return activeProjects.filter(p =>
      p.displayName.toLowerCase().includes(searchLower) ||
      (p.description && p.description.toLowerCase().includes(searchLower))
    )
  }, [projects, projectSearchTerm])

  // Build workflow data with stages for filtering and display
  const workflowsWithStages = useMemo(() => {
    return workflows.filter(w => w.isActive).map(workflow => {
      const stages: string[] = []
      if (workflow.steps) {
        workflow.steps.forEach(step => {
          const stageName = step.hitlPhase || step.name
          if (stageName && !stages.includes(stageName)) {
            stages.push(stageName)
          }
        })
      } else if (workflow.stages) {
        stages.push(...workflow.stages)
      }
      return { workflow, stages: stages.sort() }
    })
  }, [workflows])

  // Filter workflows and stages by search term
  const filteredWorkflowsWithStages = useMemo(() => {
    if (!workflowSearchTerm.trim()) {
      return workflowsWithStages
    }
    const searchLower = workflowSearchTerm.toLowerCase()
    return workflowsWithStages
      .map(({ workflow, stages }) => {
        // Check if workflow name matches
        const workflowMatches = workflow.name.toLowerCase().includes(searchLower)
        // Check which stages match
        const matchingStages = stages.filter(stage => stage.toLowerCase().includes(searchLower))

        // Include workflow if its name matches OR if any stage matches
        if (workflowMatches || matchingStages.length > 0) {
          return {
            workflow,
            // If workflow name matches, show all stages; otherwise show only matching stages
            stages: workflowMatches ? stages : matchingStages,
            workflowMatches,
          }
        }
        return null
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [workflowsWithStages, workflowSearchTerm])

  const hasActiveFilters = Object.keys(filters).length > 0 || search.length > 0

  // Check if we're viewing a non-system, user-created view
  const canUpdateCurrentView = currentView && !currentView.isSystem && currentView.name !== 'All Tasks'

  const openSaveModal = useCallback(() => {
    // Default to update mode if we're on a user-created view
    if (canUpdateCurrentView) {
      setSaveMode('update')
      setSaveName(currentView?.name || '')
      setSelectedFolderId(currentView?.folderId || null)
    } else {
      setSaveMode('new')
      setSaveName('')
      setSelectedFolderId(null)
    }
    setIsSaveModalOpen(true)
  }, [canUpdateCurrentView, currentView?.name, currentView?.folderId])

  const handleSaveSearch = useCallback(async () => {
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
        await onSaveSearch(saveName.trim(), filtersToSave, sorting, selectedFolderId)
        setIsSaveModalOpen(false)
        setSaveName('')
        setSelectedFolderId(null)
      } finally {
        setIsSaving(false)
      }
    }
  }, [saveMode, canUpdateCurrentView, onUpdateSearch, currentView, filters, search, sorting, saveName, onSaveSearch, selectedFolderId])

  const handleStatusFilter = useCallback((status: string, checked: boolean) => {
    const currentStatuses = (filters.status as string[]) || []
    const newStatuses = checked
      ? [...currentStatuses, status]
      : currentStatuses.filter((s) => s !== status)
    onFilterChange({
      ...filters,
      status: newStatuses.length > 0 ? newStatuses : undefined,
    })
  }, [filters, onFilterChange])

  const handleUrgencyFilter = useCallback((urgency: string, checked: boolean) => {
    const currentUrgencies = (filters.urgency as string[]) || []
    const newUrgencies = checked
      ? [...currentUrgencies, urgency]
      : currentUrgencies.filter((u) => u !== urgency)
    onFilterChange({
      ...filters,
      urgency: newUrgencies.length > 0 ? newUrgencies : undefined,
    })
  }, [filters, onFilterChange])

  const handleAssigneeFilter = useCallback((assigneeId: string, checked: boolean) => {
    const currentAssignees = (filters.assigneeId as string[]) || []
    const newAssignees = checked
      ? [...currentAssignees, assigneeId]
      : currentAssignees.filter((a) => a !== assigneeId)
    onFilterChange({
      ...filters,
      assigneeId: newAssignees.length > 0 ? newAssignees : undefined,
    })
  }, [filters, onFilterChange])

  const handleTagFilter = useCallback((tag: string, checked: boolean) => {
    const currentTags = (filters.tags as string[]) || []
    const newTags = checked
      ? [...currentTags, tag]
      : currentTags.filter((t) => t !== tag)
    onFilterChange({
      ...filters,
      tags: newTags.length > 0 ? newTags : undefined,
    })
  }, [filters, onFilterChange])

  const handleIncludeArchivedChange = useCallback((checked: boolean) => {
    onFilterChange({
      ...filters,
      includeArchived: checked || undefined,
    })
  }, [filters, onFilterChange])

  const handleWorkflowFilter = useCallback((workflowId: string, checked: boolean) => {
    const currentWorkflows = (filters.workflowId as string[]) || []
    const newWorkflows = checked
      ? [...currentWorkflows, workflowId]
      : currentWorkflows.filter((w) => w !== workflowId)
    onFilterChange({
      ...filters,
      workflowId: newWorkflows.length > 0 ? newWorkflows : undefined,
    })
  }, [filters, onFilterChange])

  const handleHasWorkflowFilter = useCallback((value: 'all' | 'yes' | 'no') => {
    onFilterChange({
      ...filters,
      hasWorkflow: value === 'all' ? undefined : value === 'yes',
    })
  }, [filters, onFilterChange])

  const handleWorkflowStageFilter = useCallback((stage: string, checked: boolean) => {
    const currentStages = (filters.workflowStage as string[]) || []
    const newStages = checked
      ? [...currentStages, stage]
      : currentStages.filter((s) => s !== stage)
    onFilterChange({
      ...filters,
      workflowStage: newStages.length > 0 ? newStages : undefined,
    })
  }, [filters, onFilterChange])

  const handleProjectFilter = useCallback((projectId: string, checked: boolean) => {
    // Project filter is single-select for now (or could be made multi-select)
    onFilterChange({
      ...filters,
      projectId: checked ? projectId : undefined,
    })
  }, [filters, onFilterChange])

  const clearAllFilters = useCallback(() => {
    onFilterChange({})
    onSearchChange('')
  }, [onFilterChange, onSearchChange])

  // Build active filter chips - memoized
  const activeFilters = useMemo(() => {
    const result: { key: string; label: string; value: string; color?: string }[] = []

    if (search) {
      result.push({ key: 'search', label: 'Search', value: search })
    }

    // Helper to ensure filter values are always arrays (they can be string or string[])
    const toArray = (val: unknown): string[] =>
      Array.isArray(val) ? val : val ? [val as string] : []

    const statusFilters = toArray(filters.status)
    statusFilters.forEach((status) => {
      const opt = statusOptions.find((s) => s.code === status)
      if (opt) {
        result.push({ key: `status-${status}`, label: 'Status', value: opt.displayName, color: opt.color })
      }
    })

    const urgencyFilters = toArray(filters.urgency)
    urgencyFilters.forEach((urgency) => {
      const opt = urgencyOptions.find((u) => u.code === urgency)
      if (opt) {
        result.push({ key: `urgency-${urgency}`, label: 'Urgency', value: opt.displayName, color: opt.color })
      }
    })

    const assigneeFilters = toArray(filters.assigneeId)
    assigneeFilters.forEach((assigneeId) => {
      const user = users.find((u) => u._id === assigneeId)
      if (user) {
        result.push({ key: `assignee-${assigneeId}`, label: 'Assignee', value: user.displayName })
      }
    })

    const tagFilters = toArray(filters.tags)
    tagFilters.forEach((tagName) => {
      const tagObj = availableTags.find((t) => t.name === tagName)
      result.push({
        key: `tag-${tagName}`,
        label: 'Tag',
        value: tagObj?.displayName || tagName,
        color: tagObj?.color,
      })
    })

    if (filters.includeArchived) {
      result.push({ key: 'includeArchived', label: 'Show', value: 'Archived' })
    }

    // Workflow filters
    if (filters.hasWorkflow === true) {
      result.push({ key: 'hasWorkflow-yes', label: 'Workflow', value: 'Part of workflow' })
    } else if (filters.hasWorkflow === false) {
      result.push({ key: 'hasWorkflow-no', label: 'Workflow', value: 'Standalone only' })
    }

    const workflowFilters = toArray(filters.workflowId)
    workflowFilters.forEach((workflowId) => {
      const workflow = workflows.find((w) => w._id === workflowId)
      if (workflow) {
        result.push({ key: `workflow-${workflowId}`, label: 'Workflow', value: workflow.name })
      }
    })

    const workflowStageFilters = toArray(filters.workflowStage)
    workflowStageFilters.forEach((stage) => {
      result.push({ key: `workflowStage-${stage}`, label: 'Stage', value: stage })
    })

    // Project filter
    if (filters.projectId) {
      const project = projects.find((p) => p._id === filters.projectId)
      if (project) {
        result.push({ key: `project-${filters.projectId}`, label: 'Project', value: project.displayName, color: project.color })
      }
    }

    return result
  }, [search, filters, statusOptions, urgencyOptions, users, availableTags, workflows, projects])

  const removeFilter = useCallback((filterKey: string) => {
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
    } else if (filterKey === 'includeArchived') {
      handleIncludeArchivedChange(false)
    } else if (filterKey === 'hasWorkflow-yes' || filterKey === 'hasWorkflow-no') {
      handleHasWorkflowFilter('all')
    } else if (filterKey.startsWith('workflow-')) {
      const workflowId = filterKey.replace('workflow-', '')
      handleWorkflowFilter(workflowId, false)
    } else if (filterKey.startsWith('workflowStage-')) {
      const stage = filterKey.replace('workflowStage-', '')
      handleWorkflowStageFilter(stage, false)
    } else if (filterKey.startsWith('project-')) {
      const projectId = filterKey.replace('project-', '')
      handleProjectFilter(projectId, false)
    }
  }, [onSearchChange, handleStatusFilter, handleUrgencyFilter, handleAssigneeFilter, handleTagFilter, handleIncludeArchivedChange, handleHasWorkflowFilter, handleWorkflowFilter, handleWorkflowStageFilter, handleProjectFilter])

  return (
    <div className="space-y-2">
      {/* Single row toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className={`relative transition-all duration-200 ${isSearchFocused || search ? 'w-64' : 'w-40'}`}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className="pl-9 h-9"
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
          {statusOptions.filter(s => s.code !== 'archived').map((status) => (
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
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={filters.includeArchived === true}
            onCheckedChange={handleIncludeArchivedChange}
          >
            <Archive className="mr-2 h-4 w-4 text-muted-foreground" />
            Include Archived
          </DropdownMenuCheckboxItem>
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
      <DropdownMenu onOpenChange={(open) => { if (!open) setAssigneeSearchTerm('') }}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Assignee
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <div className="px-2 py-1.5">
            <Input
              placeholder="Search assignees..."
              value={assigneeSearchTerm}
              onChange={(e) => setAssigneeSearchTerm(e.target.value)}
              className="h-8"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-48 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No assignees found
              </div>
            ) : (
              filteredUsers.map((user) => (
                <DropdownMenuCheckboxItem
                  key={user._id}
                  checked={((filters.assigneeId as string[]) || []).includes(user._id)}
                  onCheckedChange={(checked) => handleAssigneeFilter(user._id, checked)}
                >
                  <UserChip
                    user={user as Parameters<typeof UserChip>[0]['user']}
                    size="sm"
                    showUnassigned={false}
                  />
                </DropdownMenuCheckboxItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <DropdownMenu onOpenChange={(open) => { if (!open) setTagSearchTerm('') }}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <TagIcon className="mr-2 h-4 w-4" />
              Tags
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1.5">
              <Input
                placeholder="Search tags..."
                value={tagSearchTerm}
                onChange={(e) => setTagSearchTerm(e.target.value)}
                className="h-8"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <DropdownMenuSeparator />
            <div className="max-h-48 overflow-y-auto">
              {filteredTags.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No tags found
                </div>
              ) : (
                filteredTags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={tag._id}
                    checked={((filters.tags as string[]) || []).includes(tag.name)}
                    onCheckedChange={(checked) => handleTagFilter(tag.name, checked)}
                  >
                    <span
                      className="mr-2 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.displayName}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Project Filter */}
      {projects.length > 0 && (
        <DropdownMenu onOpenChange={(open) => { if (!open) setProjectSearchTerm('') }}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FolderKanban className="mr-2 h-4 w-4" />
              Project
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1.5">
              <Input
                placeholder="Search projects..."
                value={projectSearchTerm}
                onChange={(e) => setProjectSearchTerm(e.target.value)}
                className="h-8"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <DropdownMenuSeparator />
            <div className="max-h-48 overflow-y-auto">
              {filteredProjects.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No projects found
                </div>
              ) : (
                filteredProjects.map((project) => (
                  <DropdownMenuCheckboxItem
                    key={project._id}
                    checked={filters.projectId === project._id}
                    onCheckedChange={(checked) => handleProjectFilter(project._id, checked)}
                  >
                    <span
                      className="mr-2 h-3 w-3 rounded"
                      style={{ backgroundColor: project.color || '#3B82F6' }}
                    />
                    {project.displayName}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Workflow Filter */}
      {workflows.length > 0 && (
        <DropdownMenu onOpenChange={(open) => { if (!open) setWorkflowSearchTerm('') }}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <WorkflowIcon className="mr-2 h-4 w-4" />
              Workflow
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <div className="px-2 py-1.5">
              <Input
                placeholder="Search..."
                value={workflowSearchTerm}
                onChange={(e) => setWorkflowSearchTerm(e.target.value)}
                className="h-8"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <DropdownMenuSeparator />
            <div className="max-h-64 overflow-y-auto">
              {/* Quick filters - show if no search or if they match */}
              {(!workflowSearchTerm.trim() || 'part of any workflow'.includes(workflowSearchTerm.toLowerCase())) && (
                <DropdownMenuCheckboxItem
                  checked={filters.hasWorkflow === true}
                  onCheckedChange={(checked) => handleHasWorkflowFilter(checked ? 'yes' : 'all')}
                >
                  Part of any workflow
                </DropdownMenuCheckboxItem>
              )}
              {(!workflowSearchTerm.trim() || 'standalone tasks only'.includes(workflowSearchTerm.toLowerCase())) && (
                <DropdownMenuCheckboxItem
                  checked={filters.hasWorkflow === false}
                  onCheckedChange={(checked) => handleHasWorkflowFilter(checked ? 'no' : 'all')}
                >
                  Standalone tasks only
                </DropdownMenuCheckboxItem>
              )}
              {!workflowSearchTerm.trim() && <DropdownMenuSeparator />}
              {/* Workflows and stages */}
              {filteredWorkflowsWithStages.length === 0 && workflowSearchTerm.trim() && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No workflows or stages found
                </div>
              )}
              {filteredWorkflowsWithStages.map(({ workflow, stages }) => {
                const isWorkflowSelected = ((filters.workflowId as string[]) || []).includes(workflow._id)
                return (
                  <div key={workflow._id}>
                    <DropdownMenuCheckboxItem
                      checked={isWorkflowSelected}
                      onCheckedChange={(checked) => handleWorkflowFilter(workflow._id, checked)}
                      className="font-medium"
                    >
                      {workflow.name}
                    </DropdownMenuCheckboxItem>
                    {/* Show stages nested under selected workflow, or when searching */}
                    {(isWorkflowSelected || workflowSearchTerm.trim()) && stages.length > 0 && (
                      <div className="ml-4 border-l border-muted pl-2">
                        {stages.map((stage) => (
                          <DropdownMenuCheckboxItem
                            key={`${workflow._id}-${stage}`}
                            checked={((filters.workflowStage as string[]) || []).includes(stage)}
                            onCheckedChange={(checked) => handleWorkflowStageFilter(stage, checked)}
                            className="text-sm text-muted-foreground"
                          >
                            {stage}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Save Search */}
      {(onSaveSearch || onUpdateSearch) && hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={openSaveModal}>
          <Bookmark className="mr-2 h-4 w-4" />
          Save
        </Button>
      )}

      {/* Nest Workflows Toggle */}
      {onNestWorkflowsChange && (
        <Button
          variant={nestWorkflowsEnabled ? "default" : "outline"}
          size="sm"
          onClick={() => onNestWorkflowsChange(!nestWorkflowsEnabled)}
          title={nestWorkflowsEnabled ? 'Show workflows as references' : 'Nest workflows inline'}
        >
          <GitBranch className="h-4 w-4" />
        </Button>
      )}

      {/* Expand/Collapse All */}
      {hasAnyChildren && onExpandAllChange && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExpandAllChange(!expandAllEnabled)}
          title={expandAllEnabled ? 'Collapse all' : 'Expand all'}
        >
          {expandAllEnabled ? (
            <ChevronsDownUp className="h-4 w-4" />
          ) : (
            <ChevronsUpDown className="h-4 w-4" />
          )}
        </Button>
      )}

      {/* Column Config */}
      <Button variant="outline" size="sm" onClick={onOpenColumnConfig}>
        <Columns className="h-4 w-4" />
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
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name *</label>
                  <Input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="e.g., Urgent Pending Tasks"
                    autoFocus
                  />
                </div>
                {viewFolders.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Folder (optional)</label>
                    <Select
                      value={selectedFolderId || '__none__'}
                      onValueChange={(value) => setSelectedFolderId(value === '__none__' ? null : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No folder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No folder</SelectItem>
                        {viewFolders.map((folder) => (
                          <SelectItem key={folder._id} value={folder._id}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
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
