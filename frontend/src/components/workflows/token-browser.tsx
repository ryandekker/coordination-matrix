'use client'

import { useState, useEffect } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Plus,
  Zap,
  Database,
  Repeat,
  Bot,
  Globe,
  User,
  Merge,
  GitBranch,
  Hash,
  Search,
  Clock,
  Loader2,
} from 'lucide-react'
import { workflowRunsApi } from '@/lib/api'

interface TokenCategory {
  name: string
  icon: React.ElementType
  color: string
  tokens: Token[]
}

interface Token {
  path: string
  description: string
  example?: string
  fromRun?: boolean // Indicates this came from actual run data
}

interface TokenBrowserProps {
  // Workflow ID to fetch past run data
  workflowId?: string
  // Previous steps in the workflow for context
  previousSteps?: Array<{
    id: string
    name: string
    stepType?: string
    itemVariable?: string
  }>
  // Current step index (to know which steps came before)
  currentStepIndex?: number
  // If inside a loop, the loop variable
  loopVariable?: string
  // Callback when a token is selected
  onSelectToken: (token: string) => void
  // Whether to wrap in {{ }}
  wrapInBraces?: boolean
  // Button variant
  variant?: 'icon' | 'text'
  // Custom trigger content
  children?: React.ReactNode
}

interface SampleData {
  stepId: string
  stepName: string
  output: unknown
}

export function TokenBrowser({
  workflowId,
  previousSteps = [],
  currentStepIndex = 0,
  loopVariable,
  onSelectToken,
  wrapInBraces = true,
  variant = 'icon',
  children,
}: TokenBrowserProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sampleData, setSampleData] = useState<SampleData[]>([])
  const [loadingSamples, setLoadingSamples] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Fetch sample data from past workflow runs when popover opens
  useEffect(() => {
    if (open && workflowId && sampleData.length === 0 && !fetchError) {
      fetchSampleData()
    }
  }, [open, workflowId])

  const fetchSampleData = async () => {
    if (!workflowId) return

    setLoadingSamples(true)
    setFetchError(null)
    try {
      // Get recent runs (completed or running) using authenticated API client
      // Include running runs since they may have tasks with output data
      const runsResponse = await workflowRunsApi.list({
        workflowId,
        status: ['completed', 'running'],
        limit: 1,
      })
      const runs = runsResponse.data || []

      if (runs.length === 0) {
        setFetchError('No runs yet')
        setLoadingSamples(false)
        return
      }

      // Get tasks from the most recent run
      const runId = runs[0]._id
      const runResponse = await workflowRunsApi.get(runId, true) as { tasks?: Array<{ workflowStepId?: string; title?: string; metadata?: unknown }> }
      const tasks = runResponse.tasks || []

      // Extract output data from each task - data is in `metadata` field
      const samples: SampleData[] = tasks
        .filter((task) => task.metadata && Object.keys(task.metadata as object).length > 0)
        .map((task) => ({
          stepId: task.workflowStepId || '',
          stepName: task.title || 'Unknown Step',
          output: task.metadata,
        }))

      if (samples.length === 0) {
        setFetchError('No task outputs found in runs')
      }

      setSampleData(samples)
    } catch (error) {
      console.error('Failed to fetch sample data:', error)
      const errorMessage = error instanceof Error ? error.message : 'Network error'
      setFetchError(errorMessage)
    } finally {
      setLoadingSamples(false)
    }
  }

  // Extract paths from sample output object
  const extractPaths = (obj: unknown, prefix: string = '', maxDepth: number = 3): Token[] => {
    if (maxDepth <= 0 || obj === null || obj === undefined) return []

    const tokens: Token[] = []

    if (typeof obj === 'object' && !Array.isArray(obj)) {
      const record = obj as Record<string, unknown>
      for (const [key, value] of Object.entries(record)) {
        const path = prefix ? `${prefix}.${key}` : key
        const valueType = Array.isArray(value) ? 'array' : typeof value
        const example = valueType === 'string'
          ? (value as string).substring(0, 100) + ((value as string).length > 100 ? '...' : '')
          : valueType === 'number' || valueType === 'boolean'
          ? String(value)
          : valueType === 'array'
          ? `[${(value as unknown[]).length} items]`
          : undefined

        tokens.push({
          path,
          description: `${valueType}${example ? '' : ''}`,
          example,
          fromRun: true,
        })

        // Recurse into objects and first array item
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value) && value.length > 0) {
            tokens.push(...extractPaths(value[0], `${path}[0]`, maxDepth - 1))
          } else if (!Array.isArray(value)) {
            tokens.push(...extractPaths(value, path, maxDepth - 1))
          }
        }
      }
    }

    return tokens
  }

  // Build token categories based on context
  const categories: TokenCategory[] = []

  // System tokens - always available
  categories.push({
    name: 'System',
    icon: Zap,
    color: 'text-yellow-500',
    tokens: [
      { path: 'workflowRunId', description: 'Current workflow run ID' },
      { path: 'stepId', description: 'Current step ID' },
      { path: 'taskId', description: 'Current task ID' },
      { path: 'systemWebhookUrl', description: 'URL for external callbacks' },
      { path: 'callbackSecret', description: 'Secret for callback auth' },
    ],
  })

  // Loop variable if inside a loop
  if (loopVariable) {
    categories.push({
      name: 'Loop Item',
      icon: Repeat,
      color: 'text-green-500',
      tokens: [
        { path: loopVariable, description: `Current item being processed` },
        { path: `${loopVariable}.id`, description: 'Item ID (if object)' },
        { path: `${loopVariable}.name`, description: 'Item name (if object)' },
        { path: '_index', description: 'Current item index (0-based)' },
        { path: '_total', description: 'Total items in loop' },
      ],
    })
  }

  // Previous step outputs
  if (previousSteps.length > 0) {
    const prevStep = previousSteps[previousSteps.length - 1]

    // Check if we have sample data for this step
    const stepSample = sampleData.find(s => s.stepId === prevStep.id)

    let stepTokens: Token[] = []

    if (stepSample) {
      // Use actual sample data to build tokens - prefix with "output" to match actual path
      stepTokens = extractPaths(stepSample.output, 'output')
      if (stepTokens.length === 0) {
        stepTokens.push({ path: 'output', description: 'Step output', fromRun: true })
      }
    } else {
      // Fallback to type-based suggestions - all use "output" prefix
      switch (prevStep.stepType) {
        case 'external':
          stepTokens = [
            { path: 'output', description: 'Full response from external call' },
            { path: 'output.data', description: 'Response data field' },
            { path: 'output.items', description: 'Items array (if returned)' },
          ]
          break
        case 'foreach':
          if (prevStep.itemVariable) {
            stepTokens = [
              { path: prevStep.itemVariable, description: `Current loop item` },
            ]
          }
          break
        case 'join':
          stepTokens = [
            { path: 'output.aggregatedResults', description: 'Array of all completed results' },
            { path: 'output.aggregatedResults[0]', description: 'First result' },
            { path: 'output.completedCount', description: 'Number of completed tasks' },
            { path: 'output.expectedCount', description: 'Total expected tasks' },
          ]
          break
        case 'agent':
        case 'manual':
        default:
          stepTokens = [
            { path: 'output', description: 'Task output' },
            { path: 'output.data', description: 'Output data (if structured)' },
          ]
      }
    }

    const categoryName = stepSample
      ? `From: ${prevStep.name} (sampled)`
      : `From: ${prevStep.name}`

    categories.push({
      name: categoryName,
      icon: stepSample ? Clock : getStepIcon(prevStep.stepType),
      color: stepSample ? 'text-emerald-500' : getStepColor(prevStep.stepType),
      tokens: stepTokens,
    })

    // Add option to reference other steps with sample data
    if (previousSteps.length > 1) {
      const otherStepTokens: Token[] = previousSteps.slice(0, -1).flatMap(step => {
        const sample = sampleData.find(s => s.stepId === step.id)
        if (sample) {
          const paths = extractPaths(sample.output, `steps.${step.id}.output`)
          if (paths.length > 0) return paths.slice(0, 3) // Limit to top 3 paths
        }
        return [{
          path: `steps.${step.id}.output`,
          description: `Output from "${step.name}"`,
        }]
      })

      if (otherStepTokens.length > 0) {
        categories.push({
          name: 'Other Steps',
          icon: Database,
          color: 'text-gray-500',
          tokens: otherStepTokens,
        })
      }
    }
  }

  // Trigger payload
  categories.push({
    name: 'Trigger Payload',
    icon: Zap,
    color: 'text-orange-500',
    tokens: [
      { path: 'trigger.payload', description: 'Full initial payload' },
      { path: 'trigger.payload.data', description: 'Payload data field' },
    ],
  })

  // Filter tokens by search
  const filteredCategories = categories.map(cat => ({
    ...cat,
    tokens: cat.tokens.filter(token =>
      token.path.toLowerCase().includes(search.toLowerCase()) ||
      token.description.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(cat => cat.tokens.length > 0)

  const handleSelect = (token: Token) => {
    const value = wrapInBraces ? `{{${token.path}}}` : token.path
    onSelectToken(value)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        {children || (
          variant === 'icon' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
            >
              <Plus className="h-3 w-3 mr-1" />
              Insert Token
            </Button>
          )
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tokens..."
              className="h-8 border-0 p-0 focus-visible:ring-0"
            />
            {loadingSamples && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
            )}
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
          <div className="p-2 space-y-3">
            {filteredCategories.map((category) => (
              <div key={category.name}>
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                  <category.icon className={cn('h-3 w-3', category.color)} />
                  {category.name}
                </div>
                <div className="space-y-0.5">
                  {category.tokens.map((token) => (
                    <button
                      key={token.path}
                      onClick={() => handleSelect(token)}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-muted flex flex-col gap-0.5 group"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono bg-muted group-hover:bg-background px-1 py-0.5 rounded flex-shrink-0">
                          {wrapInBraces ? `{{${token.path}}}` : token.path}
                        </code>
                        {token.fromRun && (
                          <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1 rounded">
                            from run
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {token.description}
                        </span>
                        {token.example && (
                          <span className="text-[10px] text-muted-foreground/70 font-mono break-all max-w-[280px]">
                            = {token.example}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {filteredCategories.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No tokens found
              </div>
            )}
          </div>
        </div>

        <div className="border-t p-2 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            <strong>output</strong> = previous step&apos;s output<br />
            <strong>steps.id.output</strong> = specific step&apos;s output<br />
            <strong>trigger</strong> = initial workflow payload
          </p>
          {workflowId && sampleData.length === 0 && !loadingSamples && fetchError && (
            <p className="text-xs text-amber-600 mt-1">
              {fetchError}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function getStepIcon(stepType?: string): React.ElementType {
  switch (stepType) {
    case 'agent': return Bot
    case 'external': return Globe
    case 'manual': return User
    case 'foreach': return Repeat
    case 'join': return Merge
    case 'decision': return GitBranch
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
    default: return 'text-gray-500'
  }
}
