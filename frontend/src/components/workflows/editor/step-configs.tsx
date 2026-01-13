'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Bot,
  User,
  Globe,
  GitBranch,
  Repeat,
  Merge,
  Workflow as WorkflowIcon,
  Sparkles,
  Info,
  Link2,
  Plus,
  Trash2,
  ArrowRight,
  ArrowDown,
  AlertCircle,
  Database,
  Zap,
} from 'lucide-react'
import { TokenBrowser } from '../token-browser'
import { PromptSelector } from './prompt-selector'
import type { WorkflowStep, LoopScope, WorkflowStepType } from './types'
import type { Workflow as ApiWorkflow } from '@/lib/api'

interface StepConfigProps {
  step: WorkflowStep
  index: number
  steps: WorkflowStep[]
  updateStep: (index: number, updates: Partial<WorkflowStep>) => void
  users: Array<{ _id: string; displayName: string }>
  workflowId?: string
  isInLoop: boolean
  loopScope?: LoopScope
  availableWorkflows?: ApiWorkflow[]
  loadingWorkflows?: boolean
  setSteps?: (steps: WorkflowStep[]) => void
}

// Agent step configuration
export function AgentStepConfig({
  step,
  index,
  steps,
  updateStep,
  users,
  workflowId,
  isInLoop,
  loopScope,
}: StepConfigProps) {
  return (
    <div className="space-y-3">
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-blue-800 dark:text-blue-200">
            <p className="font-medium">AI Agent Task</p>
            <p className="text-xs mt-1">
              This step is handled by an AI agent. The agent already knows how to handle most tasks -
              additional instructions are optional and provide extra context.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          Default Assignee
          <span className="text-xs text-muted-foreground">(optional)</span>
        </label>
        <Select
          value={step.defaultAssigneeId || '_none'}
          onValueChange={(val) => updateStep(index, { defaultAssigneeId: val === '_none' ? undefined : val })}
        >
          <SelectTrigger className="w-full">
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
        <p className="text-xs text-muted-foreground">
          Tasks created from this step will be assigned to this user by default
        </p>
      </div>

      {/* Prompt Library Selector */}
      <PromptSelector
        selectedPromptIds={step.promptDocumentIds || []}
        onChange={(promptIds) => updateStep(index, { promptDocumentIds: promptIds.length > 0 ? promptIds : undefined })}
      />

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Additional Instructions
          <span className="text-xs text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          value={step.additionalInstructions || step.prompt || ''}
          onChange={(e) => updateStep(index, { additionalInstructions: e.target.value })}
          placeholder={`Add extra context for the agent if needed. Examples:

• "Focus on security vulnerabilities in this review"
• "Use the company style guide for formatting"
• "Include test coverage recommendations"

The agent will receive task context automatically.`}
          className="min-h-[100px] font-mono text-sm"
        />

        {/* Token Browser for instructions */}
        <div className="flex items-center gap-2 mt-2">
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={steps.slice(0, index).map(s => ({
              id: s.id,
              name: s.name,
              stepType: s.stepType,
              itemVariable: s.itemVariable,
            }))}
            currentStepIndex={index}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={(token) => {
              const current = step.additionalInstructions || ''
              updateStep(index, { additionalInstructions: current + token })
            }}
            variant="text"
          />
        </div>
      </div>
    </div>
  )
}

// External step configuration
export function ExternalStepConfig({
  step,
  index,
  steps,
  updateStep,
  workflowId,
  isInLoop,
  loopScope,
}: StepConfigProps) {
  const waitForCallback = step.externalConfig?.waitForCallback !== false

  return (
    <div className="space-y-3">
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
          onChange={(e) => updateStep(index, {
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

      {/* Callback URL info for async flows - only shown when waitForCallback is true */}
      {waitForCallback && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-blue-800 dark:text-blue-200">
              <p className="font-medium">Callback URL (for async responses)</p>
              <p className="text-xs mt-1 mb-2">
                If the external service needs to send results back asynchronously (e.g., ActivePieces),
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

      <div className="grid grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Method</label>
          <Select
            value={step.externalConfig?.method || 'POST'}
            onValueChange={(val) => updateStep(index, {
              externalConfig: { ...step.externalConfig, method: val as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' }
            })}
          >
            <SelectTrigger className="h-9">
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
          <label className="text-sm font-medium">Endpoint URL</label>
          <Input
            value={step.externalConfig?.endpoint || ''}
            onChange={(e) => updateStep(index, {
              externalConfig: { ...step.externalConfig, endpoint: e.target.value }
            })}
            placeholder="https://api.example.com/webhook"
            className="font-mono text-sm h-9"
          />
        </div>
      </div>

      {/* Headers - shown for both modes */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Headers (JSON)</label>
        <Textarea
          value={step.externalConfig?.headers ? JSON.stringify(step.externalConfig.headers, null, 2) : ''}
          onChange={(e) => {
            try {
              const headers = e.target.value ? JSON.parse(e.target.value) : {}
              updateStep(index, {
                externalConfig: { ...step.externalConfig, headers }
              })
            } catch {
              // Allow invalid JSON while typing
            }
          }}
          placeholder={`{
  "Content-Type": "application/json",
  "X-API-Key": "{{_apiKey}}"
}`}
          className="min-h-[80px] font-mono text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Payload Template (JSON)</label>
        <Textarea
          value={step.externalConfig?.payloadTemplate || ''}
          onChange={(e) => updateStep(index, {
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
          className="min-h-[100px] font-mono text-sm"
        />
        <div className="flex items-center gap-2 mt-1">
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={steps.slice(0, index).map(s => ({
              id: s.id,
              name: s.name,
              stepType: s.stepType,
              itemVariable: s.itemVariable,
            }))}
            currentStepIndex={index}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={(token) => {
              const current = step.externalConfig?.payloadTemplate || ''
              updateStep(index, {
                externalConfig: { ...step.externalConfig, payloadTemplate: current + token }
              })
            }}
            variant="text"
          />
          <span className="text-xs text-muted-foreground">
            Click to insert token at end of payload
          </span>
        </div>
      </div>

      {/* Success status codes - only shown when not waiting for callback */}
      {!waitForCallback && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Success Status Codes</label>
          <Input
            value={step.externalConfig?.successStatusCodes?.join(', ') || '200, 201'}
            onChange={(e) => {
              const codes = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
              updateStep(index, {
                externalConfig: { ...step.externalConfig, successStatusCodes: codes }
              })
            }}
            placeholder="200, 201"
            className="font-mono text-sm h-9"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list of HTTP status codes that indicate success
          </p>
        </div>
      )}
    </div>
  )
}

// Manual step configuration
export function ManualStepConfig({
  step,
  index,
  updateStep,
  users,
}: StepConfigProps) {
  return (
    <div className="space-y-3">
      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <User className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
          <div className="text-purple-800 dark:text-purple-200">
            <p className="font-medium">Human Task</p>
            <p className="text-xs mt-1">
              This step requires human review or action. The task will wait for a person to complete it.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          Default Assignee
          <span className="text-xs text-muted-foreground">(optional)</span>
        </label>
        <Select
          value={step.defaultAssigneeId || '_none'}
          onValueChange={(val) => updateStep(index, { defaultAssigneeId: val === '_none' ? undefined : val })}
        >
          <SelectTrigger className="w-full">
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
        <p className="text-xs text-muted-foreground">
          Tasks created from this step will be assigned to this user by default
        </p>
      </div>
    </div>
  )
}

// ForEach step configuration
export function ForEachStepConfig({
  step,
  index,
  steps,
  updateStep,
  workflowId,
  setSteps,
}: StepConfigProps) {
  const nextStep = steps[index + 1]
  const hasNoBodyStep = nextStep?.stepType === 'join'

  return (
    <>
      <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <Repeat className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          <div className="text-green-800 dark:text-green-200">
            <p className="font-medium">Loop Configuration</p>
            <p className="text-xs mt-1">
              Iterates over a collection and creates a task for each item.
              <strong> You need a step AFTER this</strong> that processes each item.
            </p>
          </div>
        </div>
      </div>

      {/* Warning if no step between ForEach and Join */}
      {hasNoBodyStep && setSteps && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-red-800 dark:text-red-200">
              <p className="font-medium">Missing Loop Body Step!</p>
              <p className="text-xs mt-1">
                You need a step between ForEach and Join that processes each item.
                Add an Agent or Manual step after this ForEach to handle each {step.itemVariable || 'item'}.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs border-red-300 text-red-700 hover:bg-red-100"
                onClick={() => {
                  const newStep: WorkflowStep = {
                    id: `step-${Date.now()}`,
                    name: `Process ${step.itemVariable || 'Item'}`,
                    stepType: 'agent',
                    additionalInstructions: `Process the {{${step.itemVariable || 'item'}}} provided in the input.`,
                  }
                  const newSteps = [...steps]
                  newSteps.splice(index + 1, 0, newStep)
                  setSteps(newSteps)
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Processing Step
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-1">
            Items Path
            <span className="text-xs text-muted-foreground">(JSONPath)</span>
          </label>
          <div className="flex gap-1">
            <Input
              value={step.itemsPath || ''}
              onChange={(e) => updateStep(index, { itemsPath: e.target.value })}
              placeholder="e.g., output.emails"
              className="font-mono text-sm"
            />
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={steps.slice(0, index).map(s => ({
                id: s.id,
                name: s.name,
                stepType: s.stepType,
                itemVariable: s.itemVariable,
              }))}
              currentStepIndex={index}
              onSelectToken={(token) => updateStep(index, { itemsPath: token })}
              wrapInBraces={false}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Path to array in previous step&apos;s output
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-1">
            Item Variable Name
          </label>
          <Input
            value={step.itemVariable || ''}
            onChange={(e) => updateStep(index, { itemVariable: e.target.value })}
            placeholder="e.g., email, item, record"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{`{{${step.itemVariable || 'item'}}}`}</code> in next steps
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Max Items</label>
          <Input
            type="number"
            value={step.maxItems || ''}
            onChange={(e) => updateStep(index, { maxItems: parseInt(e.target.value) || undefined })}
            placeholder="100 (default)"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Safety limit to prevent runaway loops
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-1">
            Expected Count Path
            <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <div className="flex gap-1">
            <Input
              value={step.expectedCountPath || ''}
              onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
              placeholder="e.g., response.totalItems"
              className="font-mono text-sm"
            />
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={steps.slice(0, index).map(s => ({
                id: s.id,
                name: s.name,
                stepType: s.stepType,
                itemVariable: s.itemVariable,
              }))}
              currentStepIndex={index}
              onSelectToken={(token) => updateStep(index, { expectedCountPath: token })}
              wrapInBraces={false}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            JSONPath to expected count from input payload (overrides items.length)
          </p>
        </div>
      </div>
    </>
  )
}

// Join step configuration
export function JoinStepConfig({
  step,
  index,
  steps,
  updateStep,
  workflowId,
  isInLoop,
  loopScope,
}: StepConfigProps) {
  return (
    <>
      <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <Merge className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
          <div className="text-indigo-800 dark:text-indigo-200">
            <p className="font-medium">Join / Aggregation Point</p>
            <p className="text-xs mt-1">
              Waits for parallel tasks from a ForEach loop and aggregates results.
              Works with routers inside loops - collects from <strong>all branches</strong>, not just one path.
            </p>
          </div>
        </div>
      </div>

      {/* How completion tracking works */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-sm">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-blue-800 dark:text-blue-200 text-xs">
            <p className="font-medium">How Join Knows Tasks Are Complete</p>
            <p className="mt-0.5">
              The ForEach step sets <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">expectedCount</code> when spawning tasks.
              Each task completion increments <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">completedCount</code>.
              Join fires when <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">completedCount/expectedCount &gt;= minSuccess%</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Multi-branch collection info */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2 text-sm">
        <div className="flex items-start gap-2">
          <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-amber-800 dark:text-amber-200 text-xs">
            <p className="font-medium">Works with Routers</p>
            <p className="mt-0.5">
              If there&apos;s a Decision/Router inside the loop, results from ALL branches
              are collected. Tasks are matched by the ForEach tag, regardless of which branch processed them.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-1">
            Min Success %
            <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <Input
            type="number"
            min="0"
            max="100"
            value={step.minSuccessPercent ?? ''}
            onChange={(e) => updateStep(index, {
              minSuccessPercent: e.target.value ? parseInt(e.target.value) : undefined
            })}
            placeholder="100"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Proceed when this % of tasks complete (default: 100%)
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-1">
            Expected Count Path
            <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <div className="flex gap-1">
            <Input
              value={step.expectedCountPath || ''}
              onChange={(e) => updateStep(index, { expectedCountPath: e.target.value })}
              placeholder="e.g., response.totalItems"
              className="font-mono text-sm"
            />
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={steps.slice(0, index).map(s => ({
                id: s.id,
                name: s.name,
                stepType: s.stepType,
                itemVariable: s.itemVariable,
              }))}
              currentStepIndex={index}
              onSelectToken={(token) => updateStep(index, { expectedCountPath: token })}
              wrapInBraces={false}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            JSONPath to expected count from external step response
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-1">
          Input Path
          <span className="text-xs text-muted-foreground">(optional)</span>
        </label>
        <div className="flex gap-1">
          <Input
            value={step.inputPath || ''}
            onChange={(e) => updateStep(index, { inputPath: e.target.value })}
            placeholder="e.g., output.analysis or result.data"
            className="font-mono text-sm"
          />
          <TokenBrowser
            workflowId={workflowId}
            previousSteps={steps.slice(0, index).map(s => ({
              id: s.id,
              name: s.name,
              stepType: s.stepType,
              itemVariable: s.itemVariable,
            }))}
            currentStepIndex={index}
            loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
            onSelectToken={(token) => updateStep(index, { inputPath: token })}
            wrapInBraces={false}
            forJoinInputPath={true}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          JSONPath to extract from each completed task. Results are aggregated into an array.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-1">
          Await Tag Pattern
          <span className="text-xs text-muted-foreground">(usually auto-detected)</span>
        </label>
        <Input
          value={step.awaitTag || ''}
          onChange={(e) => updateStep(index, { awaitTag: e.target.value })}
          placeholder="Auto-detects from ForEach step"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to auto-detect tasks from the preceding ForEach step.
        </p>
      </div>
    </>
  )
}

// Decision step configuration
export function DecisionStepConfig({
  step,
  index,
  steps,
  updateStep,
  isInLoop,
}: StepConfigProps) {
  return (
    <>
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-amber-800 dark:text-amber-200">
            <p className="font-medium">Decision / Router</p>
            <p className="text-xs mt-1">
              Routes to different branches based on conditions. All branches can converge
              back to the same Join step for aggregation.
            </p>
          </div>
        </div>
      </div>

      {/* Connections Editor */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          Branch Routes
        </label>

        {(step.connections || []).map((conn, connIdx) => (
          <div key={connIdx} className="flex items-center gap-2 pl-4 border-l-2 border-amber-300">
            <Input
              value={conn.condition || conn.label || ''}
              onChange={(e) => {
                const newConns = [...(step.connections || [])]
                newConns[connIdx] = { ...newConns[connIdx], condition: e.target.value, label: e.target.value }
                updateStep(index, { connections: newConns })
              }}
              placeholder="e.g., output.category === 'urgent'"
              className="font-mono text-sm flex-1"
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Select
              value={conn.targetStepId}
              onValueChange={(val) => {
                const newConns = [...(step.connections || [])]
                newConns[connIdx] = { ...newConns[connIdx], targetStepId: val }
                updateStep(index, { connections: newConns })
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select target" />
              </SelectTrigger>
              <SelectContent>
                {steps.filter((_, i) => i > index).map(s => (
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
              className="h-9 w-9 p-0 text-destructive"
              onClick={() => {
                const newConns = (step.connections || []).filter((_, i) => i !== connIdx)
                updateStep(index, { connections: newConns })
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
            updateStep(index, { connections: newConns })
          }}
          className="ml-4"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Branch
        </Button>
      </div>

      {/* Info about loops */}
      {isInLoop && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="text-green-800 dark:text-green-200">
              <p className="font-medium">Router Inside Loop</p>
              <p className="text-xs mt-1">
                All branches will be executed for each loop item. Results from all branches
                are collected by the Join step - they don&apos;t need to converge to a single path.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Tip: You can also define branches in the Mermaid diagram tab:
        </p>
        <div className="bg-muted/50 rounded p-2 font-mono text-xs space-y-1">
          <p>Router --&gt;|&quot;output.category === &apos;urgent&apos;&quot;| UrgentHandler</p>
          <p>Router --&gt;|&quot;default&quot;| NormalHandler</p>
        </div>
      </div>
    </>
  )
}

// Input Source configuration (shared across step types)
export function InputSourceConfig({
  step,
  index,
  steps,
  updateStep,
  workflowId,
  isInLoop,
  loopScope,
  getStepTypeInfo,
  parseInputPath,
  buildInputPath,
}: StepConfigProps & {
  getStepTypeInfo: (stepType?: WorkflowStepType) => { icon: any; color: string }
  parseInputPath: (inputPath: string | undefined) => { source: string; path: string }
  buildInputPath: (sourceStepId: string | undefined, path: string) => string
}) {
  return (
    <div className="space-y-2 border-t pt-3 mt-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <label className="text-sm font-medium">Input Data Source</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From Step</label>
          <Select
            value={step.inputSource || 'previous'}
            onValueChange={(val) => updateStep(index, { inputSource: val })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="previous">
                <span className="flex items-center gap-2">
                  <ArrowDown className="h-3 w-3" />
                  Previous Step ({steps[index - 1]?.name || 'N/A'})
                </span>
              </SelectItem>
              <SelectItem value="trigger">
                <span className="flex items-center gap-2">
                  <Zap className="h-3 w-3" />
                  Workflow Trigger (initial payload)
                </span>
              </SelectItem>
              {steps.slice(0, index).map((s, i) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2 text-xs">
                    {(() => {
                      const ti = getStepTypeInfo(s.stepType)
                      const Icon = ti.icon
                      return <Icon className={cn('h-3 w-3', ti.color)} />
                    })()}
                    Step {i + 1}: {s.name}
                  </span>
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
                updateStep(index, { inputPath: newPath })
              }}
              placeholder="e.g., output.data"
              className="h-9 text-sm font-mono"
            />
            <TokenBrowser
              workflowId={workflowId}
              previousSteps={steps.slice(0, index).map(s => ({
                id: s.id,
                name: s.name,
                stepType: s.stepType,
                itemVariable: s.itemVariable,
              }))}
              currentStepIndex={index}
              loopVariable={isInLoop && loopScope ? loopScope.foreachStep.itemVariable : undefined}
              onSelectToken={(token) => {
                const newPath = buildInputPath(step.inputSource, token)
                updateStep(index, { inputPath: newPath })
              }}
              wrapInBraces={false}
            />
          </div>
        </div>
      </div>
      {step.inputPath && (
        <div className="text-xs font-mono bg-muted/50 px-2 py-1 rounded text-muted-foreground">
          Full path: {step.inputPath}
        </div>
      )}
    </div>
  )
}

// Flow step configuration (nested workflow)
export function FlowStepConfig({
  step,
  index,
  updateStep,
  availableWorkflows,
  loadingWorkflows,
}: StepConfigProps) {
  return (
    <>
      <div className="bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 rounded-lg p-3 text-sm">
        <div className="flex items-start gap-2">
          <WorkflowIcon className="h-4 w-4 text-pink-600 dark:text-pink-400 mt-0.5 flex-shrink-0" />
          <div className="text-pink-800 dark:text-pink-200">
            <p className="font-medium">Nested Workflow</p>
            <p className="text-xs mt-1">
              Delegates execution to another workflow. Input is passed programmatically
              and results are returned when the flow completes.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Target Workflow</label>
        <Select
          value={step.flowId || ''}
          onValueChange={(value) => updateStep(index, { flowId: value })}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={loadingWorkflows ? 'Loading...' : 'Select a workflow'} />
          </SelectTrigger>
          <SelectContent>
            {availableWorkflows?.length === 0 && !loadingWorkflows && (
              <SelectItem value="_none" disabled>No workflows available</SelectItem>
            )}
            {availableWorkflows?.map((wf) => (
              <SelectItem key={wf._id} value={wf._id}>
                {wf.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The workflow to delegate execution to.
        </p>
      </div>
    </>
  )
}
