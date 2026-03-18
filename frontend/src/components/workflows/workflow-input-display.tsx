'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Copy, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { jsonSchemaToFields } from './schema-utils'

interface WorkflowInputDisplayProps {
  inputPayload: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  className?: string
}

function formatValue(value: unknown, type?: string): React.ReactNode {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground italic">not set</span>
  }
  if (typeof value === 'boolean') {
    return (
      <Badge variant="outline" className="text-xs font-normal">
        {value ? 'Yes' : 'No'}
      </Badge>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground italic">empty list</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} variant="secondary" className="text-xs font-normal">
            {String(item)}
          </Badge>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    return (
      <pre className="text-xs bg-muted rounded px-2 py-1 overflow-auto max-h-32 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }
  // String or number
  return <span className="text-sm">{String(value)}</span>
}

export function WorkflowInputDisplay({
  inputPayload,
  inputSchema,
  className,
}: WorkflowInputDisplayProps) {
  const fields = useMemo(() => {
    if (!inputSchema || !inputSchema.properties) return []
    return jsonSchemaToFields(inputSchema)
  }, [inputSchema])

  const hasSchema = fields.length > 0
  const schemaFieldNames = useMemo(() => new Set(fields.map(f => f.name)), [fields])
  const extraKeys = useMemo(
    () => Object.keys(inputPayload).filter(k => !schemaFieldNames.has(k)),
    [inputPayload, schemaFieldNames]
  )

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(inputPayload, null, 2))
  }

  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Input Data
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleCopy}
        >
          <Copy className="h-3 w-3 mr-1" />
          Copy JSON
        </Button>
      </div>

      {hasSchema ? (
        <div className="space-y-0">
          {/* Schema-aware field display */}
          <div className="divide-y rounded-md border overflow-hidden">
            {fields.map((field) => {
              const val = inputPayload[field.name]
              return (
                <div key={field.id} className="grid grid-cols-3 gap-2 px-3 py-2 bg-background">
                  <div className="col-span-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {field.name}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </p>
                    {field.description && (
                      <p className="text-[10px] text-muted-foreground/70">{field.description}</p>
                    )}
                  </div>
                  <div className="col-span-2 flex items-start">
                    {formatValue(val, field.type)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Extra keys not in schema */}
          {extraKeys.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1.5">Additional data</p>
              <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 font-mono">
                {JSON.stringify(
                  Object.fromEntries(extraKeys.map(k => [k, inputPayload[k]])),
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      ) : (
        /* No schema - raw JSON display */
        <pre className="text-sm bg-muted rounded p-3 overflow-auto max-h-48 font-mono">
          {JSON.stringify(inputPayload, null, 2)}
        </pre>
      )}
    </div>
  )
}
