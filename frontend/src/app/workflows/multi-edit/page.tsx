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

const MULTI_WORKFLOW_TEMPLATE = `%% Multi-Workflow Mermaid Document
%% Separate workflows with --- on its own line
%% Use @workflow, @id, @description metadata comments

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

---

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-muted/30">
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

      {/* Main content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Editor - takes 2/3 of the space */}
          <div className="lg:col-span-2 flex flex-col">
            {/* Editor toolbar */}
            <div className="flex items-center justify-between mb-4">
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
              <div className="mb-4 px-4 py-3 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Mermaid editor */}
            <MermaidLiveEditor
              value={mermaidCode}
              onChange={setMermaidCode}
              onError={setMermaidError}
              className="flex-1"
              minHeight="600px"
              initialLayout="split"
            />

            {mermaidError && (
              <div className="mt-2 text-sm text-destructive">
                Mermaid syntax error: {mermaidError}
              </div>
            )}
          </div>

          {/* Results panel - takes 1/3 of the space */}
          <div className="flex flex-col">
            <h2 className="text-lg font-medium mb-4">Import Results</h2>

            {!importResults ? (
              <div className="flex-1 flex items-center justify-center text-center text-muted-foreground p-8 border rounded-lg bg-muted/20">
                <div>
                  <Upload className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">
                    Click &quot;Preview Changes&quot; to see what will happen, or &quot;Import
                    Workflows&quot; to apply changes.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary */}
                {importSummary && (
                  <div className="p-4 border rounded-lg bg-muted/20">
                    <div className="flex items-center gap-2 mb-3">
                      {isDryRun ? (
                        <Eye className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                      <span className="font-medium">
                        {isDryRun ? 'Preview' : 'Imported'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-2xl font-bold text-green-600">
                          {importSummary.created}
                        </div>
                        <div className="text-xs text-muted-foreground">Created</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-600">
                          {importSummary.updated}
                        </div>
                        <div className="text-xs text-muted-foreground">Updated</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-amber-600">
                          {importSummary.skipped}
                        </div>
                        <div className="text-xs text-muted-foreground">Skipped</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Individual results */}
                <div className="space-y-2 max-h-[500px] overflow-auto">
                  {importResults.map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        'p-3 border rounded-lg',
                        result.action === 'create' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
                        result.action === 'update' && 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
                        result.action === 'skip' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {result.action === 'create' && (
                            <Plus className="h-4 w-4 text-green-600" />
                          )}
                          {result.action === 'update' && (
                            <Pencil className="h-4 w-4 text-blue-600" />
                          )}
                          {result.action === 'skip' && (
                            <SkipForward className="h-4 w-4 text-amber-600" />
                          )}
                          <span className="font-medium">{result.name}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            result.action === 'create' && 'border-green-500 text-green-700',
                            result.action === 'update' && 'border-blue-500 text-blue-700',
                            result.action === 'skip' && 'border-amber-500 text-amber-700'
                          )}
                        >
                          {result.action}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {result.stepCount} steps
                        {result.id && (
                          <span className="ml-2 font-mono">{result.id.slice(0, 8)}...</span>
                        )}
                      </div>
                      {result.error && (
                        <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {result.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Action hint */}
                {isDryRun && importResults.length > 0 && (
                  <div className="text-sm text-muted-foreground text-center p-2">
                    This is a preview. Click &quot;Import Workflows&quot; to apply these changes.
                  </div>
                )}
              </div>
            )}

            {/* Format reference */}
            <div className="mt-6 p-4 border rounded-lg bg-muted/20">
              <h3 className="text-sm font-medium mb-2">Format Reference</h3>
              <div className="text-xs space-y-1.5 font-mono text-muted-foreground">
                <p>%% @workflow: &quot;Name&quot;</p>
                <p>%% @id: abc123 <span className="text-muted-foreground/60">(for updates)</span></p>
                <p>%% @description: text</p>
                <p>%% @isActive: true|false</p>
                <p className="pt-1">--- <span className="text-muted-foreground/60">(separator)</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
