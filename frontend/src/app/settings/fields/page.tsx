'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  Search,
  Filter,
  SortAsc,
  Palette,
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { FieldConfig, LookupValue } from '@/lib/api'

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
]

// Field Configs API
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

// Lookups API
async function fetchLookups(): Promise<{ data: Record<string, LookupValue[]> }> {
  const response = await fetch(`${API_BASE}/lookups`)
  if (!response.ok) throw new Error('Failed to fetch lookups')
  return response.json()
}

async function createLookup(data: Partial<LookupValue>): Promise<{ data: LookupValue }> {
  const response = await fetch(`${API_BASE}/lookups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create lookup')
  return response.json()
}

async function updateLookup(id: string, data: Partial<LookupValue>): Promise<{ data: LookupValue }> {
  const response = await fetch(`${API_BASE}/lookups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update lookup')
  return response.json()
}

async function deleteLookup(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/lookups/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to delete lookup')
}

async function reorderLookups(type: string, order: { id: string; sortOrder: number }[]): Promise<void> {
  const response = await fetch(`${API_BASE}/lookups/${type}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
  if (!response.ok) throw new Error('Failed to reorder lookups')
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

interface LookupFormData {
  type: string
  code: string
  displayName: string
  color: string
  icon: string
  sortOrder: number
  isActive: boolean
}

const defaultFieldFormData: FieldFormData = {
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

const defaultLookupFormData: LookupFormData = {
  type: '',
  code: '',
  displayName: '',
  color: '#6B7280',
  icon: '',
  sortOrder: 0,
  isActive: true,
}

export default function FieldSettingsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('fields')
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set(['tasks']))
  const [expandedLookupTypes, setExpandedLookupTypes] = useState<Set<string>>(new Set(['task_status', 'urgency']))

  // Field modal state
  const [isFieldModalOpen, setIsFieldModalOpen] = useState(false)
  const [editingField, setEditingField] = useState<FieldConfig | null>(null)
  const [fieldFormData, setFieldFormData] = useState<FieldFormData>(defaultFieldFormData)
  const [draggedField, setDraggedField] = useState<string | null>(null)
  const [dragOverField, setDragOverField] = useState<string | null>(null)

  // Lookup modal state
  const [isLookupModalOpen, setIsLookupModalOpen] = useState(false)
  const [editingLookup, setEditingLookup] = useState<LookupValue | null>(null)
  const [lookupFormData, setLookupFormData] = useState<LookupFormData>(defaultLookupFormData)
  const [draggedLookup, setDraggedLookup] = useState<string | null>(null)
  const [dragOverLookup, setDragOverLookup] = useState<string | null>(null)
  const [newLookupType, setNewLookupType] = useState('')

  // Queries
  const { data: configsData, isLoading: isLoadingFields } = useQuery({
    queryKey: ['field-configs'],
    queryFn: fetchFieldConfigs,
  })

  const { data: lookupTypesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: fetchLookupTypes,
  })

  const { data: lookupsData, isLoading: isLoadingLookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: fetchLookups,
  })

  // Field mutations
  const createFieldMutation = useMutation({
    mutationFn: createFieldConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
      closeFieldModal()
    },
  })

  const updateFieldMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FieldConfig> }) => updateFieldConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
      closeFieldModal()
    },
  })

  const deleteFieldMutation = useMutation({
    mutationFn: deleteFieldConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
    },
  })

  const reorderFieldMutation = useMutation({
    mutationFn: ({ collection, order }: { collection: string; order: { fieldPath: string; displayOrder: number }[] }) =>
      reorderFieldConfigs(collection, order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-configs'] })
    },
  })

  // Lookup mutations
  const createLookupMutation = useMutation({
    mutationFn: createLookup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] })
      queryClient.invalidateQueries({ queryKey: ['lookup-types'] })
      closeLookupModal()
    },
  })

  const updateLookupMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LookupValue> }) => updateLookup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] })
      closeLookupModal()
    },
  })

  const deleteLookupMutation = useMutation({
    mutationFn: deleteLookup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] })
    },
  })

  const reorderLookupMutation = useMutation({
    mutationFn: ({ type, order }: { type: string; order: { id: string; sortOrder: number }[] }) =>
      reorderLookups(type, order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups'] })
    },
  })

  const fieldConfigs = configsData?.data || {}
  const lookupTypes = lookupTypesData?.data || []
  const lookups = lookupsData?.data || {}
  const collections = Object.keys(fieldConfigs)
  const lookupTypeList = Object.keys(lookups)

  // Field handlers
  const toggleCollection = (collection: string) => {
    const newExpanded = new Set(expandedCollections)
    if (newExpanded.has(collection)) {
      newExpanded.delete(collection)
    } else {
      newExpanded.add(collection)
    }
    setExpandedCollections(newExpanded)
  }

  const openCreateFieldModal = (collection: string = 'tasks') => {
    setEditingField(null)
    setFieldFormData({ ...defaultFieldFormData, collectionName: collection })
    setIsFieldModalOpen(true)
  }

  const openEditFieldModal = (field: FieldConfig) => {
    setEditingField(field)
    setFieldFormData({
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
    setIsFieldModalOpen(true)
  }

  const closeFieldModal = () => {
    setIsFieldModalOpen(false)
    setEditingField(null)
    setFieldFormData(defaultFieldFormData)
  }

  const handleFieldSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      ...fieldFormData,
      width: fieldFormData.width || undefined,
      minWidth: fieldFormData.minWidth || undefined,
      lookupType: fieldFormData.lookupType || undefined,
      referenceCollection: fieldFormData.referenceCollection || undefined,
      referenceDisplayField: fieldFormData.referenceDisplayField || undefined,
      renderAs: fieldFormData.renderAs || undefined,
    }

    if (editingField) {
      updateFieldMutation.mutate({ id: editingField._id, data })
    } else {
      createFieldMutation.mutate(data)
    }
  }

  const handleDeleteField = (field: FieldConfig) => {
    if (confirm(`Are you sure you want to delete the "${field.displayName}" field configuration?`)) {
      deleteFieldMutation.mutate(field._id)
    }
  }

  const handleFieldDragStart = (e: React.DragEvent, fieldPath: string) => {
    setDraggedField(fieldPath)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleFieldDragOver = (e: React.DragEvent, fieldPath: string) => {
    e.preventDefault()
    if (draggedField && draggedField !== fieldPath) {
      setDragOverField(fieldPath)
    }
  }

  const handleFieldDragEnd = (collection: string) => {
    if (draggedField && dragOverField && draggedField !== dragOverField) {
      const fields = fieldConfigs[collection] || []
      const fieldOrder = fields.map(f => f.fieldPath)
      const draggedIndex = fieldOrder.indexOf(draggedField)
      const targetIndex = fieldOrder.indexOf(dragOverField)

      fieldOrder.splice(draggedIndex, 1)
      fieldOrder.splice(targetIndex, 0, draggedField)

      const order = fieldOrder.map((fp, index) => ({ fieldPath: fp, displayOrder: index + 1 }))
      reorderFieldMutation.mutate({ collection, order })
    }
    setDraggedField(null)
    setDragOverField(null)
  }

  const handleQuickToggle = (field: FieldConfig, property: keyof FieldConfig, value: boolean) => {
    updateFieldMutation.mutate({ id: field._id, data: { [property]: value } })
  }

  // Lookup handlers
  const toggleLookupType = (type: string) => {
    const newExpanded = new Set(expandedLookupTypes)
    if (newExpanded.has(type)) {
      newExpanded.delete(type)
    } else {
      newExpanded.add(type)
    }
    setExpandedLookupTypes(newExpanded)
  }

  const openCreateLookupModal = (type: string = '') => {
    setEditingLookup(null)
    const maxSortOrder = type && lookups[type]
      ? Math.max(0, ...lookups[type].map(l => l.sortOrder)) + 1
      : 1
    setLookupFormData({ ...defaultLookupFormData, type, sortOrder: maxSortOrder })
    setIsLookupModalOpen(true)
  }

  const openEditLookupModal = (lookup: LookupValue) => {
    setEditingLookup(lookup)
    setLookupFormData({
      type: lookup.type,
      code: lookup.code,
      displayName: lookup.displayName,
      color: lookup.color || '#6B7280',
      icon: lookup.icon || '',
      sortOrder: lookup.sortOrder,
      isActive: lookup.isActive,
    })
    setIsLookupModalOpen(true)
  }

  const closeLookupModal = () => {
    setIsLookupModalOpen(false)
    setEditingLookup(null)
    setLookupFormData(defaultLookupFormData)
    setNewLookupType('')
  }

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const type = newLookupType || lookupFormData.type
    const data = {
      ...lookupFormData,
      type,
      icon: lookupFormData.icon || undefined,
    }

    if (editingLookup) {
      updateLookupMutation.mutate({ id: editingLookup._id, data })
    } else {
      createLookupMutation.mutate(data)
    }
  }

  const handleDeleteLookup = (lookup: LookupValue) => {
    if (confirm(`Are you sure you want to deactivate "${lookup.displayName}"?`)) {
      deleteLookupMutation.mutate(lookup._id)
    }
  }

  const handleLookupDragStart = (e: React.DragEvent, lookupId: string) => {
    setDraggedLookup(lookupId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleLookupDragOver = (e: React.DragEvent, lookupId: string) => {
    e.preventDefault()
    if (draggedLookup && draggedLookup !== lookupId) {
      setDragOverLookup(lookupId)
    }
  }

  const handleLookupDragEnd = (type: string) => {
    if (draggedLookup && dragOverLookup && draggedLookup !== dragOverLookup) {
      const items = lookups[type] || []
      const itemIds = items.map(l => l._id)
      const draggedIndex = itemIds.indexOf(draggedLookup)
      const targetIndex = itemIds.indexOf(dragOverLookup)

      itemIds.splice(draggedIndex, 1)
      itemIds.splice(targetIndex, 0, draggedLookup)

      const order = itemIds.map((id, index) => ({ id, sortOrder: index + 1 }))
      reorderLookupMutation.mutate({ type, order })
    }
    setDraggedLookup(null)
    setDragOverLookup(null)
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

  const formatLookupTypeName = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Field & Lookup Configuration</h1>
          <p className="text-muted-foreground">
            Configure how fields are displayed and manage lookup values (statuses, urgency levels, etc.)
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="fields" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Fields
          </TabsTrigger>
          <TabsTrigger value="lookups" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Lookups (Statuses, etc.)
          </TabsTrigger>
        </TabsList>

        {/* Fields Tab */}
        <TabsContent value="fields" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openCreateFieldModal()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Field
            </Button>
          </div>

          {isLoadingFields ? (
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
                      <Badge variant="secondary">{fieldConfigs[collection]?.length || 0} fields</Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        openCreateFieldModal(collection)
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
                        <div className="col-span-1 text-center" title="Default Visible">
                          <Eye className="h-3 w-3 inline" />
                        </div>
                        <div className="col-span-1 text-center" title="Editable">
                          <Pencil className="h-3 w-3 inline" />
                        </div>
                        <div className="col-span-1 text-center" title="Searchable">
                          <Search className="h-3 w-3 inline" />
                        </div>
                        <div className="col-span-1 text-center" title="Sortable">
                          <SortAsc className="h-3 w-3 inline" />
                        </div>
                        <div className="col-span-1 text-center" title="Filterable">
                          <Filter className="h-3 w-3 inline" />
                        </div>
                        <div className="col-span-1"></div>
                      </div>
                      {(fieldConfigs[collection] || [])
                        .sort((a, b) => a.displayOrder - b.displayOrder)
                        .map((field) => (
                          <div
                            key={field._id}
                            draggable
                            onDragStart={(e) => handleFieldDragStart(e, field.fieldPath)}
                            onDragOver={(e) => handleFieldDragOver(e, field.fieldPath)}
                            onDragEnd={() => handleFieldDragEnd(collection)}
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
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditFieldModal(field)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive"
                                onClick={() => handleDeleteField(field)}
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
        </TabsContent>

        {/* Lookups Tab */}
        <TabsContent value="lookups" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openCreateLookupModal()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Lookup Value
            </Button>
          </div>

          {isLoadingLookups ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {lookupTypeList.map((type) => (
                <div key={type} className="rounded-lg border bg-card">
                  <button
                    className="flex w-full items-center justify-between p-4 text-left"
                    onClick={() => toggleLookupType(type)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedLookupTypes.has(type) ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                      <span className="font-semibold">{formatLookupTypeName(type)}</span>
                      <Badge variant="secondary">{lookups[type]?.length || 0} values</Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        openCreateLookupModal(type)
                      }}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add
                    </Button>
                  </button>

                  {expandedLookupTypes.has(type) && (
                    <div className="border-t">
                      <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/50">
                        <div className="col-span-1"></div>
                        <div className="col-span-2">Code</div>
                        <div className="col-span-3">Display Name</div>
                        <div className="col-span-2">Color</div>
                        <div className="col-span-1">Order</div>
                        <div className="col-span-1">Active</div>
                        <div className="col-span-2"></div>
                      </div>
                      {(lookups[type] || [])
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((lookup) => (
                          <div
                            key={lookup._id}
                            draggable
                            onDragStart={(e) => handleLookupDragStart(e, lookup._id)}
                            onDragOver={(e) => handleLookupDragOver(e, lookup._id)}
                            onDragEnd={() => handleLookupDragEnd(type)}
                            className={cn(
                              'grid grid-cols-12 gap-2 px-4 py-3 items-center border-t hover:bg-muted/30 cursor-grab',
                              draggedLookup === lookup._id && 'opacity-50',
                              dragOverLookup === lookup._id && 'bg-primary/10'
                            )}
                          >
                            <div className="col-span-1">
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="col-span-2 font-mono text-sm">{lookup.code}</div>
                            <div className="col-span-3 flex items-center gap-2">
                              <Badge style={{ backgroundColor: lookup.color, color: '#fff' }}>
                                {lookup.displayName}
                              </Badge>
                            </div>
                            <div className="col-span-2 flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded border"
                                style={{ backgroundColor: lookup.color }}
                              />
                              <span className="text-xs font-mono">{lookup.color}</span>
                            </div>
                            <div className="col-span-1 text-sm">{lookup.sortOrder}</div>
                            <div className="col-span-1">
                              <Checkbox checked={lookup.isActive} disabled />
                            </div>
                            <div className="col-span-2 flex justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditLookupModal(lookup)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive"
                                onClick={() => handleDeleteLookup(lookup)}
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
        </TabsContent>
      </Tabs>

      {/* Field Modal */}
      <Dialog open={isFieldModalOpen} onOpenChange={closeFieldModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingField ? 'Edit Field Configuration' : 'Add Field Configuration'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFieldSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Collection *</label>
                <Select
                  value={fieldFormData.collectionName}
                  onValueChange={(val) => setFieldFormData({ ...fieldFormData, collectionName: val })}
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
                  value={fieldFormData.fieldPath}
                  onChange={(e) => setFieldFormData({ ...fieldFormData, fieldPath: e.target.value })}
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
                  value={fieldFormData.displayName}
                  onChange={(e) => setFieldFormData({ ...fieldFormData, displayName: e.target.value })}
                  placeholder="e.g., My Field"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Field Type *</label>
                <Select
                  value={fieldFormData.fieldType}
                  onValueChange={(val) => setFieldFormData({ ...fieldFormData, fieldType: val })}
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

            {fieldFormData.fieldType === 'select' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Lookup Type</label>
                <Select
                  value={fieldFormData.lookupType}
                  onValueChange={(val) => setFieldFormData({ ...fieldFormData, lookupType: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select lookup type" />
                  </SelectTrigger>
                  <SelectContent>
                    {lookupTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {formatLookupTypeName(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {fieldFormData.fieldType === 'reference' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Reference Collection</label>
                  <Select
                    value={fieldFormData.referenceCollection}
                    onValueChange={(val) => setFieldFormData({ ...fieldFormData, referenceCollection: val })}
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
                    value={fieldFormData.referenceDisplayField}
                    onChange={(e) => setFieldFormData({ ...fieldFormData, referenceDisplayField: e.target.value })}
                    placeholder="e.g., displayName or title"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Width (px)</label>
                <Input
                  type="number"
                  value={fieldFormData.width}
                  onChange={(e) => setFieldFormData({ ...fieldFormData, width: parseInt(e.target.value) || 150 })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Render As</label>
                <Select
                  value={fieldFormData.renderAs}
                  onValueChange={(val) => setFieldFormData({ ...fieldFormData, renderAs: val })}
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
                  checked={fieldFormData.isRequired}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, isRequired: !!checked })}
                />
                <label htmlFor="isRequired" className="text-sm">Required</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isEditable"
                  checked={fieldFormData.isEditable}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, isEditable: !!checked })}
                />
                <label htmlFor="isEditable" className="text-sm">Editable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="defaultVisible"
                  checked={fieldFormData.defaultVisible}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, defaultVisible: !!checked })}
                />
                <label htmlFor="defaultVisible" className="text-sm">Visible by default</label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isSearchable"
                  checked={fieldFormData.isSearchable}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, isSearchable: !!checked })}
                />
                <label htmlFor="isSearchable" className="text-sm">Searchable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isSortable"
                  checked={fieldFormData.isSortable}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, isSortable: !!checked })}
                />
                <label htmlFor="isSortable" className="text-sm">Sortable</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isFilterable"
                  checked={fieldFormData.isFilterable}
                  onCheckedChange={(checked) => setFieldFormData({ ...fieldFormData, isFilterable: !!checked })}
                />
                <label htmlFor="isFilterable" className="text-sm">Filterable</label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeFieldModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createFieldMutation.isPending || updateFieldMutation.isPending}>
                {createFieldMutation.isPending || updateFieldMutation.isPending
                  ? 'Saving...'
                  : editingField
                  ? 'Update Field'
                  : 'Create Field'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Lookup Modal */}
      <Dialog open={isLookupModalOpen} onOpenChange={closeLookupModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLookup ? 'Edit Lookup Value' : 'Add Lookup Value'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLookupSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type *</label>
              {editingLookup ? (
                <Input value={lookupFormData.type} disabled />
              ) : lookupFormData.type ? (
                <Input value={formatLookupTypeName(lookupFormData.type)} disabled />
              ) : (
                <div className="space-y-2">
                  <Select
                    value={newLookupType || lookupFormData.type}
                    onValueChange={(val) => {
                      if (val === '__new__') {
                        setNewLookupType('')
                        setLookupFormData({ ...lookupFormData, type: '' })
                      } else {
                        setNewLookupType('')
                        setLookupFormData({ ...lookupFormData, type: val })
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select or create type" />
                    </SelectTrigger>
                    <SelectContent>
                      {lookupTypeList.map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatLookupTypeName(type)}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Create new type...</SelectItem>
                    </SelectContent>
                  </Select>
                  {(!lookupFormData.type || newLookupType !== '') && (
                    <Input
                      value={newLookupType}
                      onChange={(e) => setNewLookupType(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                      placeholder="new_type_name"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Code *</label>
                <Input
                  value={lookupFormData.code}
                  onChange={(e) => setLookupFormData({ ...lookupFormData, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  placeholder="e.g., pending"
                  disabled={!!editingLookup}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name *</label>
                <Input
                  value={lookupFormData.displayName}
                  onChange={(e) => setLookupFormData({ ...lookupFormData, displayName: e.target.value })}
                  placeholder="e.g., Pending"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={lookupFormData.color}
                  onChange={(e) => setLookupFormData({ ...lookupFormData, color: e.target.value })}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
                <Input
                  value={lookupFormData.color}
                  onChange={(e) => setLookupFormData({ ...lookupFormData, color: e.target.value })}
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
                      lookupFormData.color === color ? 'border-primary scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setLookupFormData({ ...lookupFormData, color })}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Preview</label>
              <div className="p-4 bg-muted rounded-lg">
                <Badge style={{ backgroundColor: lookupFormData.color, color: '#fff' }}>
                  {lookupFormData.displayName || 'Preview'}
                </Badge>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeLookupModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createLookupMutation.isPending || updateLookupMutation.isPending}>
                {createLookupMutation.isPending || updateLookupMutation.isPending
                  ? 'Saving...'
                  : editingLookup
                  ? 'Update'
                  : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
