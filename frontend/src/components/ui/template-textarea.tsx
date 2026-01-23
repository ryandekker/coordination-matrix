'use client'

import * as React from 'react'
import { useRef, useCallback } from 'react'
import { TemplateEditor, TemplateEditorRef } from './template-editor'
import { TokenBrowser } from '@/components/workflows/token-browser'
import { cn } from '@/lib/utils'

interface TemplateTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
  maxHeight?: string
  disabled?: boolean
  label?: string
  description?: string
  // Token browser props
  showTokenBrowser?: boolean
  workflowId?: string
  workflowRunId?: string
  previousSteps?: Array<{
    id: string
    name: string
    stepType?: string
    itemVariable?: string
  }>
  currentStepIndex?: number
  loopVariable?: string
  // For task-only mode (no workflow context)
  taskOnly?: boolean
}

/**
 * TemplateTextarea - A textarea with template syntax highlighting and token browser
 *
 * Combines TemplateEditor (for {{token}} highlighting) with TokenBrowser button
 * for easy variable insertion.
 */
export function TemplateTextarea({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '80px',
  maxHeight = '200px',
  disabled = false,
  label,
  description,
  showTokenBrowser = true,
  workflowId,
  workflowRunId,
  previousSteps = [],
  currentStepIndex = 0,
  loopVariable,
  taskOnly = false,
}: TemplateTextareaProps) {
  const editorRef = useRef<TemplateEditorRef>(null)

  // Insert token at cursor position
  const handleSelectToken = useCallback((token: string) => {
    const editor = editorRef.current
    if (!editor) {
      // Fallback: append to end
      onChange(value + token)
      return
    }

    const cursorPos = editor.selectionStart ?? value.length
    const before = value.slice(0, cursorPos)
    const after = value.slice(cursorPos)
    const newValue = before + token + after
    onChange(newValue)

    // Move cursor after inserted token
    setTimeout(() => {
      const newPos = cursorPos + token.length
      editor.setSelectionRange(newPos, newPos)
      editor.focus()
    }, 0)
  }, [value, onChange])

  return (
    <div className={cn('space-y-1', className)}>
      {(label || (showTokenBrowser && !disabled)) && (
        <div className="flex items-center justify-between">
          {label && (
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
          )}
          {showTokenBrowser && !disabled && (
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={previousSteps}
              currentStepIndex={currentStepIndex}
              loopVariable={loopVariable}
              onSelectToken={handleSelectToken}
              wrapInBraces={true}
              variant="text"
              forJoinInputPath={false}
              taskOnly={taskOnly}
            />
          )}
        </div>
      )}
      {description && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}
      <TemplateEditor
        ref={editorRef}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        minHeight={minHeight}
        maxHeight={maxHeight}
        disabled={disabled}
      />
    </div>
  )
}

/**
 * TemplateInput - A single-line input with token browser
 *
 * For fields like URL where you want template support but not multiline.
 */
interface TemplateInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  // Token browser props
  showTokenBrowser?: boolean
  workflowId?: string
  previousSteps?: Array<{
    id: string
    name: string
    stepType?: string
    itemVariable?: string
  }>
  currentStepIndex?: number
  loopVariable?: string
}

export function TemplateInput({
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  showTokenBrowser = true,
  workflowId,
  previousSteps = [],
  currentStepIndex = 0,
  loopVariable,
}: TemplateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Insert token at cursor position
  const handleSelectToken = useCallback((token: string) => {
    const input = inputRef.current
    if (!input) {
      onChange(value + token)
      return
    }

    const cursorPos = input.selectionStart ?? value.length
    const before = value.slice(0, cursorPos)
    const after = value.slice(cursorPos)
    const newValue = before + token + after
    onChange(newValue)

    // Move cursor after inserted token
    setTimeout(() => {
      const newPos = cursorPos + token.length
      input.setSelectionRange(newPos, newPos)
      input.focus()
    }, 0)
  }, [value, onChange])

  // Highlight tokens in the displayed value
  const renderHighlightedValue = () => {
    if (!value) return null

    const parts: React.ReactNode[] = []
    const tokenRegex = /(\{\{[^}]*\}\})/g
    let lastIndex = 0
    let match

    while ((match = tokenRegex.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {value.slice(lastIndex, match.index)}
          </span>
        )
      }
      parts.push(
        <span
          key={`token-${match.index}`}
          className="bg-violet-500/20 text-violet-700 dark:text-violet-300 rounded px-0.5"
        >
          {match[1]}
        </span>
      )
      lastIndex = tokenRegex.lastIndex
    }

    if (lastIndex < value.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {value.slice(lastIndex)}
        </span>
      )
    }

    return parts
  }

  return (
    <div className={cn('flex gap-2', className)}>
      <div className="relative flex-1">
        {/* Highlighted background layer */}
        <div
          className="absolute inset-0 px-3 py-2 text-sm font-mono pointer-events-none overflow-hidden whitespace-nowrap"
          style={{ clipPath: 'inset(0 0 0 0 round 6px)' }}
          aria-hidden="true"
        >
          {renderHighlightedValue()}
        </div>
        {/* Actual input (transparent text) */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full h-8 px-3 py-2 text-sm font-mono rounded-md border border-input bg-transparent',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'text-transparent caret-foreground selection:bg-primary/30',
            'placeholder:text-muted-foreground placeholder:font-sans',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
      </div>
      {showTokenBrowser && !disabled && (
        <TokenBrowser
          workflowId={workflowId}
          previousSteps={previousSteps}
          currentStepIndex={currentStepIndex}
          loopVariable={loopVariable}
          onSelectToken={handleSelectToken}
          wrapInBraces={true}
          variant="icon"
        />
      )}
    </div>
  )
}
