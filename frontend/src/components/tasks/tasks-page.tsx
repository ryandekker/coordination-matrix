'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TaskDataTable } from './task-data-table'
import { TaskToolbar } from './task-toolbar'
import { TaskModal } from './task-modal'
import { ColumnConfigModal } from './column-config-modal'
import { useTasks, useLookups, useFieldConfigs, useViews, useUsers, useCreateView, useUpdateView } from '@/hooks/use-tasks'
import { Task, View } from '@/lib/api'

export function TasksPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const viewIdFromUrl = searchParams.get('viewId')

  const [selectedView, setSelectedView] = useState<string | null>(viewIdFromUrl)
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

  // Fetch data
  const { data: tasksData, isLoading: tasksLoading } = useTasks({
    page,
    limit: 50,
    sortBy,
    sortOrder,
    search,
    rootOnly: true,
    resolveReferences: true,
    ...filters,
  })

  const { data: lookupsData } = useLookups()
  const { data: fieldConfigsData } = useFieldConfigs('tasks')
  const { data: viewsData, refetch: refetchViews } = useViews('tasks')
  const { data: usersData } = useUsers()
  const createViewMutation = useCreateView()
  const updateViewMutation = useUpdateView()

  const tasks = tasksData?.data || []
  const pagination = tasksData?.pagination
  const lookups = lookupsData?.data || {}
  const fieldConfigs = fieldConfigsData?.data || []
  const views = viewsData?.data || []
  const users = usersData?.data || []

  // Sync view from URL
  useEffect(() => {
    if (viewIdFromUrl && viewIdFromUrl !== selectedView) {
      setSelectedView(viewIdFromUrl)
      const view = views.find((v: View) => v._id === viewIdFromUrl)
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
        }
      }
    }
  }, [viewIdFromUrl, views, selectedView])

  // Get current view
  const currentView = selectedView
    ? views.find((v: View) => v._id === selectedView)
    : views.find((v: View) => v.isDefault) || views[0]

  // Current sorting for toolbar
  const currentSorting: Array<{ field: string; direction: 'asc' | 'desc' }> = [
    { field: sortBy, direction: sortOrder }
  ]

  // Initialize visible columns from view
  const effectiveVisibleColumns =
    visibleColumns.length > 0
      ? visibleColumns
      : currentView?.visibleColumns || fieldConfigs.filter((fc) => fc.defaultVisible).map((fc) => fc.fieldPath)

  const handleViewChange = (viewId: string) => {
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
  }

  const handleSaveSearch = async (
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
  }

  const handleUpdateSearch = async (
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
  }

  const handleFilterChange = (newFilters: Record<string, unknown>) => {
    setFilters(newFilters)
    setPage(1)
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const handleCreateTask = () => {
    setSelectedTask(null)
    setParentTask(null)
    setIsTaskModalOpen(true)
  }

  const handleEditTask = (task: Task) => {
    setSelectedTask(task)
    setParentTask(null)
    setIsTaskModalOpen(true)
  }

  const handleCreateSubtask = (parent: Task) => {
    setSelectedTask(null)
    setParentTask(parent)
    setIsTaskModalOpen(true)
  }

  const handleColumnConfigSave = (columns: string[]) => {
    setVisibleColumns(columns)
    setIsColumnConfigOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            Manage AI workflow tasks and human-in-the-loop reviews
          </p>
        </div>
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
        onSearchChange={setSearch}
        onCreateTask={handleCreateTask}
        onOpenColumnConfig={() => setIsColumnConfigOpen(true)}
        onSaveSearch={handleSaveSearch}
        onUpdateSearch={handleUpdateSearch}
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
      />

      <TaskModal
        task={selectedTask}
        isOpen={isTaskModalOpen}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        parentTask={parentTask}
        onClose={() => {
          setIsTaskModalOpen(false)
          setParentTask(null)
        }}
      />

      <ColumnConfigModal
        isOpen={isColumnConfigOpen}
        fieldConfigs={fieldConfigs}
        visibleColumns={effectiveVisibleColumns}
        onClose={() => setIsColumnConfigOpen(false)}
        onSave={handleColumnConfigSave}
      />
    </div>
  )
}
