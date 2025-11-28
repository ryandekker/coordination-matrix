'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Search,
  Filter,
  SortAsc,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FieldConfig } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

const fieldTypes = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select (Dropdown)' },
  { value: 'multiselect', label: 'Multi-Select' },
  { value: 'reference', label: 'Reference (Link)' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'date', label: 'Date' },
  { value: 'tags', label: 'Tags' },
  { value: 'json', label: 'JSON' },
]

const renderAsOptions = [
  { value: 'text', label: 'Plain Text' },
  { value: 'badge', label: 'Badge' },
  { value: 'link', label: 'Link' },
  { value: 'avatar', label: 'Avatar' },
  { value: 'progress', label: 'Progress Bar' },
]

async function fetchFieldConfigs(): Promise<{ data: Record<string, FieldConfig[]> }> {
  const response = await fetch(`${API_BASE}/field-configs`)
  if (!response.ok) throw new Error('Failed to fetch field configs')
  return response.json()
}

async function fetchLookupTypes(): Promise<{ data: string[] }> {
  const response = await fetch(`${API_BASE}/lookups/types`)
  if (!response.ok) throw new Error('Failed to fetch lookup types')
  return response.json()
}

async function createFieldConfig(data: Partial<FieldConfig>): Promise<{ data: FieldConfig }> {
  const response = await fetch(`${API_BASE}/field-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create field config')
  return response.json()
}

async function updateFieldConfig(id: string, data: Partial<FieldConfig>): Promise<{ data: FieldConfig }> {
  const response = await fetch(`${API_BASE}/field-configs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update field config')
  return response.json()
}

async function deleteFieldConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/field-configs/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete field config')
}

async function reorderFieldConfigs(collection: string, order: { fieldPath: string; displayOrder: number }[]): Promise<void> {
  const response = await fetch(`${API_BASE}/field-configs/${collection}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
  if (!response.ok) throw new Error('Failed to reorder fields')
}

interface FieldFormData {
  collectionName: string
  fieldPath: string
  displayName: string
  fieldType: string
  isRequired: boolean
  isEditable: boolean
  isSearchable: boolean
  isSortable: boolean
  isFilterable: boolean
  defaultVisible: boolean
  width: number
  minWidth: number
  lookupType: string
  referenceCollection: string
  referenceDisplayField: string
  renderAs: string
}

const defaultFormData: FieldFormData = {
  collectionName: 'tasks',
  fieldPath: '',
  displayName: '',
  fieldType: 'text',
  isRequired: false,
  isEditable: true,
  isSearchable: false,
  isSortable: true,
  isFilterable: false,
  defaultVisible: true,
  width: 150,
  minWidth: 100,
  lookupType: '',
  referenceCollection: '',
  referenceDisplayField: 'displayName',
  renderAs: 'text',
}

export default function FieldSettingsPage() {
  const queryClient = useQueryClient()
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set(['tasks']))
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingField, setEditingField] = useState<FieldConfig | null>(null)
  const [formData, setFormData] = useState<FieldFormData>(defaultFormData)
  const [draggedField, setDraggedField] = useState<string | null>(null)
  const [dragOverField, setDragOverField] = useState<string | null>(null)

  const { data: configsData, isLoading } = useQuery({
    queryKey: ['field-configs'],
    queryFn: fetchFieldConfigs,
  })

  const { data: lookupTypesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: fetchLookupTypes,
  })

  const createMutation = useMutation({
    mutationFn: createFieldConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FieldConfig> }) => updateFieldConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFieldConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: ({ collection, order }: { collection: string; order: { fieldPath: string; displayOrder: number }[] }) =>
      reorderFieldConfigs(collection, order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
    },
  })

  const configs = configsData?.data || {}
  const lookupTypes = lookupTypesData?.data || []
  const collections = Object.keys(configs)

  const toggleCollection = (collection: string) => {
    const newExpanded = new Set(expandedCollections)
    if (newExpanded.has(collection)) {
      newExpanded.delete(collection)
    } else {
      newExpanded.add(collection)
    }
    setExpandedCollections(newExpanded)
  }

  const openCreateModal = (collection: string = 'tasks') => {
    setEditingField(null)
    setFormData({ ...defaultFormData, collectionName: collection })
    setIsModalOpen(true)
  }

  const openEditModal = (field: FieldConfig) => {
    setEditingField(field)
    setFormData({
      collectionName: field.collectionName,
      fieldPath: field.fieldPath,
      displayName: field.displayName,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      isEditable: field.isEditable,
      isSearchable: field.isSearchable,
      isSortable: field.isSortable,
      isFilterable: field.isFilterable,
      defaultVisible: field.defaultVisible,
      width: field.width || 150,
      minWidth: field.minWidth || 100,
      lookupType: field.lookupType || '',
      referenceCollection: field.referenceCollection || '',
      referenceDisplayField: field.referenceDisplayField || 'displayName',
      renderAs: field.renderAs || 'text',
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingField(null)
    setFormData(defaultFormData)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      ...formData,
      width: formData.width || undefined,
      minWidth: formData.minWidth || undefined,
      lookupType: formData.lookupType || undefined,
      referenceCollection: formData.referenceCollection || undefined,
      referenceDisplayField: formData.referenceDisplayField || undefined,
      renderAs: formData.renderAs || undefined,
    }

    if (editingField) {
      updateMutation.mutate({ id: editingField._id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (field: FieldConfig) => {
    if (confirm(`Are you sure you want to delete the "${field.displayName}" field configuration?`)) {
      deleteMutation.mutate(field._id)
    }
  }

  const handleDragStart = (e: React.DragEvent, fieldPath: string) => {
    setDraggedField(fieldPath)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, fieldPath: string) => {
    e.preventDefault()
    if (draggedField && draggedField !== fieldPath) {
      setDragOverField(fieldPath)
    }
  }

  const handleDragEnd = (collection: string) => {
    if (draggedField && dragOverField && draggedField !== dragOverField) {
      const fields = configs[collection] || []
      const fieldOrder = fields.map(f => f.fieldPath)
      const draggedIndex = fieldOrder.indexOf(draggedField)
      const targetIndex = fieldOrder.indexOf(dragOverField)

      fieldOrder.splice(draggedIndex, 1)
      fieldOrder.splice(targetIndex, 0, draggedField)

      const order = fieldOrder.map((fp, index) => ({ fieldPath: fp, displayOrder: index + 1 }))
      reorderMutation.mutate({ collection, order })
    }
    setDraggedField(null)
    setDragOverField(null)
  }

  const handleQuickToggle = (field: FieldConfig, property: keyof FieldConfig, value: boolean) => {
    updateMutation.mutate({ id: field._id, data: { [property]: value } })
  }

  const getFieldTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      text: 'Aa',
      textarea: '¶',
      number: '#',
      boolean: '☑',
      select: '▼',
      multiselect: '☰',
      reference: '🔗',
      datetime: '📅',
      date: '📆',
      tags: '🏷',
      json: '{}',
    }
    return icons[type] || '?'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Field Configuration</h1>
          <p className="text-muted-foreground">
            Configure how fields are displayed, edited, and filtered across collections
          </p>
        </div>
        <Button onClick={() => openCreateModal()}>
          <Plus className="mr-2 h-4 w-4" />
          Add Field
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {collections.map((collection) => (
            <div key={collection} className="rounded-lg border bg-card">
              <button
                className="flex w-full items-center justify-between p-4 text-left"
                onClick={() => toggleCollection(collection)}
              >
                <div className="flex items-center gap-3">
                  {expandedCollections.has(collection) ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                  <span className="font-semibold capitalize">{collection}</span>
                  <Badge variant="secondary">{configs[collection]?.length || 0} fields</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    openCreateModal(collection)
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </button>

              {expandedCollections.has(collection) && (
                <div className="border-t">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/50">
                    <div className="col-span-1"></div>
                    <div className="col-span-2">Field Path</div>
                    <div className="col-span-2">Display Name</div>
                    <div className="col-span-1">Type</div>
                    <div className="col-span-1 text-center">
                      <Eye className="h-3 w-3 inline" title="Default Visible" />
                    </div>
                    <div className="col-span-1 text-center">
                      <Pencil className="h-3 w-3 inline" title="Editable" />
                    </div>
                    <div className="col-span-1 text-center">
                      <Search className="h-3 w-3 inline" title="Searchable" />
                    </div>
                    <div className="col-span-1 text-center">
                      <SortAsc className="h-3 w-3 inline" title="Sortable" />
                    </div>
                    <div className="col-span-1 text-center">
                      <Filter className="h-3 w-3 inline" title="Filterable" />
                    </div>
                    <div className="col-span-1"></div>
                  </div>
                  {(configs[collection] || [])
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((field) => (
                      <div
                        key={field._id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, field.fieldPath)}
                        onDragOver={(e) => handleDragOver(e, field.fieldPath)}
                        onDragEnd={() => handleDragEnd(collection)}
                        className={cn(
                          'grid grid-cols-12 gap-2 px-4 py-3 items-center border-t hover:bg-muted/30 cursor-grab',
                          draggedField === field.fieldPath && 'opacity-50',
                          dragOverField === field.fieldPath && 'bg-primary/10'
                        )}
                      >
                        <div className="col-span-1">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="col-span-2 font-mono text-sm">{field.fieldPath}</div>
                        <div className="col-span-2">{field.displayName}</div>
                        <div className="col-span-1">
                          <Badge variant="outline" className="font-mono text-xs">
                            {getFieldTypeIcon(field.fieldType)} {field.fieldType}
                          </Badge>
                        </div>
                        <div className="col-span-1 text-center">
                          <Checkbox
                            checked={field.defaultVisible}
                            onCheckedChange={(checked) => handleQuickToggle(field, 'defaultVisible', !!checked)}
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          <Checkbox
                            checked={field.isEditable}
                            onCheckedChange={(checked) => handleQuickToggle(field, 'isEditable', !!checked)}
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          <Checkbox
                            checked={field.isSearchable}
                            onCheckedChange={(checked) => handleQuickToggle(field, 'isSearchable', !!checked)}
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          <Checkbox
                            checked={field.isSortable}
                            onCheckedChange={(checked) => handleQuickToggle(field, 'isSortable', !!checked)}
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          <Checkbox
                            checked={field.isFilterable}
                            onCheckedChange={(checked) => handleQuickToggle(field, 'isFilterable', !!checked)}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditModal(field)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive"
                            onClick={() => handleDelete(field)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingField ? 'Edit Field Configuration' : 'Add Field Configuration'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Collection *</label>
                <Select
                  value={formData.collectionName}
                  onValueChange={(val) => setFormData({ ...formData, collectionName: val })}
                  disabled={!!editingField}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tasks">tasks</SelectItem>
                    <SelectItem value="users">users</SelectItem>
                    <SelectItem value="teams">teams</SelectItem>
                    <SelectItem value="workflows">workflows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Field Path *</label>
                <Input
                  value={formData.fieldPath}
                  onChange={(e) => setFormData({ ...formData, fieldPath: e.target.value })}
                  placeholder="e.g., myField or nested.field"
                  disabled={!!editingField}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name *</label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="e.g., My Field"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Field Type *</label>
                <Select
                  value={formData.fieldType}
                  onValueChange={(val) => setFormData({ ...formData, fieldType: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.fieldType === 'select' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Lookup Type</label>
                <Select
                  value={formData.lookupType}
                  onValueChange={(val) => setFormData({ ...formData, lookupType: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select lookup type" />
                  </SelectTrigger>
                  <SelectContent>
                    {lookupTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.fieldType === 'reference' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Reference Collection</label>
                  <Select
                    value={formData.referenceCollection}
                    onValueChange={(val) => setFormData({ ...formData, referenceCollection: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select collection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="users">users</SelectItem>
                      <SelectItem value="teams">teams</SelectItem>
                      <SelectItem value="workflows">workflows</SelectItem>
                      <SelectItem value="tasks">tasks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Display Field</label>
                  <Input
                    value={formData.referenceDisplayField}
                    onChange={(e) => setFormData({ ...formData, referenceDisplayField: e.target.value })}
                    placeholder="e.g., displayName"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Width (px)</label>
                <Input
                  type="number"
                  value={formData.width}
                  onChange={(e) => setFormData({ ...formData, width: parseInt(e.target.value) || 150 })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Render As</label>
                <Select
                  value={formData.renderAs}
                  onValueChange={(val) => setFormData({ ...formData, renderAs: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {renderAsOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isRequired"
                  checked={formData.isRequired}
                  onCheckedChange={(checked) => setFormData({ ...formData, isRequired: !!checked })}
                />
                <label htmlFor="isRequired" className="text-sm">Required</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isEditable"
                  checked={formData.isEditable}
                  onCheckedChange={(checked) => setFormData({ ...formData, isEditable: !!checked })}
                />
                <label htmlFor="isEditable" className="text-sm">Editable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="defaultVisible"
                  checked={formData.defaultVisible}
                  onCheckedChange={(checked) => setFormData({ ...formData, defaultVisible: !!checked })}
                />
                <label htmlFor="defaultVisible" className="text-sm">Visible by default</label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isSearchable"
                  checked={formData.isSearchable}
                  onCheckedChange={(checked) => setFormData({ ...formData, isSearchable: !!checked })}
                />
                <label htmlFor="isSearchable" className="text-sm">Searchable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isSortable"
                  checked={formData.isSortable}
                  onCheckedChange={(checked) => setFormData({ ...formData, isSortable: !!checked })}
                />
                <label htmlFor="isSortable" className="text-sm">Sortable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isFilterable"
                  checked={formData.isFilterable}
                  onCheckedChange={(checked) => setFormData({ ...formData, isFilterable: !!checked })}
                />
                <label htmlFor="isFilterable" className="text-sm">Filterable</label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingField
                  ? 'Update Field'
                  : 'Create Field'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
