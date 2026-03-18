'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Code, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type SchemaField,
  jsonSchemaToFields,
  validateInputValues,
} from './schema-utils'

interface WorkflowInputFormProps {
  inputSchema?: Record<string, unknown>
  samplePayload?: string
  value: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  errors?: Record<string, string>
  disabled?: boolean
}

export function WorkflowInputForm({
  inputSchema,
  samplePayload,
  value,
  onChange,
  errors: externalErrors,
  disabled,
}: WorkflowInputFormProps) {
  const fields = useMemo(() => {
    if (!inputSchema || !inputSchema.properties) return []
    return jsonSchemaToFields(inputSchema)
  }, [inputSchema])

  const hasSchema = fields.length > 0
  const [mode, setMode] = useState<'form' | 'json'>(hasSchema ? 'form' : 'json')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [internalErrors, setInternalErrors] = useState<Record<string, string>>({})

  const errors = externalErrors || internalErrors

  // Sync value -> jsonText when switching to JSON mode or when value changes externally
  useEffect(() => {
    if (mode === 'json') {
      setJsonText(Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '')
    }
  }, [mode, value])

  // Pre-populate from samplePayload on mount if value is empty
  useEffect(() => {
    if (Object.keys(value).length > 0) return
    if (!samplePayload) return
    try {
      const parsed = JSON.parse(samplePayload)
      if (typeof parsed === 'object' && parsed !== null) {
        onChange(parsed)
      }
    } catch {
      // Invalid samplePayload, ignore
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFieldChange = (fieldName: string, fieldType: string, rawValue: string | boolean) => {
    const updated = { ...value }

    if (fieldType === 'boolean') {
      updated[fieldName] = rawValue as boolean
    } else if (fieldType === 'number') {
      if (rawValue === '') {
        delete updated[fieldName]
      } else {
        const num = parseFloat(rawValue as string)
        updated[fieldName] = isNaN(num) ? rawValue : num
      }
    } else if (fieldType === 'integer') {
      if (rawValue === '') {
        delete updated[fieldName]
      } else {
        const num = parseInt(rawValue as string, 10)
        updated[fieldName] = isNaN(num) ? rawValue : num
      }
    } else if (fieldType === 'array') {
      if (rawValue === '') {
        delete updated[fieldName]
      } else {
        updated[fieldName] = (rawValue as string).split(',').map(v => v.trim()).filter(Boolean)
      }
    } else {
      // string or object-as-string
      if (rawValue === '') {
        delete updated[fieldName]
      } else {
        updated[fieldName] = rawValue
      }
    }

    // Clear error for this field on change
    if (errors[fieldName]) {
      const newErrors = { ...errors }
      delete newErrors[fieldName]
      setInternalErrors(newErrors)
    }

    onChange(updated)
  }

  const handleObjectFieldChange = (fieldName: string, rawValue: string) => {
    const updated = { ...value }
    if (!rawValue.trim()) {
      delete updated[fieldName]
    } else {
      try {
        updated[fieldName] = JSON.parse(rawValue)
        // Clear error on valid parse
        if (errors[fieldName]) {
          const newErrors = { ...errors }
          delete newErrors[fieldName]
          setInternalErrors(newErrors)
        }
      } catch {
        // Store raw string temporarily; validation will catch it
        updated[fieldName] = rawValue
        setInternalErrors(prev => ({ ...prev, [fieldName]: 'Invalid JSON' }))
      }
    }
    onChange(updated)
  }

  const handleJsonChange = (text: string) => {
    setJsonText(text)
    if (!text.trim()) {
      setJsonError('')
      onChange({})
      return
    }
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setJsonError('')
        onChange(parsed)
      } else {
        setJsonError('Must be a JSON object')
      }
    } catch (e) {
      setJsonError((e as Error).message)
    }
  }

  const getFieldValue = (field: SchemaField): string => {
    const val = value[field.name]
    if (val === undefined || val === null) return ''
    if (field.type === 'array' && Array.isArray(val)) return val.join(', ')
    if (field.type === 'object' && typeof val === 'object') return JSON.stringify(val, null, 2)
    return String(val)
  }

  // If no schema, just show JSON textarea
  if (!hasSchema) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">Input Payload (JSON)</label>
        <Textarea
          value={jsonText || (Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '')}
          onChange={(e) => handleJsonChange(e.target.value)}
          placeholder='{"key": "value"}'
          className="font-mono text-sm"
          rows={4}
          disabled={disabled}
        />
        {jsonError && (
          <p className="text-xs text-red-600 dark:text-red-400">{jsonError}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Custom data that flows through the workflow steps.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Input Data</h4>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={mode === 'form' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setMode('form')}
          >
            <List className="h-3 w-3" />
            Form
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
        </div>
      </div>

      {mode === 'json' ? (
        <div className="space-y-1">
          <Textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder='{"key": "value"}'
            className="font-mono text-sm"
            rows={6}
            disabled={disabled}
          />
          {jsonError && (
            <p className="text-xs text-red-600 dark:text-red-400">Invalid JSON: {jsonError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => {
            const enumOptions = field.enumValues
              ? field.enumValues.split(',').map(v => v.trim()).filter(Boolean)
              : []

            return (
              <div key={field.id} className="space-y-1">
                <label className="text-sm font-medium">
                  {field.name}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}

                {/* String with enum -> Select */}
                {field.type === 'string' && enumOptions.length > 0 ? (
                  <Select
                    value={(value[field.name] as string) || ''}
                    onValueChange={(v) => handleFieldChange(field.name, field.type, v === '__empty__' ? '' : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={`Select ${field.name}...`} />
                    </SelectTrigger>
                    <SelectContent>
                      {!field.required && (
                        <SelectItem value="__empty__">
                          <span className="text-muted-foreground">None</span>
                        </SelectItem>
                      )}
                      {enumOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'boolean' ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Checkbox
                      id={`input-${field.id}`}
                      checked={!!value[field.name]}
                      onCheckedChange={(checked) => handleFieldChange(field.name, field.type, !!checked)}
                      disabled={disabled}
                    />
                    <label htmlFor={`input-${field.id}`} className="text-sm cursor-pointer">
                      {value[field.name] ? 'Yes' : 'No'}
                    </label>
                  </div>
                ) : field.type === 'object' ? (
                  <Textarea
                    value={getFieldValue(field)}
                    onChange={(e) => handleObjectFieldChange(field.name, e.target.value)}
                    placeholder='{}'
                    className="mt-1 font-mono text-sm"
                    rows={3}
                    disabled={disabled}
                  />
                ) : field.type === 'number' || field.type === 'integer' ? (
                  <Input
                    type="number"
                    step={field.type === 'integer' ? '1' : 'any'}
                    value={getFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.name, field.type, e.target.value)}
                    placeholder={`Enter ${field.name}...`}
                    className="mt-1"
                    disabled={disabled}
                  />
                ) : field.type === 'array' ? (
                  <>
                    <Input
                      value={getFieldValue(field)}
                      onChange={(e) => handleFieldChange(field.name, field.type, e.target.value)}
                      placeholder="value1, value2, value3"
                      className="mt-1"
                      disabled={disabled}
                    />
                    <p className="text-[10px] text-muted-foreground">Comma-separated values</p>
                  </>
                ) : (
                  /* Default: string input */
                  <Input
                    value={getFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.name, field.type, e.target.value)}
                    placeholder={`Enter ${field.name}...`}
                    className="mt-1"
                    disabled={disabled}
                  />
                )}

                {errors[field.name] && (
                  <p className="text-xs text-red-600 dark:text-red-400">{errors[field.name]}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Hook to manage workflow input form state.
 * Returns [values, setValues, validate, reset] tuple.
 */
export function useWorkflowInputForm(inputSchema?: Record<string, unknown>) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fields = useMemo(() => {
    if (!inputSchema || !inputSchema.properties) return []
    return jsonSchemaToFields(inputSchema)
  }, [inputSchema])

  const validate = (): boolean => {
    if (fields.length === 0) return true
    const validationErrors = validateInputValues(values, fields)
    setErrors(validationErrors)
    return Object.keys(validationErrors).length === 0
  }

  const reset = () => {
    setValues({})
    setErrors({})
  }

  return { values, setValues, errors, setErrors, validate, reset } as const
}
