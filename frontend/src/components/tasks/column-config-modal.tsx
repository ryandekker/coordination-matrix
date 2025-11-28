'use client'

import { useState, useEffect } from 'react'
import { GripVertical, Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldConfig } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ColumnConfigModalProps {
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  visibleColumns: string[]
  onClose: () => void
  onSave: (columns: string[]) => void
}

export function ColumnConfigModal({
  isOpen,
  fieldConfigs,
  visibleColumns,
  onClose,
  onSave,
}: ColumnConfigModalProps) {
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(visibleColumns))
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [draggedItem, setDraggedItem] = useState<string | null>(null)

  useEffect(() => {
    setSelectedColumns(new Set(visibleColumns))
    // Initialize column order with visible columns first, then rest
    const visible = fieldConfigs
      .filter((fc) => visibleColumns.includes(fc.fieldPath))
      .sort((a, b) => visibleColumns.indexOf(a.fieldPath) - visibleColumns.indexOf(b.fieldPath))
      .map((fc) => fc.fieldPath)
    const hidden = fieldConfigs
      .filter((fc) => !visibleColumns.includes(fc.fieldPath))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((fc) => fc.fieldPath)
    setColumnOrder([...visible, ...hidden])
  }, [visibleColumns, fieldConfigs])

  const toggleColumn = (fieldPath: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(fieldPath)) {
      newSelected.delete(fieldPath)
    } else {
      newSelected.add(fieldPath)
    }
    setSelectedColumns(newSelected)
  }

  const handleDragStart = (e: React.DragEvent, fieldPath: string) => {
    setDraggedItem(fieldPath)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, fieldPath: string) => {
    e.preventDefault()
    if (draggedItem === null || draggedItem === fieldPath) return

    const newOrder = [...columnOrder]
    const draggedIndex = newOrder.indexOf(draggedItem)
    const targetIndex = newOrder.indexOf(fieldPath)

    newOrder.splice(draggedIndex, 1)
    newOrder.splice(targetIndex, 0, draggedItem)
    setColumnOrder(newOrder)
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
  }

  const handleSave = () => {
    // Return columns in order, but only selected ones
    const orderedSelected = columnOrder.filter((col) => selectedColumns.has(col))
    onSave(orderedSelected)
  }

  const handleSelectAll = () => {
    setSelectedColumns(new Set(fieldConfigs.map((fc) => fc.fieldPath)))
  }

  const handleSelectNone = () => {
    // Keep at least title visible
    setSelectedColumns(new Set(['title']))
  }

  const handleReset = () => {
    setSelectedColumns(
      new Set(fieldConfigs.filter((fc) => fc.defaultVisible).map((fc) => fc.fieldPath))
    )
    setColumnOrder(
      fieldConfigs.sort((a, b) => a.displayOrder - b.displayOrder).map((fc) => fc.fieldPath)
    )
  }

  const fieldConfigMap = new Map(fieldConfigs.map((fc) => [fc.fieldPath, fc]))

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure Columns</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={handleSelectNone}>
              Select None
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset
            </Button>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-md border">
            {columnOrder.map((fieldPath) => {
              const config = fieldConfigMap.get(fieldPath)
              if (!config) return null

              const isSelected = selectedColumns.has(fieldPath)
              const isTitle = fieldPath === 'title'

              return (
                <div
                  key={fieldPath}
                  draggable
                  onDragStart={(e) => handleDragStart(e, fieldPath)}
                  onDragOver={(e) => handleDragOver(e, fieldPath)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-center gap-3 border-b p-3 last:border-b-0',
                    draggedItem === fieldPath && 'opacity-50 bg-muted',
                    'cursor-grab hover:bg-muted/50'
                  )}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Checkbox
                    checked={isSelected}
                    disabled={isTitle}
                    onCheckedChange={() => toggleColumn(fieldPath)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{config.displayName}</p>
                    <p className="text-xs text-muted-foreground">{config.fieldPath}</p>
                  </div>
                  {isSelected ? (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Drag to reorder columns. Selected columns will be visible in the table.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Apply Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
