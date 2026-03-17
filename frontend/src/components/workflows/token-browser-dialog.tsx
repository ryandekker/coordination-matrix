'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Search,
  Zap,
  Database,
  Repeat,
  Bot,
  Globe,
  User,
  Merge,
  GitBranch,
  Hash,
  Loader2,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Play,
  Variable,
  Lock,
} from 'lucide-react'
import { workflowRunsApi, variablePackagesApi, usersApi, VariableToken, KeyValuePath, User as UserType } from '@/lib/api'
import { TemplateEditor } from '@/components/ui/template-editor'

// ============================================================================
// Types
// ============================================================================

interface PreviousStep {
  id: string
  name: string
  stepType?: string
  itemVariable?: string
}

interface TokenBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId?: string
  previousSteps: PreviousStep[]
  currentStepIndex: number
  loopVariable?: string
  onSelectToken: (token: string) => void
  wrapInBraces?: boolean
  forJoinInputPath?: boolean
  // Field editing support
  fieldLabel?: string
  fieldValue?: string
  onFieldValueChange?: (value: string) => void
  // Task-only mode - shows system variables and variable packages without workflow context
  taskOnly?: boolean
}

interface WorkflowRun {
  _id: string
  status: string
  createdAt: string
  completedAt?: string
  inputPayload?: Record<string, unknown>
  callbackSecret?: string
}

interface RunContext {
  workflowRunId: string
  inputPayload?: Record<string, unknown>
  callbackSecret?: string
  apiUrl: string
  systemWebhookUrl: string
}

interface TaskRunData {
  stepId: string
  stepName: string
  stepType?: string
  status: string
  tags?: string[]
  summary?: string
  reviewDecision?: string
  reviewComment?: string
  taskResult?: {
    current?: {
      status: string
      output?: unknown
      summary?: string
      error?: string
      executedAt?: string
    }
    history?: Array<{
      status: string
      executedAt?: string
    }>
  }
  stepConfig?: Record<string, unknown>
  metadata: Record<string, unknown>
}

interface Token {
  path: string
  description: string
  example?: string
  type?: string
}

type CategoryId = 'system' | 'trigger' | 'loop' | string

// ============================================================================
// Utility Functions
// ============================================================================

function getStepIcon(stepType?: string): React.ElementType {
  switch (stepType) {
    case 'agent': return Bot
    case 'external': return Globe
    case 'manual': return User
    case 'foreach': return Repeat
    case 'join': return Merge
    case 'decision': return GitBranch
    case 'findDocument': return FileText
    default: return Hash
  }
}

function getStepColor(stepType?: string): string {
  switch (stepType) {
    case 'agent': return 'text-blue-500'
    case 'external': return 'text-orange-500'
    case 'manual': return 'text-purple-500'
    case 'foreach': return 'text-green-500'
    case 'join': return 'text-indigo-500'
    case 'decision': return 'text-amber-500'
    case 'findDocument': return 'text-cyan-500'
    default: return 'text-gray-500'
  }
}

function getStatusIcon(status: string): React.ElementType {
  switch (status) {
    case 'completed': return CheckCircle2
    case 'failed': return XCircle
    case 'cancelled': return XCircle
    case 'on_hold': return PauseCircle
    case 'waiting': return Clock
    case 'in_progress': return Play
    case 'pending': return Clock
    default: return AlertCircle
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-green-500'
    case 'failed': return 'text-red-500'
    case 'cancelled': return 'text-gray-500'
    case 'on_hold': return 'text-yellow-500'
    case 'waiting': return 'text-blue-500'
    case 'in_progress': return 'text-blue-500'
    case 'pending': return 'text-gray-400'
    default: return 'text-gray-500'
  }
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Build token path from JSON path segments
function buildTokenPath(basePath: string, segments: string[]): string {
  // Normalize basePath - remove trailing dot to prevent double dots
  let path = basePath.replace(/\.+$/, '')
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      path += `[${segment}]`
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) {
      path += path ? `.${segment}` : segment
    } else {
      path += `["${segment}"]`
    }
  }
  // Final cleanup - collapse any remaining double dots
  return path.replace(/\.{2,}/g, '.')
}

// ============================================================================
// ClickableJsonViewer - JsonViewer with click-to-select paths
// ============================================================================

interface ClickableJsonNodeProps {
  keyName?: string
  value: unknown
  depth: number
  path: string[]
  onSelectPath: (path: string[]) => void
  searchQuery?: string
  maxInitialDepth?: number
}

function ClickableJsonNode({
  keyName,
  value,
  depth,
  path,
  onSelectPath,
  searchQuery,
  maxInitialDepth = 3,
}: ClickableJsonNodeProps) {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  const isArray = Array.isArray(value)
  const isExpandable = isObject || isArray

  const [isExpanded, setIsExpanded] = useState(depth < maxInitialDepth)
  const [copied, setCopied] = useState(false)

  const currentPath = keyName !== undefined ? [...path, keyName] : path

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const tokenPath = buildTokenPath('', currentPath)
    await navigator.clipboard.writeText(`{{${tokenPath}}}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSelectPath = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectPath(currentPath)
  }

  const matchesSearch = searchQuery
    ? (keyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
       (typeof value === 'string' && value.toLowerCase().includes(searchQuery.toLowerCase())))
    : false

  const renderPrimitive = (val: unknown) => {
    if (val === null) return <span className="text-orange-500">null</span>
    if (val === undefined) return <span className="text-orange-500">undefined</span>
    if (typeof val === 'boolean') return <span className="text-purple-600 dark:text-purple-400">{val.toString()}</span>
    if (typeof val === 'number') return <span className="text-blue-600 dark:text-blue-400">{val}</span>
    if (typeof val === 'string') {
      const displayVal = val.length > 100 ? val.substring(0, 100) + '...' : val
      return <span className="text-green-700 dark:text-green-400">&quot;{displayVal}&quot;</span>
    }
    return <span>{String(val)}</span>
  }

  const getPreview = () => {
    if (isArray) {
      const arr = value as unknown[]
      return `[${arr.length} item${arr.length !== 1 ? 's' : ''}]`
    }
    if (isObject) {
      const keys = Object.keys(value as Record<string, unknown>)
      return `{${keys.length} key${keys.length !== 1 ? 's' : ''}}`
    }
    return ''
  }

  const indent = depth * 16

  if (!isExpandable) {
    return (
      <div
        className={cn(
          'group flex items-center py-1 hover:bg-primary/10 rounded px-2 -mx-2 cursor-pointer transition-colors',
          matchesSearch && 'bg-yellow-500/20'
        )}
        style={{ paddingLeft: indent + 8 }}
        onClick={handleSelectPath}
      >
        {keyName !== undefined && (
          <span className="text-cyan-700 dark:text-cyan-400 mr-1 font-medium">{keyName}:</span>
        )}
        {renderPrimitive(value)}
        <button
          onClick={handleCopyPath}
          className="ml-2 p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy token path"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>
    )
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i.toString(), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)

  return (
    <div>
      <div
        className={cn(
          'group flex items-center py-1 hover:bg-primary/10 rounded px-2 -mx-2 cursor-pointer transition-colors',
          matchesSearch && 'bg-yellow-500/20'
        )}
        style={{ paddingLeft: indent + 8 }}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-4 h-4 flex items-center justify-center mr-1 text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <span
          onClick={handleSelectPath}
          className="flex items-center flex-1"
        >
          {keyName !== undefined && (
            <span className="text-cyan-700 dark:text-cyan-400 mr-1 font-medium">{keyName}:</span>
          )}
          <span className="text-muted-foreground text-xs">{getPreview()}</span>
        </span>
        <button
          onClick={handleCopyPath}
          className="ml-2 p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy token path"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>

      {isExpanded && (
        <div>
          {entries.map(([key, val]) => (
            <ClickableJsonNode
              key={key}
              keyName={isArray ? key : key}
              value={val}
              depth={depth + 1}
              path={currentPath}
              onSelectPath={onSelectPath}
              searchQuery={searchQuery}
              maxInitialDepth={maxInitialDepth}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ClickableJsonViewer({
  data,
  basePath,
  onSelectPath,
  searchQuery,
  className,
}: {
  data: unknown
  basePath: string
  onSelectPath: (path: string) => void
  searchQuery?: string
  className?: string
}) {
  const handleSelectPath = useCallback((pathSegments: string[]) => {
    const fullPath = buildTokenPath(basePath, pathSegments)
    onSelectPath(fullPath)
  }, [basePath, onSelectPath])

  if (data === null || data === undefined) {
    return (
      <div className={cn('font-mono text-xs text-muted-foreground italic p-4', className)}>
        No data available
      </div>
    )
  }

  const isObject = typeof data === 'object' && !Array.isArray(data)
  const isArray = Array.isArray(data)

  if (!isObject && !isArray) {
    return (
      <div className={cn('font-mono text-xs p-2', className)}>
        <ClickableJsonNode
          value={data}
          depth={0}
          path={[]}
          onSelectPath={handleSelectPath}
          searchQuery={searchQuery}
        />
      </div>
    )
  }

  const entries = isArray
    ? (data as unknown[]).map((v, i) => [i.toString(), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)

  return (
    <div className={cn('font-mono text-xs p-2', className)}>
      {entries.map(([key, value]) => (
        <ClickableJsonNode
          key={key}
          keyName={isArray ? key : key}
          value={value}
          depth={0}
          path={[]}
          onSelectPath={handleSelectPath}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function TokenBrowserDialog({
  open,
  onOpenChange,
  workflowId,
  previousSteps = [],
  currentStepIndex = 0,
  loopVariable,
  onSelectToken,
  wrapInBraces = true,
  forJoinInputPath = false,
  fieldLabel,
  fieldValue,
  onFieldValueChange,
  taskOnly = false,
}: TokenBrowserDialogProps) {
  // State
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('system')
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('tokens')

  // Run data state
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runContext, setRunContext] = useState<RunContext | null>(null)
  const [taskData, setTaskData] = useState<Map<string, TaskRunData>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Variables state
  const [variableTokens, setVariableTokens] = useState<VariableToken[]>([])
  const [variablesLoading, setVariablesLoading] = useState(false)
  const [variablesError, setVariablesError] = useState<string | null>(null)
  const [expandedVariables, setExpandedVariables] = useState<Set<string>>(new Set())
  const variablesFetchedRef = useRef(false)

  // Agents state (for {{agent.*}} tokens)
  const [agents, setAgents] = useState<UserType[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const agentsFetchedRef = useRef(false)

  // Fetch available runs when dialog opens (skip in taskOnly mode)
  useEffect(() => {
    if (open && workflowId && !taskOnly && runs.length === 0) {
      fetchRuns()
    }
  }, [open, workflowId, taskOnly])

  // Fetch run data when run is selected
  useEffect(() => {
    if (selectedRunId && workflowId) {
      fetchRunData(selectedRunId)
    }
  }, [selectedRunId])

  // Fetch variable tokens when dialog opens (only once per mount)
  useEffect(() => {
    if (open && !variablesFetchedRef.current && !variablesLoading) {
      variablesFetchedRef.current = true
      fetchVariableTokens()
    }
  }, [open, variablesLoading])

  // Fetch agents when dialog opens (only once per mount)
  useEffect(() => {
    if (open && !agentsFetchedRef.current && !agentsLoading) {
      agentsFetchedRef.current = true
      fetchAgents()
    }
  }, [open, agentsLoading])

  const fetchAgents = async () => {
    setAgentsLoading(true)
    try {
      const response = await usersApi.listAgents()
      setAgents(response.data || [])
    } catch {
      // Non-critical — agents category will show static tokens only
      agentsFetchedRef.current = false
    } finally {
      setAgentsLoading(false)
    }
  }

  const fetchVariableTokens = async () => {
    setVariablesLoading(true)
    setVariablesError(null)
    try {
      const response = await variablePackagesApi.getTokens()
      setVariableTokens(response.data || [])
    } catch (err) {
      console.error('Failed to fetch variable tokens:', err)
      setVariablesError(err instanceof Error ? err.message : 'Failed to load variables')
      // Reset the ref so user can retry
      variablesFetchedRef.current = false
    } finally {
      setVariablesLoading(false)
    }
  }

  const toggleVariableExpanded = (variableName: string) => {
    setExpandedVariables(prev => {
      const next = new Set(prev)
      if (next.has(variableName)) {
        next.delete(variableName)
      } else {
        next.add(variableName)
      }
      return next
    })
  }

  const fetchRuns = async () => {
    if (!workflowId) return
    setLoading(true)
    setError(null)

    try {
      const response = await workflowRunsApi.list({
        workflowId,
        status: ['completed', 'running', 'failed'],
        limit: 10,
      })
      const fetchedRuns = (response.data || []) as WorkflowRun[]
      setRuns(fetchedRuns)

      // Auto-select most recent completed run, or first run
      const completedRun = fetchedRuns.find(r => r.status === 'completed')
      setSelectedRunId(completedRun?._id || fetchedRuns[0]?._id || null)
    } catch (err) {
      console.error('Failed to fetch runs:', err)
      setError('Failed to load workflow runs')
    } finally {
      setLoading(false)
    }
  }

  const fetchRunData = async (runId: string) => {
    setLoading(true)
    try {
      // API returns { run: {...}, tasks: [...] } when includeTasks is true
      const response = await workflowRunsApi.get(runId, {
        includeTasks: true,
      }) as unknown as {
        run: {
          _id: string
          inputPayload?: Record<string, unknown>
          callbackSecret?: string
        }
        tasks?: Array<{
          workflowStepId?: string
          title?: string
          taskType?: string
          status?: string
          tags?: string[]
          summary?: string
          reviewDecision?: string
          reviewComment?: string
          taskResult?: TaskRunData['taskResult']
          stepConfig?: Record<string, unknown>
          metadata?: Record<string, unknown>
        }>
      }

      const run = response.run

      // Build the API URL from current location
      const apiUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api`
        : '/api'

      // Build callback URL
      const systemWebhookUrl = `${apiUrl}/workflow-runs/${runId}/callback/{stepId}`

      // Store run context for system/trigger tokens
      setRunContext({
        workflowRunId: runId,
        inputPayload: run?.inputPayload,
        callbackSecret: run?.callbackSecret,
        apiUrl,
        systemWebhookUrl,
      })

      const tasks = response.tasks || []
      const dataMap = new Map<string, TaskRunData>()

      for (const task of tasks) {
        if (task.workflowStepId) {
          dataMap.set(task.workflowStepId, {
            stepId: task.workflowStepId,
            stepName: task.title || 'Unknown',
            stepType: task.taskType,
            status: task.status || 'unknown',
            tags: task.tags,
            summary: task.summary,
            reviewDecision: task.reviewDecision,
            reviewComment: task.reviewComment,
            taskResult: task.taskResult,
            stepConfig: task.stepConfig,
            metadata: (task.metadata || {}) as Record<string, unknown>,
          })
        }
      }

      setTaskData(dataMap)
    } catch (err) {
      console.error('Failed to fetch run data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Build categories list
  const categories = useMemo(() => {
    const cats: Array<{ id: CategoryId; name: string; icon: React.ElementType; color: string; hasData?: boolean }> = []

    // In taskOnly mode, always show system and variables (they're available without workflow context)
    // In workflow mode, show system only if we have run context
    if (taskOnly || runContext) {
      cats.push({ id: 'system', name: 'System', icon: Zap, color: 'text-yellow-500', hasData: taskOnly || !!runContext })
    }

    // Trigger data only available with workflow run context
    if (!taskOnly && runContext) {
      cats.push({ id: 'trigger', name: 'Trigger', icon: Zap, color: 'text-orange-500', hasData: !!runContext })
    }

    // Variables are always available
    cats.push({ id: 'variables', name: 'Variables', icon: Variable, color: 'text-violet-500', hasData: variableTokens.length > 0 })

    // Agents — dynamic agent assignment templates
    cats.push({ id: 'agents', name: 'Agents', icon: Bot, color: 'text-blue-500', hasData: agents.length > 0 })

    // Loop variable only in workflow context
    if (!taskOnly && loopVariable) {
      cats.push({ id: 'loop', name: `Loop: {{${loopVariable}}}`, icon: Repeat, color: 'text-green-500' })
    }

    // Previous steps only in workflow context
    if (!taskOnly) {
      for (const step of previousSteps) {
        const hasData = taskData.has(step.id)
        cats.push({
          id: step.id,
          name: step.name,
          icon: getStepIcon(step.stepType),
          color: getStepColor(step.stepType),
          hasData,
        })
      }
    }

    return cats
  }, [previousSteps, loopVariable, taskData, runContext, variableTokens.length, agents.length, taskOnly])

  // Helper to format example value for display
  const formatExampleValue = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'string') {
      return value.length > 60 ? value.substring(0, 60) + '...' : value
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value)
      return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`
    }
    return undefined
  }

  // Get tokens for selected category
  const getTokensForCategory = (categoryId: CategoryId): Token[] => {
    if (categoryId === 'system') {
      // Base API URL from window location
      const apiUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api`
        : '/api'

      const tokens: Token[] = [
        {
          path: '_apiUrl',
          description: 'Base API URL for internal calls',
          type: 'string',
          example: runContext?.apiUrl || apiUrl,
        },
        {
          path: '_apiKey',
          description: 'System API key for internal calls',
          type: 'string',
          example: '(injected at runtime)',
        },
        {
          path: 'taskId',
          description: 'Current task ID',
          type: 'string',
          example: '(varies per task)',
        },
      ]

      // Workflow-specific tokens (only if in workflow context)
      if (!taskOnly) {
        tokens.push(
          {
            path: '_workflowRunId',
            description: 'Current workflow run ID',
            type: 'string',
            example: runContext?.workflowRunId,
          },
          {
            path: 'workflowRunId',
            description: 'Current workflow run ID (alias)',
            type: 'string',
            example: runContext?.workflowRunId,
          },
          {
            path: 'stepId',
            description: 'Current step ID',
            type: 'string',
            example: '(varies per step)',
          },
          {
            path: 'systemWebhookUrl',
            description: 'URL for external callbacks',
            type: 'string',
            example: runContext?.systemWebhookUrl,
          },
          {
            path: 'callbackSecret',
            description: 'Secret for callback authentication',
            type: 'string',
            example: runContext?.callbackSecret ? `${runContext.callbackSecret.substring(0, 12)}...` : undefined,
          }
        )
      }

      return tokens
    }

    if (categoryId === 'trigger') {
      const payload = runContext?.inputPayload
      const tokens: Token[] = [
        {
          path: 'trigger.payload',
          description: 'Full initial payload',
          type: 'object',
          example: formatExampleValue(payload),
        },
      ]

      // Add dynamic tokens for actual payload fields
      if (payload && typeof payload === 'object') {
        for (const [key, value] of Object.entries(payload)) {
          tokens.push({
            path: `trigger.payload.${key}`,
            description: `Payload field: ${key}`,
            type: Array.isArray(value) ? 'array' : typeof value,
            example: formatExampleValue(value),
          })

          // Go one level deeper for objects
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
              tokens.push({
                path: `trigger.payload.${key}.${subKey}`,
                description: `Nested field: ${key}.${subKey}`,
                type: Array.isArray(subValue) ? 'array' : typeof subValue,
                example: formatExampleValue(subValue),
              })
            }
          }
        }
      }

      return tokens
    }

    if (categoryId === 'variables') {
      // Variables are rendered specially in the UI with expandable items
      // Return empty array here as we handle rendering directly
      return []
    }

    if (categoryId === 'agents') {
      // Agents are rendered specially in the UI
      // Return empty array here as we handle rendering directly
      return []
    }

    if (categoryId === 'loop' && loopVariable) {
      return [
        { path: loopVariable, description: 'Current item being processed', type: 'any' },
        { path: `${loopVariable}.id`, description: 'Item ID (if object)', type: 'string' },
        { path: `${loopVariable}.name`, description: 'Item name (if object)', type: 'string' },
        { path: '_index', description: 'Current item index (0-based)', type: 'number' },
        { path: '_total', description: 'Total items in loop', type: 'number' },
      ]
    }

    // Step-specific tokens
    const step = previousSteps.find(s => s.id === categoryId)
    if (!step) return []

    const isLastStep = previousSteps[previousSteps.length - 1]?.id === categoryId
    const prefix = isLastStep ? '' : `steps.${step.id}.`

    if (forJoinInputPath) {
      return [
        { path: 'output', description: 'Task output data', type: 'object' },
        { path: 'output.data', description: 'Nested data field', type: 'object' },
        { path: 'response', description: 'Response data', type: 'object' },
      ]
    }

    switch (step.stepType) {
      case 'external':
        return [
          { path: `${prefix}output`, description: 'Full response from external call', type: 'object' },
          { path: `${prefix}output.data`, description: 'Response data field', type: 'object' },
          { path: `${prefix}output.items`, description: 'Items array (if returned)', type: 'array' },
          { path: `${prefix}response`, description: 'Raw response data', type: 'object' },
        ]
      case 'foreach':
        if (step.itemVariable) {
          return [{ path: step.itemVariable, description: 'Current loop item', type: 'any' }]
        }
        return []
      case 'join':
        return [
          { path: `${prefix}output.aggregatedResults`, description: 'Array of all completed results', type: 'array' },
          { path: `${prefix}output.aggregatedResults[0]`, description: 'First result', type: 'object' },
          { path: `${prefix}output.completedCount`, description: 'Number of completed tasks', type: 'number' },
          { path: `${prefix}output.expectedCount`, description: 'Total expected tasks', type: 'number' },
        ]
      case 'findDocument':
        return [
          { path: `${prefix}output`, description: 'Found document(s)', type: 'object' },
          { path: `${prefix}output.content`, description: 'Document content', type: 'string' },
          { path: `${prefix}output.title`, description: 'Document title', type: 'string' },
        ]
      default:
        return [
          { path: `${prefix}output`, description: 'Task output', type: 'object' },
          { path: `${prefix}output.data`, description: 'Output data (if structured)', type: 'object' },
          { path: `${prefix}response`, description: 'Response data', type: 'object' },
        ]
    }
  }

  // Filter tokens by search
  const filteredTokens = useMemo(() => {
    const tokens = getTokensForCategory(selectedCategory)
    if (!searchQuery) return tokens
    const query = searchQuery.toLowerCase()
    return tokens.filter(t =>
      t.path.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    )
  }, [selectedCategory, searchQuery, loopVariable, previousSteps, forJoinInputPath])

  // Get run data for selected step
  const selectedStepData = useMemo(() => {
    if (selectedCategory === 'system' || selectedCategory === 'trigger' || selectedCategory === 'loop' || selectedCategory === 'variables' || selectedCategory === 'agents' || selectedCategory.startsWith('variable:')) {
      return null
    }
    return taskData.get(selectedCategory) || null
  }, [selectedCategory, taskData])

  // Token expression state - editable text field
  // Use fieldValue as the source of truth when provided (external field mode)
  const isExternalFieldMode = fieldValue !== undefined && onFieldValueChange !== undefined
  const [internalExpression, setInternalExpression] = useState('')

  // The actual expression being edited
  const tokenExpression = isExternalFieldMode ? fieldValue : internalExpression
  const setTokenExpression = isExternalFieldMode ? onFieldValueChange : setInternalExpression

  // Track cursor position for insertion
  const editorRef = useRef<{ focus: () => void; selectionStart: number | null; setSelectionRange: (start: number, end: number) => void }>(null)
  const [cursorPosition, setCursorPosition] = useState<number | null>(null)

  const handleCursorChange = useCallback(() => {
    if (editorRef.current) {
      setCursorPosition(editorRef.current.selectionStart)
    }
  }, [])

  // Handle token selection - insert at cursor position
  const handleSelectToken = (path: string) => {
    const token = wrapInBraces ? `{{${path}}}` : path
    const currentValue = tokenExpression || ''
    const insertPos = cursorPosition ?? currentValue.length
    const newValue = currentValue.slice(0, insertPos) + token + currentValue.slice(insertPos)
    setTokenExpression(newValue)

    // Update cursor position
    const newCursorPos = insertPos + token.length
    setCursorPosition(newCursorPos)

    // Focus and set cursor position
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
        editorRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleInsertToken = () => {
    if (!tokenExpression.trim()) return
    onSelectToken(tokenExpression)
    onOpenChange(false)
    if (!isExternalFieldMode) {
      setInternalExpression('')
    }
  }

  // Clear internal expression when dialog closes (only for non-external mode)
  useEffect(() => {
    if (!open && !isExternalFieldMode) {
      setInternalExpression('')
    }
  }, [open, isExternalFieldMode])

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!searchQuery) return categories
    const query = searchQuery.toLowerCase()
    return categories.filter(cat =>
      cat.name.toLowerCase().includes(query) ||
      getTokensForCategory(cat.id).some(t =>
        t.path.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
      )
    )
  }, [categories, searchQuery])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 pr-12 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex-shrink-0">Token Browser</DialogTitle>
            {workflowId && runs.length > 0 && (
              <Select value={selectedRunId || ''} onValueChange={setSelectedRunId}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="Select run..." />
                </SelectTrigger>
                <SelectContent>
                  {runs.map(run => (
                    <SelectItem key={run._id} value={run._id} className="text-xs">
                      <span className="flex items-center gap-2">
                        <Badge variant={run.status === 'completed' ? 'default' : 'secondary'} className="text-[10px] px-1">
                          {run.status}
                        </Badge>
                        {formatRelativeTime(run.createdAt)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </DialogHeader>

        {/* Search bar */}
        <div className="px-4 py-2 border-b flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tokens and data..."
              className="pl-8 h-9"
            />
          </div>
        </div>

        {/* Main content - two panels */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left sidebar - categories */}
          <div className="w-64 border-r flex flex-col overflow-hidden">
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Steps
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {filteredCategories.map(cat => {
                  const Icon = cat.icon
                  const isSelected = selectedCategory === cat.id
                  return (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCategory(cat.id)
                        setActiveTab('tokens')
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                        isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                      )}
                    >
                      <Icon className={cn('h-4 w-4 flex-shrink-0', cat.color)} />
                      <span className="truncate flex-1">{cat.name}</span>
                      {cat.hasData && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          data
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right panel - content */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-4 mt-2 flex-shrink-0 w-fit">
                <TabsTrigger value="tokens" className="text-xs">Tokens</TabsTrigger>
                <TabsTrigger
                  value="data"
                  className="text-xs"
                  disabled={
                    !selectedStepData &&
                    !(selectedCategory === 'system' && runContext) &&
                    !(selectedCategory === 'trigger' && runContext)
                  }
                >
                  Run Data
                </TabsTrigger>
                <TabsTrigger value="info" className="text-xs" disabled={!selectedStepData}>
                  Task Info
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0 overflow-auto p-4">
                {/* Tokens tab */}
                <TabsContent value="tokens" className="mt-0">
                  <div className="space-y-1">
                      {loading && (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      )}

                      {/* Special rendering for Variables category - expandable items */}
                      {selectedCategory === 'variables' && !loading && (
                        <>
                          {variablesLoading && (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          )}
                          {variablesError && (
                            <div className="text-center py-4 text-sm text-amber-600">
                              {variablesError}
                              <button
                                className="ml-2 underline hover:no-underline"
                                onClick={() => {
                                  setVariablesError(null)
                                  variablesFetchedRef.current = false
                                  fetchVariableTokens()
                                }}
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {!variablesLoading && !variablesError && variableTokens.length === 0 && (
                            <div className="text-center py-8 text-sm text-muted-foreground">
                              No variables defined.{' '}
                              <a href="/settings/variables" className="underline hover:no-underline" target="_blank">
                                Create one
                              </a>
                            </div>
                          )}
                          {!variablesLoading && !variablesError && variableTokens.map(v => {
                            const isExpanded = expandedVariables.has(v.name)
                            const tokenPath = `variables.${v.name}`

                            // Helper to format a value for display
                            const formatValue = (value: unknown, maxLen = 50): string => {
                              if (value === null) return 'null'
                              if (value === undefined) return 'undefined'
                              if (typeof value === 'string') {
                                return value.length > maxLen ? `"${value.substring(0, maxLen)}..."` : `"${value}"`
                              }
                              if (typeof value === 'number' || typeof value === 'boolean') {
                                return String(value)
                              }
                              if (Array.isArray(value)) {
                                return `[${value.length} items]`
                              }
                              if (typeof value === 'object') {
                                const keys = Object.keys(value)
                                return `{${keys.length} keys}`
                              }
                              return String(value)
                            }

                            return (
                              <div key={v.variableId} className="border rounded-md overflow-hidden">
                                {/* Variable header - always clickable to insert */}
                                <div className="flex items-center">
                                  {v.isObject && v.paths.length > 0 && (
                                    <button
                                      onClick={() => toggleVariableExpanded(v.name)}
                                      className="p-2 hover:bg-muted"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleSelectToken(tokenPath)}
                                    className={cn(
                                      'flex-1 text-left px-3 py-2.5 transition-colors',
                                      !v.isObject && 'pl-10',
                                      selectedPath === tokenPath ? 'bg-primary/10' : 'hover:bg-muted/50'
                                    )}
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <code className="text-xs font-mono bg-violet-500/10 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
                                        {wrapInBraces ? `{{${tokenPath}}}` : tokenPath}
                                      </code>
                                      {v.encrypted && (
                                        <Badge variant="outline" className="text-[10px] px-1 gap-0.5">
                                          <Lock className="h-2.5 w-2.5" />
                                          encrypted
                                        </Badge>
                                      )}
                                      {v.isObject && (
                                        <Badge variant="outline" className="text-[10px] px-1">
                                          object
                                        </Badge>
                                      )}
                                    </div>
                                    {v.description && (
                                      <p className="text-xs text-muted-foreground mt-1">{v.description}</p>
                                    )}
                                    {/* Show simple value for non-object variables */}
                                    {!v.isObject && v.value !== null && v.value !== undefined && (
                                      <div className="mt-1.5 flex items-center gap-1">
                                        <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">
                                          Value:
                                        </span>
                                        <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                          {formatValue(v.value, 60)}
                                        </code>
                                      </div>
                                    )}
                                  </button>
                                </div>

                                {/* Expanded paths with values */}
                                {isExpanded && v.isObject && v.paths.length > 0 && (
                                  <div className="border-t bg-muted/20">
                                    {v.paths.map((pathItem: KeyValuePath) => {
                                      const keyPath = `${tokenPath}.${pathItem.path}`
                                      // Determine indentation based on path depth
                                      const depth = (pathItem.path.match(/\./g) || []).length + (pathItem.path.match(/\[/g) || []).length
                                      const indent = 10 + depth * 12
                                      const isExpandableType = pathItem.type === 'object' || pathItem.type === 'array'

                                      return (
                                        <button
                                          key={pathItem.path}
                                          onClick={() => handleSelectToken(keyPath)}
                                          className={cn(
                                            'w-full text-left pr-3 py-2 transition-colors border-b last:border-b-0',
                                            selectedPath === keyPath ? 'bg-primary/10' : 'hover:bg-muted/50'
                                          )}
                                          style={{ paddingLeft: `${indent}px` }}
                                        >
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                              .{pathItem.path}
                                            </code>
                                            <Badge variant="outline" className="text-[9px] px-1">
                                              {pathItem.type}
                                            </Badge>
                                          </div>
                                          {/* Show value preview */}
                                          {!isExpandableType && (
                                            <div className="mt-1 flex items-center gap-1">
                                              <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 break-all">
                                                {formatValue(pathItem.value, 80)}
                                              </code>
                                            </div>
                                          )}
                                          {isExpandableType && (
                                            <div className="mt-1 flex items-center gap-1">
                                              <code className="text-[11px] font-mono text-muted-foreground">
                                                {formatValue(pathItem.value, 80)}
                                              </code>
                                            </div>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}

                      {/* Agents category - dynamic agent assignment templates */}
                      {selectedCategory === 'agents' && !loading && (
                        <>
                          {agentsLoading && (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          )}
                          {!agentsLoading && (
                            <div className="space-y-3">
                              {/* Explanation */}
                              <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Dynamic Agent Assignment</p>
                                <p>These templates resolve to agents at runtime based on their attributes. When agents are added or removed, workflows automatically pick up the right agent.</p>
                              </div>

                              {/* By Complexity */}
                              <div>
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">By Complexity Level</div>
                                {[
                                  { level: 3, label: 'Advanced (Opus-class)', desc: 'Complex reasoning, architecture, creative tasks' },
                                  { level: 2, label: 'Intermediate (Sonnet-class)', desc: 'Standard tasks, reviews, summarization' },
                                  { level: 1, label: 'Basic (Haiku-class)', desc: 'Fast triage, simple tasks, categorization' },
                                ].map(({ level, label, desc }) => {
                                  const matching = agents.filter(a => a.agentComplexity === level)
                                  const tokenPath = `agent.complexity.${level}`
                                  return (
                                    <button
                                      key={level}
                                      onClick={() => handleSelectToken(tokenPath)}
                                      className={cn(
                                        'w-full text-left px-3 py-2.5 rounded transition-colors',
                                        selectedPath === tokenPath ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'
                                      )}
                                    >
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <code className="text-xs font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                          {wrapInBraces ? `{{${tokenPath}}}` : tokenPath}
                                        </code>
                                        <Badge variant="outline" className="text-[10px] px-1">
                                          Level {level}
                                        </Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">{label} — {desc}</p>
                                      {matching.length > 0 && (
                                        <div className="mt-1.5 flex items-center gap-1">
                                          <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">Resolves to:</span>
                                          <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                            {matching[0].displayName}
                                          </code>
                                          {matching.length > 1 && (
                                            <span className="text-[10px] text-muted-foreground">+{matching.length - 1} more</span>
                                          )}
                                        </div>
                                      )}
                                      {matching.length === 0 && (
                                        <div className="mt-1.5">
                                          <span className="text-[10px] text-amber-600 dark:text-amber-400">No matching agents configured</span>
                                        </div>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>

                              {/* By Tag */}
                              {(() => {
                                const allTags = new Set<string>()
                                agents.forEach(a => a.agentTags?.forEach((t: string) => allTags.add(t)))
                                if (allTags.size === 0) return null

                                return (
                                  <div>
                                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">By Capability Tag</div>
                                    {Array.from(allTags).sort().map(tag => {
                                      const matching = agents.filter(a => a.agentTags?.includes(tag))
                                      const tokenPath = `agent.tag.${tag}`
                                      return (
                                        <button
                                          key={tag}
                                          onClick={() => handleSelectToken(tokenPath)}
                                          className={cn(
                                            'w-full text-left px-3 py-2.5 rounded transition-colors',
                                            selectedPath === tokenPath ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <code className="text-xs font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                              {wrapInBraces ? `{{${tokenPath}}}` : tokenPath}
                                            </code>
                                          </div>
                                          <p className="text-xs text-muted-foreground mt-1">Agent with &quot;{tag}&quot; capability</p>
                                          {matching.length > 0 && (
                                            <div className="mt-1.5 flex items-center gap-1">
                                              <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">Resolves to:</span>
                                              <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                                {matching[0].displayName}
                                              </code>
                                              {matching.length > 1 && (
                                                <span className="text-[10px] text-muted-foreground">+{matching.length - 1} more</span>
                                              )}
                                            </div>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )
                              })()}

                              {/* By Name */}
                              {agents.length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">By Name</div>
                                  {agents.map(agent => {
                                    const tokenPath = `agent.name.${agent.displayName}`
                                    return (
                                      <button
                                        key={agent._id}
                                        onClick={() => handleSelectToken(tokenPath)}
                                        className={cn(
                                          'w-full text-left px-3 py-2.5 rounded transition-colors',
                                          selectedPath === tokenPath ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'
                                        )}
                                      >
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <code className="text-xs font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                            {wrapInBraces ? `{{${tokenPath}}}` : tokenPath}
                                          </code>
                                          {agent.agentComplexity && (
                                            <Badge variant="outline" className="text-[10px] px-1">
                                              Level {agent.agentComplexity}
                                            </Badge>
                                          )}
                                          {agent.agentTags?.map((tag: string) => (
                                            <Badge key={tag} variant="secondary" className="text-[10px] px-1">
                                              {tag}
                                            </Badge>
                                          ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">Resolves to {agent.displayName} by exact name</p>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                              {/* Multi-Agent Queries (for ForEach fan-out) */}
                              {agents.length > 1 && (
                                <div className="border-t pt-3 mt-3">
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Multi-Agent Queries</div>
                                  <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 mb-2">
                                    <p className="font-medium text-amber-800 dark:text-amber-200 mb-0.5">ForEach Fan-Out</p>
                                    <p>Use in a ForEach step&apos;s <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">Items Path</code> to iterate over all matching agents. Combine criteria with <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">+</code> for AND filtering.</p>
                                  </div>
                                  {/* By Complexity — show levels with 2+ agents */}
                                  {[3, 2, 1].map(level => {
                                    const matching = agents.filter(a => a.agentComplexity === level)
                                    if (matching.length < 2) return null
                                    const tokenPath = `agents.complexity.${level}`
                                    return (
                                      <button
                                        key={`multi-${level}`}
                                        onClick={() => handleSelectToken(tokenPath)}
                                        className={cn(
                                          'w-full text-left px-3 py-2 rounded transition-colors',
                                          selectedPath === tokenPath ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'
                                        )}
                                      >
                                        <code className="text-xs font-mono bg-purple-500/10 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                          {tokenPath}
                                        </code>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          {matching.length} agents: {matching.map(a => a.displayName).join(', ')}
                                        </p>
                                      </button>
                                    )
                                  })}
                                  {/* By Tag — show tags with 2+ agents */}
                                  {(() => {
                                    const allTags = new Set<string>()
                                    agents.forEach(a => a.agentTags?.forEach((t: string) => allTags.add(t)))
                                    return Array.from(allTags).sort().map(tag => {
                                      const matching = agents.filter(a => a.agentTags?.includes(tag))
                                      if (matching.length < 2) return null
                                      const tokenPath = `agents.tag.${tag}`
                                      return (
                                        <button
                                          key={`multi-tag-${tag}`}
                                          onClick={() => handleSelectToken(tokenPath)}
                                          className={cn(
                                            'w-full text-left px-3 py-2 rounded transition-colors',
                                            selectedPath === tokenPath ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'
                                          )}
                                        >
                                          <code className="text-xs font-mono bg-purple-500/10 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                            {tokenPath}
                                          </code>
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {matching.length} agents: {matching.map(a => a.displayName).join(', ')}
                                          </p>
                                        </button>
                                      )
                                    })
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Standard token rendering for other categories */}
                      {selectedCategory !== 'variables' && selectedCategory !== 'agents' && !loading && filteredTokens.length === 0 && (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          No tokens available
                        </div>
                      )}
                      {selectedCategory !== 'variables' && selectedCategory !== 'agents' && !loading && filteredTokens.map(token => (
                        <button
                          key={token.path}
                          onClick={() => handleSelectToken(token.path)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 rounded transition-colors overflow-hidden',
                            selectedPath === token.path
                              ? 'bg-primary/10 ring-1 ring-primary'
                              : 'hover:bg-muted'
                          )}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded break-all">
                              {wrapInBraces ? `{{${token.path}}}` : token.path}
                            </code>
                            {token.type && (
                              <Badge variant="outline" className="text-[10px] px-1 flex-shrink-0">
                                {token.type}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {token.description}
                          </p>
                          {token.example && (
                            <div className="mt-1.5 overflow-hidden">
                              <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">
                                Value:{' '}
                              </span>
                              <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 break-all" title={token.example}>
                                {token.example.length > 80 ? token.example.substring(0, 80) + '...' : token.example}
                              </code>
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </TabsContent>

                {/* Run Data tab */}
                <TabsContent value="data" className="mt-0">
                    {selectedCategory === 'system' && runContext ? (
                      <div>
                        <div className="text-xs text-muted-foreground pb-2">
                          System values from the selected run
                        </div>
                        <ClickableJsonViewer
                          data={{
                            _apiUrl: runContext.apiUrl,
                            _workflowRunId: runContext.workflowRunId,
                            workflowRunId: runContext.workflowRunId,
                            systemWebhookUrl: runContext.systemWebhookUrl,
                            callbackSecret: runContext.callbackSecret || '(not set)',
                          }}
                          basePath=""
                          onSelectPath={handleSelectToken}
                          searchQuery={searchQuery}
                        />
                      </div>
                    ) : selectedCategory === 'trigger' && runContext ? (
                      <div>
                        <div className="text-xs text-muted-foreground pb-2">
                          Trigger payload from the selected run - click any value to select its path
                        </div>
                        {runContext.inputPayload && Object.keys(runContext.inputPayload).length > 0 ? (
                          <ClickableJsonViewer
                            data={runContext.inputPayload}
                            basePath="trigger.payload"
                            onSelectPath={handleSelectToken}
                            searchQuery={searchQuery}
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground italic py-4">
                            No payload was provided when this workflow was triggered.
                          </div>
                        )}
                      </div>
                    ) : selectedStepData ? (
                      <div>
                        <div className="text-xs text-muted-foreground pb-2">
                          Click any value to select its token path
                        </div>
                        <ClickableJsonViewer
                          data={selectedStepData.metadata}
                          basePath={previousSteps[previousSteps.length - 1]?.id === selectedCategory ? '' : `steps.${selectedCategory}`}
                          onSelectPath={handleSelectToken}
                          searchQuery={searchQuery}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        {selectedRunId ? 'No run data available for this step' : 'Select a workflow run to see actual data'}
                      </div>
                    )}
                </TabsContent>

                {/* Task Info tab */}
                <TabsContent value="info" className="mt-0">
                    {selectedStepData ? (
                      <div className="space-y-4">
                        {/* Status */}
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground uppercase">Status</label>
                          <div className="flex items-center gap-2">
                            {(() => {
                              const StatusIcon = getStatusIcon(selectedStepData.status)
                              return <StatusIcon className={cn('h-4 w-4', getStatusColor(selectedStepData.status))} />
                            })()}
                            <span className="text-sm font-medium">{selectedStepData.status}</span>
                          </div>
                        </div>

                        {/* Tags */}
                        {selectedStepData.tags && selectedStepData.tags.length > 0 && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Tags</label>
                            <div className="flex flex-wrap gap-1">
                              {selectedStepData.tags.map(tag => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Summary */}
                        {selectedStepData.summary && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Summary</label>
                            <p className="text-sm">{selectedStepData.summary}</p>
                          </div>
                        )}

                        {/* Review Decision */}
                        {selectedStepData.reviewDecision && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Review Decision</label>
                            <div className="flex items-center gap-2">
                              <Badge variant={selectedStepData.reviewDecision === 'approved' ? 'default' : 'destructive'}>
                                {selectedStepData.reviewDecision}
                              </Badge>
                              {selectedStepData.reviewComment && (
                                <span className="text-sm text-muted-foreground">{selectedStepData.reviewComment}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Task Result */}
                        {selectedStepData.taskResult?.current && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Task Result</label>
                            <div className="bg-muted rounded p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge variant={selectedStepData.taskResult.current.status === 'success' ? 'default' : 'secondary'}>
                                  {selectedStepData.taskResult.current.status}
                                </Badge>
                                {selectedStepData.taskResult.current.executedAt && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatRelativeTime(selectedStepData.taskResult.current.executedAt)}
                                  </span>
                                )}
                              </div>
                              {selectedStepData.taskResult.current.summary && (
                                <p className="text-sm">{selectedStepData.taskResult.current.summary}</p>
                              )}
                              {selectedStepData.taskResult.current.error && (
                                <p className="text-sm text-red-500">{selectedStepData.taskResult.current.error}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Step Config (collapsed by default) */}
                        {selectedStepData.stepConfig && Object.keys(selectedStepData.stepConfig).length > 0 && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Step Config</label>
                            <ClickableJsonViewer
                              data={selectedStepData.stepConfig}
                              basePath="stepConfig"
                              onSelectPath={handleSelectToken}
                              className="bg-muted rounded p-2"
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        No task info available
                      </div>
                    )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        {/* Footer - editable token expression */}
        <div className="px-4 py-3 border-t bg-muted/30 flex-shrink-0 space-y-2">
          {fieldLabel && (
            <div className="text-xs font-medium text-muted-foreground">{fieldLabel}</div>
          )}
          <div className="flex gap-2">
            <TemplateEditor
              ref={editorRef}
              value={tokenExpression || ''}
              onChange={setTokenExpression}
              onSelect={handleCursorChange}
              onClick={handleCursorChange}
              onKeyUp={handleCursorChange}
              placeholder="Click tokens above to insert, or type directly..."
              className="flex-1"
              minHeight="80px"
              maxHeight="120px"
            />
            <div className="flex flex-col gap-1">
              <Button
                onClick={() => {
                  if (isExternalFieldMode) {
                    setTokenExpression('')
                  } else {
                    setInternalExpression('')
                  }
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                disabled={!tokenExpression}
              >
                Clear
              </Button>
              {!isExternalFieldMode && (
                <Button
                  onClick={handleInsertToken}
                  disabled={!tokenExpression.trim()}
                  size="sm"
                  className="h-8"
                >
                  Insert
                </Button>
              )}
              {isExternalFieldMode && (
                <Button
                  onClick={() => onOpenChange(false)}
                  size="sm"
                  className="h-8"
                >
                  Done
                </Button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Click tokens to insert at cursor. You can also type text between tokens like: <code className="bg-muted px-1 rounded">Hello {'{{name}}'}, your order {'{{orderId}}'} is ready</code>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
