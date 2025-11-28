'use client'

import { useState } from 'react'
import { TaskDataTable } from './task-data-table'
import { TaskToolbar } from './task-toolbar'
import { TaskModal } from './task-modal'
import { ColumnConfigModal } from './column-config-modal'
import { useTasks, useLookups, useFieldConfigs, useViews } from '@/hooks/use-tasks'
import { Task, View } from '@/lib/api'

export function TasksPage() {
  const [selectedView, setSelectedView] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<string, unknown>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
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
  const { data: viewsData } = useViews('tasks')

  const tasks = tasksData?.data || []
  const pagination = tasksData?.pagination
  const lookups = lookupsData?.data || {}
  const fieldConfigs = fieldConfigsData?.data || []
  const views = viewsData?.data || []

  // Get current view
  const currentView = selectedView
    ? views.find((v: View) => v._id === selectedView)
    : views.find((v: View) => v.isDefault) || views[0]

  // Initialize visible columns from view
  const effectiveVisibleColumns =
    visibleColumns.length > 0
      ? visibleColumns
      : currentView?.visibleColumns || fieldConfigs.filter((fc) => fc.defaultVisible).map((fc) => fc.fieldPath)

  const handleViewChange = (viewId: string) => {
    setSelectedView(viewId)
    const view = views.find((v: View) => v._id === viewId)
    if (view) {
      setFilters(view.filters || {})
      if (view.sorting && view.sorting.length > 0) {
        setSortBy(view.sorting[0].field)
        setSortOrder(view.sorting[0].direction)
      }
      setVisibleColumns(view.visibleColumns || [])
    }
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
    setIsTaskModalOpen(true)
  }

  const handleEditTask = (task: Task) => {
    setSelectedTask(task)
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
        filters={filters}
        search={search}
        onViewChange={handleViewChange}
        onFilterChange={handleFilterChange}
        onSearchChange={setSearch}
        onCreateTask={handleCreateTask}
        onOpenColumnConfig={() => setIsColumnConfigOpen(true)}
      />

      <TaskDataTable
        tasks={tasks}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        visibleColumns={effectiveVisibleColumns}
        sortBy={sortBy}
        sortOrder={sortOrder}
        isLoading={tasksLoading}
        pagination={pagination}
        onSort={handleSort}
        onEditTask={handleEditTask}
        onPageChange={setPage}
      />

      <TaskModal
        task={selectedTask}
        isOpen={isTaskModalOpen}
        fieldConfigs={fieldConfigs}
        lookups={lookups}
        onClose={() => setIsTaskModalOpen(false)}
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
