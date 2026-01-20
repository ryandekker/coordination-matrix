'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Trash2, Pencil, Package, Eye, EyeOff, Lock, GitBranch, Copy } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDateTime } from '@/lib/utils'
import { variablePackagesApi, type VariablePackage, type VariableFieldSchema, type VariableFieldType } from '@/lib/api'

export default function VariablesPage() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPackage, setEditingPackage] = useState<VariablePackage | null>(null)
  const [packageToDelete, setPackageToDelete] = useState<VariablePackage | null>(null)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, Record<string, Record<string, unknown>>>>({})
  const [copied, setCopied] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    schema: [] as VariableFieldSchema[],
    branches: {} as Record<string, Record<string, unknown>>,
    defaultBranch: '',
  })

  // Branch editing state
  const [editingBranch, setEditingBranch] = useState<{ packageId: string; branchName: string; data: Record<string, unknown> } | null>(null)
  const [newBranchName, setNewBranchName] = useState('')

  const { data: packagesData, isLoading } = useQuery({
    queryKey: ['variable-packages'],
    queryFn: () => variablePackagesApi.list({ includeInactive: true }),
  })

  const createMutation = useMutation({
    mutationFn: variablePackagesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof variablePackagesApi.update>[1] }) =>
      variablePackagesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: variablePackagesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
      setPackageToDelete(null)
    },
  })

  const addBranchMutation = useMutation({
    mutationFn: ({ id, name, data }: { id: string; name: string; data: Record<string, unknown> }) =>
      variablePackagesApi.addBranch(id, name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
      setNewBranchName('')
    },
  })

  const updateBranchMutation = useMutation({
    mutationFn: ({ id, branch, data }: { id: string; branch: string; data: Record<string, unknown> }) =>
      variablePackagesApi.updateBranch(id, branch, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
      setEditingBranch(null)
    },
  })

  const deleteBranchMutation = useMutation({
    mutationFn: ({ id, branch }: { id: string; branch: string }) =>
      variablePackagesApi.deleteBranch(id, branch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variable-packages'] })
    },
  })

  const packages = packagesData?.data || []

  const resetForm = () => {
    setFormData({
      name: '',
      displayName: '',
      description: '',
      schema: [],
      branches: {},
      defaultBranch: '',
    })
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingPackage(null)
    resetForm()
  }

  const openCreateModal = () => {
    resetForm()
    setEditingPackage(null)
    setIsModalOpen(true)
  }

  const openEditModal = (pkg: VariablePackage) => {
    setFormData({
      name: pkg.name,
      displayName: pkg.displayName || '',
      description: pkg.description || '',
      schema: [...pkg.schema],
      branches: { ...pkg.branches },
      defaultBranch: pkg.defaultBranch || '',
    })
    setEditingPackage(pkg)
    setIsModalOpen(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingPackage) {
      updateMutation.mutate({
        id: editingPackage._id,
        data: {
          name: formData.name,
          displayName: formData.displayName,
          description: formData.description,
          schema: formData.schema,
          defaultBranch: formData.defaultBranch,
        },
      })
    } else {
      createMutation.mutate({
        name: formData.name,
        displayName: formData.displayName || formData.name,
        description: formData.description,
        schema: formData.schema,
        branches: formData.branches,
        defaultBranch: formData.defaultBranch,
      })
    }
  }

  const addSchemaField = () => {
    setFormData((prev) => ({
      ...prev,
      schema: [
        ...prev.schema,
        { key: '', displayName: '', type: 'string' as VariableFieldType },
      ],
    }))
  }

  const updateSchemaField = (index: number, updates: Partial<VariableFieldSchema>) => {
    setFormData((prev) => ({
      ...prev,
      schema: prev.schema.map((field, i) => (i === index ? { ...field, ...updates } : field)),
    }))
  }

  const removeSchemaField = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      schema: prev.schema.filter((_, i) => i !== index),
    }))
  }

  const revealSecrets = async (pkg: VariablePackage, branch: string) => {
    try {
      const response = await variablePackagesApi.revealBranch(pkg._id, branch)
      setRevealedSecrets((prev) => ({
        ...prev,
        [pkg._id]: {
          ...prev[pkg._id],
          [branch]: response.data.values,
        },
      }))
    } catch (error) {
      console.error('Failed to reveal secrets:', error)
    }
  }

  const hideSecrets = (pkgId: string, branch: string) => {
    setRevealedSecrets((prev) => {
      const next = { ...prev }
      if (next[pkgId]) {
        delete next[pkgId][branch]
      }
      return next
    })
  }

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const getTokenPath = (pkgName: string, branch: string, fieldKey: string) => {
    return `{{packages.${pkgName}[${branch}].${fieldKey}}}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Variable Packages</h1>
          <p className="text-muted-foreground">
            Manage credential packages and configuration variables for workflows
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Create Package
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Package</TableHead>
              <TableHead>Branches</TableHead>
              <TableHead>Fields</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : packages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Package className="h-8 w-8" />
                    <p>No variable packages yet</p>
                    <p className="text-sm">Create a package to store credentials and configuration</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              packages.map((pkg) => (
                <TableRow key={pkg._id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{pkg.displayName || pkg.name}</p>
                      <code className="text-xs text-muted-foreground">{pkg.name}</code>
                      {pkg.description && (
                        <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.keys(pkg.branches).map((branch) => (
                        <Badge
                          key={branch}
                          variant={branch === pkg.defaultBranch ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          <GitBranch className="h-3 w-3 mr-1" />
                          {branch}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {pkg.schema.map((field) => (
                        <Badge key={field.key} variant="outline" className="text-xs">
                          {field.type === 'secret' && <Lock className="h-3 w-3 mr-1" />}
                          {field.key}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(pkg.createdAt)}
                  </TableCell>
                  <TableCell>
                    {pkg.isActive ? (
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
                        <DropdownMenuItem onClick={() => openEditModal(pkg)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit Package
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setPackageToDelete(pkg)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
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

      {/* Expanded view for each package */}
      {packages.map((pkg) => (
        <div key={`detail-${pkg._id}`} className="rounded-md border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{pkg.displayName || pkg.name}</h3>
            <div className="flex gap-2">
              <Input
                placeholder="New branch name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="w-40 h-8"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!newBranchName || addBranchMutation.isPending}
                onClick={() => {
                  const emptyData: Record<string, unknown> = {}
                  pkg.schema.forEach((f) => {
                    emptyData[f.key] = ''
                  })
                  addBranchMutation.mutate({ id: pkg._id, name: newBranchName, data: emptyData })
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Branch
              </Button>
            </div>
          </div>

          {Object.entries(pkg.branches).map(([branchName, branchData]) => {
            const isRevealed = !!revealedSecrets[pkg._id]?.[branchName]
            const revealedData = revealedSecrets[pkg._id]?.[branchName] || {}

            return (
              <div key={branchName} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={branchName === pkg.defaultBranch ? 'default' : 'secondary'}>
                      <GitBranch className="h-3 w-3 mr-1" />
                      {branchName}
                    </Badge>
                    {branchName === pkg.defaultBranch && (
                      <span className="text-xs text-muted-foreground">(default)</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {pkg.schema.some((f) => f.type === 'secret') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          isRevealed ? hideSecrets(pkg._id, branchName) : revealSecrets(pkg, branchName)
                        }
                      >
                        {isRevealed ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-1" />
                            Hide
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-1" />
                            Reveal
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditingBranch({
                          packageId: pkg._id,
                          branchName,
                          data: isRevealed ? { ...revealedData } : { ...branchData },
                        })
                      }
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    {Object.keys(pkg.branches).length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteBranchMutation.mutate({ id: pkg._id, branch: branchName })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {pkg.schema.map((field) => {
                    const value = isRevealed ? revealedData[field.key] : branchData[field.key]
                    const displayValue =
                      field.type === 'secret' && !isRevealed ? '••••••••' : String(value || '')
                    const tokenPath = getTokenPath(pkg.name, branchName, field.key)
                    const copyKey = `${pkg._id}-${branchName}-${field.key}`

                    return (
                      <div key={field.key} className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground min-w-[100px]">
                          {field.type === 'secret' && <Lock className="h-3 w-3 inline mr-1" />}
                          {field.displayName || field.key}:
                        </span>
                        <code className="bg-muted px-1 rounded flex-1 truncate">{displayValue}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => copyToClipboard(tokenPath, copyKey)}
                        >
                          {copied === copyKey ? (
                            <span className="text-xs text-green-500">Copied</span>
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {/* Create/Edit Package Modal */}
      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPackage ? 'Edit Package' : 'Create Package'}</DialogTitle>
            <DialogDescription>
              {editingPackage
                ? 'Update the package configuration.'
                : 'Create a new variable package for credentials or configuration.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., email_credentials"
                required
                disabled={!!editingPackage}
              />
              <p className="text-xs text-muted-foreground">
                Used in templates: {`{{packages.${formData.name || 'name'}[branch].field}}`}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="e.g., Email Credentials"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this package used for?"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Fields</label>
                <Button type="button" variant="outline" size="sm" onClick={addSchemaField}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Field
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {formData.schema.map((field, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 border rounded">
                    <Input
                      placeholder="key"
                      value={field.key}
                      onChange={(e) => updateSchemaField(index, { key: e.target.value })}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Label"
                      value={field.displayName}
                      onChange={(e) => updateSchemaField(index, { displayName: e.target.value })}
                      className="flex-1"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) => updateSchemaField(index, { type: value as VariableFieldType })}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="secret">Secret</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="boolean">Boolean</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSchemaField(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {formData.schema.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No fields defined. Add fields to define the structure.
                  </p>
                )}
              </div>
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
                  formData.schema.length === 0
                }
              >
                {editingPackage
                  ? updateMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'
                  : createMutation.isPending
                    ? 'Creating...'
                    : 'Create Package'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Branch Modal */}
      <Dialog open={!!editingBranch} onOpenChange={() => setEditingBranch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Branch: {editingBranch?.branchName}</DialogTitle>
          </DialogHeader>
          {editingBranch && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                updateBranchMutation.mutate({
                  id: editingBranch.packageId,
                  branch: editingBranch.branchName,
                  data: editingBranch.data,
                })
              }}
              className="space-y-4"
            >
              {packages
                .find((p) => p._id === editingBranch.packageId)
                ?.schema.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">
                      {field.type === 'secret' && <Lock className="h-3 w-3 inline mr-1" />}
                      {field.displayName || field.key}
                    </label>
                    <Input
                      type={field.type === 'secret' ? 'password' : 'text'}
                      value={String(editingBranch.data[field.key] || '')}
                      onChange={(e) =>
                        setEditingBranch((prev) =>
                          prev
                            ? {
                                ...prev,
                                data: { ...prev.data, [field.key]: e.target.value },
                              }
                            : null
                        )
                      }
                      placeholder={field.type === 'secret' ? 'Enter new value to update' : ''}
                    />
                  </div>
                ))}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingBranch(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateBranchMutation.isPending}>
                  {updateBranchMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!packageToDelete} onOpenChange={() => setPackageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Package?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the package &quot;{packageToDelete?.displayName || packageToDelete?.name}&quot;
              and all its branches. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => packageToDelete && deleteMutation.mutate(packageToDelete._id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Package'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
