'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban, ListTodo, Clock, CheckCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useGroupContext } from '@/lib/group-context'
import { projectsApi, Project } from '@/lib/api'
import Link from 'next/link'

export default function ProjectsPage() {
  const router = useRouter()
  const { currentGroup, currentGroupId, isLoadingGroups } = useGroupContext()

  // Fetch projects for current group
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects', currentGroupId],
    queryFn: () => projectsApi.list({ groupId: currentGroupId! }),
    enabled: !!currentGroupId,
  })

  // Fetch project stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ['project-stats', currentGroupId],
    queryFn: () => projectsApi.getStats(currentGroupId!),
    enabled: !!currentGroupId,
  })

  const projects = projectsData?.data || []
  const stats = statsData?.data || {}

  const isLoading = isLoadingGroups || isLoadingProjects || isLoadingStats

  // Navigate to tasks page with project filter
  const handleProjectClick = (projectId: string) => {
    router.push(`/tasks?projectId=${projectId}`)
  }

  if (!currentGroup && !isLoadingGroups) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Group Selected</h2>
        <p className="text-muted-foreground">
          Select a group from the user menu to view projects.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Projects in {currentGroup?.displayName || 'your group'}
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/projects">
            <Plus className="mr-2 h-4 w-4" />
            Manage Projects
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
          <FolderKanban className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h2 className="text-lg font-medium mb-2">No Projects</h2>
          <p className="text-muted-foreground mb-4">
            Create a project to organize tasks.
          </p>
          <Button asChild variant="outline">
            <Link href="/settings/projects">Create Project</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const projectStats = stats[project._id] || {
              totalTasks: 0,
              pendingTasks: 0,
              inProgressTasks: 0,
              completedTasks: 0,
            }
            const statusOption = project.status === 'archived'
              ? { label: 'Archived', color: '#9CA3AF' }
              : { label: 'Active', color: '#10B981' }

            return (
              <button
                key={project._id}
                onClick={() => handleProjectClick(project._id)}
                className="flex flex-col rounded-lg border p-4 transition-colors hover:bg-muted/50 text-left"
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: project.color || '#3B82F6' }}
                  >
                    <FolderKanban className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold truncate">{project.displayName}</span>
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{ borderColor: statusOption.color, color: statusOption.color }}
                      >
                        {statusOption.label}
                      </Badge>
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {project.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Task Stats */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t">
                  <div className="flex items-center gap-1.5 text-sm">
                    <ListTodo className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{projectStats.totalTasks}</span>
                    <span className="text-muted-foreground text-xs">total</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Clock className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">{projectStats.pendingTasks + projectStats.inProgressTasks}</span>
                    <span className="text-muted-foreground text-xs">active</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{projectStats.completedTasks}</span>
                    <span className="text-muted-foreground text-xs">done</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
