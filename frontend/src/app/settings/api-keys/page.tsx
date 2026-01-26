'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Copy, RefreshCw, Trash2, Eye, Key, Pencil } from 'lucide-react'
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
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDateTime } from '@/lib/utils'
import { apiKeysApi, usersApi, type ApiKey, type ScopeDefinition, isSystemUser } from '@/lib/api'
import { useAuth } from '@/lib/auth'

// Special value for "Full System Access" option (no user association, admin-level access)
const SYSTEM_ACCESS_VALUE = '__system__'

interface User {
  _id: string
  displayName: string
  email?: string
  role: string
  isActive: boolean
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const isCurrentUserAdmin = currentUser?.role === 'admin'
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null)
  const [isKeyRevealModalOpen, setIsKeyRevealModalOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null)
  const [keyToRegenerate, setKeyToRegenerate] = useState<ApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    userId: '' as string,
    scopes: ['tasks:read', 'saved-searches:read'] as string[],
  })

  const { data: apiKeysData, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: apiKeysApi.list,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  const { data: scopesData } = useQuery({
    queryKey: ['api-key-scopes'],
    queryFn: apiKeysApi.getScopes,
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; scopes: string[]; userId?: string | null }) => apiKeysApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      closeModal()
      // Show the key reveal modal with the new key
      setRevealedKey(response.data.key || null)
      setIsKeyRevealModalOpen(true)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; scopes?: string[]; userId?: string | null } }) =>
      apiKeysApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: apiKeysApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setKeyToDelete(null)
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: apiKeysApi.regenerate,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setKeyToRegenerate(null)
      // Show the key reveal modal with the regenerated key
      setRevealedKey(response.data.key || null)
      setIsKeyRevealModalOpen(true)
    },
  })

  const apiKeys = apiKeysData?.data || []
  const users = usersData?.data || []
  const availableScopes = scopesData?.data || []

  // Group scopes by category for better UI organization
  const scopesByCategory = availableScopes.reduce((acc, scope) => {
    if (!acc[scope.category]) acc[scope.category] = []
    acc[scope.category].push(scope)
    return acc
  }, {} as Record<string, ScopeDefinition[]>)

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      // Default to current user - they must select a user (or system access if admin)
      userId: currentUser?.id || '',
      scopes: ['tasks:read', 'saved-searches:read'],
    })
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingKey(null)
    resetForm()
  }

  const openCreateModal = () => {
    resetForm()
    setEditingKey(null)
    setIsModalOpen(true)
  }

  const openEditModal = (apiKey: ApiKey) => {
    // Determine the userId value for the form:
    // - If apiKey has no userId, it's a system access key (admin only)
    // - Otherwise use the userId
    const userIdValue = apiKey.userId ? apiKey.userId : SYSTEM_ACCESS_VALUE
    setFormData({
      name: apiKey.name,
      description: apiKey.description || '',
      userId: userIdValue,
      scopes: [...apiKey.scopes],
    })
    setEditingKey(apiKey)
    setIsModalOpen(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Convert userId: SYSTEM_ACCESS_VALUE means null (no user), otherwise use the userId
    const userIdPayload = formData.userId === SYSTEM_ACCESS_VALUE ? null : formData.userId

    if (editingKey) {
      // Update existing key - include userId if admin is editing
      const updateData: { name?: string; description?: string; scopes?: string[]; userId?: string | null } = {
        name: formData.name,
        description: formData.description || undefined,
        scopes: formData.scopes,
      }
      // Only admins can change userId
      if (isCurrentUserAdmin) {
        updateData.userId = userIdPayload
      }
      updateMutation.mutate({
        id: editingKey._id,
        data: updateData,
      })
    } else {
      // Create new key
      const payload: { name: string; description?: string; scopes: string[]; userId?: string | null } = {
        name: formData.name,
        description: formData.description || undefined,
        scopes: formData.scopes,
      }
      // userId is required - either a user ID or null for system access
      if (userIdPayload !== null) {
        payload.userId = userIdPayload
      }
      // If null (system access), don't include userId - backend will handle it
      createMutation.mutate(payload)
    }
  }

  const handleScopeChange = (scope: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      scopes: checked
        ? [...prev.scopes, scope]
        : prev.scopes.filter((s) => s !== scope),
    }))
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const closeKeyRevealModal = () => {
    setIsKeyRevealModalOpen(false)
    setRevealedKey(null)
    setCopied(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground">
            Generate and manage API keys for programmatic access
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Generate New Key
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Acts As</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : apiKeys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Key className="h-8 w-8" />
                    <p>No API keys yet</p>
                    <p className="text-sm">Generate a key to get started with the API</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              apiKeys.map((apiKey) => (
                <TableRow key={apiKey._id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{apiKey.name}</p>
                      {apiKey.description && (
                        <p className="text-sm text-muted-foreground">{apiKey.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-sm bg-muted px-2 py-1 rounded">
                      {apiKey.keyPrefix}
                    </code>
                  </TableCell>
                  <TableCell>
                    {apiKey.userId ? (
                      <span className="text-sm">
                        {users.find(u => u._id === apiKey.userId)?.displayName || apiKey.userId}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-600">
                        System
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {apiKey.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(apiKey.createdAt)}
                  </TableCell>
                  <TableCell>
                    {apiKey.isActive ? (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500 border-gray-500">
                        Revoked
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditModal(apiKey)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setKeyToRegenerate(apiKey)}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Regenerate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setKeyToDelete(apiKey)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Revoke
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

      {/* Create/Edit API Key Modal */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingKey ? 'Edit API Key' : 'Generate New API Key'}</DialogTitle>
            <DialogDescription>
              {editingKey
                ? 'Update the name, description, or scopes for this API key.'
                : 'Create a new API key for programmatic access. The key will only be shown once.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Production Agent"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What will this key be used for?"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Acts As User *</label>
              <Select
                value={formData.userId}
                onValueChange={(value) => setFormData({ ...formData, userId: value })}
                disabled={!!editingKey && !isCurrentUserAdmin}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {isCurrentUserAdmin && (
                    <SelectItem value={SYSTEM_ACCESS_VALUE}>
                      <span className="font-medium text-amber-600">Full System Access</span>
                    </SelectItem>
                  )}
                  {users.filter((user) => !isSystemUser(user)).map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.displayName}{user.email ? ` (${user.email})` : ''}
                      {user._id === currentUser?.id && ' (you)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.userId === SYSTEM_ACCESS_VALUE
                  ? 'This key will have full system access without user restrictions.'
                  : 'This API key will inherit the selected user\'s permissions and group access.'}
                {editingKey && !isCurrentUserAdmin && ' Only admins can change this setting.'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Scopes</label>
              <div className="space-y-4 border rounded-md p-3 max-h-64 overflow-y-auto">
                {Object.entries(scopesByCategory).map(([category, scopes]) => (
                  <div key={category} className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {category}
                    </h4>
                    {scopes.map((scope) => (
                      <div key={scope.value} className="flex items-start space-x-3">
                        <Checkbox
                          id={scope.value}
                          checked={formData.scopes.includes(scope.value)}
                          onCheckedChange={(checked) =>
                            handleScopeChange(scope.value, checked as boolean)
                          }
                        />
                        <div className="space-y-0.5">
                          <label htmlFor={scope.value} className="text-sm font-medium cursor-pointer">
                            {scope.label}
                          </label>
                          <p className="text-xs text-muted-foreground">{scope.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending || !formData.name || !formData.userId}
              >
                {editingKey
                  ? updateMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'
                  : createMutation.isPending
                    ? 'Generating...'
                    : 'Generate Key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Key Reveal Modal */}
      <Dialog open={isKeyRevealModalOpen} onOpenChange={closeKeyRevealModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Generated</DialogTitle>
            <DialogDescription>
              Make sure to copy your API key now. You won&apos;t be able to see it again!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
              <code className="flex-1 text-sm break-all">{revealedKey}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => revealedKey && copyToClipboard(revealedKey)}
              >
                {copied ? (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Warning:</strong> This is the only time you&apos;ll see this key.
                Store it securely - you cannot retrieve it later.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={closeKeyRevealModal}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!keyToDelete} onOpenChange={() => setKeyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke the API key &quot;{keyToDelete?.name}&quot;.
              Any applications using this key will no longer be able to authenticate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => keyToDelete && deleteMutation.mutate(keyToDelete._id)}
            >
              {deleteMutation.isPending ? 'Revoking...' : 'Revoke Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Regenerate Confirmation */}
      <AlertDialog open={!!keyToRegenerate} onOpenChange={() => setKeyToRegenerate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a new key for &quot;{keyToRegenerate?.name}&quot; and invalidate the old one.
              Any applications using the current key will need to be updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => keyToRegenerate && regenerateMutation.mutate(keyToRegenerate._id)}
            >
              {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
