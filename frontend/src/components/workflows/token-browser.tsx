'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { TokenBrowserDialog } from './token-browser-dialog'

interface TokenBrowserProps {
  // Workflow ID to fetch past run data
  workflowId?: string
  // Previous steps in the workflow for context
  previousSteps?: Array<{
    id: string
    name: string
    stepType?: string
    itemVariable?: string
  }>
  // Current step index (to know which steps came before)
  currentStepIndex?: number
  // If inside a loop, the loop variable
  loopVariable?: string
  // Callback when a token is selected
  onSelectToken: (token: string) => void
  // Whether to wrap in {{ }}
  wrapInBraces?: boolean
  // Button variant
  variant?: 'icon' | 'text'
  // Custom trigger content
  children?: React.ReactNode
  // For join inputPath: paths are relative to child task metadata (no output prefix)
  forJoinInputPath?: boolean
  // Field context for the bottom panel (editable mode)
  fieldLabel?: string
  fieldValue?: string
  // Callback when field value changes (enables editable mode)
  onFieldValueChange?: (value: string) => void
  // Task-only mode - shows system variables and variable packages without workflow context
  taskOnly?: boolean
}

/**
 * TokenBrowser - A button that opens the full Token Browser dialog
 *
 * This component provides a simple trigger button that opens the TokenBrowserDialog
 * for browsing and inserting template tokens.
 */
export function TokenBrowser({
  workflowId,
  previousSteps = [],
  currentStepIndex = 0,
  loopVariable,
  onSelectToken,
  wrapInBraces = true,
  variant = 'icon',
  children,
  forJoinInputPath = false,
  fieldLabel,
  fieldValue,
  onFieldValueChange,
  taskOnly = false,
}: TokenBrowserProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      {/* Trigger button */}
      {children ? (
        <div onClick={() => setDialogOpen(true)}>{children}</div>
      ) : variant === 'icon' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0 flex-shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 flex-shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Token
        </Button>
      )}

      {/* Full token browser dialog */}
      <TokenBrowserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workflowId={workflowId}
        previousSteps={previousSteps}
        currentStepIndex={currentStepIndex}
        loopVariable={loopVariable}
        onSelectToken={(token) => {
          onSelectToken(token)
          // Only close if not in external field mode
          if (!onFieldValueChange) {
            setDialogOpen(false)
          }
        }}
        wrapInBraces={wrapInBraces}
        forJoinInputPath={forJoinInputPath}
        fieldLabel={fieldLabel}
        fieldValue={fieldValue}
        onFieldValueChange={onFieldValueChange}
        taskOnly={taskOnly}
      />
    </>
  )
}

// Re-export types that may be used by consumers
export type { TokenBrowserProps }
