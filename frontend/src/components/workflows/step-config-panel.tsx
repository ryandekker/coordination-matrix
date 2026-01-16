'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TokenBrowser } from './token-browser'
import { PromptSelector } from './editor/prompt-selector'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { Search, X, FileText, Check, ChevronsUpDown } from 'lucide-react'
import {
  Bot,
  User,
  Globe,
  GitBranch,
  Repeat,
  Merge,
  Workflow as WorkflowIcon,
  Sparkles,
  Download,
  Link2,
  Trash2,
  Plus,
  ArrowRight,
  ArrowDown,
  MessageSquare,
  Info,
  AlertCircle,
  Database,
  Zap,
  CornerDownRight,
  ChevronUp,
  ChevronDown,
  FileSearch,
} from 'lucide-react'

type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument'

interface StepConnection {
  targetStepId: string
  condition?: string | null
  label?: string
}

interface ExternalConfig {
  endpoint?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  payloadTemplate?: string
}

interface JoinBoundary {
  minCount?: number
  minPercent?: number
  maxWaitMs?: number
  failOnTimeout?: boolean
}

type DocumentType = 'sop' | 'strategy' | 'plan' | 'template' | 'reference' | 'output' | 'custom'
type DocumentStatus = 'draft' | 'review' | 'approved' | 'archived'

interface FindDocumentConfig {
  // Mode: 'static' for specific document, 'dynamic' for runtime search
  mode?: 'static' | 'dynamic'
  // Static mode
  documentId?: string
  documentTitle?: string  // For display in UI only
  // Dynamic mode
  searchPrompt?: string
  documentTypes?: DocumentType[]
  documentStatus?: DocumentStatus[]
  tags?: string[]
  limit?: number
  minScore?: number
  // Shared
  storeAs?: string
  failIfNotFound?: boolean
}

interface WorkflowStep {
  id: string
  name: string
  description?: string
  stepType?: WorkflowStepType
  titleTemplate?: string
  connections?: StepConnection[]
  additionalInstructions?: string
  defaultAssigneeId?: string
  promptDocumentIds?: string[]
  externalConfig?: ExternalConfig
  defaultConnection?: string
  decisionField?: string
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  inputSource?: string
  inputPath?: string
  awaitStepId?: string
  joinBoundary?: JoinBoundary
  minSuccessPercent?: number
  expectedCountPath?: string
  flowId?: string
  inputMapping?: Record<string, string>
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
  findDocumentConfig?: FindDocumentConfig
}

interface LoopScope {
  foreachIndex: number
  joinIndex: number
  foreachStep: WorkflowStep
  joinStep: WorkflowStep
}

interface AvailableWorkflow {
  _id: string
  name: string
  description?: string
}

interface StepConfigPanelProps {
  step: WorkflowStep
  stepIndex: number
  allSteps: WorkflowStep[]
  workflowId?: string
  users: { _id: string; displayName: string }[]
  loopScope?: LoopScope | null
  isInLoop: boolean
  availableWorkflows?: AvailableWorkflow[]
  loadingWorkflows?: boolean
  onUpdate: (updates: Partial<WorkflowStep>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAddStepAfter: () => void
  onChangeType: (type: WorkflowStepType) => void
}

const STEP_TYPES: { type: WorkflowStepType; label: string; description: string; icon: React.ElementType; color: string; bgColor: string }[] = [
  { type: 'agent', label: 'Agent', description: 'AI agent task', icon: Bot, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  { type: 'external', label: 'External', description: 'External API call', icon: Globe, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  { type: 'manual', label: 'Manual', description: 'Human task', icon: User, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
  { type: 'decision', label: 'Decision', description: 'Route by condition', icon: GitBranch, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  { type: 'foreach', label: 'ForEach', description: 'Loop over items', icon: Repeat, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  { type: 'join', label: 'Join', description: 'Aggregate results', icon: Merge, color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
  { type: 'flow', label: 'Flow', description: 'Nested workflow', icon: WorkflowIcon, color: 'text-pink-500', bgColor: 'bg-pink-500/10' },
  { type: 'findDocument', label: 'Find Document', description: 'Search documents', icon: FileSearch, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
]

function getStepTypeInfo(stepType?: WorkflowStepType) {
  return STEP_TYPES.find(t => t.type === stepType) || STEP_TYPES[0]
}

function parseInputPath(inputPath?: string): { source: string; path: string } {
  if (!inputPath) return { source: 'previous', path: '' }
  if (inputPath.startsWith('trigger.')) return { source: 'trigger', path: inputPath.slice(8) }
  const match = inputPath.match(/^steps\.([^.]+)\.(.*)$/)
  if (match) return { source: match[1], path: match[2] }
  return { source: 'previous', path: inputPath }
}

function buildInputPath(source?: string, path?: string): string {
  if (!source || source === 'previous') return path || ''
  if (source === 'trigger') return path ? `trigger.${path}` : ''
  return path ? `steps.${source}.${path}` : ''
}

// Document search result type for the picker
interface DocumentSearchResult {
  _id: string
  title: string
  type: DocumentType
  status: DocumentStatus
  summary?: string
}

// FindDocument step configuration component
function FindDocumentConfig({
  step,
  stepIndex,
  workflowId,
  previousSteps,
  isInLoop,
  loopScope,
  onUpdate,
}: {
  step: WorkflowStep
  stepIndex: number
  workflowId?: string
  previousSteps: { id: string; name: string; stepType?: WorkflowStepType; itemVariable?: string }[]
  isInLoop: boolean
  loopScope?: LoopScope | null
  onUpdate: (updates: Partial<WorkflowStep>) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  const mode = step.findDocumentConfig?.mode || 'dynamic'

  // Debounced search
  const searchDocuments = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const response = await fetch(`${API_BASE}/documents?search=${encodeURIComponent(query)}&limit=10`, {
        headers: getAuthHeader(),
      })
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.data || [])
      }
    } catch (error) {
      console.error('Failed to search documents:', error)
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (showSearch && searchQuery) {
        searchDocuments(searchQuery)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, showSearch, searchDocuments])

  const handleSelectDocument = (doc: DocumentSearchResult) => {
    onUpdate({
      findDocumentConfig: {
        ...step.findDocumentConfig,
        mode: 'static',
        documentId: doc._id,
        documentTitle: doc.title,
      }
    })
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
  }

  const handleClearDocument = () => {
    onUpdate({
      findDocumentConfig: {
        ...step.findDocumentConfig,
        documentId: undefined,
        documentTitle: undefined,
      }
    })
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <FileSearch className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
          <div className="text-cyan-800 dark:text-cyan-200">
            <p className="font-medium">Find Document</p>
            <p className="text-xs mt-1">
              Reference a specific document or search dynamically at runtime.
            </p>
          </div>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Document Selection Mode</label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'static' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onUpdate({
              findDocumentConfig: { ...step.findDocumentConfig, mode: 'static' }
            })}
            className="flex-1"
          >
            <FileText className="h-4 w-4 mr-2" />
            Select Document
          </Button>
          <Button
            type="button"
            variant={mode === 'dynamic' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onUpdate({
              findDocumentConfig: { ...step.findDocumentConfig, mode: 'dynamic' }
            })}
            className="flex-1"
          >
            <Search className="h-4 w-4 mr-2" />
            Dynamic Search
          </Button>
        </div>
      </div>

      {/* Static Mode: Document Selector */}
      {mode === 'static' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Selected Document</label>
          {step.findDocumentConfig?.documentId ? (
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <FileText className="h-4 w-4 text-cyan-500 flex-shrink-0" />
              <span className="flex-1 text-sm truncate">
                {step.findDocumentConfig.documentTitle || step.findDocumentConfig.documentId}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearDocument}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {!showSearch ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSearch(true)}
                  className="w-full"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search for Document
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search documents..."
                      className="flex-1"
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowSearch(false)
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="max-h-48 overflow-y-auto border rounded-md">
                    {isSearching ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        Searching...
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((doc) => (
                        <button
                          key={doc._id}
                          type="button"
                          onClick={() => handleSelectDocument(doc)}
                          className="w-full p-2 text-left hover:bg-muted flex items-start gap-2 border-b last:border-b-0"
                        >
                          <FileText className="h-4 w-4 text-cyan-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{doc.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.type} · {doc.status}
                            </p>
                          </div>
                          <Check className="h-4 w-4 text-transparent group-hover:text-cyan-500" />
                        </button>
                      ))
                    ) : searchQuery ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No documents found
                      </div>
                    ) : (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        Type to search documents
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dynamic Mode: Search Configuration */}
      {mode === 'dynamic' && (
        <>
          <div className="space-y-1">
            <label className="text-sm font-medium">Search Prompt</label>
            <div className="flex gap-1">
              <Textarea
                value={step.findDocumentConfig?.searchPrompt || ''}
                onChange={(e) => onUpdate({
                  findDocumentConfig: { ...step.findDocumentConfig, searchPrompt: e.target.value }
                })}
                placeholder='e.g., "Find SOPs about {{input.topic}}" or "Documentation for {{item.productName}}"'
                className="min-h-[60px] font-mono text-sm"
              />
            </div>
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={previousSteps}
              currentStepIndex={stepIndex}
              loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
              onSelectToken={(token) => {
                const current = step.findDocumentConfig?.searchPrompt || ''
                onUpdate({
                  findDocumentConfig: { ...step.findDocumentConfig, searchPrompt: current + token }
                })
              }}
              variant="text"
            />
            <p className="text-xs text-muted-foreground">
              Use template variables like {`{{input.field}}`} to build dynamic search queries from previous step data.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Document Types</label>
              <Select
                value={step.findDocumentConfig?.documentTypes?.[0] || '_any'}
                onValueChange={(val) => onUpdate({
                  findDocumentConfig: {
                    ...step.findDocumentConfig,
                    documentTypes: val === '_any' ? undefined : [val as DocumentType]
                  }
                })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Any type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any type</SelectItem>
                  <SelectItem value="sop">SOP</SelectItem>
                  <SelectItem value="strategy">Strategy</SelectItem>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="template">Template</SelectItem>
                  <SelectItem value="reference">Reference</SelectItem>
                  <SelectItem value="output">Output</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="workflow-prompt">Workflow Prompt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Document Status</label>
              <Select
                value={step.findDocumentConfig?.documentStatus?.[0] || 'approved'}
                onValueChange={(val) => onUpdate({
                  findDocumentConfig: {
                    ...step.findDocumentConfig,
                    documentStatus: [val as DocumentStatus]
                  }
                })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Max Results</label>
              <Input
                type="number"
                min="1"
                max="10"
                value={step.findDocumentConfig?.limit || 1}
                onChange={(e) => onUpdate({
                  findDocumentConfig: {
                    ...step.findDocumentConfig,
                    limit: parseInt(e.target.value) || 1
                  }
                })}
                className="font-mono text-sm h-8"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Min Score (0-1)</label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={step.findDocumentConfig?.minScore || 0.5}
                onChange={(e) => onUpdate({
                  findDocumentConfig: {
                    ...step.findDocumentConfig,
                    minScore: parseFloat(e.target.value) || 0.5
                  }
                })}
                className="font-mono text-sm h-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Tags (comma-separated)</label>
            <Input
              value={step.findDocumentConfig?.tags?.join(', ') || ''}
              onChange={(e) => onUpdate({
                findDocumentConfig: {
                  ...step.findDocumentConfig,
                  tags: e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(Boolean) : undefined
                }
              })}
              placeholder="e.g., onboarding, hr"
              className="font-mono text-sm h-8"
            />
          </div>
        </>
      )}

      {/* Shared Options */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Store Result As</label>
        <Input
          value={step.findDocumentConfig?.storeAs || 'document'}
          onChange={(e) => onUpdate({
            findDocumentConfig: {
              ...step.findDocumentConfig,
              storeAs: e.target.value || 'document'
            }
          })}
          placeholder="document"
          className="font-mono text-sm h-8"
        />
        <p className="text-xs text-muted-foreground">
          Access via {`{{steps.${step.id}.${step.findDocumentConfig?.storeAs || 'document'}}}`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`failIfNotFound-${step.id}`}
          checked={step.findDocumentConfig?.failIfNotFound || false}
          onChange={(e) => onUpdate({
            findDocumentConfig: {
              ...step.findDocumentConfig,
              failIfNotFound: e.target.checked
            }
          })}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor={`failIfNotFound-${step.id}`} className="text-sm">
          Fail step if no document found
        </label>
      </div>
    </div>
  )
}

// Flow step configuration component (extracted to match step-configs.tsx)
function FlowStepConfigPanel({
  step,
  stepIndex,
  workflowId,
  previousSteps,
  isInLoop,
  loopScope,
  availableWorkflows,
  loadingWorkflows,
  flowSelectorOpen,
  setFlowSelectorOpen,
  onUpdate,
}: {
  step: WorkflowStep
  stepIndex: number
  workflowId?: string
  previousSteps: { id: string; name: string; stepType?: WorkflowStepType; itemVariable?: string }[]
  isInLoop: boolean
  loopScope?: LoopScope | null
  availableWorkflows?: AvailableWorkflow[]
  loadingWorkflows?: boolean
  flowSelectorOpen: boolean
  setFlowSelectorOpen: (open: boolean) => void
  onUpdate: (updates: Partial<WorkflowStep>) => void
}) {
  // Initialize inputMapping if it doesn't exist
  const inputMapping = step.inputMapping || {}
  const mappingEntries = Object.entries(inputMapping)

  const addMapping = () => {
    const newMapping = { ...inputMapping, '': '' }
    onUpdate({ inputMapping: newMapping })
  }

  const updateMappingKey = (oldKey: string, newKey: string) => {
    const entries = Object.entries(inputMapping)
    const newMapping: Record<string, string> = {}
    for (const [k, v] of entries) {
      if (k === oldKey) {
        newMapping[newKey] = v
      } else {
        newMapping[k] = v
      }
    }
    onUpdate({ inputMapping: newMapping })
  }

  const updateMappingValue = (key: string, value: string) => {
    onUpdate({ inputMapping: { ...inputMapping, [key]: value } })
  }

  const removeMapping = (key: string) => {
    const newMapping = { ...inputMapping }
    delete newMapping[key]
    onUpdate({ inputMapping: newMapping })
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <WorkflowIcon className="h-4 w-4 text-pink-600 dark:text-pink-400 mt-0.5 flex-shrink-0" />
          <div className="text-pink-800 dark:text-pink-200">
            <p className="font-medium">Nested Workflow</p>
            <p className="text-xs mt-1">
              Delegates execution to another workflow. Input data is mapped from previous steps
              and results are returned when the subflow completes.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Target Workflow</label>
        <Popover open={flowSelectorOpen} onOpenChange={setFlowSelectorOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={flowSelectorOpen}
              className="w-full h-9 justify-between font-normal"
              disabled={loadingWorkflows}
            >
              {loadingWorkflows ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : step.flowId ? (
                <span className="flex items-center gap-2 truncate">
                  <WorkflowIcon className="h-4 w-4 text-pink-500 flex-shrink-0" />
                  <span className="truncate">
                    {availableWorkflows?.find(wf => wf._id === step.flowId)?.name || step.flowId}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select a workflow...</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search workflows..." />
              <CommandList>
                <CommandEmpty>
                  {loadingWorkflows ? 'Loading workflows...' : 'No workflow found.'}
                </CommandEmpty>
                <CommandGroup>
                  {availableWorkflows?.map((wf) => (
                    <CommandItem
                      key={wf._id}
                      value={wf.name}
                      onSelect={() => {
                        onUpdate({ flowId: wf._id })
                        setFlowSelectorOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          step.flowId === wf._id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{wf.name}</span>
                        {wf.description && (
                          <span className="text-xs opacity-60 truncate">
                            {wf.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          The workflow to delegate execution to.
        </p>
      </div>

      {/* Input Mapping Section */}
      <div className="space-y-2 border-t pt-3 mt-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            Input Mapping
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMapping}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Field
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Map data from previous steps to the subflow&apos;s input. Each field becomes available
          in the subflow as <code className="bg-muted px-1 rounded">{"{{inputPayload.fieldName}}"}</code>
        </p>

        {mappingEntries.length === 0 ? (
          <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground text-center">
            No input mappings defined. The subflow will receive the full input from the previous step.
          </div>
        ) : (
          <div className="space-y-2">
            {mappingEntries.map(([key, value], mappingIdx) => (
              <div key={mappingIdx} className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(e) => updateMappingKey(key, e.target.value)}
                  placeholder="fieldName"
                  className="w-[140px] font-mono text-sm h-9"
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 flex gap-1">
                  <Input
                    value={value}
                    onChange={(e) => updateMappingValue(key, e.target.value)}
                    placeholder="{{output.data}} or {{item.field}}"
                    className="font-mono text-sm h-9"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                    onSelectToken={(token) => updateMappingValue(key, token)}
                    variant="icon"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-destructive"
                  onClick={() => removeMapping(key)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Quick add common mappings */}
        <div className="flex flex-wrap gap-1 mt-2">
          <span className="text-xs text-muted-foreground">Quick add:</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => onUpdate({
              inputMapping: { ...inputMapping, 'data': '{{output}}' }
            })}
          >
            output
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => onUpdate({
              inputMapping: { ...inputMapping, 'title': '{{output.title}}' }
            })}
          >
            output.title
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => onUpdate({
              inputMapping: { ...inputMapping, 'item': '{{item}}' }
            })}
          >
            item (loop)
          </Button>
        </div>
      </div>

      {/* Info about output extraction */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-sm mt-3">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-blue-800 dark:text-blue-200 text-xs">
            <p className="font-medium">Output from Subflow</p>
            <p className="mt-0.5">
              When the subflow completes, its output will be available to subsequent steps
              via <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{"{{output}}"}</code> containing
              the aggregated results from all subflow steps.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Decision step configuration component
function DecisionStepConfig({
  step,
  stepIndex,
  allSteps,
  workflowId,
  previousSteps,
  loopVariable,
  onUpdate,
}: {
  step: WorkflowStep
  stepIndex: number
  allSteps: WorkflowStep[]
  workflowId?: string
  previousSteps: Array<{ id: string; name: string; stepType?: string; itemVariable?: string }>
  loopVariable?: string
  onUpdate: (updates: Partial<WorkflowStep>) => void
}) {
  const [showDocs, setShowDocs] = useState(false)
  const hasDecisionField = !!step.decisionField

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-amber-800 dark:text-amber-200">
            <p className="font-medium">Decision / Router</p>
            <p className="text-xs mt-1">
              Routes to different branches based on a field value from the input payload.
            </p>
          </div>
        </div>
      </div>

      {/* Decision Field - the path to evaluate */}
      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Decision Field
        </label>
        <div className="flex gap-1">
          <Input
            value={step.decisionField || ''}
            onChange={(e) => onUpdate({ decisionField: e.target.value })}
            placeholder="e.g., output.route or status"
            className="font-mono text-sm"
          />
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={previousSteps}
            currentStepIndex={stepIndex}
            loopVariable={loopVariable}
            onSelectToken={(token) => onUpdate({ decisionField: token })}
            wrapInBraces={false}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Path to the field in the input payload to evaluate. Branches then just specify the values to match.
        </p>
      </div>

      {/* Collapsible documentation */}
      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDocs(!showDocs)}
          className="w-full flex items-center justify-between p-2 text-sm bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 text-muted-foreground" />
            Help & Examples
          </span>
          {showDocs ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {showDocs && (
          <div className="p-3 text-xs space-y-3 bg-background border-t">
            <div>
              <p className="font-medium text-sm mb-1">How It Works</p>
              <p className="text-muted-foreground">
                {hasDecisionField ? (
                  <>Set the <strong>Decision Field</strong> above, then each branch just needs the value(s) to match.</>
                ) : (
                  <>Set a <strong>Decision Field</strong> to simplify branches to just values, or use full <code className="bg-muted px-1 rounded">field:value</code> format per branch.</>
                )}
              </p>
            </div>

            <div>
              <p className="font-medium text-sm mb-1">Examples</p>
              <div className="space-y-2 font-mono">
                {hasDecisionField ? (
                  <>
                    <div className="bg-muted/50 p-2 rounded">
                      <p className="text-muted-foreground text-[10px]">Decision Field: <code>{step.decisionField}</code></p>
                      <p className="text-amber-600 dark:text-amber-400 mt-1">Review</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">
                        Matches when <code>{step.decisionField} = "Review"</code>
                      </p>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <p className="text-amber-600 dark:text-amber-400">approved,pending</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">
                        Matches when value is "approved" OR "pending" (comma-separated)
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-muted/50 p-2 rounded">
                      <p className="text-amber-600 dark:text-amber-400">route:Review</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">
                        Full format: field:value
                      </p>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <p className="text-amber-600 dark:text-amber-400">output.status:approved,pending</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">
                        Nested path with multiple values
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="text-muted-foreground">
              <p>Matching is <strong>case-insensitive</strong>.</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <CornerDownRight className="h-4 w-4 text-muted-foreground" />
          Branch Routes
        </label>

        {(step.connections || []).map((conn, connIdx) => (
          <div key={connIdx} className="flex items-center gap-2 pl-4 border-l-2 border-amber-300">
            <Input
              value={conn.condition || conn.label || ''}
              onChange={(e) => {
                const newConns = [...(step.connections || [])]
                newConns[connIdx] = { ...newConns[connIdx], condition: e.target.value, label: e.target.value }
                onUpdate({ connections: newConns })
              }}
              placeholder={hasDecisionField ? "value (e.g., Review)" : "field:value (e.g., route:Review)"}
              className="font-mono text-sm flex-1"
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Select
              value={conn.targetStepId}
              onValueChange={(val) => {
                const newConns = [...(step.connections || [])]
                newConns[connIdx] = { ...newConns[connIdx], targetStepId: val }
                onUpdate({ connections: newConns })
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Target" />
              </SelectTrigger>
              <SelectContent>
                {allSteps.filter((_, i) => i > stepIndex).map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive"
              onClick={() => {
                const newConns = (step.connections || []).filter((_, i) => i !== connIdx)
                onUpdate({ connections: newConns })
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const newConns = [...(step.connections || []), { targetStepId: '', condition: '' }]
            onUpdate({ connections: newConns })
          }}
          className="ml-4"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Branch
        </Button>
      </div>
    </div>
  )
}

export function StepConfigPanel({
  step,
  stepIndex,
  allSteps,
  workflowId,
  users,
  loopScope,
  isInLoop,
  availableWorkflows,
  loadingWorkflows,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddStepAfter,
  onChangeType,
}: StepConfigPanelProps) {
  const [flowSelectorOpen, setFlowSelectorOpen] = useState(false)
  const typeInfo = getStepTypeInfo(step.stepType)
  const TypeIcon = typeInfo.icon

  const previousSteps = allSteps.slice(0, stepIndex).map(s => ({
    id: s.id,
    name: s.name,
    stepType: s.stepType,
    itemVariable: s.itemVariable,
  }))

  return (
    <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">
              Step {stepIndex + 1}
            </span>
            <div className={cn('p-1 rounded', typeInfo.bgColor)}>
              <TypeIcon className={cn('h-4 w-4', typeInfo.color)} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onMoveUp}
              disabled={stepIndex === 0}
              title="Move up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onMoveDown}
              disabled={stepIndex === allSteps.length - 1}
              title="Move down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive"
              onClick={onDelete}
              title="Delete step"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Name and Type */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Step Name</label>
            <Input
              value={step.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="Step name"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Step Type</label>
            <Select
              value={step.stepType}
              onValueChange={(val) => onChangeType(val as WorkflowStepType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STEP_TYPES.map((st) => (
                  <SelectItem key={st.type} value={st.type}>
                    <div className="flex items-center gap-2">
                      <st.icon className={cn('h-4 w-4', st.color)} />
                      <span>{st.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Task Title Template - available for all step types */}
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Task Title Template
            <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <div className="flex gap-1">
            <Input
              value={step.titleTemplate || ''}
              onChange={(e) => onUpdate({ titleTemplate: e.target.value })}
              placeholder={`e.g., "Review: {{item.name}}" or "Process {{input.customerName}}"`}
              className="font-mono text-sm"
            />
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={previousSteps}
              currentStepIndex={stepIndex}
              loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
              onSelectToken={(token) => {
                const current = step.titleTemplate || ''
                onUpdate({ titleTemplate: current + token })
              }}
              variant="text"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Dynamic title for tasks created from this step.
          </p>
        </div>

        {/* Agent step configuration */}
        {(step.stepType === 'agent' || (!step.stepType && step.execution !== 'manual')) && (
          <div className="space-y-3 border-t pt-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-blue-800 dark:text-blue-200">
                  <p className="font-medium">AI Agent Task</p>
                  <p className="text-xs mt-1">
                    This step is handled by an AI agent. The prompt is optional.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Default Assignee
              </label>
              <Select
                value={step.defaultAssigneeId || '_none'}
                onValueChange={(val) => onUpdate({ defaultAssigneeId: val === '_none' ? undefined : val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select default assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No default assignee</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompt Library Selector */}
            <PromptSelector
              selectedPromptIds={step.promptDocumentIds || []}
              onChange={(promptIds) => onUpdate({ promptDocumentIds: promptIds.length > 0 ? promptIds : undefined })}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Additional Instructions
              </label>
              <Textarea
                value={step.additionalInstructions || step.prompt || ''}
                onChange={(e) => onUpdate({ additionalInstructions: e.target.value })}
                placeholder="Instructions for the AI agent..."
                className="min-h-[80px] font-mono text-sm"
              />
              <TokenBrowser
                workflowId={workflowId}
                previousSteps={previousSteps}
                currentStepIndex={stepIndex}
                loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                onSelectToken={(token) => {
                  const current = step.additionalInstructions || ''
                  onUpdate({ additionalInstructions: current + token })
                }}
                variant="text"
              />
            </div>

          </div>
        )}

        {/* External step configuration */}
        {step.stepType === 'external' && (
          <div className="space-y-3 border-t pt-3">
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Globe className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                <div className="text-orange-800 dark:text-orange-200">
                  <p className="font-medium">External Service Call</p>
                  <p className="text-xs mt-1">
                    Calls an external API or webhook.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-xs">
              <div className="flex items-start gap-2">
                <Link2 className="h-3 w-3 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-blue-800 dark:text-blue-200 space-y-1.5">
                  <p className="font-medium">Template Variables (from task.metadata.inputPayload)</p>
                  <div className="space-y-1 font-mono text-[10px]">
                    <p><span className="text-blue-600 dark:text-blue-300">System:</span> {`{{_apiUrl}}`}, {`{{_apiKey}}`}, {`{{_workflowRunId}}`}</p>
                    <p><span className="text-blue-600 dark:text-blue-300">Callbacks:</span> {`{{systemWebhookUrl}}`}, {`{{callbackSecret}}`}, {`{{taskId}}`}</p>
                    <p><span className="text-blue-600 dark:text-blue-300">This task:</span> {`{{title}}`}, {`{{status}}`}, {`{{tags}}`}, {`{{summary}}`}</p>
                    <p><span className="text-blue-600 dark:text-blue-300">Prev step:</span> {`{{output}}`}, {`{{output.field}}`}, {`{{response.field}}`}</p>
                    <p><span className="text-blue-600 dark:text-blue-300">Loop item:</span> {`{{item}}`}, {`{{item.field}}`}, {`{{_index}}`}</p>
                  </div>
                  <p className="text-[10px] opacity-75">
                    Use the Token browser below to see actual data from previous runs.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Method</label>
                <Select
                  value={step.externalConfig?.method || 'POST'}
                  onValueChange={(val) => onUpdate({
                    externalConfig: { ...step.externalConfig, method: val as any }
                  })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="PATCH">PATCH</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 space-y-1">
                <label className="text-xs font-medium">Endpoint URL</label>
                <Input
                  value={step.externalConfig?.endpoint || ''}
                  onChange={(e) => onUpdate({
                    externalConfig: { ...step.externalConfig, endpoint: e.target.value }
                  })}
                  placeholder="https://api.example.com/webhook"
                  className="font-mono text-xs h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Payload Template (JSON)</label>
              <Textarea
                value={step.externalConfig?.payloadTemplate || ''}
                onChange={(e) => onUpdate({
                  externalConfig: { ...step.externalConfig, payloadTemplate: e.target.value }
                })}
                placeholder={`{
  "callbackUrl": "{{systemWebhookUrl}}",
  "data": "{{input.previousStep.output}}"
}`}
                className="min-h-[80px] font-mono text-xs"
              />
              <TokenBrowser
                workflowId={workflowId}
                previousSteps={previousSteps}
                currentStepIndex={stepIndex}
                loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                onSelectToken={(token) => {
                  const current = step.externalConfig?.payloadTemplate || ''
                  onUpdate({
                    externalConfig: { ...step.externalConfig, payloadTemplate: current + token }
                  })
                }}
                variant="text"
              />
            </div>
          </div>
        )}

        {/* Manual step configuration */}
        {step.stepType === 'manual' && (
          <div className="space-y-3 border-t pt-3">
            <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                <div className="text-purple-800 dark:text-purple-200">
                  <p className="font-medium">Human Task</p>
                  <p className="text-xs mt-1">
                    Requires human review or action.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Default Assignee
              </label>
              <Select
                value={step.defaultAssigneeId || '_none'}
                onValueChange={(val) => onUpdate({ defaultAssigneeId: val === '_none' ? undefined : val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select default assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No default assignee</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Decision step configuration */}
        {step.stepType === 'decision' && (
          <DecisionStepConfig
            step={step}
            stepIndex={stepIndex}
            allSteps={allSteps}
            workflowId={workflowId}
            previousSteps={previousSteps}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onUpdate={onUpdate}
          />
        )}

        {/* ForEach configuration */}
        {step.stepType === 'foreach' && (
          <div className="space-y-3 border-t pt-3">
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Repeat className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div className="text-green-800 dark:text-green-200">
                  <p className="font-medium">Loop Configuration</p>
                  <p className="text-xs mt-1">
                    Creates a task for each item in the collection.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Items Path</label>
                <div className="flex gap-1">
                  <Input
                    value={step.itemsPath || ''}
                    onChange={(e) => onUpdate({ itemsPath: e.target.value })}
                    placeholder="e.g., output.emails"
                    className="font-mono text-sm"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    onSelectToken={(token) => onUpdate({ itemsPath: token })}
                    wrapInBraces={false}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Item Variable</label>
                <Input
                  value={step.itemVariable || ''}
                  onChange={(e) => onUpdate({ itemVariable: e.target.value })}
                  placeholder="e.g., email, item"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Max Items</label>
                <Input
                  type="number"
                  value={step.maxItems || ''}
                  onChange={(e) => onUpdate({ maxItems: parseInt(e.target.value) || undefined })}
                  placeholder="100"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Expected Count Path</label>
                <div className="flex gap-1">
                  <Input
                    value={step.expectedCountPath || ''}
                    onChange={(e) => onUpdate({ expectedCountPath: e.target.value })}
                    placeholder="e.g., response.totalItems"
                    className="font-mono text-sm"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    onSelectToken={(token) => onUpdate({ expectedCountPath: token })}
                    wrapInBraces={false}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Join configuration */}
        {step.stepType === 'join' && (
          <div className="space-y-3 border-t pt-3">
            <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Merge className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                <div className="text-indigo-800 dark:text-indigo-200">
                  <p className="font-medium">Join / Aggregation</p>
                  <p className="text-xs mt-1">
                    Waits for parallel tasks and aggregates results.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Expected Count Path</label>
              <div className="flex gap-1">
                <Input
                  value={step.expectedCountPath || ''}
                  onChange={(e) => onUpdate({ expectedCountPath: e.target.value })}
                  placeholder="response.totalItems"
                  className="font-mono text-sm"
                />
                <TokenBrowser
                  workflowId={workflowId}
                  previousSteps={previousSteps}
                  currentStepIndex={stepIndex}
                  onSelectToken={(token) => onUpdate({ expectedCountPath: token })}
                  wrapInBraces={false}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Path to the expected number of tasks. Set this and Max Wait to enable min thresholds.
              </p>
            </div>

            {step.expectedCountPath && step.joinBoundary?.maxWaitMs && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Min Success %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={step.joinBoundary?.minPercent ?? step.minSuccessPercent ?? ''}
                    onChange={(e) => onUpdate({
                      joinBoundary: {
                        ...step.joinBoundary,
                        minPercent: e.target.value ? parseInt(e.target.value) : undefined
                      },
                      minSuccessPercent: e.target.value ? parseInt(e.target.value) : undefined
                    })}
                    placeholder="100"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Min Count</label>
                  <Input
                    type="number"
                    min="0"
                    value={step.joinBoundary?.minCount ?? ''}
                    onChange={(e) => onUpdate({
                      joinBoundary: {
                        ...step.joinBoundary,
                        minCount: e.target.value ? parseInt(e.target.value) : undefined
                      }
                    })}
                    placeholder="All tasks"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium">Max Wait (ms)</label>
              <Input
                type="number"
                min="0"
                value={step.joinBoundary?.maxWaitMs ?? ''}
                onChange={(e) => onUpdate({
                  joinBoundary: {
                    ...step.joinBoundary,
                    maxWaitMs: e.target.value ? parseInt(e.target.value) : undefined
                  }
                })}
                placeholder="No timeout"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Input Path</label>
              <div className="flex gap-1">
                <Input
                  value={step.inputPath || ''}
                  onChange={(e) => onUpdate({ inputPath: e.target.value })}
                  placeholder="e.g., output.analysis"
                  className="font-mono text-sm"
                />
                <TokenBrowser
                  workflowId={workflowId}
                  previousSteps={previousSteps}
                  currentStepIndex={stepIndex}
                  loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                  onSelectToken={(token) => onUpdate({ inputPath: token })}
                  wrapInBraces={false}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                JSONPath to extract from each completed task.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Await Step</label>
              <Select
                value={step.awaitStepId || '_auto'}
                onValueChange={(val) => onUpdate({ awaitStepId: val === '_auto' ? undefined : val })}
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_auto">Auto-detect (most recent ForEach)</SelectItem>
                  {allSteps.slice(0, stepIndex).filter(s => s.stepType === 'foreach').map((s, i) => (
                    <SelectItem key={s.id} value={s.id}>
                      Step {i + 1}: {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which ForEach step's tasks to wait for.
              </p>
            </div>
          </div>
        )}

        {/* Flow configuration */}
        {step.stepType === 'flow' && (
          <FlowStepConfigPanel
            step={step}
            stepIndex={stepIndex}
            workflowId={workflowId}
            previousSteps={previousSteps}
            isInLoop={isInLoop}
            loopScope={loopScope}
            availableWorkflows={availableWorkflows}
            loadingWorkflows={loadingWorkflows}
            flowSelectorOpen={flowSelectorOpen}
            setFlowSelectorOpen={setFlowSelectorOpen}
            onUpdate={onUpdate}
          />
        )}

        {/* FindDocument configuration */}
        {step.stepType === 'findDocument' && (
          <FindDocumentConfig
            step={step}
            stepIndex={stepIndex}
            workflowId={workflowId}
            previousSteps={previousSteps}
            isInLoop={isInLoop}
            loopScope={loopScope}
            onUpdate={onUpdate}
          />
        )}

        {/* Input Source - for steps that receive data */}
        {stepIndex > 0 && step.stepType !== 'foreach' && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium">Input Data Source</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From Step</label>
                <Select
                  value={step.inputSource || 'previous'}
                  onValueChange={(val) => onUpdate({ inputSource: val })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previous">
                      <span className="flex items-center gap-2">
                        <ArrowDown className="h-3 w-3" />
                        Previous Step
                      </span>
                    </SelectItem>
                    <SelectItem value="trigger">
                      <span className="flex items-center gap-2">
                        <Zap className="h-3 w-3" />
                        Workflow Trigger
                      </span>
                    </SelectItem>
                    {allSteps.slice(0, stepIndex).map((s, i) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="text-xs">Step {i + 1}: {s.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Data Path</label>
                <div className="flex gap-1">
                  <Input
                    value={parseInputPath(step.inputPath).path}
                    onChange={(e) => {
                      const newPath = buildInputPath(step.inputSource, e.target.value)
                      onUpdate({ inputPath: newPath })
                    }}
                    placeholder="e.g., output.data"
                    className="h-8 text-sm font-mono"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                    onSelectToken={(token) => {
                      const newPath = buildInputPath(step.inputSource, token)
                      onUpdate({ inputPath: newPath })
                    }}
                    wrapInBraces={false}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-1 border-t pt-3">
          <label className="text-sm font-medium">Description</label>
          <Input
            value={step.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Optional description"
          />
        </div>

        {/* Add step after button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddStepAfter}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Step After
        </Button>
    </div>
  )
}
