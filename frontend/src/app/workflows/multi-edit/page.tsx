'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

const MULTI_WORKFLOW_TEMPLATE = `%% ============================================================
%% Multi-Workflow Mermaid Document
%% Separate workflows with: %% ======== (at least 8 equals signs)
%% ============================================================

%% @workflow: "My New Workflow"
%% @description: Description of this workflow
flowchart TD
    step1["First Step"]
    step2("Manual Review")
    step3{{"API Call"}}
    step1 --> step2 --> step3

    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    classDef external fill:#F97316,color:#fff
    class step1 agent
    class step2 manual
    class step3 external

%% ========================================================

%% @workflow: "Another Workflow"
%% @description: A second workflow in the same document
flowchart TD
    start["Begin Process"]
    nested[["Run: My New Workflow"]]
    finish["Complete"]
    start --> nested --> finish

    classDef agent fill:#3B82F6,color:#fff
    classDef flow fill:#EC4899,color:#fff
    class start,finish agent
    class nested flow
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

  // Export all workflows
  const handleExport = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/workflows/export-multi`, {
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
                onClick={handleNewFromTemplate}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New from Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isLoading}
                className="gap-2"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export All Workflows
              </Button>
            </div>
          </div>
        </div>
      </div>

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

        {mermaidError && (
          <div className="mt-2 text-sm text-amber-600 dark:text-amber-400 flex-shrink-0">
            Note: Preview shows first workflow only. Use separators: %% ======== (8+ equals)
          </div>
        )}

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
            <span><code className="bg-muted px-1 rounded">%% ========</code> separator</span>
          </div>
        </div>
      </div>
    </div>
  )
}
