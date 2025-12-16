'use client'

import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  ChevronRight,
} from 'lucide-react'

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
}

interface TokenBrowserProps {
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

export function TokenBrowser({
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

  // Build token categories based on context
  const categories: TokenCategory[] = []

  // System tokens - always available
  categories.push({
    name: 'System',
    icon: Zap,
    color: 'text-yellow-500',
    tokens: [
      { path: 'workflowRunId', description: 'Current workflow run ID', example: '507f1f77bcf86cd799439011' },
      { path: 'stepId', description: 'Current step ID', example: 'step-1234567890' },
      { path: 'taskId', description: 'Current task ID', example: '507f1f77bcf86cd799439012' },
      { path: 'systemWebhookUrl', description: 'URL for external callbacks', example: 'https://api.example.com/callback' },
      { path: 'callbackSecret', description: 'Secret for callback authentication' },
    ],
  })

  // Loop variable if inside a loop
  if (loopVariable) {
    categories.push({
      name: 'Loop Item',
      icon: Repeat,
      color: 'text-green-500',
      tokens: [
        { path: loopVariable, description: `Current item in the loop`, example: '{ "id": 1, "name": "Item" }' },
        { path: `${loopVariable}.id`, description: 'Item ID (if object)' },
        { path: `${loopVariable}.name`, description: 'Item name (if object)' },
        { path: '_index', description: 'Current item index (0-based)', example: '0' },
        { path: '_total', description: 'Total items in loop', example: '100' },
      ],
    })
  }

  // Previous step outputs
  if (previousSteps.length > 0) {
    const prevStep = previousSteps[previousSteps.length - 1]
    const stepTokens: Token[] = []

    // Add tokens based on step type
    switch (prevStep.stepType) {
      case 'external':
        stepTokens.push(
          { path: 'input.output', description: 'Full response from external call' },
          { path: 'input.output.data', description: 'Response data field' },
          { path: 'input.output.status', description: 'Response status code' },
          { path: 'input.output.items', description: 'Items array (if returned)' },
          { path: 'input.output.results', description: 'Results array (if returned)' },
        )
        break
      case 'foreach':
        if (prevStep.itemVariable) {
          stepTokens.push(
            { path: prevStep.itemVariable, description: `Loop item variable` },
            { path: `${prevStep.itemVariable}.id`, description: 'Item ID' },
          )
        }
        break
      case 'join':
        stepTokens.push(
          { path: 'input.aggregatedResults', description: 'Array of all completed results' },
          { path: 'input.aggregatedResults[0]', description: 'First result' },
          { path: 'input.completedCount', description: 'Number of completed tasks' },
          { path: 'input.expectedCount', description: 'Total expected tasks' },
        )
        break
      case 'agent':
      case 'manual':
      default:
        stepTokens.push(
          { path: 'input.output', description: 'Task output/result' },
          { path: 'input.output.result', description: 'Result field' },
          { path: 'input.metadata', description: 'Task metadata' },
        )
    }

    categories.push({
      name: `Previous: ${prevStep.name}`,
      icon: getStepIcon(prevStep.stepType),
      color: getStepColor(prevStep.stepType),
      tokens: stepTokens,
    })

    // Add option to reference other steps
    if (previousSteps.length > 1) {
      const otherStepTokens: Token[] = previousSteps.slice(0, -1).map(step => ({
        path: `steps.${step.id}.output`,
        description: `Output from "${step.name}"`,
      }))

      categories.push({
        name: 'Other Steps',
        icon: Database,
        color: 'text-gray-500',
        tokens: otherStepTokens,
      })
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children || (
          variant === 'icon' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
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
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tokens..."
              className="h-8 border-0 p-0 focus-visible:ring-0"
            />
          </div>
        </div>

        <ScrollArea className="h-[300px]">
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
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-muted flex items-start gap-2 group"
                    >
                      <code className="text-xs font-mono bg-muted group-hover:bg-background px-1 py-0.5 rounded flex-shrink-0">
                        {wrapInBraces ? `{{${token.path}}}` : token.path}
                      </code>
                      <span className="text-xs text-muted-foreground truncate">
                        {token.description}
                      </span>
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
        </ScrollArea>

        <div className="border-t p-2 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            <strong>output</strong> = previous step result<br />
            <strong>input</strong> = data passed to current step<br />
            <strong>trigger</strong> = initial workflow payload
          </p>
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
