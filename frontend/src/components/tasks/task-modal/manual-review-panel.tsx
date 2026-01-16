'use client'

import { useState, useMemo } from 'react'
import { Check, RotateCcw, MessageSquare, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Task, ManualReviewDecision } from '@/lib/api'
import { cn } from '@/lib/utils'
import { JsonViewer } from '@/components/ui/json-viewer'

interface ManualReviewPanelProps {
  task: Task
  previousStepOutput?: Record<string, unknown> | null
  onReview: (decision: ManualReviewDecision, comment: string) => Promise<void>
  onRollback?: () => Promise<void>
  isSubmitting?: boolean
}

export function ManualReviewPanel({
  task,
  previousStepOutput,
  onReview,
  onRollback,
  isSubmitting = false,
}: ManualReviewPanelProps) {
  const [comment, setComment] = useState('')
  const [showPreviousOutput, setShowPreviousOutput] = useState(true)
  const [selectedAction, setSelectedAction] = useState<ManualReviewDecision | 'rollback' | null>(null)

  // Check if task is already reviewed
  const isAlreadyReviewed = task.status === 'completed' && task.reviewDecision

  // Determine what output to show - prefer metadata.output or the full metadata
  const outputToShow = useMemo(() => {
    if (previousStepOutput) return previousStepOutput
    // Check if task has input from previous step in metadata
    const metadata = task.metadata as Record<string, unknown> | undefined
    if (metadata?.output) return metadata.output
    if (metadata?.input) return metadata.input
    return metadata || null
  }, [previousStepOutput, task.metadata])

  const handleApprove = async () => {
    setSelectedAction('approved')
    await onReview('approved', comment)
  }

  const handleApproveWithNotes = async () => {
    setSelectedAction('approved_with_notes')
    await onReview('approved_with_notes', comment)
  }

  const handleRequestChanges = async () => {
    setSelectedAction('request_changes')
    await onReview('request_changes', comment)
  }

  const handleRollback = async () => {
    if (!onRollback) return
    setSelectedAction('rollback')
    await onRollback()
  }

  // If already reviewed, show the review result
  if (isAlreadyReviewed) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-500" />
          <span className="font-medium">Review Completed</span>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg border space-y-2">
          <div className="text-xs text-muted-foreground">Decision</div>
          <div className={cn(
            'inline-flex items-center px-2 py-1 rounded text-xs font-medium',
            task.reviewDecision === 'approved' && 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400',
            task.reviewDecision === 'approved_with_notes' && 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400',
            task.reviewDecision === 'request_changes' && 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
          )}>
            {task.reviewDecision === 'approved' && 'Approved'}
            {task.reviewDecision === 'approved_with_notes' && 'Approved with Notes'}
            {task.reviewDecision === 'request_changes' && 'Changes Requested'}
          </div>
          {task.reviewComment && (
            <>
              <div className="text-xs text-muted-foreground mt-3">Comment</div>
              <p className="text-sm">{task.reviewComment}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Manual Review Required</h3>
        <span className="text-xs text-muted-foreground">
          {task.workflowStage || task.stepConfig?.stepName || 'Review Step'}
        </span>
      </div>

      {/* Previous Step Output */}
      {outputToShow && (
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPreviousOutput(!showPreviousOutput)}
            className="w-full px-3 py-2 flex items-center justify-between text-sm bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <span className="font-medium">Previous Step Output</span>
            {showPreviousOutput ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {showPreviousOutput && (
            <div className="p-3 bg-background max-h-[300px] overflow-auto">
              {typeof outputToShow === 'object' ? (
                <JsonViewer
                  data={outputToShow}
                  defaultExpanded={true}
                  maxInitialDepth={3}
                />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {String(outputToShow)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Comment Input */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Comments (optional)
        </label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add review notes or feedback..."
          rows={3}
          disabled={isSubmitting}
          className="resize-none"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Approve */}
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleApprove}
          disabled={isSubmitting}
          className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
        >
          {isSubmitting && selectedAction === 'approved' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Approve
        </Button>

        {/* Approve with Notes */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleApproveWithNotes}
          disabled={isSubmitting || !comment.trim()}
          className="gap-1.5"
        >
          {isSubmitting && selectedAction === 'approved_with_notes' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
          Approve with Notes
        </Button>

        {/* Request Changes / Rollback */}
        {onRollback && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRollback}
            disabled={isSubmitting}
            className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/50"
          >
            {isSubmitting && selectedAction === 'rollback' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Request Changes
          </Button>
        )}
      </div>

      {/* Help Text */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Approve:</strong> Complete this step and advance to the next step</p>
        <p><strong>Approve with Notes:</strong> Approve and pass your notes to the next step</p>
        {onRollback && (
          <p><strong>Request Changes:</strong> Send back to the previous step for revision</p>
        )}
      </div>
    </div>
  )
}
