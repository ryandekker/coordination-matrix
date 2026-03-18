// Shared schema types and utilities for workflow input handling
// Used by InputSchemaBuilder (editor), WorkflowInputForm (run dialog), and WorkflowInputDisplay (run detail)

export interface SchemaField {
  id: string
  name: string
  type: string
  description: string
  required: boolean
  enumValues: string  // comma-separated for simple editing
}

export const FIELD_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
  { value: 'object', label: 'Object' },
] as const

let fieldCounter = 0
export function nextFieldId(): string {
  return `field-${++fieldCounter}-${Date.now()}`
}

export function fieldsToJsonSchema(fields: SchemaField[]): Record<string, unknown> | null {
  if (fields.length === 0) return null

  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const field of fields) {
    if (!field.name.trim()) continue
    const prop: Record<string, unknown> = { type: field.type }
    if (field.description.trim()) {
      prop.description = field.description.trim()
    }
    if (field.enumValues.trim() && field.type === 'string') {
      const values = field.enumValues.split(',').map(v => v.trim()).filter(Boolean)
      if (values.length > 0) {
        prop.enum = values
      }
    }
    if (field.type === 'array') {
      prop.items = { type: 'string' }
    }
    properties[field.name.trim()] = prop
    if (field.required) {
      required.push(field.name.trim())
    }
  }

  if (Object.keys(properties).length === 0) return null

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  }
  if (required.length > 0) {
    schema.required = required
  }
  return schema
}

export function jsonSchemaToFields(schema: Record<string, unknown>): SchemaField[] {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties) return []

  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : []
  )

  return Object.entries(properties).map(([name, prop]) => ({
    id: nextFieldId(),
    name,
    type: (prop.type as string) || 'string',
    description: (prop.description as string) || '',
    required: required.has(name),
    enumValues: Array.isArray(prop.enum) ? prop.enum.join(', ') : '',
  }))
}

/**
 * Validate input values against schema fields.
 * Returns a map of fieldName -> error message for invalid fields.
 */
export function validateInputValues(
  values: Record<string, unknown>,
  fields: SchemaField[]
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const value = values[field.name]

    // Required check
    if (field.required) {
      if (value === undefined || value === null || value === '') {
        errors[field.name] = 'This field is required'
        continue
      }
    }

    // Skip further validation if empty and not required
    if (value === undefined || value === null || value === '') continue

    // Type-specific validation
    if (field.type === 'number' || field.type === 'integer') {
      const num = Number(value)
      if (isNaN(num)) {
        errors[field.name] = `Must be a valid ${field.type}`
      } else if (field.type === 'integer' && !Number.isInteger(num)) {
        errors[field.name] = 'Must be a whole number'
      }
    }
  }

  return errors
}
