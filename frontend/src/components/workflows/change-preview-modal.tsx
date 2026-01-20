'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Pencil,
  Equal,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Types matching backend
interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

interface StepDiff {
  stepId: string
  stepName: string
  stepType: string
  action: 'add' | 'remove' | 'modify' | 'unchanged'
  fieldChanges?: FieldChange[]
}

interface WorkflowDiff {
  workflowId?: string
  workflowName: string
  action: 'create' | 'update' | 'skip'
  stepCount: number
  stepDiffs: StepDiff[]
  metadataChanges?: FieldChange[]
  warnings?: string[]
  error?: string
}

interface StepSummary {
  added: number
  modified: number
  removed: number
  unchanged: number
}

interface ChangePreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  results: WorkflowDiff[]
  summary: {
    total: number
    created: number
    updated: number
    skipped: number
  }
  stepSummary?: StepSummary
  onConfirm: () => void
  isConfirming?: boolean
}

function formatValue(value: unknown, maxLength = 200): string {
  if (value === undefined || value === null) return '(empty)'
  if (typeof value === 'string') {
    if (value.length === 0) return '(empty)'
    return value.length > maxLength ? value.slice(0, maxLength) + '...' : value
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty array)'
    // For connections/branches, show a summary of targets
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      const firstItem = value[0] as Record<string, unknown>
      // Check if it looks like a connection or branch
      if ('targetStepId' in firstItem) {
        const targets = value.map((item) => {
          const conn = item as Record<string, unknown>
          const target = conn.targetStepId || '?'
          const condition = conn.condition || conn.label
          return condition ? `${target} (${condition})` : String(target)
        })
        const summary = targets.join(', ')
        return summary.length > maxLength ? summary.slice(0, maxLength) + '...' : summary
      }
    }
    // Generic array display
    const json = JSON.stringify(value, null, 0)
    return json.length > maxLength ? json.slice(0, maxLength) + '...' : json
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value, null, 0)
    return json.length > maxLength ? json.slice(0, maxLength) + '...' : json
  }
  return String(value)
}

// Human-readable field names
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  stepType: 'Step Type',
  additionalInstructions: 'Instructions',
  defaultAssigneeId: 'Assignee',
  promptDocumentIds: 'Prompt Documents',
  externalConfig: 'External Config',
  defaultConnection: 'Default Connection',
  itemsPath: 'Items Path',
  itemVariable: 'Item Variable',
  maxItems: 'Max Items',
  awaitStepId: 'Await Step',
  joinBoundary: 'Join Boundary',
  minSuccessPercent: 'Min Success %',
  expectedCountPath: 'Expected Count Path',
  flowId: 'Sub-workflow',
  inputMapping: 'Input Mapping',
  inputSource: 'Input Source',
  inputPath: 'Input Path',
  connections: 'Connections',
  branches: 'Branches',
  isActive: 'Active',
  rootTaskTitleTemplate: 'Root Task Title',
}

function getFieldLabel(field: string): string {
  return FIELD_LABELS[field] || field
}

function StepDiffItem({ diff }: { diff: StepDiff }) {
  const [expanded, setExpanded] = useState(diff.action === 'modify')

  const actionConfig = {
    add: { icon: Plus, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30', label: 'Added' },
    remove: { icon: Minus, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', label: 'Removed' },
    modify: { icon: Pencil, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', label: 'Modified' },
    unchanged: { icon: Equal, color: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/30', label: 'Unchanged' },
  }

  const config = actionConfig[diff.action]
  const Icon = config.icon
  const hasDetails = diff.fieldChanges && diff.fieldChanges.length > 0

  if (diff.action === 'unchanged') {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-sm text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="opacity-60">{diff.stepName}</span>
        <span className="text-xs opacity-40">({diff.stepType})</span>
      </div>
    )
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-2 py-1.5 px-2 rounded text-sm transition-colors',
            config.bg,
            'hover:opacity-80'
          )}
        >
          {hasDetails ? (
            expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
          <Icon className={cn('h-3.5 w-3.5', config.color)} />
          <span className={cn('font-medium', config.color)}>{diff.stepName}</span>
          <span className="text-xs text-muted-foreground">({diff.stepType})</span>
          {diff.action === 'remove' && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 ml-auto" />
          )}
        </button>
      </CollapsibleTrigger>
      {hasDetails && (
        <CollapsibleContent>
          <div className="ml-8 mt-1 space-y-2 pb-2">
            {diff.fieldChanges!.map((change, i) => (
              <div key={i} className="text-xs border-l-2 border-blue-300 pl-2 py-1 bg-muted/30 rounded-r">
                <div className="font-medium text-muted-foreground mb-1">
                  {getFieldLabel(change.field)}
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-start gap-2">
                    <span className="text-red-500 font-mono text-[10px] bg-red-50 dark:bg-red-950/30 px-1 rounded">−</span>
                    <span className="text-red-600 break-all">
                      {formatValue(change.oldValue)}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-green-500 font-mono text-[10px] bg-green-50 dark:bg-green-950/30 px-1 rounded">+</span>
                    <span className="text-green-600 break-all">
                      {formatValue(change.newValue)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function WorkflowDiffSection({ workflow }: { workflow: WorkflowDiff }) {
  const stepDiffs = workflow.stepDiffs || []
  const hasChanges = stepDiffs.some(s => s.action !== 'unchanged') ||
    (workflow.metadataChanges && workflow.metadataChanges.length > 0)

  const [expanded, setExpanded] = useState(hasChanges)

  const actionBadge = {
    create: { variant: 'default' as const, className: 'bg-green-600', label: 'CREATE' },
    update: { variant: 'default' as const, className: 'bg-blue-600', label: 'UPDATE' },
    skip: { variant: 'secondary' as const, className: '', label: 'SKIP' },
  }

  const badge = actionBadge[workflow.action]

  const stepCounts = {
    add: stepDiffs.filter(s => s.action === 'add').length,
    modify: stepDiffs.filter(s => s.action === 'modify').length,
    remove: stepDiffs.filter(s => s.action === 'remove').length,
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{workflow.workflowName}</span>
          <Badge variant={badge.variant} className={cn('text-xs', badge.className)}>
            {badge.label}
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            {workflow.stepCount} steps
            {(stepCounts.add > 0 || stepCounts.modify > 0 || stepCounts.remove > 0) && (
              <span className="ml-2">
                {stepCounts.add > 0 && <span className="text-green-600">+{stepCounts.add}</span>}
                {stepCounts.modify > 0 && <span className="text-blue-600 ml-1">~{stepCounts.modify}</span>}
                {stepCounts.remove > 0 && <span className="text-red-600 ml-1">-{stepCounts.remove}</span>}
              </span>
            )}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-2">
          {/* Metadata changes */}
          {workflow.metadataChanges && workflow.metadataChanges.length > 0 && (
            <div className="border-l-2 border-blue-400 pl-3 py-2 bg-blue-50/50 dark:bg-blue-950/20 rounded-r">
              <div className="text-xs font-medium text-blue-600 mb-2">Workflow Metadata Changes</div>
              <div className="space-y-2">
                {workflow.metadataChanges.map((change, i) => (
                  <div key={i} className="text-xs">
                    <div className="font-medium text-muted-foreground mb-1">
                      {getFieldLabel(change.field)}
                    </div>
                    <div className="space-y-0.5 ml-2">
                      <div className="flex items-start gap-2">
                        <span className="text-red-500 font-mono text-[10px] bg-red-50 dark:bg-red-950/30 px-1 rounded">−</span>
                        <span className="text-red-600 break-all">
                          {formatValue(change.oldValue)}
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-green-500 font-mono text-[10px] bg-green-50 dark:bg-green-950/30 px-1 rounded">+</span>
                        <span className="text-green-600 break-all">
                          {formatValue(change.newValue)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step diffs */}
          {stepDiffs.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-muted-foreground mb-1">Steps</div>
              {stepDiffs.map((diff) => (
                <StepDiffItem key={diff.stepId} diff={diff} />
              ))}
            </div>
          )}

          {/* Warnings */}
          {workflow.warnings && workflow.warnings.length > 0 && (
            <div className="border-l-2 border-amber-400 pl-3 py-1 bg-amber-50/50 dark:bg-amber-950/20 rounded-r">
              <div className="text-xs font-medium text-amber-600 mb-1">Warnings</div>
              {workflow.warnings.map((warning, i) => (
                <div key={i} className="text-xs text-amber-700 dark:text-amber-400">{warning}</div>
              ))}
            </div>
          )}

          {/* Error */}
          {workflow.error && (
            <div className="border-l-2 border-red-400 pl-3 py-1 bg-red-50/50 dark:bg-red-950/20 rounded-r">
              <div className="text-xs text-red-600">{workflow.error}</div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ChangePreviewModal({
  open,
  onOpenChange,
  results,
  summary,
  stepSummary,
  onConfirm,
  isConfirming = false,
}: ChangePreviewModalProps) {
  const hasRemovals = stepSummary && stepSummary.removed > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review Changes</DialogTitle>
          <DialogDescription>
            Review the changes before importing. This will modify your workflows.
          </DialogDescription>
        </DialogHeader>

        {/* Summary stats */}
        <div className="flex flex-wrap items-center gap-3 text-sm border-b pb-3">
          <span className="text-muted-foreground">
            {summary.total} workflow{summary.total !== 1 ? 's' : ''}
          </span>
          {summary.created > 0 && (
            <Badge variant="outline" className="border-green-300 text-green-600">
              <Plus className="h-3 w-3 mr-1" />
              {summary.created} new
            </Badge>
          )}
          {summary.updated > 0 && (
            <Badge variant="outline" className="border-blue-300 text-blue-600">
              <Pencil className="h-3 w-3 mr-1" />
              {summary.updated} updated
            </Badge>
          )}
          {summary.skipped > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-600">
              {summary.skipped} skipped
            </Badge>
          )}
          {stepSummary && (
            <>
              <span className="text-muted-foreground">|</span>
              {stepSummary.added > 0 && (
                <span className="text-green-600 text-xs">+{stepSummary.added} steps</span>
              )}
              {stepSummary.modified > 0 && (
                <span className="text-blue-600 text-xs">~{stepSummary.modified} steps</span>
              )}
              {stepSummary.removed > 0 && (
                <span className="text-red-600 text-xs flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  -{stepSummary.removed} steps
                </span>
              )}
            </>
          )}
        </div>

        {/* Warning banner for removals */}
        {hasRemovals && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-amber-800 dark:text-amber-200">
              {stepSummary!.removed} step{stepSummary!.removed !== 1 ? 's' : ''} will be removed.
              This cannot be undone.
            </span>
          </div>
        )}

        {/* Workflow list */}
        <div className="flex-1 overflow-auto space-y-2 min-h-0">
          {results.map((workflow, i) => (
            <WorkflowDiffSection key={workflow.workflowId || i} workflow={workflow} />
          ))}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              'Confirm & Import'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
