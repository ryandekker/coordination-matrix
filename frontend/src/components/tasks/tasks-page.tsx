'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, ChevronLeft, Workflow } from 'lucide-react'
import { TaskDataTable } from './task-data-table'
import { TaskToolbar } from './task-toolbar'
import { TaskModal } from './task-modal'
import { ColumnConfigModal } from './column-config-modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTasks, useTask, useLookups, useFieldConfigs, useViews, useUsers, useCreateView, useUpdateView } from '@/hooks/use-tasks'
import { useEventStream } from '@/hooks/use-event-stream'
import { Task, View, FieldConfig } from '@/lib/api'

// Fallback field configs when API returns empty or fails - ensures basic functionality
const FALLBACK_FIELD_CONFIGS: FieldConfig[] = [
  {
    _id: 'fallback-title',
    collectionName: 'tasks',
    fieldPath: 'title',
    displayName: 'Title',
    fieldType: 'text',
    isRequired: true,
    isEditable: true,
    isSearchable: true,
    isSortable: true,
    isFilterable: false,
    displayOrder: 1,
    width: 300,
    minWidth: 150,
    defaultVisible: true,
    renderAs: 'text',
  },
  {
    _id: 'fallback-status',
    collectionName: 'tasks',
    fieldPath: 'status',
    displayName: 'Status',
    fieldType: 'lookup',
    lookupType: 'status',
    isRequired: true,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 2,
    width: 120,
    minWidth: 80,
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    _id: 'fallback-urgency',
    collectionName: 'tasks',
    fieldPath: 'urgency',
    displayName: 'Urgency',
    fieldType: 'lookup',
    lookupType: 'urgency',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 3,
    width: 100,
    minWidth: 80,
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    _id: 'fallback-createdAt',
    collectionName: 'tasks',
    fieldPath: 'createdAt',
    displayName: 'Created',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: false,
    displayOrder: 4,
    width: 150,
    minWidth: 100,
    defaultVisible: true,
    renderAs: 'text',
  },
]

export function TasksPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const viewIdFromUrl = searchParams.get('viewId')
  const taskIdFromUrl = searchParams.get('taskId')
  const parentIdFromUrl = searchParams.get('parentId')  // For viewing a flow's children

  const [selectedView, setSelectedView] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<string, unknown>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [parentTask, setParentTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [expandAllEnabled, setExpandAllEnabled] = useState(false)

  // Fetch task from URL if taskId is provided
  const { data: taskFromUrl } = useTask(taskIdFromUrl)

  // Fetch the flow parent task when viewing its children
  const { data: flowParentTask } = useTask(parentIdFromUrl)

  // Fetch data - use parentId filter when viewing a flow, otherwise use rootOnly
  const { data: tasksData, isLoading: tasksLoading } = useTasks({
    page,
    limit: 50,
    sortBy,
    sortOrder,
    search,
    ...(parentIdFromUrl ? { parentId: parentIdFromUrl } : { rootOnly: true }),
    resolveReferences: true,
    ...filters,
  })

  const { data: lookupsData } = useLookups()
  const { data: fieldConfigsData } = useFieldConfigs('tasks')
  const { data: viewsData, refetch: refetchViews } = useViews('tasks')
  const { data: usersData } = useUsers()
  const createViewMutation = useCreateView()
  const updateViewMutation = useUpdateView()

  // Enable real-time updates via SSE - the hook handles cache updates automatically
  useEventStream()

  const rawTasks = tasksData?.data || []
  // When viewing a flow's children, show just the parent with its children attached
  const tasks = useMemo(() => {
    if (parentIdFromUrl && flowParentTask?.data) {
      // Return parent with children attached - they'll expand inline
      const parentWithChildren: Task = {
        ...flowParentTask.data,
        children: rawTasks,
      }
      return [parentWithChildren]
    }
    return rawTasks
  }, [parentIdFromUrl, flowParentTask?.data, rawTasks])
  const pagination = tasksData?.pagination
  const lookups = lookupsData?.data || {}
  // Use API field configs if available, otherwise fall back to defaults
  const fieldConfigs = (fieldConfigsData?.data && fieldConfigsData.data.length > 0)
    ? fieldConfigsData.data
    : FALLBACK_FIELD_CONFIGS
  const views = viewsData?.data || []
  const users = usersData?.data || []

  // Check if any tasks have children (for expand all button)
  const hasAnyChildren = useMemo(() => {
    return tasks.some(t => t.children && t.children.length > 0)
  }, [tasks])

  // Threshold for large lists where expand all defaults to off
  const LARGE_LIST_THRESHOLD = 50
  const isLargeList = (pagination?.total ?? tasks.length) > LARGE_LIST_THRESHOLD

  // Load expand all preference from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedPref = localStorage.getItem('taskList.expandAllPreference')
    if (savedPref !== null && !isLargeList) {
      setExpandAllEnabled(savedPref === 'true')
    }
  }, [isLargeList])

  const handleExpandAllChange = useCallback((enabled: boolean) => {
    setExpandAllEnabled(enabled)
    localStorage.setItem('taskList.expandAllPreference', String(enabled))
  }, [])

  // Sync view from URL - only apply view settings once the view is loaded
  useEffect(() => {
    if (viewIdFromUrl) {
      const view = views.find((v: View) => v._id === viewIdFromUrl)
      if (view && selectedView !== viewIdFromUrl) {
        // View found and not yet applied - apply its settings
        setSelectedView(viewIdFromUrl)
        setFilters(view.filters || {})
        if (view.sorting && view.sorting.length > 0) {
          setSortBy(view.sorting[0].field)
          setSortOrder(view.sorting[0].direction)
        }
        setVisibleColumns(view.visibleColumns || [])
        // Extract search from filters if present
        if (view.filters?.search) {
          setSearch(view.filters.search as string)
        } else {
          setSearch('')
        }
      }
    } else if (!viewIdFromUrl && selectedView) {
      // Clear view selection and reset to defaults when navigating to /tasks without viewId
      setSelectedView(null)
      setFilters({})
      setSearch('')
      setSortBy('createdAt')
      setSortOrder('desc')
      setVisibleColumns([])
    }
  }, [viewIdFromUrl, views, selectedView])

  // Open modal when taskId is in URL and task data is loaded
  useEffect(() => {
    if (taskIdFromUrl && taskFromUrl?.data) {
      setSelectedTask(taskFromUrl.data)
      setParentTask(null)
      setIsTaskModalOpen(true)
    }
  }, [taskIdFromUrl, taskFromUrl])

  // Memoized current view
  const currentView = useMemo(() => {
    return selectedView
      ? views.find((v: View) => v._id === selectedView)
      : views.find((v: View) => v.isDefault) || views[0]
  }, [selectedView, views])

  // Memoized current sorting for toolbar
  const currentSorting = useMemo<Array<{ field: string; direction: 'asc' | 'desc' }>>(
    () => [{ field: sortBy, direction: sortOrder }],
    [sortBy, sortOrder]
  )

  // Memoized effective visible columns
  const effectiveVisibleColumns = useMemo(() => {
    return visibleColumns.length > 0
      ? visibleColumns
      : currentView?.visibleColumns || fieldConfigs.filter((fc) => fc.defaultVisible).map((fc) => fc.fieldPath)
  }, [visibleColumns, currentView?.visibleColumns, fieldConfigs])

  const handleViewChange = useCallback((viewId: string) => {
    setSelectedView(viewId)
    // Update URL with viewId
    router.push(`/tasks?viewId=${viewId}`)
    const view = views.find((v: View) => v._id === viewId)
    if (view) {
      setFilters(view.filters || {})
      if (view.sorting && view.sorting.length > 0) {
        setSortBy(view.sorting[0].field)
        setSortOrder(view.sorting[0].direction)
      }
      setVisibleColumns(view.visibleColumns || [])
      // Extract search from filters if present
      if (view.filters?.search) {
        setSearch(view.filters.search as string)
      } else {
        setSearch('')
      }
    }
  }, [views, router])

  const handleSaveSearch = useCallback(async (
    name: string,
    filtersToSave: Record<string, unknown>,
    sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>
  ) => {
    const newView = await createViewMutation.mutateAsync({
      name,
      collectionName: 'tasks',
      filters: filtersToSave,
      sorting: sorting || currentSorting,
      visibleColumns: effectiveVisibleColumns,
    })

    // Refetch views to update sidebar
    await refetchViews()

    // Navigate to the new view
    if (newView?.data?._id) {
      router.push(`/tasks?viewId=${newView.data._id}`)
    }
  }, [createViewMutation, currentSorting, effectiveVisibleColumns, refetchViews, router])

  const handleUpdateSearch = useCallback(async (
    viewId: string,
    filtersToSave: Record<string, unknown>,
    sorting?: Array<{ field: string; direction: 'asc' | 'desc' }>
  ) => {
    await updateViewMutation.mutateAsync({
      id: viewId,
      data: {
        filters: filtersToSave,
        sorting: sorting || currentSorting,
        visibleColumns: effectiveVisibleColumns,
      },
    })

    // Refetch views to update sidebar
    await refetchViews()
  }, [updateViewMutation, currentSorting, effectiveVisibleColumns, refetchViews])

  const handleFilterChange = useCallback((newFilters: Record<string, unknown>) => {
    setFilters(newFilters)
    setPage(1)
  }, [])

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }, [sortBy])

  const handleCreateTask = useCallback(() => {
    setSelectedTask(null)
    setParentTask(null)
    setIsTaskModalOpen(true)
  }, [])

  const handleEditTask = useCallback((task: Task) => {
    setSelectedTask(task)
    setParentTask(null)
    setIsTaskModalOpen(true)
    // Update URL with taskId
    const params = new URLSearchParams(searchParams.toString())
    params.set('taskId', task._id)
    router.push(`/tasks?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const handleCreateSubtask = useCallback((parent: Task) => {
    setSelectedTask(null)
    setParentTask(parent)
    setIsTaskModalOpen(true)
  }, [])

  const handleColumnConfigSave = useCallback((columns: string[]) => {
    setVisibleColumns(columns)
    setIsColumnConfigOpen(false)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleOpenColumnConfig = useCallback(() => {
    setIsColumnConfigOpen(true)
  }, [])

  const handleCloseTaskModal = useCallback(() => {
    setIsTaskModalOpen(false)
    setSelectedTask(null)
    setParentTask(null)
    // Remove taskId from URL
    const params = new URLSearchParams(searchParams.toString())
    params.delete('taskId')
    const queryString = params.toString()
    router.push(queryString ? `/tasks?${queryString}` : '/tasks', { scroll: false })
  }, [router, searchParams])

  const handleCloseColumnConfig = useCallback(() => {
    setIsColumnConfigOpen(false)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Flow breadcrumb - shown when viewing a flow's children */}
      {parentIdFromUrl && flowParentTask?.data && (
        <div className="flex items-center gap-2 px-3 py-2 bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg animate-[pulse_0.5s_ease-in-out_2]">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-pink-600 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-900/50"
            onClick={() => router.push('/tasks')}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to all tasks
          </Button>
          <span className="text-muted-foreground">|</span>
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-pink-500" />
            <span className="text-sm font-medium text-pink-800 dark:text-pink-200">
              Flow: {flowParentTask.data.title}
            </span>
            <Badge variant="outline" className="text-xs border-pink-300 text-pink-600">
              {flowParentTask.data.status}
            </Badge>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            {parentIdFromUrl && flowParentTask?.data
              ? `Viewing tasks within flow: ${flowParentTask.data.title}`
              : 'Manage AI workflow tasks and human-in-the-loop reviews'
            }
          </p>
        </div>
        <Button onClick={handleCreateTask}>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      <TaskToolbar
        views={views}
        currentView={currentView}
        lookups={lookups}
        users={users}
        tasks={tasks}
        filters={filters}
        search={search}
        sorting={currentSorting}
        onViewChange={handleViewChange}
        onFilterChange={handleFilterChange}
        onSearchChange={handleSearchChange}
        onOpenColumnConfig={handleOpenColumnConfig}
        onSaveSearch={handleSaveSearch}
        onUpdateSearch={handleUpdateSearch}
        hasAnyChildren={hasAnyChildren}
        expandAllEnabled={expandAllEnabled}
        onExpandAllChange={handleExpandAllChange}
      />

      <TaskDataTable
        tasks={tasks}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        users={users}
        visibleColumns={effectiveVisibleColumns}
        sortBy={sortBy}
        sortOrder={sortOrder}
        isLoading={tasksLoading}
        pagination={pagination}
        onSort={handleSort}
        onEditTask={handleEditTask}
        onCreateSubtask={handleCreateSubtask}
        onPageChange={setPage}
        expandAllEnabled={expandAllEnabled}
        onExpandAllChange={handleExpandAllChange}
        autoExpandIds={parentIdFromUrl ? [parentIdFromUrl] : undefined}
      />

      <TaskModal
        task={selectedTask}
        isOpen={isTaskModalOpen}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        parentTask={parentTask}
        onClose={handleCloseTaskModal}
      />

      <ColumnConfigModal
        isOpen={isColumnConfigOpen}
        fieldConfigs={fieldConfigs}
        visibleColumns={effectiveVisibleColumns}
        onClose={handleCloseColumnConfig}
        onSave={handleColumnConfigSave}
      />
    </div>
  )
}
