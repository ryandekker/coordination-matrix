'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, MessageSquareWarning, Activity, RefreshCw, Plus, FolderKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { useFieldConfigs, useLookups } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-groups'
import { Task } from '@/lib/api'

export function DashboardPage() {
  const { currentGroupId, currentProjectId } = useGroupContext()

  // Project filter - defaults to global context project, or 'all'
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(currentProjectId)

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

  // Data for TaskModal
  const { data: fieldConfigsData } = useFieldConfigs('tasks')
  const { data: lookupsData } = useLookups()
  const fieldConfigs = fieldConfigsData?.data || []
  const lookups = lookupsData?.data || {}

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-kanban', currentGroupId, selectedProjectId],
    queryFn: () => fetchKanbanData(
      currentGroupId || undefined,
      selectedProjectId || undefined,
    ),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })

  const handleTaskClick = useCallback((taskId: string) => {
    // Find the task in the kanban data to pass to the modal
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
    // Fallback: open modal with just the ID (TaskModal fetches fresh data internally)
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
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Tasks needing your attention</p>
          </div>

          {/* Project Filter */}
          {projects.length > 0 && (
            <Select
              value={selectedProjectId || '__all__'}
              onValueChange={(val) => setSelectedProjectId(val === '__all__' ? null : val)}
            >
              <SelectTrigger className="w-[200px] h-9">
                <FolderKanban className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project._id} value={project._id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded shrink-0"
                        style={{ backgroundColor: project.color || '#3B82F6' }}
                      />
                      {project.displayName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleCreateTask}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {data?.stats && (
        <div className="flex gap-4">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Needs Attention</p>
              <p className="text-lg font-semibold">{data.stats.totalNeedingAttention}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2">
            <MessageSquareWarning className="h-4 w-4 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">Questions Waiting</p>
              <p className="text-lg font-semibold">{data.stats.questionsWaiting}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2">
            <Activity className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Escalated</p>
              <p className="text-lg font-semibold">{data.stats.escalatedCount}</p>
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
