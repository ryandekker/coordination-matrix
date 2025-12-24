'use client'

import * as React from 'react'
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface JsonViewerProps {
  data: unknown
  className?: string
  defaultExpanded?: boolean
  maxInitialDepth?: number
}

interface JsonNodeProps {
  keyName?: string
  value: unknown
  depth: number
  defaultExpanded: boolean
  maxInitialDepth: number
  isLast?: boolean
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    const success = await copyToClipboard(text)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-1 p-0.5 rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Copy value"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  )
}

// Threshold for truncating long strings
const STRING_TRUNCATE_THRESHOLD = 200

function ExpandableString({ value, className }: { value: string; className?: string }) {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const shouldTruncate = value.length > STRING_TRUNCATE_THRESHOLD

  const displayValue = shouldTruncate && !isExpanded
    ? value.substring(0, STRING_TRUNCATE_THRESHOLD) + '...'
    : value

  if (!shouldTruncate) {
    return (
      <span className={cn("text-green-700 dark:text-green-400", className)}>
        &quot;{value}&quot;
      </span>
    )
  }

  return (
    <span className={cn("text-green-700 dark:text-green-400", className)}>
      &quot;
      <span
        className={cn(
          "cursor-pointer hover:bg-green-500/10 rounded transition-colors",
          isExpanded && "whitespace-pre-wrap break-all"
        )}
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        title={isExpanded ? 'Click to collapse' : 'Click to expand full text'}
      >
        {displayValue}
      </span>
      &quot;
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        className="ml-1 text-[10px] text-primary hover:underline"
      >
        {isExpanded ? 'less' : `+${value.length - STRING_TRUNCATE_THRESHOLD} chars`}
      </button>
    </span>
  )
}

function JsonNode({ keyName, value, depth, defaultExpanded, maxInitialDepth, isLast = true }: JsonNodeProps) {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  const isArray = Array.isArray(value)
  const isExpandable = isObject || isArray

  // Start collapsed if beyond maxInitialDepth
  const [isExpanded, setIsExpanded] = React.useState(
    defaultExpanded && depth < maxInitialDepth
  )

  const renderPrimitive = (val: unknown) => {
    if (val === null) {
      return <span className="text-orange-500 dark:text-orange-400">null</span>
    }
    if (val === undefined) {
      return <span className="text-orange-500 dark:text-orange-400">undefined</span>
    }
    if (typeof val === 'boolean') {
      return <span className="text-purple-600 dark:text-purple-400">{val.toString()}</span>
    }
    if (typeof val === 'number') {
      return <span className="text-blue-600 dark:text-blue-400">{val}</span>
    }
    if (typeof val === 'string') {
      return <ExpandableString value={val} />
    }
    return <span>{String(val)}</span>
  }

  const getPreview = () => {
    if (isArray) {
      const arr = value as unknown[]
      if (arr.length === 0) return '[]'
      return `[${arr.length} item${arr.length !== 1 ? 's' : ''}]`
    }
    if (isObject) {
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
      if (keys.length === 0) return '{}'
      return `{${keys.length} key${keys.length !== 1 ? 's' : ''}}`
    }
    return ''
  }

  const indent = depth * 12

  if (!isExpandable) {
    return (
      <div
        className="group flex items-center py-0.5 hover:bg-muted/50 rounded px-1 -mx-1"
        style={{ paddingLeft: indent }}
      >
        {keyName !== undefined && (
          <span className="text-cyan-700 dark:text-cyan-400 mr-1">
            {keyName}:
          </span>
        )}
        {renderPrimitive(value)}
        <CopyButton value={value} />
      </div>
    )
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i.toString(), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)

  return (
    <div>
      <div
        className="group flex items-center py-0.5 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 select-none"
        style={{ paddingLeft: indent }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="w-4 h-4 flex items-center justify-center mr-0.5 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        {keyName !== undefined && (
          <span className="text-cyan-700 dark:text-cyan-400 mr-1">
            {keyName}:
          </span>
        )}
        <span className="text-muted-foreground text-[11px]">
          {getPreview()}
        </span>
        <CopyButton value={value} />
      </div>

      {isExpanded && (
        <div>
          {entries.map(([key, val], index) => (
            <JsonNode
              key={key}
              keyName={isArray ? `[${key}]` : key}
              value={val}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
              maxInitialDepth={maxInitialDepth}
              isLast={index === entries.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function JsonViewer({
  data,
  className,
  defaultExpanded = true,
  maxInitialDepth = 2
}: JsonViewerProps) {
  if (data === null || data === undefined) {
    return (
      <div className={cn('font-mono text-xs', className)}>
        <span className="text-muted-foreground italic">No data</span>
      </div>
    )
  }

  const isObject = typeof data === 'object' && !Array.isArray(data)
  const isArray = Array.isArray(data)

  // For primitive values at root level
  if (!isObject && !isArray) {
    return (
      <div className={cn('font-mono text-xs', className)}>
        <JsonNode
          value={data}
          depth={0}
          defaultExpanded={defaultExpanded}
          maxInitialDepth={maxInitialDepth}
        />
      </div>
    )
  }

  const entries = isArray
    ? (data as unknown[]).map((v, i) => [i.toString(), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)

  return (
    <div className={cn('font-mono text-xs', className)}>
      {entries.map(([key, value], index) => (
        <JsonNode
          key={key}
          keyName={isArray ? `[${key}]` : key}
          value={value}
          depth={0}
          defaultExpanded={defaultExpanded}
          maxInitialDepth={maxInitialDepth}
          isLast={index === entries.length - 1}
        />
      ))}
    </div>
  )
}
