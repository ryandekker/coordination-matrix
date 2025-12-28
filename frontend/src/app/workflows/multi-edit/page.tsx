'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
  Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface WorkflowInfo {
  _id: string
  name: string
  description?: string
  stepCount: number
}

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

const MULTI_WORKFLOW_TEMPLATE = `flowchart TD

    %% @workflow: "Document Validation"
    %% @description: Validates a single document format and content
    subgraph docValidation["Document Validation"]
        direction TB
        receive["Receive Document"]:::agent
        checkFormat{{"Check Format"}}:::external
        formatOk{"Format Valid?"}:::decision
        reject["Reject Document"]:::agent
        validate["Validate Content"]:::agent
        receive --> checkFormat --> formatOk
        formatOk -->|"yes"| validate
        formatOk -->|"no"| reject
    end

    %% @workflow: "Review Pipeline"
    %% @description: Human review process that uses Document Validation
    subgraph reviewPipeline["Review Pipeline"]
        direction TB
        prep["Prepare for Review"]:::agent
        runValidation[["Run: Document Validation"]]:::flow
        humanReview("Manager Review"):::manual
        approve["Mark Approved"]:::agent
        prep --> runValidation --> humanReview --> approve
    end

    %% @workflow: "Batch Processing"
    %% @description: Processes multiple documents using the Review Pipeline
    subgraph batchProcessing["Batch Processing"]
        direction TB
        initBatch["Initialize Batch"]:::agent
        eachDoc[["Each: Document"]]:::foreach
        processOne[["Run: Review Pipeline"]]:::flow
        collectResults[["Join: All Results"]]:::join
        generateReport["Generate Report"]:::agent
        initBatch --> eachDoc --> processOne --> collectResults --> generateReport
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
  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [isDryRun, setIsDryRun] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const [promptCopied, setPromptCopied] = useState(false)

  // Workflow selection state
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([])
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<string>>(new Set())
  const [showWorkflowSelector, setShowWorkflowSelector] = useState(false)
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false)

  // Fetch available workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      setIsLoadingWorkflows(true)
      try {
        const response = await fetch(`${API_BASE}/workflows`, {
          headers: getAuthHeader(),
        })
        if (response.ok) {
          const data = await response.json()
          const workflowList = (data.data || []).map((w: { _id: string; name: string; description?: string; steps?: unknown[] }) => ({
            _id: w._id,
            name: w.name,
            description: w.description,
            stepCount: w.steps?.length || 0,
          }))
          setWorkflows(workflowList)
        }
      } catch (err) {
        console.error('Failed to fetch workflows:', err)
      } finally {
        setIsLoadingWorkflows(false)
      }
    }
    fetchWorkflows()
  }, [])

  // Toggle workflow selection
  const toggleWorkflowSelection = useCallback((workflowId: string) => {
    setSelectedWorkflowIds(prev => {
      const next = new Set(prev)
      if (next.has(workflowId)) {
        next.delete(workflowId)
      } else {
        next.add(workflowId)
      }
      return next
    })
  }, [])

  // Select/deselect all workflows
  const toggleSelectAll = useCallback(() => {
    if (selectedWorkflowIds.size === workflows.length) {
      setSelectedWorkflowIds(new Set())
    } else {
      setSelectedWorkflowIds(new Set(workflows.map(w => w._id)))
    }
  }, [workflows, selectedWorkflowIds.size])

  // Copy AI prompt to clipboard
  const handleCopyAIPrompt = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/workflows/ai-prompt-multi`, {
        headers: getAuthHeader(),
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch AI prompt: ${response.statusText}`)
      }
      const data = await response.json()
      await navigator.clipboard.writeText(data.data.prompt)
      setPromptCopied(true)
      setTimeout(() => setPromptCopied(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy AI prompt')
    }
  }, [])

  // Export workflows (all or selected)
  const handleExport = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Build URL with optional workflow ID filter
      const url = new URL(`${API_BASE}/workflows/export-multi`, window.location.origin)
      if (selectedWorkflowIds.size > 0 && selectedWorkflowIds.size < workflows.length) {
        url.searchParams.set('ids', Array.from(selectedWorkflowIds).join(','))
      }

      const response = await fetch(url.toString(), {
        headers: getAuthHeader(),
      })
      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`)
      }
      const result = await response.json()
      setMermaidCode(result.data.mermaid || '')
      setImportResults(null)
      setImportSummary(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load template for new workflows
  const handleNewFromTemplate = useCallback(() => {
    setMermaidCode(MULTI_WORKFLOW_TEMPLATE)
    setImportResults(null)
    setImportSummary(null)
    setError(null)
  }, [])

  // Preview or import workflows
  const handleImport = useCallback(async (dryRun: boolean) => {
    if (!mermaidCode.trim()) {
      setError('No Mermaid code to import')
      return
    }

    setIsImporting(true)
    setError(null)
    setIsDryRun(dryRun)
    setResultsExpanded(true)

    try {
      const response = await fetch(`${API_BASE}/workflows/import-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ mermaid: mermaidCode, dryRun }),
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`)
      }

      const result = await response.json()
      setImportResults(result.data.results)
      setImportSummary(result.data.summary)

      // If not a dry run and successful, refresh the export to get updated IDs
      if (!dryRun && result.data.summary.created > 0) {
        // Wait a moment then re-export to update IDs in the editor
        setTimeout(() => handleExport(), 500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }, [mermaidCode, handleExport])

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-muted/30 flex-shrink-0">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/workflows">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Workflows
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold">Multi-Workflow Editor</h1>
                <p className="text-sm text-muted-foreground">
                  Export, edit, and import multiple workflows as Mermaid
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAIPrompt}
                className="gap-2"
              >
                {promptCopied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {promptCopied ? 'Copied!' : 'Copy AI Prompt'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNewFromTemplate}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New from Template
              </Button>
              <Button
                variant={showWorkflowSelector ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowWorkflowSelector(!showWorkflowSelector)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Select Workflows
                {selectedWorkflowIds.size > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {selectedWorkflowIds.size}
                  </Badge>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isLoading || workflows.length === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {selectedWorkflowIds.size > 0 && selectedWorkflowIds.size < workflows.length
                  ? `Export ${selectedWorkflowIds.size} Selected`
                  : 'Export All Workflows'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow selector panel */}
      {showWorkflowSelector && (
        <div className="border-b bg-muted/20 flex-shrink-0">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Select Workflows to Export</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSelectAll}
                className="text-xs"
              >
                {selectedWorkflowIds.size === workflows.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            {isLoadingWorkflows ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading workflows...
              </div>
            ) : workflows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflows found</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-auto">
                {workflows.map((workflow) => (
                  <label
                    key={workflow._id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 border rounded-lg cursor-pointer transition-colors',
                      selectedWorkflowIds.has(workflow._id)
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <Checkbox
                      checked={selectedWorkflowIds.has(workflow._id)}
                      onCheckedChange={() => toggleWorkflowSelection(workflow._id)}
                    />
                    <span className="text-sm font-medium">{workflow.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({workflow.stepCount} steps)
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content - flex grow */}
      <div className="flex-1 flex flex-col min-h-0 container mx-auto px-4 py-4">
        {/* Editor toolbar */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <label>
              <Button variant="outline" size="sm" className="gap-2 cursor-pointer" asChild>
                <span>
                  <FileUp className="h-4 w-4" />
                  Upload File
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
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleImport(true)}
              disabled={isImporting || !mermaidCode.trim()}
              className="gap-2"
            >
              {isImporting && isDryRun ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Preview Changes
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleImport(false)}
              disabled={isImporting || !mermaidCode.trim()}
              className="gap-2"
            >
              {isImporting && !isDryRun ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import Workflows
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
          <div className="mt-4 border rounded-lg bg-muted/20 flex-shrink-0">
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
                <span className="font-medium">
                  {isDryRun ? 'Preview Results' : 'Import Complete'}
                </span>
                {importSummary && (
                  <div className="flex items-center gap-3 text-sm">
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
                <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
                  {importResults.map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        'px-3 py-2 border rounded-lg flex items-center gap-2',
                        result.action === 'create' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
                        result.action === 'update' && 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
                        result.action === 'skip' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                      )}
                    >
                      {result.action === 'create' && <Plus className="h-3 w-3 text-green-600" />}
                      {result.action === 'update' && <Pencil className="h-3 w-3 text-blue-600" />}
                      {result.action === 'skip' && <SkipForward className="h-3 w-3 text-amber-600" />}
                      <span className="font-medium text-sm">{result.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {result.stepCount} steps
                      </span>
                      {result.error && (
                        <span className="text-xs text-destructive">({result.error})</span>
                      )}
                    </div>
                  ))}
                </div>
                {isDryRun && (
                  <p className="text-xs text-muted-foreground mt-2">
                    This is a preview. Click &quot;Import Workflows&quot; to apply these changes.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Format reference - small footer */}
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground flex-shrink-0">
          <div className="flex items-center gap-4">
            <span><code className="bg-muted px-1 rounded">%% @workflow: &quot;Name&quot;</code></span>
            <span><code className="bg-muted px-1 rounded">%% @id: abc123</code> for updates</span>
            <span><code className="bg-muted px-1 rounded">subgraph id[&quot;Name&quot;]...end</code></span>
          </div>
        </div>
      </div>
    </div>
  )
}
