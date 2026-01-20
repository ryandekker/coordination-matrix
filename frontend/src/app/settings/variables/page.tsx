'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Trash2, Pencil, Variable as VariableIcon, Eye, EyeOff, Lock, Copy, Unlock } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDateTime } from '@/lib/utils'
import { variablePackagesApi, type VariableRecord } from '@/lib/api'

export default function VariablesPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<VariableRecord | null>(null)
  const [variableToDelete, setVariableToDelete] = useState<VariableRecord | null>(null)
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    value: '',
    encrypted: false,
  })

  const { data: variablesData, isLoading } = useQuery({
    queryKey: ['variables'],
    queryFn: () => variablePackagesApi.list({ includeInactive: true }),
  })

  const createMutation = useMutation({
    mutationFn: variablePackagesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof variablePackagesApi.update>[1] }) =>
      variablePackagesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: variablePackagesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables'] })
      setVariableToDelete(null)
    },
  })

  const variables = variablesData?.data || []

  const resetForm = () => {
    setFormData({
      name: '',
      displayName: '',
      description: '',
      value: '',
      encrypted: false,
    })
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingVariable(null)
    resetForm()
  }

  const openCreateModal = () => {
    resetForm()
    setEditingVariable(null)
    setIsModalOpen(true)
  }

  const openEditModal = async (v: VariableRecord) => {
    // If encrypted, need to fetch the revealed value first
    let value = v.value
    if (v.encrypted && revealedValues[v._id]) {
      value = revealedValues[v._id]
    } else if (v.encrypted) {
      try {
        const response = await variablePackagesApi.reveal(v._id)
        value = response.data.value
        setRevealedValues((prev) => ({ ...prev, [v._id]: value }))
      } catch {
        // If reveal fails, leave as redacted
      }
    }

    setFormData({
      name: v.name,
      displayName: v.displayName || '',
      description: v.description || '',
      value,
      encrypted: v.encrypted,
    })
    setEditingVariable(v)
    setIsModalOpen(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingVariable) {
      updateMutation.mutate({
        id: editingVariable._id,
        data: {
          displayName: formData.displayName,
          description: formData.description,
          value: formData.value,
          encrypted: formData.encrypted,
        },
      })
    } else {
      createMutation.mutate({
        name: formData.name,
        displayName: formData.displayName || formData.name,
        description: formData.description,
        value: formData.value,
        encrypted: formData.encrypted,
      })
    }
  }

  const revealValue = async (v: VariableRecord) => {
    try {
      const response = await variablePackagesApi.reveal(v._id)
      setRevealedValues((prev) => ({ ...prev, [v._id]: response.data.value }))
    } catch (error) {
      console.error('Failed to reveal value:', error)
    }
  }

  const hideValue = (id: string) => {
    setRevealedValues((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const getTokenPath = (name: string) => {
    return `{{variables.${name}}}`
  }

  // Try to detect if value is JSON
  const isJsonValue = (value: string): boolean => {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'object' && parsed !== null
    } catch {
      return false
    }
  }

  // Format value for display (truncate if long, format JSON)
  const formatValuePreview = (value: string, maxLength = 100): string => {
    if (isJsonValue(value)) {
      try {
        const obj = JSON.parse(value)
        const keys = Object.keys(obj)
        if (keys.length <= 3) {
          return `{ ${keys.join(', ')} }`
        }
        return `{ ${keys.slice(0, 3).join(', ')}, ... }`
      } catch {
        return value
      }
    }
    if (value.length > maxLength) {
      return value.slice(0, maxLength) + '...'
    }
    return value
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Variables</h1>
          <p className="text-muted-foreground">
            Manage variables and credentials for use in workflows and templates
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Create Variable
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variable</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : variables.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <VariableIcon className="h-8 w-8" />
                    <p>No variables yet</p>
                    <p className="text-sm">Create a variable to store credentials and configuration</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              variables.map((v) => {
                const isRevealed = !!revealedValues[v._id]
                const displayValue = v.encrypted
                  ? isRevealed
                    ? formatValuePreview(revealedValues[v._id])
                    : '••••••••'
                  : formatValuePreview(v.value)

                return (
                  <TableRow key={v._id}>
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{v.displayName || v.name}</p>
                          {v.encrypted && (
                            <Badge variant="outline" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Encrypted
                            </Badge>
                          )}
                        </div>
                        <code className="text-xs text-muted-foreground">{v.name}</code>
                        {v.description && (
                          <p className="text-sm text-muted-foreground mt-1">{v.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded text-sm max-w-[300px] truncate">
                          {displayValue}
                        </code>
                        {v.encrypted && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => (isRevealed ? hideValue(v._id) : revealValue(v))}
                          >
                            {isRevealed ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => copyToClipboard(getTokenPath(v.name), v._id)}
                        >
                          {copied === v._id ? (
                            <span className="text-xs text-green-500">Copied!</span>
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(v.createdAt)}
                    </TableCell>
                    <TableCell>
                      {v.isActive ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500 border-gray-500">
                          Inactive
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
                          <DropdownMenuItem onClick={() => openEditModal(v)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit Variable
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setVariableToDelete(v)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Variable Modal */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVariable ? 'Edit Variable' : 'Create Variable'}</DialogTitle>
            <DialogDescription>
              {editingVariable
                ? 'Update the variable configuration.'
                : 'Create a new variable for credentials or configuration. Values can be strings or JSON/YAML objects.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., api_key"
                  required
                  disabled={!!editingVariable}
                />
                <p className="text-xs text-muted-foreground">
                  Used in templates: {getTokenPath(formData.name || 'name')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name</label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., API Key"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this variable used for?"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Value *</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={formData.encrypted}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, encrypted: checked === true })
                    }
                  />
                  <Lock className="h-3 w-3" />
                  Encrypt value
                </label>
              </div>
              <Textarea
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                placeholder={`Enter a string value or JSON/YAML object, e.g.:
{
  "host": "localhost",
  "port": 5432,
  "database": "mydb"
}`}
                rows={10}
                className="font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground">
                For JSON objects, access nested values with: {`{{variables.${formData.name || 'name'}.path.to.field}}`}
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  !formData.name ||
                  !formData.value
                }
              >
                {editingVariable
                  ? updateMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'
                  : createMutation.isPending
                    ? 'Creating...'
                    : 'Create Variable'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!variableToDelete} onOpenChange={() => setVariableToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Variable?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the variable &quot;{variableToDelete?.displayName || variableToDelete?.name}&quot;.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => variableToDelete && deleteMutation.mutate(variableToDelete._id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Variable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
