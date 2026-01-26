'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Users,
  UserPlus,
  UserMinus,
  Shield,
  Eye,
  Crown,
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
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { authFetch, Group, GroupMember, GroupRole, GroupVisibility, User, isSystemUser } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

// Groups API
async function fetchGroups(): Promise<{ data: Group[] }> {
  const response = await authFetch(`${API_BASE}/groups?all=true`)
  if (!response.ok) throw new Error('Failed to fetch groups')
  return response.json()
}

async function fetchGroup(id: string): Promise<{ data: Group }> {
  const response = await authFetch(`${API_BASE}/groups/${id}`)
  if (!response.ok) throw new Error('Failed to fetch group')
  return response.json()
}

async function createGroup(data: Partial<Group>): Promise<{ data: Group }> {
  const response = await authFetch(`${API_BASE}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create group')
  }
  return response.json()
}

async function updateGroup(id: string, data: Partial<Group>): Promise<{ data: Group }> {
  const response = await authFetch(`${API_BASE}/groups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update group')
  }
  return response.json()
}

async function deleteGroup(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/groups/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete group')
}

async function addMember(groupId: string, userId: string, role: GroupRole): Promise<{ data: Group }> {
  const response = await authFetch(`${API_BASE}/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, role }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to add member')
  }
  return response.json()
}

async function updateMemberRole(groupId: string, userId: string, role: GroupRole): Promise<{ data: Group }> {
  const response = await authFetch(`${API_BASE}/groups/${groupId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update member role')
  }
  return response.json()
}

async function removeMember(groupId: string, userId: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to remove member')
}

async function fetchUsers(): Promise<{ data: User[] }> {
  const response = await authFetch(`${API_BASE}/users`)
  if (!response.ok) throw new Error('Failed to fetch users')
  return response.json()
}

interface GroupFormData {
  displayName: string
  description: string
  visibility: GroupVisibility
}

const defaultGroupFormData: GroupFormData = {
  displayName: '',
  description: '',
  visibility: 'private',
}

// Helper to get owner email from a group
function getOwnerEmail(group: Group, users: User[]): string | null {
  const ownerMember = group.members.find((m) => m.role === 'owner')
  if (!ownerMember) return null
  const owner = users.find((u) => u._id === ownerMember.userId)
  return owner?.email || null
}

const roleIcons: Record<GroupRole, React.ComponentType<{ className?: string }>> = {
  owner: Crown,
  admin: Shield,
  member: Users,
  viewer: Eye,
}

const roleColors: Record<GroupRole, string> = {
  owner: 'bg-amber-500',
  admin: 'bg-blue-500',
  member: 'bg-green-500',
  viewer: 'bg-gray-500',
}

export default function GroupsSettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false)
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [formData, setFormData] = useState<GroupFormData>(defaultGroupFormData)
  const [formError, setFormError] = useState<string | null>(null)
  const [newMemberUserId, setNewMemberUserId] = useState<string>('')
  const [newMemberRole, setNewMemberRole] = useState<GroupRole>('member')

  // Queries
  const { data: groupsData, isLoading } = useQuery({
    queryKey: ['groups', 'all'],
    queryFn: fetchGroups,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Group> }) => updateGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      closeModal()
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })

  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId, role }: { groupId: string; userId: string; role: GroupRole }) =>
      addMember(groupId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      setIsAddMemberModalOpen(false)
      setNewMemberUserId('')
      setNewMemberRole('member')
    },
    onError: (error: Error) => {
      setFormError(error.message)
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ groupId, userId, role }: { groupId: string; userId: string; role: GroupRole }) =>
      updateMemberRole(groupId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      removeMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })

  const users = usersData?.data || []

  const groups = (groupsData?.data || []).filter((g) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    const ownerEmail = getOwnerEmail(g, users)
    return (
      g.displayName.toLowerCase().includes(query) ||
      (ownerEmail && ownerEmail.toLowerCase().includes(query)) ||
      (g.description && g.description.toLowerCase().includes(query))
    )
  })

  const openCreateModal = () => {
    setEditingGroup(null)
    setFormData(defaultGroupFormData)
    setFormError(null)
    setIsModalOpen(true)
  }

  const openEditModal = (group: Group) => {
    setEditingGroup(group)
    setFormData({
      displayName: group.displayName,
      description: group.description || '',
      visibility: group.visibility,
    })
    setFormError(null)
    setIsModalOpen(true)
  }

  const openMembersModal = (group: Group) => {
    setSelectedGroup(group)
    setIsMembersModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingGroup(null)
    setFormData(defaultGroupFormData)
    setFormError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const data = {
      displayName: formData.displayName,
      description: formData.description || undefined,
      visibility: formData.visibility,
    }

    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup._id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (group: Group) => {
    if (confirm(`Are you sure you want to delete the "${group.displayName}" group? This will remove all members and may affect tasks and workflows associated with this group.`)) {
      deleteMutation.mutate(group._id)
    }
  }

  const handleAddMember = () => {
    if (!selectedGroup || !newMemberUserId) return
    addMemberMutation.mutate({
      groupId: selectedGroup._id,
      userId: newMemberUserId,
      role: newMemberRole,
    })
  }

  const handleRemoveMember = (userId: string) => {
    if (!selectedGroup) return
    if (confirm('Are you sure you want to remove this member from the group?')) {
      removeMemberMutation.mutate({ groupId: selectedGroup._id, userId })
    }
  }

  const handleRoleChange = (userId: string, role: GroupRole) => {
    if (!selectedGroup) return
    updateRoleMutation.mutate({ groupId: selectedGroup._id, userId, role })
  }

  // Get members not already in the group (exclude system user)
  const availableUsers = users.filter(
    (user) => !isSystemUser(user) && !selectedGroup?.members.some((m) => m.userId === user._id)
  )

  // Refresh selected group from query data when it changes
  const currentSelectedGroup = selectedGroup
    ? groups.find((g) => g._id === selectedGroup._id) || selectedGroup
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Group Management</h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? 'Create and manage groups to organize users and control access to tasks and workflows.'
              : 'View groups and manage your memberships.'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Create Group
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search groups..."
          className="pl-10"
        />
      </div>

      {/* Groups Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {searchQuery ? (
            <p>No groups found matching &quot;{searchQuery}&quot;</p>
          ) : (
            <div className="space-y-2">
              <p>{isAdmin ? 'No groups have been created yet.' : 'You are not a member of any groups.'}</p>
              {isAdmin && (
                <Button onClick={openCreateModal} variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first group
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const ownerEmail = getOwnerEmail(group, users)
            return (
            <div
              key={group._id}
              className="flex flex-col rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">{group.displayName}</span>
                    <Badge variant={group.visibility === 'private' ? 'secondary' : 'outline'}>
                      {group.visibility}
                    </Badge>
                  </div>
                  {ownerEmail && (
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Crown className="h-3 w-3" />
                      {ownerEmail}
                    </p>
                  )}
                  {group.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{group.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t">
                <button
                  onClick={() => openMembersModal(group)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Users className="h-4 w-4" />
                  <span>{group.members.length} members</span>
                </button>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => openMembersModal(group)}
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => openEditModal(group)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => handleDelete(group)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Group Modal (Create/Edit) */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit Group' : 'Create Group'}</DialogTitle>
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
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="e.g., Engineering Team"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Visibility</label>
              <Select
                value={formData.visibility}
                onValueChange={(value) => setFormData({ ...formData, visibility: value as GroupVisibility })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private - Only members can see this group</SelectItem>
                  <SelectItem value="internal">Internal - All users can see this group</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description of this group..."
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingGroup
                  ? 'Update Group'
                  : 'Create Group'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Members Modal */}
      <Dialog open={isMembersModalOpen} onOpenChange={setIsMembersModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {currentSelectedGroup?.displayName} - Members
            </DialogTitle>
            <DialogDescription>
              Manage members and their roles in this group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setIsAddMemberModalOpen(true)} size="sm">
                <UserPlus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            </div>

            {currentSelectedGroup?.members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No members in this group yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentSelectedGroup?.members.map((member) => {
                    const user = users.find((u) => u._id === member.userId)
                    const RoleIcon = roleIcons[member.role]
                    return (
                      <TableRow key={member.userId}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                              {user?.displayName?.charAt(0) || '?'}
                            </div>
                            <div>
                              <p className="font-medium">{user?.displayName || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{user?.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={member.role}
                            onValueChange={(role) => handleRoleChange(member.userId, role as GroupRole)}
                          >
                            <SelectTrigger className="w-32">
                              <div className="flex items-center gap-2">
                                <RoleIcon className="h-4 w-4" />
                                <span className="capitalize">{member.role}</span>
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              {(['owner', 'admin', 'member', 'viewer'] as GroupRole[]).map((role) => {
                                const Icon = roleIcons[role]
                                return (
                                  <SelectItem key={role} value={role}>
                                    <div className="flex items-center gap-2">
                                      <Icon className="h-4 w-4" />
                                      <span className="capitalize">{role}</span>
                                    </div>
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(member.addedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive"
                            onClick={() => handleRemoveMember(member.userId)}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Member Modal */}
      <Dialog open={isAddMemberModalOpen} onOpenChange={setIsAddMemberModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Add a user to {currentSelectedGroup?.displayName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">User *</label>
              <Select value={newMemberUserId} onValueChange={setNewMemberUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      <div className="flex items-center gap-2">
                        <span>{user.displayName}</span>
                        <span className="text-muted-foreground">({user.email})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={newMemberRole} onValueChange={(v) => setNewMemberRole(v as GroupRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['owner', 'admin', 'member', 'viewer'] as GroupRole[]).map((role) => {
                    const Icon = roleIcons[role]
                    return (
                      <SelectItem key={role} value={role}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="capitalize">{role}</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddMemberModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={!newMemberUserId || addMemberMutation.isPending}
            >
              {addMemberMutation.isPending ? 'Adding...' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
