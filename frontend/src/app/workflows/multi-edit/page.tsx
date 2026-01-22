'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ChangePreviewModal } from '@/components/workflows/change-preview-modal'
import { getAuthHeader } from '@/lib/auth'
import {
  ArrowLeft,
  Download,
  Upload,
  FileUp,
  RefreshCw,
  Check,
  AlertCircle,
  Plus,
  Pencil,
  SkipForward,
  Eye,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Copy,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface ImportResult {
  name: string
  id?: string
  action: 'create' | 'update' | 'skip'
  stepCount: number
  error?: string
}

interface ImportSummary {
  total: number
  created: number
  updated: number
  skipped: number
}

// Types for detailed diff preview
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

const MULTI_WORKFLOW_TEMPLATE = `flowchart TD

    %% @workflow: "My New Workflow"
    %% @description: Description of this workflow
    subgraph workflow1["My New Workflow"]
        direction TB
        step1["First Step"]:::agent
        step2("Manual Review"):::manual
        step3{{"API Call"}}:::external
        step1 --> step2 --> step3
    end

    %% @workflow: "Another Workflow"
    %% @description: A second workflow that calls the first
    subgraph workflow2["Another Workflow"]
        direction TB
        start["Begin Process"]:::agent
        nested[["Run: My New Workflow"]]:::flow
        finish["Complete"]:::agent
        start --> nested --> finish
    end

    %% Styling
    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    classDef decision fill:#F59E0B,color:#fff
    classDef foreach fill:#10B981,color:#fff
    classDef join fill:#6366F1,color:#fff
    classDef flow fill:#EC4899,color:#fff
`

export default function MultiWorkflowEditPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const idsParam = searchParams.get('ids')
  const workflowIds = idsParam ? idsParam.split(',').filter(Boolean) : []

  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [isDryRun, setIsDryRun] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const [isCopyingPrompt, setIsCopyingPrompt] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptContent, setPromptContent] = useState('')
  const [workflowCount, setWorkflowCount] = useState<number>(0)

  // Change preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [detailedResults, setDetailedResults] = useState<WorkflowDiff[] | null>(null)
  const [detailedSummary, setDetailedSummary] = useState<ImportSummary | null>(null)
  const [stepSummary, setStepSummary] = useState<StepSummary | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  // Export workflows (by IDs if provided, or all)
  const handleExport = useCallback(async (ids?: string[]) => {
    setIsLoading(true)
    setError(null)
    try {
      let url = `${API_BASE}/workflows/export-multi`
      const idsToExport = ids || workflowIds
      if (idsToExport.length > 0) {
        url += `?ids=${idsToExport.join(',')}`
      }
      const response = await fetch(url, {
        headers: getAuthHeader(),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `Export failed: ${response.statusText}`)
      }
      const result = await response.json()
      setMermaidCode(result.data.mermaid || '')
      setWorkflowCount(result.data.workflows?.length || 0)
      setImportResults(null)
      setImportSummary(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsLoading(false)
    }
  }, [workflowIds])

  // Auto-load workflows from URL params on mount
  useEffect(() => {
    if (workflowIds.length > 0) {
      handleExport(workflowIds)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load template for new workflows
  const handleNewFromTemplate = useCallback(() => {
    setMermaidCode(MULTI_WORKFLOW_TEMPLATE)
    setImportResults(null)
    setImportSummary(null)
    setError(null)
  }, [])

  // Preview (quick dry-run without detailed diffs)
  const handlePreview = useCallback(async () => {
    if (!mermaidCode.trim()) {
      setError('No Mermaid code to import')
      return
    }

    setIsImporting(true)
    setError(null)
    setIsDryRun(true)
    setResultsExpanded(true)

    try {
      const response = await fetch(`${API_BASE}/workflows/import-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ mermaid: mermaidCode, dryRun: true }),
      })

      if (!response.ok) {
        throw new Error(`Preview failed: ${response.statusText}`)
      }

      const result = await response.json()
      setImportResults(result.data.results)
      setImportSummary(result.data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setIsImporting(false)
    }
  }, [mermaidCode])

  // Import with detailed preview modal
  const handleImportWithPreview = useCallback(async () => {
    if (!mermaidCode.trim()) {
      setError('No Mermaid code to import')
      return
    }

    setIsImporting(true)
    setError(null)

    try {
      // First get detailed diffs
      const response = await fetch(`${API_BASE}/workflows/import-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ mermaid: mermaidCode, dryRun: true, includeStepDiffs: true }),
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`)
      }

      const result = await response.json()
      setDetailedResults(result.data.results)
      setDetailedSummary(result.data.summary)
      setStepSummary(result.data.stepSummary || null)
      setPreviewModalOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }, [mermaidCode])

  // Confirm import after preview
  const handleConfirmImport = useCallback(async () => {
    if (!mermaidCode.trim()) return

    setIsConfirming(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE}/workflows/import-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ mermaid: mermaidCode, dryRun: false }),
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`)
      }

      // Redirect to workflows page on success
      router.push('/workflows')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setPreviewModalOpen(false)
    } finally {
      setIsConfirming(false)
    }
  }, [mermaidCode, router])

  // Download as file
  const handleDownload = useCallback(() => {
    if (!mermaidCode) return
    const blob = new Blob([mermaidCode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'workflows.mmd'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [mermaidCode])

  // Upload from file
  const handleUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setMermaidCode(content)
      setImportResults(null)
      setImportSummary(null)
    }
    reader.readAsText(file)
    event.target.value = ''
  }, [])

  // Copy AI prompt to clipboard (with fallback dialog)
  const handleCopyAIPrompt = useCallback(async () => {
    setIsCopyingPrompt(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/workflows/ai-prompt-multi?includeContext=true`, {
        headers: getAuthHeader(),
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch AI prompt: ${response.statusText}`)
      }
      const result = await response.json()
      const prompt = result.data?.prompt || ''

      // Append current diagram if available
      let fullPrompt = prompt
      if (mermaidCode.trim()) {
        fullPrompt += `\n\n---\n\n## Current Diagram to Edit\n\nHere is the current multi-workflow diagram. Modify it based on the user's request:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``
      }

      // Try clipboard first, fall back to dialog
      try {
        await navigator.clipboard.writeText(fullPrompt)
        setPromptCopied(true)
        setTimeout(() => setPromptCopied(false), 2000)
      } catch {
        // Clipboard blocked (e.g., in iframe), show dialog instead
        setPromptContent(fullPrompt)
        setPromptDialogOpen(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AI prompt')
    } finally {
      setIsCopyingPrompt(false)
    }
  }, [mermaidCode])

  // Copy from dialog textarea
  const handleCopyFromDialog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(promptContent)
      setPromptCopied(true)
      setTimeout(() => {
        setPromptCopied(false)
        setPromptDialogOpen(false)
      }, 1000)
    } catch {
      // Still blocked, user will need to manually select and copy
    }
  }, [promptContent])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header - Clean and simple */}
      <div className="border-b bg-muted/30 flex-shrink-0">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/workflows">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold">
                Multi-Workflow Editor
                {workflowCount > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({workflowCount} workflow{workflowCount !== 1 ? 's' : ''})
                  </span>
                )}
              </h1>
              <p className="text-xs text-muted-foreground">
                Edit multiple workflows as Mermaid diagrams
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0 container mx-auto px-4 py-3">
        {/* Toolbar - All actions organized here */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0 flex-wrap gap-2">
          {/* Left: Load/Save actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport()}
              disabled={isLoading}
              className="gap-1.5"
            >
              {isLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewFromTemplate}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Template
            </Button>
            <div className="h-4 w-px bg-border" />
            <label>
              <Button variant="outline" size="sm" className="gap-1.5 cursor-pointer" asChild>
                <span>
                  <FileUp className="h-3.5 w-3.5" />
                  Upload
                </span>
              </Button>
              <input
                type="file"
                accept=".mmd,.txt"
                className="hidden"
                onChange={handleUpload}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!mermaidCode}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>

          {/* Right: AI + Import actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAIPrompt}
              disabled={isCopyingPrompt}
              className="gap-1.5"
            >
              {isCopyingPrompt ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : promptCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {promptCopied ? 'Copied!' : 'AI Prompt'}
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={isImporting || !mermaidCode.trim()}
              className="gap-1.5"
            >
              {isImporting && isDryRun && !previewModalOpen ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              Preview
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleImportWithPreview}
              disabled={isImporting || !mermaidCode.trim()}
              className="gap-1.5"
            >
              {isImporting && !isDryRun ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import
            </Button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-3 px-4 py-3 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2 flex-shrink-0">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Mermaid editor - takes remaining space */}
        <div className="flex-1 min-h-0">
          <MermaidLiveEditor
            value={mermaidCode}
            onChange={setMermaidCode}
            onError={setMermaidError}
            className="h-full"
            minHeight="100%"
            initialLayout="split"
          />
        </div>

        {/* Results panel - collapsible at bottom */}
        {importResults && (
          <div className="mt-3 border rounded-lg bg-muted/20 flex-shrink-0">
            {/* Results header - clickable to collapse */}
            <button
              onClick={() => setResultsExpanded(!resultsExpanded)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isDryRun ? (
                  <Eye className="h-4 w-4 text-blue-500" />
                ) : (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                <span className="font-medium text-sm">
                  {isDryRun ? 'Preview Results' : 'Import Complete'}
                </span>
                {importSummary && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-600">{importSummary.created} created</span>
                    <span className="text-blue-600">{importSummary.updated} updated</span>
                    {importSummary.skipped > 0 && (
                      <span className="text-amber-600">{importSummary.skipped} skipped</span>
                    )}
                  </div>
                )}
              </div>
              {resultsExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {/* Collapsible results content */}
            {resultsExpanded && (
              <div className="border-t p-3">
                <div className="flex flex-wrap gap-2 max-h-32 overflow-auto">
                  {importResults.map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        'px-2.5 py-1.5 border rounded-md flex items-center gap-1.5 text-xs',
                        result.action === 'create' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
                        result.action === 'update' && 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
                        result.action === 'skip' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                      )}
                    >
                      {result.action === 'create' && <Plus className="h-3 w-3 text-green-600" />}
                      {result.action === 'update' && <Pencil className="h-3 w-3 text-blue-600" />}
                      {result.action === 'skip' && <SkipForward className="h-3 w-3 text-amber-600" />}
                      <span className="font-medium">{result.name}</span>
                      <span className="text-muted-foreground">
                        {result.stepCount} steps
                      </span>
                      {result.error && (
                        <span className="text-destructive">({result.error})</span>
                      )}
                    </div>
                  ))}
                </div>
                {isDryRun && (
                  <p className="text-xs text-muted-foreground mt-2">
                    This is a preview. Click &quot;Import&quot; to apply changes.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Format reference - compact footer */}
        <div className="mt-2 text-xs text-muted-foreground flex-shrink-0">
          <span className="opacity-70">Format:</span>{' '}
          <code className="bg-muted px-1 rounded">%% @workflow: &quot;Name&quot;</code>{' '}
          <code className="bg-muted px-1 rounded">subgraph id[&quot;Name&quot;]...end</code>
        </div>
      </div>

      {/* AI Prompt Dialog - Fallback when clipboard is blocked */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Prompt
            </DialogTitle>
            <DialogDescription>
              Copy this prompt and paste it into your AI assistant to generate or modify workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <Textarea
              value={promptContent}
              readOnly
              className="h-[50vh] font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setPromptDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={handleCopyFromDialog} className="gap-2">
              {promptCopied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Preview Modal */}
      {detailedResults && detailedSummary && (
        <ChangePreviewModal
          open={previewModalOpen}
          onOpenChange={setPreviewModalOpen}
          results={detailedResults}
          summary={detailedSummary}
          stepSummary={stepSummary || undefined}
          onConfirm={handleConfirmImport}
          isConfirming={isConfirming}
        />
      )}
    </div>
  )
}
