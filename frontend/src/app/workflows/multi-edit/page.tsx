'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { MermaidLiveEditor } from '@/components/ui/mermaid-live-editor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  Search,
  ListFilter,
  Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface WorkflowSummary {
  _id: string
  name: string
  description?: string
  isActive: boolean
  steps?: { id: string; name: string }[]
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
  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [isDryRun, setIsDryRun] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultsExpanded, setResultsExpanded] = useState(true)

  // Workflow selection state
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<string>>(new Set())
  const [workflowSearchQuery, setWorkflowSearchQuery] = useState('')
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false)
  const [selectorExpanded, setSelectorExpanded] = useState(true)

  // Fetch all workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      setIsLoadingWorkflows(true)
      try {
        const response = await fetch(`${API_BASE}/workflows?includeInactive=true`, {
          headers: getAuthHeader(),
        })
        if (response.ok) {
          const result = await response.json()
          setWorkflows(result.data || [])
        }
      } catch {
        // Silently fail - workflows list is optional
      } finally {
        setIsLoadingWorkflows(false)
      }
    }
    fetchWorkflows()
  }, [])

  // Filter workflows by search query
  const filteredWorkflows = useMemo(() => {
    if (!workflowSearchQuery.trim()) return workflows
    const query = workflowSearchQuery.toLowerCase()
    return workflows.filter(w =>
      w.name.toLowerCase().includes(query) ||
      w.description?.toLowerCase().includes(query)
    )
  }, [workflows, workflowSearchQuery])

  // Toggle workflow selection
  const toggleWorkflowSelection = useCallback((id: string) => {
    setSelectedWorkflowIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Select all filtered workflows
  const selectAllFiltered = useCallback(() => {
    setSelectedWorkflowIds(prev => {
      const next = new Set(prev)
      for (const w of filteredWorkflows) {
        next.add(w._id)
      }
      return next
    })
  }, [filteredWorkflows])

  // Deselect all workflows
  const deselectAll = useCallback(() => {
    setSelectedWorkflowIds(new Set())
  }, [])

  // Export selected workflows (or all if none selected)
  const handleExport = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      let url = `${API_BASE}/workflows/export-multi`
      if (selectedWorkflowIds.size > 0) {
        url += `?ids=${Array.from(selectedWorkflowIds).join(',')}`
      }
      const response = await fetch(url, {
        headers: getAuthHeader(),
      })
      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`)
      }
      const result = await response.json()
      setMermaidCode(result.data.mermaid || '')
      setImportResults(null)
      setImportSummary(null)
      // Collapse selector after export to give more room to editor
      setSelectorExpanded(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsLoading(false)
    }
  }, [selectedWorkflowIds])

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
                {selectedWorkflowIds.size > 0
                  ? `Export ${selectedWorkflowIds.size} Selected`
                  : 'Export All Workflows'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Selector */}
      <div className="border-b bg-muted/10 flex-shrink-0">
        <div className="container mx-auto px-4">
          <Collapsible open={selectorExpanded} onOpenChange={setSelectorExpanded}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-3 hover:bg-muted/20 transition-colors rounded">
              <div className="flex items-center gap-3">
                <ListFilter className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">
                  Select Workflows to Edit
                </span>
                {selectedWorkflowIds.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedWorkflowIds.size} selected
                  </Badge>
                )}
                {workflows.length > 0 && selectedWorkflowIds.size === 0 && (
                  <span className="text-xs text-muted-foreground">
                    (all {workflows.length} workflows will be exported)
                  </span>
                )}
              </div>
              {selectorExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="pb-4 space-y-3">
                {/* Search and bulk actions */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search workflows..."
                      value={workflowSearchQuery}
                      onChange={(e) => setWorkflowSearchQuery(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllFiltered}
                    className="text-xs"
                  >
                    Select All{workflowSearchQuery ? ' Filtered' : ''}
                  </Button>
                  {selectedWorkflowIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deselectAll}
                      className="text-xs text-muted-foreground"
                    >
                      Clear Selection
                    </Button>
                  )}
                </div>

                {/* Workflows list */}
                {isLoadingWorkflows ? (
                  <div className="flex items-center justify-center py-6">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No workflows found. Create some workflows first.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto pr-2">
                    {filteredWorkflows.map((workflow) => (
                      <div
                        key={workflow._id}
                        onClick={() => toggleWorkflowSelection(workflow._id)}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          selectedWorkflowIds.has(workflow._id)
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-background hover:bg-muted/30 border-border'
                        )}
                      >
                        <Checkbox
                          checked={selectedWorkflowIds.has(workflow._id)}
                          onCheckedChange={() => toggleWorkflowSelection(workflow._id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Workflow className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium text-sm truncate">
                              {workflow.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] px-1.5 py-0',
                                workflow.isActive
                                  ? 'text-green-600 border-green-300'
                                  : 'text-gray-400 border-gray-300'
                              )}
                            >
                              {workflow.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            {workflow.steps && (
                              <span className="text-[10px] text-muted-foreground">
                                {workflow.steps.length} steps
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
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
