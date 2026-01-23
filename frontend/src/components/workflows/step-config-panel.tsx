'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
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
import { Search, X, FileText, Check, ChevronsUpDown, Maximize2, Play, Terminal, Package } from 'lucide-react'
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
  Code,
} from 'lucide-react'

type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument' | 'code'

// Available packages for the code sandbox - matches backend CodeSandboxPackage type
type CodeSandboxPackage =
  // HTTP & Networking
  | 'node-fetch' | 'axios' | 'qs'
  // Data Manipulation
  | 'lodash' | 'ramda' | 'immer' | 'deepmerge'
  // String & Text
  | 'validator' | 'slugify' | 'change-case' | 'marked' | 'sanitize-html'
  // Numbers & Math
  | 'bignumber.js' | 'decimal.js' | 'mathjs' | 'currency.js'
  // Date & Time
  | 'date-fns' | 'dayjs' | 'luxon' | 'ms'
  // JSON & Data Formats
  | 'jsonpath-plus' | 'json5' | 'yaml' | 'csv-parse' | 'csv-stringify' | 'papaparse' | 'fast-xml-parser'
  // Validation & Schema
  | 'zod' | 'yup' | 'ajv'
  // UUID & IDs
  | 'uuid' | 'nanoid' | 'ulid' | 'hashids'
  // Crypto & Security
  | 'crypto-js' | 'bcryptjs' | 'jsonwebtoken' | 'js-base64'
  // Async & Flow Control
  | 'p-limit' | 'p-map' | 'p-retry' | 'delay'
  // Templating
  | 'handlebars' | 'mustache' | 'ejs'
  // Comparison & Diff
  | 'fast-json-patch' | 'diff'
  // Encoding & Compression
  | 'pako' | 'lz-string'
  // Random & Fake Data
  | '@faker-js/faker'

// Code step configuration
interface CodeStepConfig {
  code: string
  packages?: CodeSandboxPackage[]
  timeout?: number
  continueOnError?: boolean
}

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
  waitForCallback?: boolean
  successStatusCodes?: number[]
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
  codeConfig?: CodeStepConfig
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
  { type: 'code', label: 'Code', description: 'Run JavaScript', icon: Code, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
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
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={previousSteps}
              currentStepIndex={stepIndex}
              loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
              onSelectToken={() => {}}
              variant="text"
              fieldLabel="Search Query"
              fieldValue={step.findDocumentConfig?.searchPrompt || ''}
              onFieldValueChange={(value) => onUpdate({
                findDocumentConfig: { ...step.findDocumentConfig, searchPrompt: value }
              })}
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

// External step configuration component with editable headers
function ExternalStepConfigPanel({
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
  const waitForCallback = step.externalConfig?.waitForCallback !== false

  // Default headers that system will use - shown as info
  const DEFAULT_HEADERS = { 'Content-Type': 'application/json' }

  // Track raw headers text for editing (allows invalid JSON while typing)
  const [headersText, setHeadersText] = useState(() => {
    if (step.externalConfig?.headers && Object.keys(step.externalConfig.headers).length > 0) {
      return JSON.stringify(step.externalConfig.headers, null, 2)
    }
    return ''
  })
  const [headersError, setHeadersError] = useState<string | null>(null)

  // Sync headersText when step changes externally
  useEffect(() => {
    if (step.externalConfig?.headers && Object.keys(step.externalConfig.headers).length > 0) {
      const newText = JSON.stringify(step.externalConfig.headers, null, 2)
      // Only update if different to avoid cursor jump
      if (newText !== headersText) {
        setHeadersText(newText)
        setHeadersError(null)
      }
    }
  }, [step.id]) // Only re-sync when step changes, not on every header change

  // Validate and save headers on blur
  const handleHeadersBlur = () => {
    if (!headersText.trim()) {
      // Empty is valid - clear headers
      onUpdate({ externalConfig: { ...step.externalConfig, headers: undefined } })
      setHeadersError(null)
      return
    }
    try {
      const parsed = JSON.parse(headersText)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setHeadersError('Headers must be a JSON object')
        return
      }
      onUpdate({ externalConfig: { ...step.externalConfig, headers: parsed } })
      setHeadersError(null)
    } catch (e) {
      setHeadersError('Invalid JSON')
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <Globe className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
          <div className="text-orange-800 dark:text-orange-200">
            <p className="font-medium">External HTTP Call</p>
            <p className="text-xs mt-1">
              {waitForCallback
                ? 'Sends request and waits for external system to call back with results.'
                : 'Sends request and continues immediately (fire-and-forget).'}
            </p>
          </div>
        </div>
      </div>

      {/* Wait for callback toggle */}
      <div className="flex items-center gap-3 py-2 px-3 bg-muted/30 rounded-lg">
        <input
          type="checkbox"
          id={`waitForCallback-${step.id}`}
          checked={waitForCallback}
          onChange={(e) => onUpdate({
            externalConfig: { ...step.externalConfig, waitForCallback: e.target.checked }
          })}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor={`waitForCallback-${step.id}`} className="text-sm">
          <span className="font-medium">Wait for callback</span>
          <span className="text-muted-foreground ml-2">
            {waitForCallback ? '(async - workflow pauses until callback)' : '(fire-and-forget - continues immediately)'}
          </span>
        </label>
      </div>

      {/* Callback URL info for async flows */}
      {waitForCallback && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-blue-800 dark:text-blue-200">
              <p className="font-medium">Callback URL (for async responses)</p>
              <p className="text-xs mt-1 mb-2">
                If the external service needs to send results back asynchronously,
                include these template variables in your payload:
              </p>
              <div className="bg-muted/60 rounded p-2 font-mono text-xs space-y-1">
                <p><span className="text-blue-600">{"{{systemWebhookUrl}}"}</span> - Webhook endpoint URL</p>
                <p><span className="text-blue-600">{"{{callbackSecret}}"}</span> - Auth token for callback</p>
                <p><span className="text-blue-600">{"{{workflowRunId}}"}</span> - Current workflow run ID</p>
                <p><span className="text-blue-600">{"{{stepId}}"}</span> - This step&apos;s ID</p>
                <p><span className="text-blue-600">{"{{taskId}}"}</span> - Current task ID</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Token Info - shown for fire-and-forget mode */}
      {!waitForCallback && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="text-emerald-800 dark:text-emerald-200">
              <p className="font-medium">System Variables</p>
              <p className="text-xs mt-1 mb-2">
                Use these tokens for calling internal APIs or referencing previous step outputs:
              </p>
              <div className="bg-muted/60 rounded p-2 font-mono text-xs space-y-1">
                <p><span className="text-emerald-600">{"{{_apiUrl}}"}</span> - Base API URL (e.g., http://localhost:3001)</p>
                <p><span className="text-emerald-600">{"{{_apiKey}}"}</span> - System API key for authentication</p>
                <p><span className="text-emerald-600">{"{{_workflowRunId}}"}</span> - Current workflow run ID</p>
                <p><span className="text-emerald-600">{"{{output.field}}"}</span> - Previous step&apos;s output (use Token Browser for paths)</p>
              </div>
              <p className="text-xs mt-2 text-emerald-700 dark:text-emerald-300">
                <strong>Note:</strong> {"{{_apiKey}}"} requires MATRIX_API_KEY env var on the server.
              </p>
            </div>
          </div>
        </div>
      )}

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

      {/* Headers - editable with proper state management */}
      <div className="space-y-1">
        <label className="text-xs font-medium flex items-center gap-2">
          Headers (JSON)
          {headersError && (
            <span className="text-destructive text-[10px]">{headersError}</span>
          )}
        </label>
        <Textarea
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          onBlur={handleHeadersBlur}
          placeholder={`{
  "Authorization": "Bearer {{_apiKey}}",
  "X-Custom-Header": "value"
}`}
          className={cn(
            "min-h-[80px] font-mono text-xs",
            headersError && "border-destructive"
          )}
        />
        <div className="flex items-center gap-2 mt-1">
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={previousSteps}
            currentStepIndex={stepIndex}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={() => {
              // Token selection handled by onFieldValueChange
            }}
            fieldLabel="Headers"
            fieldValue={headersText}
            onFieldValueChange={(value) => {
              setHeadersText(value)
              // Also try to parse and save if valid
              if (!value.trim()) {
                onUpdate({ externalConfig: { ...step.externalConfig, headers: undefined } })
                setHeadersError(null)
              } else {
                try {
                  const parsed = JSON.parse(value)
                  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                    onUpdate({ externalConfig: { ...step.externalConfig, headers: parsed } })
                    setHeadersError(null)
                  }
                } catch {
                  // Allow invalid JSON while typing
                }
              }
            }}
            variant="text"
          />
          <span className="text-xs text-muted-foreground">
            Browse and insert tokens into headers
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> <code className="bg-muted px-1 rounded">Content-Type: application/json</code> is added automatically.
          Add additional headers here (leave empty if none needed).
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Payload Template (JSON)</label>
        <Textarea
          value={step.externalConfig?.payloadTemplate || ''}
          onChange={(e) => onUpdate({
            externalConfig: { ...step.externalConfig, payloadTemplate: e.target.value }
          })}
          placeholder={waitForCallback ? `{
  "callbackUrl": "{{systemWebhookUrl}}",
  "callbackSecret": "{{callbackSecret}}",
  "workflowRunId": "{{workflowRunId}}",
  "stepId": "{{stepId}}",
  "taskId": "{{taskId}}",
  "data": "{{input.previousStep.output}}"
}` : `{
  "title": "{{output.document.title}}",
  "content": "{{output.document.content}}",
  "workflowRunId": "{{_workflowRunId}}"
}`}
          className="min-h-[100px] font-mono text-xs"
        />
        <div className="flex items-center gap-2 mt-1">
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={previousSteps}
            currentStepIndex={stepIndex}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={() => {
              // Token selection handled by onFieldValueChange
            }}
            fieldLabel="Payload Template"
            fieldValue={step.externalConfig?.payloadTemplate || ''}
            onFieldValueChange={(value) => {
              onUpdate({
                externalConfig: { ...step.externalConfig, payloadTemplate: value }
              })
            }}
            variant="text"
          />
          <span className="text-xs text-muted-foreground">
            Browse and insert tokens into payload
          </span>
        </div>
      </div>

      {/* Success status codes - only shown when not waiting for callback */}
      {!waitForCallback && (
        <div className="space-y-1">
          <label className="text-xs font-medium">Success Status Codes</label>
          <Input
            value={step.externalConfig?.successStatusCodes?.join(', ') || '200, 201'}
            onChange={(e) => {
              const codes = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
              onUpdate({
                externalConfig: { ...step.externalConfig, successStatusCodes: codes }
              })
            }}
            placeholder="200, 201"
            className="font-mono text-xs h-8"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list of HTTP status codes that indicate success
          </p>
        </div>
      )}
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

// Available packages for the code sandbox with metadata
const CODE_PACKAGES: Array<{ value: CodeSandboxPackage; label: string; description: string; sandboxName: string; category: string }> = [
  // HTTP & Networking
  { value: 'node-fetch', label: 'fetch', description: 'HTTP fetch API', sandboxName: 'fetch', category: 'HTTP & Networking' },
  { value: 'axios', label: 'axios', description: 'Full-featured HTTP client', sandboxName: 'axios', category: 'HTTP & Networking' },
  { value: 'qs', label: 'qs', description: 'Query string parsing/stringify', sandboxName: 'qs', category: 'HTTP & Networking' },

  // Data Manipulation
  { value: 'lodash', label: 'Lodash', description: 'Utility functions', sandboxName: '_', category: 'Data Manipulation' },
  { value: 'ramda', label: 'Ramda', description: 'Functional programming', sandboxName: 'R', category: 'Data Manipulation' },
  { value: 'immer', label: 'Immer', description: 'Immutable state updates', sandboxName: 'immer', category: 'Data Manipulation' },
  { value: 'deepmerge', label: 'deepmerge', description: 'Deep object merging', sandboxName: 'deepmerge', category: 'Data Manipulation' },

  // String & Text
  { value: 'validator', label: 'validator', description: 'String validation (email, URL)', sandboxName: 'validator', category: 'String & Text' },
  { value: 'slugify', label: 'slugify', description: 'URL-safe strings', sandboxName: 'slugify', category: 'String & Text' },
  { value: 'change-case', label: 'change-case', description: 'Case conversion', sandboxName: 'changeCase', category: 'String & Text' },
  { value: 'marked', label: 'marked', description: 'Markdown to HTML', sandboxName: 'marked', category: 'String & Text' },
  { value: 'sanitize-html', label: 'sanitize-html', description: 'HTML sanitization', sandboxName: 'sanitizeHtml', category: 'String & Text' },

  // Numbers & Math
  { value: 'bignumber.js', label: 'BigNumber', description: 'Arbitrary precision math', sandboxName: 'BigNumber', category: 'Numbers & Math' },
  { value: 'decimal.js', label: 'Decimal', description: 'Decimal arithmetic', sandboxName: 'Decimal', category: 'Numbers & Math' },
  { value: 'mathjs', label: 'math.js', description: 'Math library', sandboxName: 'math', category: 'Numbers & Math' },
  { value: 'currency.js', label: 'currency.js', description: 'Currency handling', sandboxName: 'currency', category: 'Numbers & Math' },

  // Date & Time
  { value: 'date-fns', label: 'date-fns', description: 'Date manipulation', sandboxName: 'dateFns', category: 'Date & Time' },
  { value: 'dayjs', label: 'Day.js', description: 'Lightweight date library', sandboxName: 'dayjs', category: 'Date & Time' },
  { value: 'luxon', label: 'Luxon', description: 'Modern date library', sandboxName: 'luxon', category: 'Date & Time' },
  { value: 'ms', label: 'ms', description: 'Millisecond conversion', sandboxName: 'ms', category: 'Date & Time' },

  // JSON & Data Formats
  { value: 'jsonpath-plus', label: 'JSONPath', description: 'Query JSON data', sandboxName: 'JSONPath', category: 'JSON & Data Formats' },
  { value: 'json5', label: 'JSON5', description: 'Extended JSON', sandboxName: 'JSON5', category: 'JSON & Data Formats' },
  { value: 'yaml', label: 'YAML', description: 'YAML parsing', sandboxName: 'YAML', category: 'JSON & Data Formats' },
  { value: 'csv-parse', label: 'CSV Parse', description: 'CSV parsing', sandboxName: 'csvParse', category: 'JSON & Data Formats' },
  { value: 'csv-stringify', label: 'CSV Stringify', description: 'CSV generation', sandboxName: 'csvStringify', category: 'JSON & Data Formats' },
  { value: 'papaparse', label: 'PapaParse', description: 'Full-featured CSV parsing', sandboxName: 'Papa', category: 'JSON & Data Formats' },
  { value: 'fast-xml-parser', label: 'XML Parser', description: 'Fast XML parsing', sandboxName: 'XMLParser', category: 'JSON & Data Formats' },

  // Validation & Schema
  { value: 'zod', label: 'Zod', description: 'TypeScript-first validation', sandboxName: 'z', category: 'Validation & Schema' },
  { value: 'yup', label: 'Yup', description: 'Schema validation', sandboxName: 'yup', category: 'Validation & Schema' },
  { value: 'ajv', label: 'Ajv', description: 'JSON Schema validation', sandboxName: 'Ajv', category: 'Validation & Schema' },

  // UUID & IDs
  { value: 'uuid', label: 'UUID', description: 'UUID generation', sandboxName: 'uuid', category: 'UUID & IDs' },
  { value: 'nanoid', label: 'nanoid', description: 'Tiny unique ID generator', sandboxName: 'nanoid', category: 'UUID & IDs' },
  { value: 'ulid', label: 'ULID', description: 'Sortable unique IDs', sandboxName: 'ulid', category: 'UUID & IDs' },
  { value: 'hashids', label: 'Hashids', description: 'Obfuscated IDs from numbers', sandboxName: 'Hashids', category: 'UUID & IDs' },

  // Crypto & Security
  { value: 'crypto-js', label: 'CryptoJS', description: 'Crypto functions (MD5, SHA, AES)', sandboxName: 'CryptoJS', category: 'Crypto & Security' },
  { value: 'bcryptjs', label: 'bcrypt', description: 'Password hashing', sandboxName: 'bcrypt', category: 'Crypto & Security' },
  { value: 'jsonwebtoken', label: 'JWT', description: 'JWT signing/verification', sandboxName: 'jwt', category: 'Crypto & Security' },
  { value: 'js-base64', label: 'Base64', description: 'Base64 encode/decode', sandboxName: 'Base64', category: 'Crypto & Security' },

  // Async & Flow Control
  { value: 'p-limit', label: 'p-limit', description: 'Limit concurrent promises', sandboxName: 'pLimit', category: 'Async & Flow Control' },
  { value: 'p-map', label: 'p-map', description: 'Concurrent map with limit', sandboxName: 'pMap', category: 'Async & Flow Control' },
  { value: 'p-retry', label: 'p-retry', description: 'Retry failed promises', sandboxName: 'pRetry', category: 'Async & Flow Control' },
  { value: 'delay', label: 'delay', description: 'Simple delay/sleep', sandboxName: 'delay', category: 'Async & Flow Control' },

  // Templating
  { value: 'handlebars', label: 'Handlebars', description: 'Handlebars templates', sandboxName: 'Handlebars', category: 'Templating' },
  { value: 'mustache', label: 'Mustache', description: 'Mustache templates', sandboxName: 'Mustache', category: 'Templating' },
  { value: 'ejs', label: 'EJS', description: 'EJS templates', sandboxName: 'ejs', category: 'Templating' },

  // Comparison & Diff
  { value: 'fast-json-patch', label: 'JSON Patch', description: 'JSON Patch (RFC 6902)', sandboxName: 'jsonPatch', category: 'Comparison & Diff' },
  { value: 'diff', label: 'Diff', description: 'Text diff', sandboxName: 'Diff', category: 'Comparison & Diff' },

  // Encoding & Compression
  { value: 'pako', label: 'pako', description: 'zlib compression', sandboxName: 'pako', category: 'Encoding & Compression' },
  { value: 'lz-string', label: 'LZ-String', description: 'LZ compression for strings', sandboxName: 'LZString', category: 'Encoding & Compression' },

  // Random & Fake Data
  { value: '@faker-js/faker', label: 'Faker', description: 'Generate fake data', sandboxName: 'faker', category: 'Random & Fake Data' },
]

// Default code template that actually runs
const DEFAULT_CODE = `// Access input data from previous step or trigger
const data = input || {};

// Process the data
const result = {
  processed: true,
  timestamp: new Date().toISOString(),
  inputKeys: Object.keys(data),
};

// Log for debugging (visible in test output)
console.log('Processing input:', data);

return result;`

// Test input source type
type TestInputSource = 'manual' | 'previous_run'

// Workflow run for selection
interface WorkflowRunOption {
  _id: string
  status: string
  createdAt: string
  inputPayload?: Record<string, unknown>
}

// Execution context from a workflow run
interface ExecutionContext {
  trigger: Record<string, unknown>
  input: unknown
  steps: Record<string, unknown>
  runStatus?: string
  workflowName?: string
}

// Code step configuration component
function CodeStepConfigPanel({
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
  const [packageSelectorOpen, setPackageSelectorOpen] = useState(false)
  const [codeModalOpen, setCodeModalOpen] = useState(false)
  const [testResult, setTestResult] = useState<{ output?: unknown; logs?: string[]; error?: string } | null>(null)
  const [isRunningTest, setIsRunningTest] = useState(false)

  // Test input state
  const [testInputSource, setTestInputSource] = useState<TestInputSource>('manual')
  const [manualInput, setManualInput] = useState('{}')
  const [manualTrigger, setManualTrigger] = useState('{}')
  const [manualSteps, setManualSteps] = useState('{}')

  // Previous run selection
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunOption[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadedContext, setLoadedContext] = useState<ExecutionContext | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)

  const codeConfig = step.codeConfig || { code: DEFAULT_CODE }
  const selectedPackages = codeConfig.packages || []

  // Initialize with default code if empty
  useEffect(() => {
    if (!step.codeConfig?.code) {
      onUpdate({ codeConfig: { ...codeConfig, code: DEFAULT_CODE } })
    }
  }, []) // Only run once on mount

  // Load workflow runs when switching to previous_run source
  useEffect(() => {
    if (testInputSource === 'previous_run' && workflowId && workflowRuns.length === 0) {
      loadWorkflowRuns()
    }
  }, [testInputSource, workflowId])

  // Load context when run is selected
  useEffect(() => {
    if (selectedRunId && workflowId) {
      loadRunContext(selectedRunId)
    }
  }, [selectedRunId])

  const loadWorkflowRuns = async () => {
    if (!workflowId) return
    setLoadingRuns(true)
    try {
      const response = await fetch(`${API_BASE}/workflows/${workflowId}/runs?limit=20`, {
        headers: getAuthHeader(),
      })
      if (response.ok) {
        const data = await response.json()
        setWorkflowRuns(data.data || [])
      }
    } catch (err) {
      console.error('Failed to load workflow runs:', err)
    } finally {
      setLoadingRuns(false)
    }
  }

  const loadRunContext = async (runId: string) => {
    if (!workflowId) return
    setLoadingContext(true)
    try {
      const response = await fetch(
        `${API_BASE}/workflows/${workflowId}/runs/${runId}/context?stepId=${step.id}`,
        { headers: getAuthHeader() }
      )
      if (response.ok) {
        const data = await response.json()
        setLoadedContext(data.data)
      }
    } catch (err) {
      console.error('Failed to load run context:', err)
    } finally {
      setLoadingContext(false)
    }
  }

  const togglePackage = (pkg: CodeSandboxPackage) => {
    const newPackages = selectedPackages.includes(pkg)
      ? selectedPackages.filter(p => p !== pkg)
      : [...selectedPackages, pkg]
    onUpdate({
      codeConfig: { ...codeConfig, packages: newPackages.length > 0 ? newPackages : undefined }
    })
  }

  const removePackage = (pkg: CodeSandboxPackage) => {
    const newPackages = selectedPackages.filter(p => p !== pkg)
    onUpdate({
      codeConfig: { ...codeConfig, packages: newPackages.length > 0 ? newPackages : undefined }
    })
  }

  // Get current test context based on source
  const getTestContext = (): { input: unknown; trigger: unknown; steps: Record<string, unknown> } => {
    if (testInputSource === 'previous_run' && loadedContext) {
      return {
        input: loadedContext.input,
        trigger: loadedContext.trigger,
        steps: loadedContext.steps,
      }
    }

    // Manual input mode
    try {
      return {
        input: JSON.parse(manualInput || '{}'),
        trigger: JSON.parse(manualTrigger || '{}'),
        steps: JSON.parse(manualSteps || '{}'),
      }
    } catch {
      return { input: {}, trigger: {}, steps: {} }
    }
  }

  // Test code execution
  const runTest = async () => {
    setIsRunningTest(true)
    setTestResult(null)
    try {
      const context = getTestContext()

      const response = await fetch(`${API_BASE}/workflows/test-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          code: codeConfig.code,
          input: context.input,
          trigger: context.trigger,
          steps: context.steps,
          packages: selectedPackages,
          timeout: codeConfig.timeout,
        }),
      })

      const result = await response.json()
      if (response.ok) {
        setTestResult(result)
      } else {
        setTestResult({ error: result.error || 'Test failed' })
      }
    } catch (err) {
      setTestResult({ error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setIsRunningTest(false)
    }
  }

  // Inline code editor component (reusable for both inline and modal)
  const CodeEditor = ({ minHeight = '200px' }: { minHeight?: string }) => (
    <Textarea
      value={codeConfig.code || ''}
      onChange={(e) => onUpdate({
        codeConfig: { ...codeConfig, code: e.target.value }
      })}
      placeholder={DEFAULT_CODE}
      className={`font-mono text-sm`}
      style={{ minHeight }}
    />
  )

  // Test input panel component (reusable in modal)
  const TestInputPanel = () => (
    <div className="space-y-3">
      {/* Source selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={testInputSource === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTestInputSource('manual')}
          className="flex-1"
        >
          Manual JSON
        </Button>
        <Button
          type="button"
          variant={testInputSource === 'previous_run' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTestInputSource('previous_run')}
          className="flex-1"
          disabled={!workflowId}
        >
          From Run
        </Button>
      </div>

      {testInputSource === 'manual' ? (
        <div className="space-y-3">
          {/* Manual input fields */}
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <code className="bg-muted px-1 rounded">input</code>
              <span className="text-muted-foreground font-normal">- Previous step output</span>
            </label>
            <Textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder='{"data": "from previous step"}'
              className="font-mono text-xs h-20 resize-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <code className="bg-muted px-1 rounded">trigger</code>
              <span className="text-muted-foreground font-normal">- Workflow trigger payload</span>
            </label>
            <Textarea
              value={manualTrigger}
              onChange={(e) => setManualTrigger(e.target.value)}
              placeholder='{"workflowInput": "data"}'
              className="font-mono text-xs h-16 resize-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <code className="bg-muted px-1 rounded">steps</code>
              <span className="text-muted-foreground font-normal">- All step outputs by ID</span>
            </label>
            <Textarea
              value={manualSteps}
              onChange={(e) => setManualSteps(e.target.value)}
              placeholder='{"step-1": {"output": "data"}}'
              className="font-mono text-xs h-16 resize-none"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Workflow run selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Select a workflow run</label>
            {loadingRuns ? (
              <div className="text-xs text-muted-foreground p-2">Loading runs...</div>
            ) : workflowRuns.length === 0 ? (
              <div className="text-xs text-muted-foreground p-2">
                No runs found. Run the workflow first to test with real data.
              </div>
            ) : (
              <Select value={selectedRunId || ''} onValueChange={setSelectedRunId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a run..." />
                </SelectTrigger>
                <SelectContent>
                  {workflowRuns.map((run) => (
                    <SelectItem key={run._id} value={run._id} className="text-xs">
                      <span className={cn(
                        'inline-block w-2 h-2 rounded-full mr-2',
                        run.status === 'completed' ? 'bg-green-500' :
                        run.status === 'running' ? 'bg-blue-500' :
                        run.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                      )} />
                      {new Date(run.createdAt).toLocaleString()} - {run.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Loaded context preview */}
          {loadingContext ? (
            <div className="text-xs text-muted-foreground p-2">Loading context...</div>
          ) : loadedContext ? (
            <div className="space-y-2 text-xs">
              <div className="bg-muted/50 rounded p-2">
                <p className="font-medium mb-1">Loaded Context:</p>
                <div className="space-y-1">
                  <p><code className="bg-muted px-1 rounded">input</code>: {JSON.stringify(loadedContext.input).slice(0, 50)}...</p>
                  <p><code className="bg-muted px-1 rounded">trigger</code>: {JSON.stringify(loadedContext.trigger).slice(0, 50)}...</p>
                  <p><code className="bg-muted px-1 rounded">steps</code>: {Object.keys(loadedContext.steps).length} step outputs</p>
                </div>
              </div>
            </div>
          ) : selectedRunId ? (
            <div className="text-xs text-muted-foreground p-2">Select a run to load its context</div>
          ) : null}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="text-emerald-800 dark:text-emerald-200">
            <p className="font-medium">JavaScript Code Execution</p>
            <p className="text-xs mt-1">
              Executes JavaScript in a sandboxed environment. Access data via
              <code className="bg-emerald-100 dark:bg-emerald-900 px-1 mx-1 rounded">input</code>
              (previous step output) or
              <code className="bg-emerald-100 dark:bg-emerald-900 px-1 mx-1 rounded">trigger</code>
              (workflow trigger payload).
            </p>
          </div>
        </div>
      </div>

      {/* Packages Selection - Searchable Multi-Select */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          NPM Packages
        </label>

        {/* Selected packages as badges */}
        {selectedPackages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedPackages.map((pkg) => {
              const pkgInfo = CODE_PACKAGES.find(p => p.value === pkg)
              return (
                <Badge
                  key={pkg}
                  variant="secondary"
                  className="gap-1 pr-1"
                >
                  <code className="text-xs">{pkgInfo?.sandboxName || pkg}</code>
                  <button
                    type="button"
                    onClick={() => removePackage(pkg)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
          </div>
        )}

        {/* Package selector popover */}
        <Popover open={packageSelectorOpen} onOpenChange={setPackageSelectorOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-muted-foreground"
            >
              <Plus className="h-4 w-4 mr-2" />
              {selectedPackages.length === 0 ? 'Add packages...' : 'Add more packages...'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search packages..." />
              <CommandList>
                <CommandEmpty>No packages found.</CommandEmpty>
                <CommandGroup>
                  {CODE_PACKAGES.map((pkg) => (
                    <CommandItem
                      key={pkg.value}
                      value={pkg.label}
                      onSelect={() => {
                        togglePackage(pkg.value)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selectedPackages.includes(pkg.value) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{pkg.label}</span>
                          <code className="text-xs text-muted-foreground">{pkg.sandboxName}</code>
                        </div>
                        <p className="text-xs text-muted-foreground">{pkg.description}</p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Code Editor */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            JavaScript Code
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCodeModalOpen(true)}
            className="h-7 px-2"
          >
            <Maximize2 className="h-4 w-4 mr-1" />
            Expand
          </Button>
        </div>
        <CodeEditor minHeight="150px" />
        <p className="text-xs text-muted-foreground mt-1">
          Access data using <code className="bg-muted px-1 rounded">input</code>, <code className="bg-muted px-1 rounded">trigger</code>, or <code className="bg-muted px-1 rounded">steps.stepId</code>
        </p>
      </div>

      {/* Code Modal Dialog */}
      <Dialog open={codeModalOpen} onOpenChange={setCodeModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Code Editor - {step.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 grid grid-cols-2 gap-4 min-h-0 overflow-hidden">
            {/* Left side - Code editor */}
            <div className="flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Code</label>
                <div className="flex items-center gap-1">
                  {selectedPackages.length > 0 && (
                    <div className="flex gap-1">
                      {selectedPackages.map(pkg => {
                        const pkgInfo = CODE_PACKAGES.find(p => p.value === pkg)
                        return (
                          <Badge key={pkg} variant="outline" className="text-xs">
                            {pkgInfo?.sandboxName}
                          </Badge>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              <Textarea
                value={codeConfig.code || ''}
                onChange={(e) => onUpdate({
                  codeConfig: { ...codeConfig, code: e.target.value }
                })}
                className="flex-1 font-mono text-sm min-h-[400px] resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Access data: <code className="bg-muted px-1 rounded">input</code>, <code className="bg-muted px-1 rounded">trigger</code>, <code className="bg-muted px-1 rounded">steps.stepId</code>
              </p>
            </div>

            {/* Right side - Test panel */}
            <div className="flex flex-col gap-2 min-h-0 overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Test
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={runTest}
                  disabled={isRunningTest || (testInputSource === 'previous_run' && !loadedContext)}
                  className="h-7"
                >
                  <Play className="h-3 w-3 mr-1" />
                  {isRunningTest ? 'Running...' : 'Run Test'}
                </Button>
              </div>

              {/* Test input panel */}
              <div className="border rounded-lg p-3 bg-muted/20">
                <TestInputPanel />
              </div>

              {/* Test results */}
              <div className="flex-1 min-h-0 overflow-auto">
                {testResult && (
                  <div className="space-y-2">
                    {testResult.error ? (
                      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
                        <pre className="text-xs text-red-700 dark:text-red-300 mt-1 whitespace-pre-wrap">{testResult.error}</pre>
                      </div>
                    ) : (
                      <>
                        {testResult.logs && testResult.logs.length > 0 && (
                          <div className="bg-muted/50 rounded-lg p-3">
                            <p className="text-sm font-medium flex items-center gap-2">
                              <Terminal className="h-4 w-4" />
                              Console Output
                            </p>
                            <pre className="text-xs mt-1 whitespace-pre-wrap font-mono">
                              {testResult.logs.join('\n')}
                            </pre>
                          </div>
                        )}
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Result</p>
                          <pre className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 whitespace-pre-wrap font-mono">
                            {JSON.stringify(testResult.output, null, 2)}
                          </pre>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {!testResult && (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4">
                    Click &quot;Run Test&quot; to execute your code
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Advanced Options */}
      <div className="space-y-2 border-t pt-3">
        <label className="text-sm font-medium">Advanced Options</label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Timeout (ms)</label>
            <Input
              type="number"
              value={codeConfig.timeout || ''}
              onChange={(e) => onUpdate({
                codeConfig: { ...codeConfig, timeout: e.target.value ? parseInt(e.target.value) : undefined }
              })}
              placeholder="30000"
              className="font-mono text-sm h-8"
            />
          </div>
          <div className="space-y-1 flex items-end">
            <div className="flex items-center gap-2 h-8">
              <input
                type="checkbox"
                id={`continueOnError-${step.id}`}
                checked={codeConfig.continueOnError || false}
                onChange={(e) => onUpdate({
                  codeConfig: { ...codeConfig, continueOnError: e.target.checked }
                })}
                className="h-4 w-4 rounded"
              />
              <label htmlFor={`continueOnError-${step.id}`} className="text-sm">
                Continue on error
              </label>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          If &quot;Continue on error&quot; is checked, the step will complete even if the code throws an error,
          with the error stored in the output.
        </p>
      </div>

      {/* Info box about available features */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-sm">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-blue-800 dark:text-blue-200 text-xs">
            <p className="font-medium">Available in Sandbox</p>
            <ul className="mt-1 space-y-0.5">
              <li><code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">input</code> - Previous step&apos;s output</li>
              <li><code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">trigger</code> - Original workflow trigger payload</li>
              <li><code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">steps</code> - Object with outputs from all previous steps (by step ID)</li>
              <li><code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">console.log()</code> - Logs captured in output</li>
              <li><code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">return value</code> - Becomes step output</li>
            </ul>
          </div>
        </div>
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
              onSelectToken={() => {}}
              variant="text"
              fieldLabel="Task Title Template"
              fieldValue={step.titleTemplate || ''}
              onFieldValueChange={(value) => onUpdate({ titleTemplate: value })}
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
              <TokenBrowser
                workflowId={workflowId}
                previousSteps={previousSteps}
                currentStepIndex={stepIndex}
                loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                onSelectToken={() => {}}
                variant="text"
                fieldLabel="Instructions"
                fieldValue={step.additionalInstructions || step.prompt || ''}
                onFieldValueChange={(value) => onUpdate({ additionalInstructions: value })}
              />
            </div>

          </div>
        )}

        {/* External step configuration */}
        {step.stepType === 'external' && (
          <ExternalStepConfigPanel
            step={step}
            stepIndex={stepIndex}
            workflowId={workflowId}
            previousSteps={previousSteps}
            isInLoop={isInLoop}
            loopScope={loopScope}
            onUpdate={onUpdate}
          />
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

        {/* Code step configuration */}
        {step.stepType === 'code' && (
          <CodeStepConfigPanel
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
