'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  FolderKanban,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { authFetch, Group, Project, ProjectStatus } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

const defaultColors = [
  '#6B7280', // Gray
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#F97316', // Orange
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#14B8A6', // Teal
  '#A855F7', // Violet
]

const statusOptions: { value: ProjectStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: '#10B981' },
  { value: 'archived', label: 'Archived', color: '#9CA3AF' },
]

// Projects API
async function fetchProjects(groupId?: string): Promise<{ data: Project[] }> {
  const params = new URLSearchParams()
  if (groupId) params.set('groupId', groupId)
  const url = `${API_BASE}/projects${params.toString() ? `?${params.toString()}` : ''}`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch projects')
  return response.json()
}

async function createProject(data: Partial<Project>): Promise<{ data: Project }> {
  const response = await authFetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create project')
  }
  return response.json()
}

async function updateProject(id: string, data: Partial<Project>): Promise<{ data: Project }> {
  const response = await authFetch(`${API_BASE}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update project')
  }
  return response.json()
}

async function deleteProject(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/projects/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete project')
}

async function fetchGroups(): Promise<{ data: Group[] }> {
  const response = await authFetch(`${API_BASE}/groups`)
  if (!response.ok) throw new Error('Failed to fetch groups')
  return response.json()
}

interface ProjectFormData {
  name: string
  displayName: string
  description: string
  groupId: string
  status: ProjectStatus
  color: string
}

const defaultProjectFormData: ProjectFormData = {
  name: '',
  displayName: '',
  description: '',
  groupId: '',
  status: 'active',
  color: '#3B82F6',
}

export default function ProjectsSettingsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGroupId, setFilterGroupId] = useState<string>('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [formData, setFormData] = useState<ProjectFormData>(defaultProjectFormData)
  const [formError, setFormError] = useState<string | null>(null)

  // Queries
  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['projects', filterGroupId],
    queryFn: () => fetchProjects(filterGroupId || undefined),
  })

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Project> }) => updateProject(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const projects = (projectsData?.data || []).filter((p) =>
    searchQuery
      ? p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  )

  const groups = groupsData?.data || []

  const openCreateModal = () => {
    setEditingProject(null)
    setFormData({
      ...defaultProjectFormData,
      groupId: filterGroupId || (groups[0]?._id || ''),
    })
    setFormError(null)
    setIsModalOpen(true)
  }

  const openEditModal = (project: Project) => {
    setEditingProject(project)
    setFormData({
      name: project.name,
      displayName: project.displayName,
      description: project.description || '',
      groupId: project.groupId,
      status: project.status,
      color: project.color || '#3B82F6',
    })
    setFormError(null)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingProject(null)
    setFormData(defaultProjectFormData)
    setFormError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!formData.groupId) {
      setFormError('Please select a group')
      return
    }

    const data = {
      name: formData.name,
      displayName: formData.displayName || formData.name,
      description: formData.description || undefined,
      groupId: formData.groupId,
      status: formData.status,
      color: formData.color,
    }

    if (editingProject) {
      updateMutation.mutate({ id: editingProject._id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (project: Project) => {
    if (confirm(`Are you sure you want to delete the "${project.displayName}" project? This may affect tasks associated with this project.`)) {
      deleteMutation.mutate(project._id)
    }
  }

  // Auto-generate display name from name if empty
  const handleNameChange = (name: string) => {
    const newFormData = { ...formData, name }
    if (!formData.displayName || formData.displayName === formData.name) {
      newFormData.displayName = name
    }
    setFormData(newFormData)
  }

  const getGroupName = (groupId: string) => {
    const group = groups.find((g) => g._id === groupId)
    return group?.displayName || 'Unknown Group'
  }

  const getStatusOption = (status: ProjectStatus) => {
    return statusOptions.find((s) => s.value === status) || statusOptions[0]
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Project Management</h1>
          <p className="text-muted-foreground">
            Create and manage projects to organize tasks within groups.
          </p>
        </div>
        <Button onClick={openCreateModal} disabled={groups.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Create Project
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <FolderKanban className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No groups available</p>
          <p className="text-sm">You need to create a group before you can create projects.</p>
          <Button variant="outline" className="mt-4" asChild>
            <a href="/settings/groups">Go to Groups</a>
          </Button>
        </div>
      ) : (
        <>
          {/* Search and Filter */}
          <div className="flex gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="pl-10"
              />
            </div>
            <Select value={filterGroupId || 'all'} onValueChange={(value) => setFilterGroupId(value === 'all' ? '' : value)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group._id} value={group._id}>
                    {group.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Projects Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || filterGroupId ? (
                <p>No projects found matching your criteria.</p>
              ) : (
                <div className="space-y-2">
                  <p>No projects have been created yet.</p>
                  <Button onClick={openCreateModal} variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Create your first project
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => {
                const statusOption = getStatusOption(project.status)
                return (
                  <div
                    key={project._id}
                    className="flex flex-col rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: project.color || '#3B82F6' }}
                      >
                        <FolderKanban className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium truncate">{project.displayName}</span>
                          <Badge
                            variant="outline"
                            style={{ borderColor: statusOption.color, color: statusOption.color }}
                          >
                            {statusOption.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mb-1">{project.name}</p>
                        {project.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>{getGroupName(project.groupId)}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEditModal(project)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => handleDelete(project)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Project Modal (Create/Edit) */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProject ? 'Edit Project' : 'Create Project'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Group *</label>
              <Select
                value={formData.groupId}
                onValueChange={(value) => setFormData({ ...formData, groupId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group._id} value={group._id}>
                      {group.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The group this project belongs to.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., api-v2"
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase identifier used in the API. Spaces will be converted to hyphens.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="e.g., API v2"
              />
              <p className="text-xs text-muted-foreground">
                Human-readable name shown in the UI. Defaults to the name if not provided.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value as ProjectStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: option.color }}
                        />
                        {option.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
                <Input
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  placeholder="#3B82F6"
                  className="flex-1"
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {defaultColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'w-6 h-6 rounded border-2 transition-all',
                      formData.color === color ? 'border-primary scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description of this project..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Preview</label>
              <div className="p-4 bg-muted rounded-lg flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: formData.color }}
                >
                  <FolderKanban className="h-5 w-5 text-white" />
                </div>
                <span className="font-medium">
                  {formData.displayName || formData.name || 'Project Name'}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingProject
                  ? 'Update Project'
                  : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
