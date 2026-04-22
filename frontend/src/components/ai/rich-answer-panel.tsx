'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Sparkles, Loader2, ArrowRight, Pencil, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MarkdownContent } from '@/components/ui/markdown-content'
import { aiAssistantApi } from '@/lib/api'
import { toast } from 'sonner'

export interface RichAnswerFollowUp {
  label: string
  instruction: string
  mode?: 'question' | 'edit'
  reason?: string
}

export interface RichAnswerData {
  answer: string
  summary?: string
  followUps?: RichAnswerFollowUp[]
  referencedSteps?: string[]
  relevantSections?: string[]
  sourceContext?: 'workflow' | 'document'
  sourceTargetId?: string
  sourceInstruction?: string
  documentId?: string
}

interface RichAnswerPanelProps {
  data: RichAnswerData
  /** Optional link to open the rendered document in a new tab */
  documentId?: string
  /** Hide the document link even if documentId is present (e.g., when already on the document page) */
  hideDocumentLink?: boolean
  /** Optional title shown above the markdown body */
  title?: string
  className?: string
}

export function RichAnswerPanel({
  data,
  documentId,
  hideDocumentLink,
  title,
  className,
}: RichAnswerPanelProps) {
  const linkedDocumentId = documentId || data.documentId

  const followUps = useMemo(
    () => (Array.isArray(data.followUps) ? data.followUps.filter(f => f && f.instruction) : []),
    [data.followUps]
  )

  const [activeFollowUp, setActiveFollowUp] = useState<RichAnswerFollowUp | null>(null)

  return (
    <div className={className}>
      {/* Header — title + open-as-document link */}
      {(title || (!hideDocumentLink && linkedDocumentId)) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title ? (
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {title}
            </h3>
          ) : <span />}
          {!hideDocumentLink && linkedDocumentId && (
            <Link
              href={`/documents/${linkedDocumentId}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Open as document
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}

      {/* Markdown answer body */}
      <div className="rounded-lg border bg-background p-4 max-h-[600px] overflow-auto">
        <MarkdownContent content={data.answer} />
      </div>

      {/* Suggested follow-ups */}
      {followUps.length > 0 && data.sourceContext && data.sourceTargetId && (
        <div className="mt-4 rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Suggested follow-ups
          </div>
          <div className="flex flex-wrap gap-2">
            {followUps.map((f, i) => (
              <Button
                key={i}
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setActiveFollowUp(f)}
                title={f.reason || f.instruction}
              >
                {f.mode === 'edit' ? (
                  <Pencil className="h-3.5 w-3.5" />
                ) : (
                  <MessageCircle className="h-3.5 w-3.5" />
                )}
                {f.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click a button to review and edit the instruction before submitting.
          </p>
        </div>
      )}

      {/* Follow-up dialog */}
      {activeFollowUp && data.sourceContext && data.sourceTargetId && (
        <FollowUpDialog
          followUp={activeFollowUp}
          context={data.sourceContext}
          targetId={data.sourceTargetId}
          onClose={() => setActiveFollowUp(null)}
        />
      )}
    </div>
  )
}

interface FollowUpDialogProps {
  followUp: RichAnswerFollowUp
  context: 'workflow' | 'document'
  targetId: string
  onClose: () => void
}

function FollowUpDialog({ followUp, context, targetId, onClose }: FollowUpDialogProps) {
  const router = useRouter()
  const [instruction, setInstruction] = useState(followUp.instruction)
  const [mode, setMode] = useState<'question' | 'edit' | 'auto'>(followUp.mode || 'auto')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!instruction.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await aiAssistantApi.followUp({
        context,
        targetId,
        instruction: instruction.trim(),
        ...(mode !== 'auto' && { mode }),
      })
      toast.success('Follow-up started — opening task')
      onClose()
      if (res.rootTask?._id) {
        router.push(`/tasks/?taskId=${res.rootTask._id}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start follow-up'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            {followUp.label}
          </DialogTitle>
          <DialogDescription>
            Review and edit the instruction before submitting. The assistant will run as a new task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="follow-up-instruction" className="text-xs font-medium">
              Instruction
            </Label>
            <Textarea
              id="follow-up-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={5}
              disabled={submitting}
              className="resize-y"
              placeholder="What should the assistant do?"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as 'question' | 'edit' | 'auto')}
              className="flex gap-4"
              disabled={submitting}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="auto" id="mode-auto" />
                <Label htmlFor="mode-auto" className="font-normal cursor-pointer text-sm">
                  Auto-detect
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="question" id="mode-question" />
                <Label htmlFor="mode-question" className="font-normal cursor-pointer text-sm">
                  Question
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="edit" id="mode-edit" />
                <Label htmlFor="mode-edit" className="font-normal cursor-pointer text-sm">
                  Edit
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !instruction.trim()} className="gap-2">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Run follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Try to parse a RichAnswerData object from a task's stepOutput / metadata blob.
 * Returns null when the shape doesn't match.
 */
export function parseRichAnswer(source: unknown): RichAnswerData | null {
  if (!source || typeof source !== 'object') return null
  const obj = source as Record<string, unknown>

  // Direct richAnswer field (preferred — set by format-answer code step)
  const direct = obj.richAnswer
  if (direct && typeof direct === 'object') {
    const ra = direct as Record<string, unknown>
    if (typeof ra.answer === 'string' && ra.answer.trim().length > 0) {
      return normalize(ra)
    }
  }

  // Result wrapper (agent step output: output.result.{answer, suggestedFollowUps, ...})
  const result = obj.result
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.answer === 'string' && r.answer.trim().length > 0) {
      return normalize(r)
    }
  }

  // Top-level answer
  if (typeof obj.answer === 'string' && obj.answer.trim().length > 0) {
    return normalize(obj)
  }

  return null
}

function normalize(raw: Record<string, unknown>): RichAnswerData {
  const followUps = raw.followUps || raw.suggestedFollowUps
  return {
    answer: String(raw.answer || ''),
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    followUps: Array.isArray(followUps)
      ? followUps.filter((f: unknown): f is RichAnswerFollowUp => {
          if (!f || typeof f !== 'object') return false
          const obj = f as Record<string, unknown>
          return typeof obj.label === 'string' && typeof obj.instruction === 'string'
        })
      : undefined,
    referencedSteps: Array.isArray(raw.referencedSteps)
      ? raw.referencedSteps.filter((s): s is string => typeof s === 'string')
      : undefined,
    relevantSections: Array.isArray(raw.relevantSections)
      ? raw.relevantSections.filter((s): s is string => typeof s === 'string')
      : undefined,
    sourceContext:
      raw.sourceContext === 'workflow' || raw.sourceContext === 'document'
        ? raw.sourceContext
        : undefined,
    sourceTargetId: typeof raw.sourceTargetId === 'string' ? raw.sourceTargetId : undefined,
    sourceInstruction:
      typeof raw.sourceInstruction === 'string' ? raw.sourceInstruction : undefined,
    documentId: typeof raw.documentId === 'string' ? raw.documentId : undefined,
  }
}
