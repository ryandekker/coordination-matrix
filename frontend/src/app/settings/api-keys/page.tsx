'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Copy, RefreshCw, Trash2, Eye, EyeOff, Key } from 'lucide-react'
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
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface ApiKey {
  _id: string
  name: string
  description?: string
  key?: string // Only present on creation/regeneration
  keyPrefix: string
  scopes: string[]
  userId?: string | null
  createdAt: string
  expiresAt?: string | null
  lastUsedAt?: string | null
  isActive: boolean
}

interface User {
  _id: string
  displayName: string
  email?: string
  role: string
  isActive: boolean
}

const AVAILABLE_SCOPES = [
  { value: 'tasks:read', label: 'Read Tasks', description: 'View tasks and task details' },
  { value: 'tasks:write', label: 'Write Tasks', description: 'Create and update tasks' },
  { value: 'saved-searches:read', label: 'Read Saved Searches', description: 'Access saved searches/views' },
  { value: 'saved-searches:write', label: 'Write Saved Searches', description: 'Create and modify saved searches' },
]

async function fetchApiKeys(): Promise<{ data: ApiKey[] }> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to fetch API keys')
  return response.json()
}

async function fetchUsers(): Promise<{ data: User[] }> {
  const response = await fetch(`${API_BASE}/users?isActive=true`, {
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to fetch users')
  return response.json()
}

async function createApiKey(data: Partial<ApiKey>): Promise<{ data: ApiKey }> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create API key')
  return response.json()
}

async function deleteApiKey(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/api-keys/${id}`, {
    method: 'DELETE',
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to delete API key')
}

async function regenerateApiKey(id: string): Promise<{ data: ApiKey }> {
  const response = await fetch(`${API_BASE}/auth/api-keys/${id}/regenerate`, {
    method: 'POST',
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to regenerate API key')
  return response.json()
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
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
    queryFn: fetchApiKeys,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setIsCreateModalOpen(false)
      // Show the key reveal modal with the new key
      setRevealedKey(response.data.key || null)
      setIsKeyRevealModalOpen(true)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setKeyToDelete(null)
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: regenerateApiKey,
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

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      userId: '',
      scopes: ['tasks:read', 'saved-searches:read'],
    })
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      name: formData.name,
      description: formData.description,
      scopes: formData.scopes,
      ...(formData.userId && { userId: formData.userId }),
    }
    createMutation.mutate(payload)
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
        <Button onClick={() => setIsCreateModalOpen(true)}>
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
                <TableCell colSpan={7} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : apiKeys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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

      {/* Create API Key Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate New API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for programmatic access. The key will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
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
              <label className="text-sm font-medium">Acts As User</label>
              <Select
                value={formData.userId || 'none'}
                onValueChange={(value) => setFormData({ ...formData, userId: value === 'none' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No user (API key only)</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.displayName}{user.email ? ` (${user.email})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                When set, this API key will inherit the selected user&apos;s permissions.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Scopes</label>
              <div className="space-y-2 border rounded-md p-3">
                {AVAILABLE_SCOPES.map((scope) => (
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
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !formData.name}>
                {createMutation.isPending ? 'Generating...' : 'Generate Key'}
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
