'use client'

import * as React from 'react'
import { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { cn } from '@/lib/utils'

interface TemplateEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
  maxHeight?: string
  disabled?: boolean
  onSelect?: () => void
  onClick?: () => void
  onKeyUp?: () => void
}

export interface TemplateEditorRef {
  focus: () => void
  selectionStart: number | null
  setSelectionRange: (start: number, end: number) => void
}

/**
 * TemplateEditor - A text editor with syntax highlighting for template tokens
 *
 * Highlights {{...}} tokens with a distinctive style while allowing full editing.
 * Uses a layered approach with a transparent textarea over a highlighted div.
 */
export const TemplateEditor = forwardRef<TemplateEditorRef, TemplateEditorProps>(function TemplateEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '80px',
  maxHeight = '200px',
  disabled = false,
  onSelect,
  onClick,
  onKeyUp,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    get selectionStart() {
      return textareaRef.current?.selectionStart ?? null
    },
    setSelectionRange: (start: number, end: number) => {
      textareaRef.current?.setSelectionRange(start, end)
    },
  }))

  // Sync scroll position between textarea and highlight div
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop)
      setScrollLeft(textareaRef.current.scrollLeft)
    }
  }, [])

  // Apply scroll position to highlight div
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop
      highlightRef.current.scrollLeft = scrollLeft
    }
  }, [scrollTop, scrollLeft])

  // Render highlighted content
  const renderHighlightedContent = () => {
    if (!value) {
      return <span className="text-muted-foreground">{placeholder}</span>
    }

    // Split by token pattern while preserving the tokens
    const parts: React.ReactNode[] = []
    const tokenRegex = /(\{\{[^}]*\}\})/g
    let lastIndex = 0
    let match

    const text = value
    const regex = new RegExp(tokenRegex)

    while ((match = regex.exec(text)) !== null) {
      // Add text before the token
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {text.slice(lastIndex, match.index)}
          </span>
        )
      }

      // Add the token with highlighting
      parts.push(
        <span
          key={`token-${match.index}`}
          className="bg-violet-500/20 text-violet-700 dark:text-violet-300 rounded px-0.5"
        >
          {match[1]}
        </span>
      )

      lastIndex = regex.lastIndex
    }

    // Add remaining text after the last token
    if (lastIndex < text.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {text.slice(lastIndex)}
        </span>
      )
    }

    // Add a trailing space to ensure the cursor can go past the last character
    parts.push(<span key="trailing">&nbsp;</span>)

    return parts
  }

  return (
    <div className={cn('relative', className)}>
      {/* Highlighted background layer */}
      <div
        ref={highlightRef}
        className={cn(
          'absolute inset-0 p-2 font-mono text-sm whitespace-pre-wrap break-words overflow-hidden pointer-events-none',
          'border border-transparent rounded-md bg-background'
        )}
        style={{
          minHeight,
          maxHeight,
        }}
        aria-hidden="true"
      >
        {renderHighlightedContent()}
      </div>

      {/* Editable textarea layer (transparent text) */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onSelect={onSelect}
        onClick={onClick}
        onKeyUp={onKeyUp}
        placeholder=""
        disabled={disabled}
        className={cn(
          'relative w-full p-2 font-mono text-sm whitespace-pre-wrap resize-none',
          'border border-input rounded-md bg-transparent',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'placeholder:text-muted-foreground',
          'text-transparent caret-foreground',
          'selection:bg-primary/30',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        style={{
          minHeight,
          maxHeight,
        }}
      />
    </div>
  )
})
