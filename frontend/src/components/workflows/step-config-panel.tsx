'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { JsonViewer } from '@/components/ui/json-viewer'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Search, X, FileText, Check, ChevronsUpDown, Maximize2, Play, Terminal, Package, Eye, Loader2, RefreshCw, Clock } from 'lucide-react'
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

// Variable mapping for code steps
interface CodeVariableMapping {
  name: string   // Variable name available in code (e.g., "apiUrl")
  path: string   // Context path to resolve (e.g., "trigger._API_URL")
}

// Code step configuration
interface CodeStepConfig {
  code: string
  packages?: CodeSandboxPackage[]
  variables?: CodeVariableMapping[]
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

// Unified input configuration for workflow steps
interface StepInputConfig {
  source: 'previous' | 'trigger' | string
  mapping?: Record<string, string>
  extractPath?: string
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
  inputConfig?: StepInputConfig
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
  /** Read-only mode - hides edit controls and disables all form inputs */
  readOnly?: boolean
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
  // Flow steps now use InputConfigurationSection for input mapping (consolidated)
  // Legacy inputMapping field is no longer used here

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

      {/* Input Configuration note - refers to unified InputConfigurationSection */}
      <div className="text-xs text-muted-foreground border-t pt-3 mt-3">
        <p>
          Use the <strong>Input Configuration</strong> section below to map data from previous steps
          to the subflow&apos;s input. Each mapped field becomes available in the subflow.
        </p>
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

  // Previous run selection for testing
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunOption[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadedContext, setLoadedContext] = useState<ExecutionContext | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)

  // Get variables from step config (stored, not component state)
  const configVariables = step.codeConfig?.variables || []

  // Add a new variable mapping from a token path - saves to step config
  const addVariableMapping = (tokenPath: string) => {
    // Generate a suggested variable name from the path
    // e.g., "input.user.id" -> "userId", "trigger._API_URL" -> "apiUrl"
    const parts = tokenPath.split('.')
    let suggestedName = parts.length > 1
      ? parts.slice(1).map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join('')
      : parts[0]

    // Clean up names starting with underscore (like _API_URL -> apiUrl)
    if (suggestedName.startsWith('_')) {
      suggestedName = suggestedName.slice(1).toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    }

    const newVariable: CodeVariableMapping = { name: suggestedName, path: tokenPath }
    const currentConfig = step.codeConfig || { code: DEFAULT_CODE }
    onUpdate({
      codeConfig: {
        ...currentConfig,
        variables: [...configVariables, newVariable]
      }
    })
  }

  // Update a variable mapping - saves to step config
  const updateVariableMapping = (index: number, updates: Partial<CodeVariableMapping>) => {
    const newVariables = configVariables.map((v, i) => i === index ? { ...v, ...updates } : v)
    const currentConfig = step.codeConfig || { code: DEFAULT_CODE }
    onUpdate({
      codeConfig: { ...currentConfig, variables: newVariables }
    })
  }

  // Remove a variable mapping - saves to step config
  const removeVariableMapping = (index: number) => {
    const newVariables = configVariables.filter((_, i) => i !== index)
    const currentConfig = step.codeConfig || { code: DEFAULT_CODE }
    onUpdate({
      codeConfig: { ...currentConfig, variables: newVariables.length > 0 ? newVariables : undefined }
    })
  }

  // Copy variable name to insert into code
  const copyVariableToCode = (name: string) => {
    const currentCode = codeConfig.code || ''
    const newCode = currentCode ? `${currentCode}\n${name}` : name
    onUpdate({ codeConfig: { ...codeConfig, code: newCode } })
  }

  const codeConfig = step.codeConfig || { code: DEFAULT_CODE }
  const selectedPackages = codeConfig.packages || []

  // Initialize with default code if empty
  useEffect(() => {
    if (!step.codeConfig?.code) {
      onUpdate({ codeConfig: { ...codeConfig, code: DEFAULT_CODE } })
    }
  }, []) // Only run once on mount

  // Load workflow runs on mount if workflow exists
  useEffect(() => {
    if (workflowId && workflowRuns.length === 0) {
      loadWorkflowRuns()
    }
  }, [workflowId])

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

  // Test code execution
  const runTest = async () => {
    if (!loadedContext) {
      setTestResult({ error: 'Please load a workflow run first to provide context for testing' })
      return
    }

    setIsRunningTest(true)
    setTestResult(null)
    try {
      const response = await fetch(`${API_BASE}/workflows/test-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          code: codeConfig.code,
          input: loadedContext.input,
          trigger: loadedContext.trigger,
          steps: loadedContext.steps,
          variables: configVariables, // Pass variable mappings (name + path) - resolved at execution
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
      {/* Variables section - always visible, stored in step config */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Variables</label>
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={previousSteps}
            currentStepIndex={stepIndex}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={addVariableMapping}
            wrapInBraces={false}
          />
        </div>

        {configVariables.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-md text-center">
            Click <Plus className="h-3 w-3 inline mx-1" /> to add variables from workflow context.
            <br />
            <span className="text-muted-foreground/70">
              Variables are resolved at runtime from the workflow context.
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            {configVariables.map((variable, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                <Input
                  value={variable.name}
                  onChange={(e) => updateVariableMapping(index, { name: e.target.value })}
                  placeholder="varName"
                  className="h-7 text-xs font-mono w-24 flex-shrink-0"
                />
                <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <code className="text-[10px] text-muted-foreground truncate flex-1" title={variable.path}>
                  {variable.path}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive flex-shrink-0"
                  onClick={() => removeVariableMapping(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Values are resolved from context at runtime. Use variable names in code (e.g., <code className="bg-muted px-0.5 rounded">apiUrl</code>).
        </p>
      </div>

      {/* Workflow run selector for loading context/values */}
      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Load Context from Run</label>
          {loadedContext && (
            <Badge variant="outline" className="text-[10px]">
              Context loaded
            </Badge>
          )}
        </div>
        {loadingRuns ? (
          <div className="text-xs text-muted-foreground p-2">Loading runs...</div>
        ) : workflowRuns.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">
            {workflowId ? 'No runs found. Run the workflow first.' : 'Save workflow first to load runs.'}
          </div>
        ) : (
          <Select value={selectedRunId || ''} onValueChange={setSelectedRunId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a run to load values..." />
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

        {/* Loaded context preview */}
        {loadingContext ? (
          <div className="text-xs text-muted-foreground p-2">Loading context...</div>
        ) : loadedContext ? (
          <div className="space-y-2 text-xs">
            <div className="bg-muted/50 rounded p-2 max-h-[200px] overflow-auto">
              <div className="space-y-3">
                <div>
                  <p className="text-muted-foreground mb-1"><code className="bg-muted px-1 rounded">input</code>:</p>
                  <div className="pl-2 border-l-2 border-muted">
                    <JsonViewer data={loadedContext.input} maxInitialDepth={1} />
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1"><code className="bg-muted px-1 rounded">trigger</code>:</p>
                  <div className="pl-2 border-l-2 border-muted">
                    <JsonViewer data={loadedContext.trigger} maxInitialDepth={1} />
                  </div>
                </div>
                {Object.keys(loadedContext.steps).length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1"><code className="bg-muted px-1 rounded">steps</code>:</p>
                    <div className="pl-2 border-l-2 border-muted">
                      <JsonViewer data={loadedContext.steps} maxInitialDepth={1} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
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

      {/* Variables - inject context values as named variables */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            Variables
          </label>
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={previousSteps}
            currentStepIndex={stepIndex}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={addVariableMapping}
            wrapInBraces={false}
          />
        </div>

        {configVariables.length > 0 ? (
          <div className="space-y-1">
            {configVariables.map((variable, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/30 rounded-md text-sm">
                <Input
                  value={variable.name}
                  onChange={(e) => updateVariableMapping(index, { name: e.target.value })}
                  placeholder="varName"
                  className="h-7 text-xs font-mono w-24 flex-shrink-0"
                />
                <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <code className="text-[10px] text-muted-foreground truncate flex-1" title={variable.path}>
                  {variable.path}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive flex-shrink-0"
                  onClick={() => removeVariableMapping(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Add variables to inject context values (e.g., <code className="bg-muted px-1 rounded">trigger._API_URL</code>) as named variables in your code.
          </p>
        )}
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
          Access data via <code className="bg-muted px-1 rounded">input</code>, <code className="bg-muted px-1 rounded">trigger</code>, <code className="bg-muted px-1 rounded">steps.stepName</code>, or use variables defined above.
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
              <Textarea
                value={codeConfig.code || ''}
                onChange={(e) => onUpdate({
                  codeConfig: { ...codeConfig, code: e.target.value }
                })}
                className="flex-1 font-mono text-sm min-h-[400px] resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Access: <code className="bg-muted px-1 rounded">input</code>, <code className="bg-muted px-1 rounded">trigger</code>, <code className="bg-muted px-1 rounded">steps.stepName</code>, or use variables from the test panel.
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
                  disabled={isRunningTest}
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

// API Response types for input preview and test execution
interface InputPreviewResponse {
  previewSource: 'run' | 'none'
  workflowRunId?: string
  runCompletedAt?: string
  resolvedInput: Record<string, unknown>
  inputConfig?: StepInputConfig
  previousStepOutput?: Record<string, unknown>
}

interface TestExecuteResponse {
  success: boolean
  output?: unknown
  error?: string
  executionTimeMs: number
  logs?: string[]
  requestDetails?: {
    url: string
    method: string
    headers: Record<string, string>
    body?: unknown
  }
  selectedBranch?: {
    targetStepId: string
    condition?: string
    label?: string
  }
}

// Internal state for field mapping - allows multiple empty keys during editing
interface MappingField {
  id: string
  fieldName: string
  value: string
}

// Input Configuration Section Component
function InputConfigurationSection({
  step,
  stepIndex,
  allSteps,
  workflowId,
  previousSteps,
  isInLoop,
  loopScope,
  onUpdate,
  readOnly = false,
}: {
  step: WorkflowStep
  stepIndex: number
  allSteps: WorkflowStep[]
  workflowId?: string
  previousSteps: { id: string; name: string; stepType?: WorkflowStepType; itemVariable?: string }[]
  isInLoop: boolean
  loopScope?: LoopScope | null
  onUpdate: (updates: Partial<WorkflowStep>) => void
  readOnly?: boolean
}) {
  // Convert object mapping to array for editing (preserves order, allows duplicate empty keys)
  const [fields, setFields] = useState<MappingField[]>(() => {
    const mapping = step.inputConfig?.mapping || {}
    return Object.entries(mapping).map(([fieldName, value], idx) => ({
      id: `field-${idx}-${Date.now()}`,
      fieldName,
      value,
    }))
  })

  // Track if we're in mapping mode
  const [inputMode, setInputMode] = useState<'previous' | 'mapping'>(() => {
    const hasMapping = step.inputConfig?.mapping && Object.keys(step.inputConfig.mapping).length > 0
    return hasMapping ? 'mapping' : 'previous'
  })

  // Sync from external step changes (e.g., when switching steps)
  const prevStepId = useRef(step.id)
  useEffect(() => {
    if (prevStepId.current !== step.id) {
      prevStepId.current = step.id
      const mapping = step.inputConfig?.mapping || {}
      const newFields = Object.entries(mapping).map(([fieldName, value], idx) => ({
        id: `field-${idx}-${Date.now()}`,
        fieldName,
        value,
      }))
      setFields(newFields)
      setInputMode(newFields.length > 0 ? 'mapping' : 'previous')
    }
  }, [step.id, step.inputConfig?.mapping])

  // Convert fields array back to object and update step
  const updateStepMapping = useCallback((newFields: MappingField[]) => {
    const mapping: Record<string, string> = {}
    for (const field of newFields) {
      // Only include fields with non-empty names
      if (field.fieldName.trim()) {
        mapping[field.fieldName.trim()] = field.value
      }
    }
    onUpdate({
      inputConfig: {
        ...step.inputConfig,
        source: step.inputConfig?.source || 'previous',
        mapping: Object.keys(mapping).length > 0 ? mapping : undefined,
      }
    })
  }, [onUpdate, step.inputConfig])

  const handleModeChange = (mode: 'previous' | 'mapping') => {
    setInputMode(mode)
    if (mode === 'previous') {
      // Clear mapping when switching to previous step mode
      setFields([])
      onUpdate({
        inputConfig: {
          source: 'previous',
          mapping: undefined,
          extractPath: undefined,
        }
      })
    } else {
      // Initialize with one empty field when switching to mapping mode
      const newField = { id: `field-${Date.now()}`, fieldName: '', value: '' }
      setFields([newField])
      // Don't update step yet - wait for user to fill in the field
    }
  }

  const updateField = (id: string, updates: Partial<Pick<MappingField, 'fieldName' | 'value'>>) => {
    setFields(prev => {
      const newFields = prev.map(f =>
        f.id === id ? { ...f, ...updates } : f
      )
      // Update step mapping after state change
      updateStepMapping(newFields)
      return newFields
    })
  }

  const removeField = (id: string) => {
    setFields(prev => {
      const newFields = prev.filter(f => f.id !== id)
      // If no fields left, switch back to previous mode
      if (newFields.length === 0) {
        setInputMode('previous')
        onUpdate({
          inputConfig: {
            source: 'previous',
            mapping: undefined,
            extractPath: undefined,
          }
        })
      } else {
        updateStepMapping(newFields)
      }
      return newFields
    })
  }

  const addField = () => {
    const newField = { id: `field-${Date.now()}`, fieldName: '', value: '' }
    setFields(prev => [...prev, newField])
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <label className="text-sm font-medium">Input Configuration</label>
      </div>

      {/* Input Mode Selector */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Input Mode</label>
        <Select
          value={inputMode}
          onValueChange={(val) => !readOnly && handleModeChange(val as 'previous' | 'mapping')}
          disabled={readOnly}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="previous">
              <span className="flex items-center gap-2">
                <ArrowDown className="h-3 w-3" />
                Previous Step Output
              </span>
            </SelectItem>
            <SelectItem value="mapping">
              <span className="flex items-center gap-2">
                <CornerDownRight className="h-3 w-3" />
                Field Mapping
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {inputMode === 'previous'
            ? 'This step receives the full output from the previous step.'
            : 'Define specific fields to extract from workflow context.'}
        </p>
      </div>

      {/* Field Mapping UI - only show when in mapping mode */}
      {inputMode === 'mapping' && (
        <div className="space-y-2 bg-muted/30 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-2">
            Each field creates a property in the step input. Use the token browser to select values.
          </div>

          {fields.map((field) => (
            <div key={field.id} className="flex gap-2 items-start">
              {/* Field Name */}
              <div className="flex-1 min-w-0">
                <Input
                  value={field.fieldName}
                  onChange={(e) => updateField(field.id, { fieldName: e.target.value })}
                  placeholder="fieldName"
                  className="h-8 text-sm font-mono"
                  disabled={readOnly}
                />
              </div>

              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-2" />

              {/* Token Value with Browser */}
              <div className="flex-[2] min-w-0 flex gap-1">
                <Input
                  value={field.value}
                  onChange={(e) => updateField(field.id, { value: e.target.value })}
                  placeholder="{{output.field}} or {{trigger.data}}"
                  className="h-8 text-sm font-mono flex-1"
                  disabled={readOnly}
                />
                {!readOnly && (
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                    onSelectToken={(token) => {
                      // This is only called when closing the dialog in non-external mode
                      // In external field mode (with fieldValue/onFieldValueChange),
                      // the TokenBrowserDialog handles insertions directly
                      updateField(field.id, { value: token })
                    }}
                    wrapInBraces={true}
                    fieldLabel={`Value for "${field.fieldName || 'field'}"`}
                    fieldValue={field.value}
                    onFieldValueChange={(newValue) => updateField(field.id, { value: newValue })}
                  />
                )}
              </div>

              {/* Remove Button */}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => removeField(field.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          {/* Add Field Button */}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={addField}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Field
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Workflow run option for the selector
interface WorkflowRunForPreview {
  _id: string
  status: string
  createdAt: string
  completedAt?: string
}

// Input Preview Section Component
function InputPreviewSection({
  workflowId,
  stepId,
  stepIndex,
  inputConfig,
  onResolvedInputChange,
}: {
  workflowId?: string
  stepId: string
  stepIndex: number
  inputConfig?: StepInputConfig
  onResolvedInputChange?: (input: Record<string, unknown> | null, workflowRunId?: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [runs, setRuns] = useState<WorkflowRunForPreview[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [preview, setPreview] = useState<InputPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runsLoaded, setRunsLoaded] = useState(false)

  // Fetch available workflow runs
  const fetchRuns = useCallback(async () => {
    if (!workflowId || runsLoaded) return

    setIsLoadingRuns(true)
    try {
      const response = await fetch(`${API_BASE}/workflows/${workflowId}/runs?limit=20`, {
        headers: getAuthHeader(),
      })
      if (response.ok) {
        const data = await response.json()
        const runsList = data.data || []
        setRuns(runsList)
        // Auto-select the most recent completed run
        const completedRun = runsList.find((r: WorkflowRunForPreview) => r.status === 'completed')
        if (completedRun) {
          setSelectedRunId(completedRun._id)
        } else if (runsList.length > 0) {
          setSelectedRunId(runsList[0]._id)
        }
      }
    } catch (err) {
      console.error('Failed to load runs:', err)
    } finally {
      setIsLoadingRuns(false)
      setRunsLoaded(true)
    }
  }, [workflowId, runsLoaded])

  // Fetch preview for selected run using current inputConfig
  const fetchPreview = useCallback(async (runId?: string) => {
    if (!workflowId) {
      setError('Workflow must be saved first')
      return
    }

    setIsLoadingPreview(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/workflows/${workflowId}/steps/${stepId}/input-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          workflowRunId: runId,
          inputConfig: inputConfig,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch input preview')
      }
      const data = await response.json()
      const previewData = data.data || data
      setPreview(previewData)
      // Notify parent of resolved input for test execution (include workflowRunId for trigger.payload.* resolution)
      onResolvedInputChange?.(previewData.resolvedInput || null, previewData.workflowRunId || runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch preview')
      onResolvedInputChange?.(null, undefined)
    } finally {
      setIsLoadingPreview(false)
    }
  }, [workflowId, stepId, inputConfig, onResolvedInputChange])

  // Load runs when section opens
  useEffect(() => {
    if (isOpen && !runsLoaded) {
      fetchRuns()
    }
  }, [isOpen, runsLoaded, fetchRuns])

  // Fetch preview ONLY when a different run is explicitly selected
  // Using a ref to track the previous run ID to avoid re-fetching on config changes
  const lastFetchedRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Only fetch if:
    // 1. Section is open
    // 2. A run is selected
    // 3. Runs have loaded
    // 4. This is a NEW run selection (not the same run)
    if (isOpen && selectedRunId && runsLoaded && selectedRunId !== lastFetchedRunIdRef.current) {
      lastFetchedRunIdRef.current = selectedRunId
      fetchPreview(selectedRunId)
    }
  }, [isOpen, selectedRunId, runsLoaded, fetchPreview])

  // Don't show for first step
  if (stepIndex === 0) return null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Input Preview</span>
          {preview && (
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              From run
            </Badge>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-3">
        {/* Run Selector */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Select Previous Run</label>
          {isLoadingRuns ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading runs...
            </div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No previous runs available. Run the workflow to see input preview.
            </div>
          ) : (
            <Select value={selectedRunId || ''} onValueChange={setSelectedRunId}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue placeholder="Select a run..." />
              </SelectTrigger>
              <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                {runs.map((run) => (
                  <SelectItem key={run._id} value={run._id} className="text-xs">
                    <span className="flex items-center gap-2 truncate">
                      <span className={cn(
                        'inline-block w-2 h-2 rounded-full flex-shrink-0',
                        run.status === 'completed' ? 'bg-green-500' :
                        run.status === 'running' ? 'bg-blue-500' :
                        run.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                      )} />
                      <span className="truncate">
                        {new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="flex-shrink-0 text-muted-foreground">({run.status})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Preview Content */}
        {isLoadingPreview ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">Loading preview...</span>
          </div>
        ) : error ? (
          <div className="text-sm text-red-500 py-2">{error}</div>
        ) : preview ? (
          <div className="space-y-3">
            {preview.previousStepOutput && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Previous Step Output</label>
                <div className="max-h-32 overflow-auto bg-muted/30 rounded p-2">
                  <JsonViewer data={preview.previousStepOutput} defaultExpanded={false} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Resolved Input for This Step</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => fetchPreview(selectedRunId || undefined)}
                  disabled={isLoadingPreview}
                  title="Recalculate preview with current input configuration"
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", isLoadingPreview && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              <div className="max-h-48 overflow-auto bg-muted/30 rounded p-2">
                <JsonViewer data={preview.resolvedInput} defaultExpanded={true} />
              </div>
            </div>
          </div>
        ) : selectedRunId ? (
          <div className="text-sm text-muted-foreground py-2">
            Select a run to preview input.
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

// Test Execution Section Component
function TestExecutionSection({
  workflowId,
  stepId,
  stepType,
  stepName,
  sampleInput,
  workflowRunId,
}: {
  workflowId?: string
  stepId: string
  stepType?: WorkflowStepType
  stepName: string
  sampleInput?: Record<string, unknown> | null
  workflowRunId?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<TestExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Types that can be test-executed
  const canTestExecute = stepType && ['code', 'decision', 'foreach', 'external', 'findDocument'].includes(stepType)

  // Format the sample input for display
  const formattedInput = sampleInput ? JSON.stringify(sampleInput, null, 2) : null

  const executeTest = async () => {
    if (!workflowId) {
      setError('Workflow must be saved first')
      return
    }

    if (!sampleInput) {
      setError('No sample input available. Open the Input Preview section above and select a previous run.')
      return
    }

    setIsExecuting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`${API_BASE}/workflows/${workflowId}/steps/${stepId}/test-execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ inputPayload: sampleInput, workflowRunId }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Test execution failed')
      }
      setResult(data.data || data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test execution failed')
    } finally {
      setIsExecuting(false)
    }
  }

  if (!canTestExecute) {
    return null
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Test Execution</span>
          {result?.success && (
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              Success
            </Badge>
          )}
          {result && !result.success && (
            <Badge variant="secondary" className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
              Failed
            </Badge>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <div className="space-y-3">
          {/* Sample Input Display (read-only, from Input Preview section) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Test Input (from Input Preview)</label>
            {sampleInput ? (
              <div className="max-h-24 overflow-auto bg-muted/30 rounded p-2">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {formattedInput}
                </pre>
              </div>
            ) : (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded flex items-center gap-2">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span>Open the Input Preview section above and select a previous run to load sample input.</span>
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={executeTest}
            disabled={isExecuting || !workflowId || !sampleInput}
            className="w-full"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Test
              </>
            )}
          </Button>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Executed in {result.executionTimeMs}ms
                </span>
                {result.success ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <Check className="h-3 w-3 mr-1" />
                    Success
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600 border-red-300">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </div>

              {result.error && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded font-mono">
                  {result.error}
                </div>
              )}

              {result.logs && result.logs.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Console Output</label>
                  <div className="bg-gray-900 text-gray-100 p-2 rounded font-mono text-xs max-h-24 overflow-auto">
                    {result.logs.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              )}

              {result.selectedBranch && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Selected Branch</label>
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-2 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-amber-500" />
                      <span>{result.selectedBranch.label || result.selectedBranch.targetStepId}</span>
                    </div>
                    {result.selectedBranch.condition && (
                      <code className="text-xs text-muted-foreground block mt-1">
                        {result.selectedBranch.condition}
                      </code>
                    )}
                  </div>
                </div>
              )}

              {result.requestDetails && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Request Details</label>
                  <div className="bg-muted p-2 rounded text-xs font-mono space-y-1">
                    <div>{result.requestDetails.method} {result.requestDetails.url}</div>
                    {result.requestDetails.body !== undefined && (
                      <div className="text-muted-foreground truncate">
                        Body: {String(typeof result.requestDetails.body === 'string'
                          ? (result.requestDetails.body as string).substring(0, 100)
                          : JSON.stringify(result.requestDetails.body).substring(0, 100))}...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result.output !== undefined && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Output</label>
                  <div className="max-h-48 overflow-auto">
                    <JsonViewer data={result.output ?? null} defaultExpanded={true} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  readOnly = false,
}: StepConfigPanelProps) {
  const [flowSelectorOpen, setFlowSelectorOpen] = useState(false)
  // Shared state for resolved input from InputPreviewSection to TestExecutionSection
  const [sampleInput, setSampleInput] = useState<Record<string, unknown> | null>(null)
  const [sampleInputRunId, setSampleInputRunId] = useState<string | undefined>(undefined)
  const typeInfo = getStepTypeInfo(step.stepType)
  const TypeIcon = typeInfo.icon

  const previousSteps = allSteps.slice(0, stepIndex).map(s => ({
    id: s.id,
    name: s.name,
    stepType: s.stepType,
    itemVariable: s.itemVariable,
  }))

  // In readOnly mode, use a no-op update function
  const handleUpdate = readOnly ? () => {} : onUpdate

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
          {!readOnly && (
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
          )}
        </div>

        {/* Name and Type */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Step Name</label>
            <Input
              value={step.name}
              onChange={(e) => handleUpdate({ name: e.target.value })}
              placeholder="Step name"
              disabled={readOnly}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Step Type</label>
            <Select
              value={step.stepType}
              onValueChange={(val) => !readOnly && onChangeType(val as WorkflowStepType)}
              disabled={readOnly}
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
              onChange={(e) => handleUpdate({ titleTemplate: e.target.value })}
              placeholder={`e.g., "Review: {{item.name}}" or "Process {{input.customerName}}"`}
              className="font-mono text-sm"
              disabled={readOnly}
            />
            {!readOnly && (
              <TokenBrowser
                workflowId={workflowId}
                previousSteps={previousSteps}
                currentStepIndex={stepIndex}
                loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                onSelectToken={() => {}}
                variant="text"
                fieldLabel="Task Title Template"
                fieldValue={step.titleTemplate || ''}
                onFieldValueChange={(value) => handleUpdate({ titleTemplate: value })}
              />
            )}
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
                onValueChange={(val) => handleUpdate({ defaultAssigneeId: val === '_none' ? undefined : val })}
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
              onChange={(promptIds) => handleUpdate({ promptDocumentIds: promptIds.length > 0 ? promptIds : undefined })}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Additional Instructions
                <span className="text-xs text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                value={step.additionalInstructions || step.prompt || ''}
                onChange={(e) => handleUpdate({ additionalInstructions: e.target.value })}
                placeholder={`Add extra context for the agent if needed. Examples:

• "Focus on security vulnerabilities in this review"
• "Use the company style guide for formatting"
• "Include test coverage recommendations"

The agent will receive task context automatically.`}
                className="min-h-[100px] font-mono text-sm"
                disabled={readOnly}
              />
              {!readOnly && (
                <div className="flex items-center gap-2 mt-2">
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                    onSelectToken={(token) => {
                      const current = step.additionalInstructions || ''
                      handleUpdate({ additionalInstructions: current + token })
                    }}
                    variant="text"
                  />
                </div>
              )}
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
                onValueChange={(val) => handleUpdate({ defaultAssigneeId: val === '_none' ? undefined : val })}
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
                    onChange={(e) => handleUpdate({ itemsPath: e.target.value })}
                    placeholder="e.g., output.emails"
                    className="font-mono text-sm"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    onSelectToken={(token) => handleUpdate({ itemsPath: token })}
                    wrapInBraces={false}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Item Variable</label>
                <Input
                  value={step.itemVariable || ''}
                  onChange={(e) => handleUpdate({ itemVariable: e.target.value })}
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
                  onChange={(e) => handleUpdate({ maxItems: parseInt(e.target.value) || undefined })}
                  placeholder="100"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Expected Count Path</label>
                <div className="flex gap-1">
                  <Input
                    value={step.expectedCountPath || ''}
                    onChange={(e) => handleUpdate({ expectedCountPath: e.target.value })}
                    placeholder="e.g., response.totalItems"
                    className="font-mono text-sm"
                  />
                  <TokenBrowser
                    workflowId={workflowId}
                    previousSteps={previousSteps}
                    currentStepIndex={stepIndex}
                    onSelectToken={(token) => handleUpdate({ expectedCountPath: token })}
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
                  onChange={(e) => handleUpdate({ expectedCountPath: e.target.value })}
                  placeholder="response.totalItems"
                  className="font-mono text-sm"
                />
                <TokenBrowser
                  workflowId={workflowId}
                  previousSteps={previousSteps}
                  currentStepIndex={stepIndex}
                  onSelectToken={(token) => handleUpdate({ expectedCountPath: token })}
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
                    onChange={(e) => handleUpdate({
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
                    onChange={(e) => handleUpdate({
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
                onChange={(e) => handleUpdate({
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
                  onChange={(e) => handleUpdate({ inputPath: e.target.value })}
                  placeholder="e.g., output.analysis"
                  className="font-mono text-sm"
                />
                <TokenBrowser
                  workflowId={workflowId}
                  previousSteps={previousSteps}
                  currentStepIndex={stepIndex}
                  loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
                  onSelectToken={(token) => handleUpdate({ inputPath: token })}
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
                onValueChange={(val) => handleUpdate({ awaitStepId: val === '_auto' ? undefined : val })}
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

        {/* Input Configuration - unified input model for all step types */}
        {stepIndex > 0 && step.stepType !== 'foreach' && (
          <InputConfigurationSection
            step={step}
            stepIndex={stepIndex}
            allSteps={allSteps}
            workflowId={workflowId}
            previousSteps={previousSteps}
            isInLoop={isInLoop}
            loopScope={loopScope}
            onUpdate={handleUpdate}
            readOnly={readOnly}
          />
        )}

        {/* Input Preview and Test Execution - only in workflow editor mode */}
        {!readOnly && workflowId && stepIndex > 0 && (
          <div className="space-y-2 border-t pt-3">
            <InputPreviewSection
              workflowId={workflowId}
              stepId={step.id}
              stepIndex={stepIndex}
              inputConfig={step.inputConfig}
              onResolvedInputChange={(input, runId) => {
                setSampleInput(input)
                setSampleInputRunId(runId)
              }}
            />
            <TestExecutionSection
              workflowId={workflowId}
              stepId={step.id}
              stepType={step.stepType}
              stepName={step.name}
              sampleInput={sampleInput}
              workflowRunId={sampleInputRunId}
            />
          </div>
        )}

        {/* Description */}
        <div className="space-y-1 border-t pt-3">
          <label className="text-sm font-medium">Description</label>
          <Input
            value={step.description || ''}
            onChange={(e) => handleUpdate({ description: e.target.value })}
            placeholder="Optional description"
          />
        </div>

        {/* Add step after button */}
        {!readOnly && (
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
        )}
    </div>
  )
}
