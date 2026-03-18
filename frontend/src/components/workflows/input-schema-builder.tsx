'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2, Code, List, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TemplateTextarea } from '@/components/ui/template-textarea'
import {
  type SchemaField,
  FIELD_TYPES,
  nextFieldId,
  fieldsToJsonSchema,
  jsonSchemaToFields,
} from './schema-utils'

interface InputSchemaBuilderProps {
  value: string           // JSON string of the schema
  onChange: (value: string) => void
}

export function InputSchemaBuilder({ value, onChange }: InputSchemaBuilderProps) {
  const [mode, setMode] = useState<'builder' | 'json'>('builder')
  const [fields, setFields] = useState<SchemaField[]>([])
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())
  const suppressSync = useRef(false)

  // Load fields from JSON value on mount or when JSON changes externally
  useEffect(() => {
    if (suppressSync.current) {
      suppressSync.current = false
      return
    }
    if (!value.trim()) {
      setFields([])
      return
    }
    try {
      const parsed = JSON.parse(value)
      if (parsed.properties) {
        setFields(jsonSchemaToFields(parsed))
      }
    } catch {
      // Invalid JSON — don't update builder, user can fix in JSON mode
    }
  }, [value])

  // Sync fields back to JSON
  const syncToJson = useCallback((updatedFields: SchemaField[]) => {
    const schema = fieldsToJsonSchema(updatedFields)
    suppressSync.current = true
    onChange(schema ? JSON.stringify(schema, null, 2) : '')
  }, [onChange])

  const addField = () => {
    const newField: SchemaField = {
      id: nextFieldId(),
      name: '',
      type: 'string',
      description: '',
      required: false,
      enumValues: '',
    }
    const updated = [...fields, newField]
    setFields(updated)
    setExpandedFields(prev => {
      const next = new Set(Array.from(prev))
      next.add(newField.id)
      return next
    })
  }

  const removeField = (id: string) => {
    const updated = fields.filter(f => f.id !== id)
    setFields(updated)
    setExpandedFields(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    syncToJson(updated)
  }

  const updateField = (id: string, updates: Partial<SchemaField>) => {
    const updated = fields.map(f => f.id === id ? { ...f, ...updates } : f)
    setFields(updated)
    // Only sync if the field has a name (avoid generating schema with empty keys)
    const field = updated.find(f => f.id === id)
    if (field?.name.trim()) {
      syncToJson(updated)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleJsonChange = (newValue: string) => {
    onChange(newValue)
  }

  // Validate JSON for display
  let jsonValid = true
  let jsonError = ''
  if (value.trim()) {
    try {
      JSON.parse(value)
    } catch (e) {
      jsonValid = false
      jsonError = (e as Error).message
    }
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={mode === 'builder' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => setMode('builder')}
        >
          <List className="h-3 w-3" />
          Builder
        </Button>
        <Button
          type="button"
          variant={mode === 'json' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => setMode('json')}
        >
          <Code className="h-3 w-3" />
          JSON
        </Button>
        {fields.length > 0 && mode === 'builder' && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {fields.filter(f => f.name.trim()).length} field{fields.filter(f => f.name.trim()).length !== 1 ? 's' : ''}
            {fields.some(f => f.required) && `, ${fields.filter(f => f.required && f.name.trim()).length} required`}
          </span>
        )}
      </div>

      {mode === 'json' ? (
        /* JSON editor mode */
        <div className="space-y-1">
          <TemplateTextarea
            value={value}
            onChange={handleJsonChange}
            placeholder={'{\n  "type": "object",\n  "properties": {\n    "email": { "type": "string", "description": "User email" },\n    "priority": { "type": "string", "enum": ["low", "medium", "high"] }\n  },\n  "required": ["email"]\n}'}
            minHeight="120px"
            maxHeight="300px"
            showTokenBrowser={false}
          />
          {value.trim() && (
            <p className={cn('text-xs', jsonValid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
              {jsonValid ? 'Valid JSON' : `Invalid JSON: ${jsonError}`}
            </p>
          )}
        </div>
      ) : (
        /* Visual builder mode */
        <div className="space-y-1.5">
          {fields.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              No fields defined. Add fields to define what input this workflow expects.
            </p>
          )}

          {fields.map((field) => {
            const isExpanded = expandedFields.has(field.id)
            return (
              <div
                key={field.id}
                className="border rounded-md bg-background"
              >
                {/* Compact row */}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground p-0.5"
                    onClick={() => toggleExpanded(field.id)}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3 w-3" />
                      : <ChevronRight className="h-3 w-3" />
                    }
                  </button>

                  <Input
                    value={field.name}
                    onChange={(e) => updateField(field.id, { name: e.target.value })}
                    placeholder="fieldName"
                    className="h-6 text-xs px-1.5 font-mono flex-1 min-w-0"
                    onBlur={() => {
                      if (field.name.trim()) syncToJson(fields)
                    }}
                  />

                  <Select
                    value={field.type}
                    onValueChange={(val) => updateField(field.id, { type: val })}
                  >
                    <SelectTrigger className="h-6 text-xs w-[90px] px-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-1">
                    <Checkbox
                      id={`req-${field.id}`}
                      checked={field.required}
                      onCheckedChange={(checked) => updateField(field.id, { required: !!checked })}
                      className="h-3.5 w-3.5"
                    />
                    <label
                      htmlFor={`req-${field.id}`}
                      className={cn(
                        'text-[10px] cursor-pointer',
                        field.required ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'
                      )}
                    >
                      req
                    </label>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => removeField(field.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-2 pb-2 pt-0.5 border-t space-y-1.5">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Description</label>
                      <Input
                        value={field.description}
                        onChange={(e) => updateField(field.id, { description: e.target.value })}
                        placeholder="What this field is for..."
                        className="h-6 text-xs px-1.5"
                        onBlur={() => syncToJson(fields)}
                      />
                    </div>
                    {field.type === 'string' && (
                      <div>
                        <label className="text-[10px] text-muted-foreground">
                          Allowed values <span className="opacity-60">(comma-separated, leave empty for any)</span>
                        </label>
                        <Input
                          value={field.enumValues}
                          onChange={(e) => updateField(field.id, { enumValues: e.target.value })}
                          placeholder="low, medium, high"
                          className="h-6 text-xs px-1.5 font-mono"
                          onBlur={() => syncToJson(fields)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 w-full"
            onClick={addField}
          >
            <Plus className="h-3 w-3" />
            Add Field
          </Button>
        </div>
      )}
    </div>
  )
}
