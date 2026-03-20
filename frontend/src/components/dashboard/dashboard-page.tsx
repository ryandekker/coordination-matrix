'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, MessageSquareWarning, Activity, RefreshCw, Plus, FolderKanban, Workflow, Tags, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KanbanBoard } from './kanban-board'
import { TaskModal } from '@/components/tasks/task-modal'
import { fetchKanbanData } from '@/lib/dashboard-api'
import { useGroupContext } from '@/lib/group-context'
import { useEventStream } from '@/hooks/use-event-stream'
import { useFieldConfigs, useLookups, useWorkflows, useUsers, useTags } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-groups'
import { Task, isSystemUser } from '@/lib/api'
import { UserChip } from '@/components/ui/user-chip'

const STORAGE_KEY_PREFIX = 'dashboard_filter_'

function loadFilter(key: string): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY_PREFIX + key) || null
}

function saveFilter(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  if (value) {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, value)
  } else {
    localStorage.removeItem(STORAGE_KEY_PREFIX + key)
  }
}

function loadArrayFilter(key: string): string[] {
  if (typeof window === 'undefined') return []
  const val = localStorage.getItem(STORAGE_KEY_PREFIX + key)
  if (!val) return []
  try {
    return JSON.parse(val)
  } catch {
    return []
  }
}

function saveArrayFilter(key: string, value: string[]) {
  if (typeof window === 'undefined') return
  if (value.length > 0) {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(value))
  } else {
    localStorage.removeItem(STORAGE_KEY_PREFIX + key)
  }
}

export function DashboardPage() {
  const { currentGroupId, currentProjectId } = useGroupContext()

  // Persistent filters - load from localStorage
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => loadFilter('projectId') ?? currentProjectId
  )
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    () => loadFilter('workflowId')
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(
    () => loadArrayFilter('tags')
  )
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(
    () => loadFilter('assigneeId')
  )

  // Task modal state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)

  // Enable SSE for real-time updates
  useEventStream()

  // Fetch projects for the current group
  const { data: projectsData } = useProjects(
    currentGroupId ? { groupId: currentGroupId } : undefined
  )
  const projects = projectsData?.data?.filter(p => p.status === 'active') || []

  // Fetch workflows, users, tags for filters
  const { data: workflowsData } = useWorkflows()
  const { data: usersData } = useUsers()
  const { data: tagsData } = useTags()
  const workflows = workflowsData?.data || []
  const users = usersData?.data || []
  const availableTags = tagsData?.data || []
  const assignableUsers = useMemo(
    () => users.filter(u => u._id && u.isActive && !isSystemUser(u)),
    [users]
  )

  // Data for TaskModal
  const { data: fieldConfigsData } = useFieldConfigs('tasks')
  const { data: lookupsData } = useLookups()
  const fieldConfigs = fieldConfigsData?.data || []
  const lookups = lookupsData?.data || {}

  // Build extra filters for the query
  const extraFilters = useMemo(() => ({
    workflowId: selectedWorkflowId || undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    assigneeId: selectedAssigneeId || undefined,
  }), [selectedWorkflowId, selectedTags, selectedAssigneeId])

  const hasActiveFilters = !!selectedWorkflowId || selectedTags.length > 0 || !!selectedAssigneeId

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-kanban', currentGroupId, selectedProjectId, extraFilters],
    queryFn: () => fetchKanbanData(
      currentGroupId || undefined,
      selectedProjectId || undefined,
      extraFilters,
    ),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })

  // Filter setters with persistence
  const handleProjectChange = useCallback((val: string) => {
    const value = val === '__all__' ? null : val
    setSelectedProjectId(value)
    saveFilter('projectId', value)
  }, [])

  const handleWorkflowChange = useCallback((val: string) => {
    const value = val === '__all__' ? null : val
    setSelectedWorkflowId(value)
    saveFilter('workflowId', value)
  }, [])

  const handleAssigneeChange = useCallback((val: string) => {
    const value = val === '__all__' ? null : val
    setSelectedAssigneeId(value)
    saveFilter('assigneeId', value)
  }, [])

  const handleTagToggle = useCallback((tag: string) => {
    setSelectedTags(prev => {
      const next = prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
      saveArrayFilter('tags', next)
      return next
    })
  }, [])

  const handleClearFilters = useCallback(() => {
    setSelectedWorkflowId(null)
    setSelectedTags([])
    setSelectedAssigneeId(null)
    saveFilter('workflowId', null)
    saveArrayFilter('tags', [])
    saveFilter('assigneeId', null)
  }, [])

  const handleTaskClick = useCallback((taskId: string) => {
    if (data?.columns) {
      for (const column of Object.values(data.columns)) {
        const task = column.tasks.find(t => t._id === taskId)
        if (task) {
          setSelectedTask(task as unknown as Task)
          setIsTaskModalOpen(true)
          return
        }
      }
    }
    setSelectedTask({ _id: taskId } as Task)
    setIsTaskModalOpen(true)
  }, [data])

  const handleCreateTask = useCallback(() => {
    setSelectedTask(null)
    setIsTaskModalOpen(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    setIsTaskModalOpen(false)
    setSelectedTask(null)
    refetch()
  }, [refetch])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Failed to load dashboard</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground hidden sm:block">Tasks needing your attention</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1 sm:flex-none" onClick={handleCreateTask}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Project Filter */}
        {projects.length > 0 && (
          <Select
            value={selectedProjectId || '__all__'}
            onValueChange={handleProjectChange}
          >
            <SelectTrigger className="w-auto h-8 text-xs gap-1.5">
              <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project._id} value={project._id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project.color || '#3B82F6' }}
                    />
                    {project.displayName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Workflow Filter */}
        {workflows.length > 0 && (
          <Select
            value={selectedWorkflowId || '__all__'}
            onValueChange={handleWorkflowChange}
          >
            <SelectTrigger className="w-auto h-8 text-xs gap-1.5">
              <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="All Workflows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Workflows</SelectItem>
              {workflows.map((wf) => (
                <SelectItem key={wf._id} value={wf._id}>
                  <span className="flex items-center gap-2">
                    {wf.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: wf.color }}
                      />
                    )}
                    {wf.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Assignee Filter */}
        {assignableUsers.length > 0 && (
          <Select
            value={selectedAssigneeId || '__all__'}
            onValueChange={handleAssigneeChange}
          >
            <SelectTrigger className="w-auto h-8 text-xs gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="All Assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Assignees</SelectItem>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {assignableUsers.map((user) => (
                <SelectItem key={user._id} value={user._id}>
                  <UserChip user={user} size="sm" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Tag Filter */}
        {availableTags.length > 0 && (
          <Select
            value="__placeholder__"
            onValueChange={handleTagToggle}
          >
            <SelectTrigger className="w-auto h-8 text-xs gap-1.5">
              <Tags className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {selectedTags.length > 0
                  ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}`
                  : 'Tags'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {availableTags.map((tag) => (
                <SelectItem key={tag._id} value={tag.name}>
                  <span className="flex items-center gap-2">
                    {selectedTags.includes(tag.name) && (
                      <span className="text-primary font-bold">&#10003;</span>
                    )}
                    {tag.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    {tag.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={handleClearFilters}
          >
            <X className="mr-1 h-3 w-3" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Active filter tags */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedWorkflowId && (() => {
            const wf = workflows.find(w => w._id === selectedWorkflowId)
            return wf ? (
              <Badge
                variant="secondary"
                className="h-6 gap-1 text-xs cursor-pointer"
                onClick={() => { setSelectedWorkflowId(null); saveFilter('workflowId', null) }}
              >
                <Workflow className="h-3 w-3" />
                {wf.name}
                <X className="h-3 w-3" />
              </Badge>
            ) : null
          })()}
          {selectedAssigneeId && (() => {
            if (selectedAssigneeId === '__unassigned__') {
              return (
                <Badge
                  variant="secondary"
                  className="h-6 gap-1 text-xs cursor-pointer"
                  onClick={() => { setSelectedAssigneeId(null); saveFilter('assigneeId', null) }}
                >
                  <User className="h-3 w-3" />
                  Unassigned
                  <X className="h-3 w-3" />
                </Badge>
              )
            }
            const assignee = users.find(u => u._id === selectedAssigneeId)
            return assignee ? (
              <Badge
                variant="secondary"
                className="h-6 gap-1 text-xs cursor-pointer"
                onClick={() => { setSelectedAssigneeId(null); saveFilter('assigneeId', null) }}
              >
                {assignee.displayName}
                <X className="h-3 w-3" />
              </Badge>
            ) : null
          })()}
          {selectedTags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="h-6 gap-1 text-xs cursor-pointer"
              onClick={() => handleTagToggle(tag)}
            >
              <Tags className="h-3 w-3" />
              {tag}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}

      {/* Stats Bar */}
      {data?.stats && (
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 md:px-4 md:py-2">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">Needs Attention</p>
              <p className="text-base md:text-lg font-semibold">{data.stats.totalNeedingAttention}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 md:px-4 md:py-2">
            <MessageSquareWarning className="h-4 w-4 text-purple-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">Questions</p>
              <p className="text-base md:text-lg font-semibold">{data.stats.questionsWaiting}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 md:px-4 md:py-2">
            <Activity className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">Escalated</p>
              <p className="text-base md:text-lg font-semibold">{data.stats.escalatedCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {isLoading && !data ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data?.columns ? (
        <KanbanBoard columns={data.columns} onTaskClick={handleTaskClick} />
      ) : null}

      {/* Task Modal */}
      <TaskModal
        task={selectedTask}
        isOpen={isTaskModalOpen}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        onClose={handleCloseModal}
      />
    </div>
  )
}
