'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, MoreHorizontal, UserCheck, UserX, Bot, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { User, AgentComplexity, usersApi, authFetch } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

async function fetchUsers(): Promise<{ data: User[] }> {
  return usersApi.list()
}

async function createUser(data: Partial<User>): Promise<{ data: User }> {
  return usersApi.create(data)
}

async function updateUser(id: string, data: Partial<User>): Promise<{ data: User }> {
  return usersApi.update(id, data)
}

async function deleteUser(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeader() },
  })
  if (!response.ok) throw new Error('Failed to delete user')
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    role: 'viewer' as string,
    isAgent: false,
    agentPrompt: '',
    agentComplexity: undefined as AgentComplexity | undefined,
    agentTags: [] as string[],
    botColor: '#3B82F6',
  })
  const [tagInput, setTagInput] = useState('')

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const users = usersData?.data || []

  const openCreateModal = () => {
    setEditingUser(null)
    setFormData({ email: '', displayName: '', role: 'viewer', isAgent: false, agentPrompt: '', agentComplexity: undefined, agentTags: [], botColor: '#3B82F6' })
    setTagInput('')
    setIsModalOpen(true)
  }

  const openEditModal = (user: User) => {
    setEditingUser(user)
    setFormData({
      email: user.email || '',
      displayName: user.displayName,
      role: user.role,
      isAgent: user.isAgent || false,
      agentPrompt: user.agentPrompt || '',
      agentComplexity: user.agentComplexity,
      agentTags: user.agentTags || [],
      botColor: user.botColor || '#3B82F6',
    })
    setTagInput('')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingUser(null)
    setFormData({ email: '', displayName: '', role: 'viewer', isAgent: false, agentPrompt: '', agentComplexity: undefined, agentTags: [], botColor: '#3B82F6' })
    setTagInput('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const submitData: Partial<User> = {
      ...formData,
      agentComplexity: formData.isAgent ? formData.agentComplexity : undefined,
      agentTags: formData.isAgent && formData.agentTags.length > 0 ? formData.agentTags : undefined,
    }
    if (editingUser) {
      updateMutation.mutate({ id: editingUser._id, data: submitData })
    } else {
      createMutation.mutate(submitData)
    }
  }

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed && !formData.agentTags.includes(trimmed)) {
      setFormData({ ...formData, agentTags: [...formData.agentTags, trimmed] })
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setFormData({ ...formData, agentTags: formData.agentTags.filter(t => t !== tag) })
  }

  const handleDelete = (user: User) => {
    if (confirm(`Are you sure you want to deactivate ${user.displayName}?`)) {
      deleteMutation.mutate(user._id)
    }
  }

  const roleColors: Record<string, string> = {
    admin: '#EF4444',
    operator: '#3B82F6',
    reviewer: '#8B5CF6',
    viewer: '#6B7280',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground hidden sm:block">Manage system users and their roles</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user._id}>
                  <TableCell className="font-medium">{user.displayName}</TableCell>
                  <TableCell>
                    {user.isAgent ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: user.botColor || '#3B82F6' }}
                        />
                        <Badge variant="outline" className="text-blue-600 border-blue-600">
                          <Bot className="mr-1 h-3 w-3" />
                          Agent
                        </Badge>
                        {user.agentComplexity && (
                          <Badge variant="secondary" className="text-[10px]">
                            L{user.agentComplexity}
                          </Badge>
                        )}
                        {user.agentTags?.map(tag => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-gray-500 border-gray-500">
                        Human
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell>
                    <Badge color={roleColors[user.role]} variant="outline">
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        <UserCheck className="mr-1 h-3 w-3" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500 border-gray-500">
                        <UserX className="mr-1 h-3 w-3" />
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(user.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditModal(user)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(user)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Deactivate
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Create New User'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="isAgent"
                checked={formData.isAgent}
                onCheckedChange={(checked) => setFormData({ ...formData, isAgent: !!checked })}
              />
              <label htmlFor="isAgent" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-500" />
                This is an AI Agent
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name *</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="Enter display name"
                required
              />
            </div>
            {!formData.isAgent && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Email *</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter email"
                  required
                  disabled={!!editingUser}
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select
                value={formData.role}
                onValueChange={(val) => setFormData({ ...formData, role: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.isAgent && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Agent Prompt</label>
                  <Textarea
                    value={formData.agentPrompt}
                    onChange={(e) => setFormData({ ...formData, agentPrompt: e.target.value })}
                    placeholder="Enter the agent's base prompt/persona (optional). This will be prepended to task instructions."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Define the agent&apos;s personality, capabilities, and constraints. Leave empty to use default daemon behavior.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Complexity Level</label>
                  <Select
                    value={formData.agentComplexity?.toString() || '_none'}
                    onValueChange={(val) => setFormData({ ...formData, agentComplexity: val === '_none' ? undefined : Number(val) as AgentComplexity })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select complexity level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Not set</SelectItem>
                      <SelectItem value="3">3 — Advanced (Opus-class)</SelectItem>
                      <SelectItem value="2">2 — Intermediate (Sonnet-class)</SelectItem>
                      <SelectItem value="1">1 — Basic (Haiku-class)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used by <code className="bg-muted px-1 rounded">{'{{agent.complexity.N}}'}</code> templates for dynamic workflow assignment.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Capability Tags</label>
                  <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                    {formData.agentTags.map(tag => (
                      <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag(tagInput)
                        }
                      }}
                      placeholder="Type a tag and press Enter"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => addTag(tagInput)}
                      disabled={!tagInput.trim()}
                    >
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Used by <code className="bg-muted px-1 rounded">{'{{agent.tag.name}}'}</code> templates. E.g., <code className="bg-muted px-1 rounded">api-integration</code>, <code className="bg-muted px-1 rounded">code-review</code>
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Agent Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={formData.botColor}
                      onChange={(e) => setFormData({ ...formData, botColor: e.target.value })}
                      className="h-10 w-14 cursor-pointer rounded border border-input bg-background p-1"
                    />
                    <Input
                      value={formData.botColor}
                      onChange={(e) => setFormData({ ...formData, botColor: e.target.value })}
                      placeholder="#3B82F6"
                      className="w-28 font-mono text-sm"
                    />
                    <span className="text-sm text-muted-foreground">Used to identify this agent in the UI</span>
                  </div>
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingUser
                  ? 'Update User'
                  : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
