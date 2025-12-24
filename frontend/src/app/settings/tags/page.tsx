'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
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
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface Tag {
  _id: string
  name: string
  displayName: string
  color: string
  description?: string | null
  isActive: boolean
  createdAt: string
  updatedAt?: string | null
}

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

// Tags API
async function fetchTags(search?: string): Promise<{ data: Tag[] }> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  const url = `${API_BASE}/tags${params.toString() ? `?${params.toString()}` : ''}`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch tags')
  return response.json()
}

async function createTag(data: Partial<Tag>): Promise<{ data: Tag }> {
  const response = await authFetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create tag')
  }
  return response.json()
}

async function updateTag(id: string, data: Partial<Tag>): Promise<{ data: Tag }> {
  const response = await authFetch(`${API_BASE}/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update tag')
  }
  return response.json()
}

async function deleteTag(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/tags/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete tag')
}

interface TagFormData {
  name: string
  displayName: string
  color: string
  description: string
}

const defaultTagFormData: TagFormData = {
  name: '',
  displayName: '',
  color: '#6B7280',
  description: '',
}

export default function TagsSettingsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [formData, setFormData] = useState<TagFormData>(defaultTagFormData)
  const [formError, setFormError] = useState<string | null>(null)

  // Query
  const { data: tagsData, isLoading } = useQuery({
    queryKey: ['tags', searchQuery],
    queryFn: () => fetchTags(searchQuery),
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Tag> }) => updateTag(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  const tags = tagsData?.data || []

  const openCreateModal = () => {
    setEditingTag(null)
    setFormData(defaultTagFormData)
    setFormError(null)
    setIsModalOpen(true)
  }

  const openEditModal = (tag: Tag) => {
    setEditingTag(tag)
    setFormData({
      name: tag.name,
      displayName: tag.displayName,
      color: tag.color,
      description: tag.description || '',
    })
    setFormError(null)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTag(null)
    setFormData(defaultTagFormData)
    setFormError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const data = {
      name: formData.name,
      displayName: formData.displayName || formData.name,
      color: formData.color,
      description: formData.description || null,
    }

    if (editingTag) {
      updateMutation.mutate({ id: editingTag._id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (tag: Tag) => {
    if (confirm(`Are you sure you want to delete the "${tag.displayName}" tag?`)) {
      deleteMutation.mutate(tag._id)
    }
  }

  // Auto-generate display name from name if empty
  const handleNameChange = (name: string) => {
    const newFormData = { ...formData, name }
    // Auto-generate display name if it's empty or matches the old auto-generated value
    if (!formData.displayName || formData.displayName === formData.name) {
      newFormData.displayName = name
    }
    setFormData(newFormData)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tag Management</h1>
          <p className="text-muted-foreground">
            Create and manage tags for task categorization. Tags are available to all users, daemons, and agents.
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Create Tag
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tags..."
          className="pl-10"
        />
      </div>

      {/* Tags Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : tags.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {searchQuery ? (
            <p>No tags found matching &quot;{searchQuery}&quot;</p>
          ) : (
            <div className="space-y-2">
              <p>No tags have been created yet.</p>
              <Button onClick={openCreateModal} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Create your first tag
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <div
              key={tag._id}
              className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div
                className="w-10 h-10 rounded-lg flex-shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge style={{ backgroundColor: tag.color, color: '#fff' }}>
                    {tag.displayName}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono mb-1">{tag.name}</p>
                {tag.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{tag.description}</p>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEditModal(tag)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() => handleDelete(tag)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tag Modal */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTag ? 'Edit Tag' : 'Create Tag'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., bug-fix"
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
                placeholder="e.g., Bug Fix"
              />
              <p className="text-xs text-muted-foreground">
                Human-readable name shown in the UI. Defaults to the name if not provided.
              </p>
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
                  placeholder="#6B7280"
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
                placeholder="Optional description of what this tag is used for..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Preview</label>
              <div className="p-4 bg-muted rounded-lg">
                <Badge style={{ backgroundColor: formData.color, color: '#fff' }}>
                  {formData.displayName || formData.name || 'Preview'}
                </Badge>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingTag
                  ? 'Update Tag'
                  : 'Create Tag'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
