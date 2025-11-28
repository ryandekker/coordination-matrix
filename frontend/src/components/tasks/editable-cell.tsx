'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldConfig, LookupValue } from '@/lib/api'
import { cn } from '@/lib/utils'

interface EditableCellProps {
  value: unknown
  fieldConfig: FieldConfig
  lookups: Record<string, LookupValue[]>
  onSave: (value: unknown) => void
  children: ReactNode
}

export function EditableCell({
  value,
  fieldConfig,
  lookups,
  onSave,
  children,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState<unknown>(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSave = () => {
    onSave(editValue)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditValue(value)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (!isEditing) {
    return (
      <div
        className="editable-cell cursor-pointer"
        onClick={() => setIsEditing(true)}
        onKeyDown={(e) => e.key === 'Enter' && setIsEditing(true)}
        tabIndex={0}
        role="button"
      >
        {children}
      </div>
    )
  }

  // Render different editors based on field type
  switch (fieldConfig.fieldType) {
    case 'select':
      const options = fieldConfig.lookupType
        ? lookups[fieldConfig.lookupType] || []
        : fieldConfig.options || []

      return (
        <div className="flex items-center gap-1">
          <Select
            value={editValue as string}
            onValueChange={(val) => {
              setEditValue(val)
              onSave(val)
              setIsEditing(false)
            }}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.code || (opt as { value: string }).value} value={opt.code || (opt as { value: string }).value}>
                  {opt.displayName || (opt as { label: string }).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={editValue as boolean}
            onCheckedChange={(checked) => {
              setEditValue(checked)
              onSave(checked)
              setIsEditing(false)
            }}
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )

    case 'number':
      return (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            type="number"
            value={editValue as number}
            onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleSave}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )

    case 'datetime':
    case 'date':
      return (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            type={fieldConfig.fieldType === 'datetime' ? 'datetime-local' : 'date'}
            value={
              editValue
                ? new Date(editValue as string).toISOString().slice(0, fieldConfig.fieldType === 'datetime' ? 16 : 10)
                : ''
            }
            onChange={(e) => setEditValue(e.target.value ? new Date(e.target.value).toISOString() : null)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleSave}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )

    case 'tags':
      return (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={Array.isArray(editValue) ? (editValue as string[]).join(', ') : ''}
            onChange={(e) =>
              setEditValue(
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            onKeyDown={handleKeyDown}
            placeholder="tag1, tag2, tag3"
            className="h-8"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleSave}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )

    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          <textarea
            ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
            value={editValue as string}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancel()
            }}
            className={cn(
              'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'ring-offset-background placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          />
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={handleSave}>
              <Check className="mr-1 h-4 w-4" />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      )

    case 'text':
    default:
      return (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={editValue as string}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleSave}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )
  }
}
