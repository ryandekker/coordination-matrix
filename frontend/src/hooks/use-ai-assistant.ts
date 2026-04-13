'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tasksApi, workflowsApi, Task, Workflow } from '@/lib/api'
import { useGroupContext } from '@/lib/group-context'
import { useEventStream } from './use-event-stream'

export type AiIntentMode = 'question' | 'edit'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  taskId?: string
  editSummary?: string
  /** The original instruction text, stored on assistant messages so retry can re-use it */
  originalInstruction?: string
}

interface AiAssistantState {
  messages: AiMessage[]
  isProcessing: boolean
  error: string | null
  activeTaskId: string | null
}

const WORKFLOW_NAMES = {
  document: 'AI Document Assistant',
  workflow: 'AI Workflow Assistant',
} as const

// Helper to safely access nested metadata properties
function getOutput(t: Task): Record<string, unknown> | null {
  const output = t.metadata?.output as Record<string, unknown> | undefined
  return output || null
}
function getResult(t: Task): Record<string, unknown> | null {
  const output = getOutput(t)
  return (output?.result as Record<string, unknown>) || null
}

export function useAiAssistant(contextType: 'document' | 'workflow', contextId: string) {
  const queryClient = useQueryClient()
  const { currentGroupId } = useGroupContext()

  const [state, setState] = useState<AiAssistantState>({
    messages: [],
    isProcessing: false,
    error: null,
    activeTaskId: null,
  })

  // Cache the workflow ID after first lookup
  const workflowIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Use ref to avoid stale closures in the polling callback
  const contextTypeRef = useRef(contextType)
  const contextIdRef = useRef(contextId)
  contextTypeRef.current = contextType
  contextIdRef.current = contextId

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  // Unified completion check + result extraction — uses refs to avoid stale closures
  const checkAndHandleCompletion = useCallback(async (flowTaskId: string) => {
    try {
      // Check flow status directly — this is the most reliable method
      const flowStatus = await tasksApi.getFlowStatus(flowTaskId)
      const status = flowStatus?.data

      if (!status) return
      if (status.spawnedWorkflowStatus !== 'completed' && status.spawnedWorkflowStatus !== 'failed') {
        return // Still running
      }

      // Workflow is done — stop polling first
      stopPolling()

      const workflowStatus = status.spawnedWorkflowStatus
      const spawnedRunId = status.spawnedWorkflowRunId

      let content = ''
      let editSummary = ''

      if (workflowStatus === 'failed') {
        content = 'The AI assistant encountered an error processing your request. Please try again.'
      } else if (spawnedRunId) {
        // Fetch tasks from the workflow run to find the agent result
        const tasksResult = await tasksApi.list({
          workflowRunId: spawnedRunId,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          limit: 20,
        })
        const workflowTasks = tasksResult?.data || []

        // Find the agent task that has a structured result (skip the flow task itself)
        const agentTask = workflowTasks.find((t: Task) =>
          t.status === 'completed' &&
          t.workflowStage && // Must be a workflow step (not the flow trigger)
          getResult(t) !== null
        )

        if (agentTask) {
          const result = getResult(agentTask)!
          const output = getOutput(agentTask)!
          if (result.answer) {
            content = String(result.answer)
          } else if (result.editSummary) {
            editSummary = String(result.editSummary)
            content = contextTypeRef.current === 'workflow'
              ? `Workflow updated: ${editSummary}`
              : `Document updated: ${editSummary}`
          } else {
            content = output.summary
              ? String(output.summary)
              : 'Task completed successfully.'
          }
        } else {
          // Fallback: check for code step with success result (e.g., save-workflow)
          const codeTask = workflowTasks.find((t: Task) => {
            const out = getOutput(t)
            return t.status === 'completed' && t.workflowStage && out?.success
          })
          if (codeTask) {
            const output = getOutput(codeTask)!
            editSummary = String(output.editSummary || 'Changes applied')
            content = contextTypeRef.current === 'workflow'
              ? `Workflow updated: ${editSummary}`
              : `Updated: ${editSummary}`
          } else {
            content = 'Task completed.'
          }
        }
      } else {
        content = 'Task completed.'
      }

      const assistantMessage: AiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        taskId: flowTaskId,
        editSummary,
      }

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
        isProcessing: false,
        activeTaskId: null,
        error: null,
      }))

      // Invalidate caches so the document/workflow refreshes
      const ct = contextTypeRef.current
      const ci = contextIdRef.current
      if (ct === 'document') {
        queryClient.invalidateQueries({ queryKey: ['document', ci] })
        queryClient.invalidateQueries({ queryKey: ['documents'] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['workflows'] })
        queryClient.invalidateQueries({ queryKey: ['workflow', ci] })
      }
    } catch (error) {
      // Log but don't crash — polling will retry
      console.error('[AI Assistant] Error checking completion:', error)
    }
  }, [queryClient, stopPolling])

  // Use a ref so the polling interval always calls the latest version
  const checkCompletionRef = useRef(checkAndHandleCompletion)
  checkCompletionRef.current = checkAndHandleCompletion

  // Listen for task completion events via SSE
  useEventStream({
    enabled: !!state.activeTaskId,
    onEvent: (event) => {
      if (!state.activeTaskId) return
      if (event.type === 'task.status.changed' && 'task' in event) {
        const task = event.task as Task | undefined
        if (!task) return
        // When any task in a workflow run completes, check if our workflow is done
        if (task.status === 'completed' && task.workflowRunId) {
          checkCompletionRef.current(state.activeTaskId)
        }
      }
    },
  })

  // Look up the stock workflow ID by name
  const resolveWorkflowId = useCallback(async (): Promise<string | null> => {
    if (workflowIdRef.current) return workflowIdRef.current

    const workflowName = WORKFLOW_NAMES[contextType]
    const result = await workflowsApi.list()
    const workflows = result?.data || []
    const match = workflows.find((w: Workflow) => w.name === workflowName && w.isActive)

    if (match) {
      workflowIdRef.current = match._id
      return match._id
    }

    return null
  }, [contextType])

  // Core send logic — creates a flow task that triggers the stock workflow
  const dispatchToWorkflow = useCallback(async (
    instruction: string,
    mode?: AiIntentMode,
  ) => {
    // Resolve the stock workflow ID
    const workflowId = await resolveWorkflowId()
    if (!workflowId) {
      throw new Error(
        `Stock workflow "${WORKFLOW_NAMES[contextType]}" not found. ` +
        'Please deploy the AI assistant workflows first.'
      )
    }

    // Build the input payload for the workflow
    const inputPayload: Record<string, string> = { instruction }
    if (contextType === 'document') {
      inputPayload.documentId = contextId
    } else {
      inputPayload.workflowId = contextId
    }
    if (mode) {
      inputPayload.mode = mode
    }

    // Create a flow task that auto-triggers the workflow
    const modeLabel = mode ? ` [${mode}]` : ''
    const result = await tasksApi.create({
      title: `AI${modeLabel}: ${instruction.slice(0, 80)}${instruction.length > 80 ? '...' : ''}`,
      summary: instruction,
      humanInstruction: instruction,
      triggerWorkflowId: workflowId,
      groupId: currentGroupId || undefined,
      metadata: {
        flowInputPayloadTemplate: JSON.stringify(inputPayload),
        aiAssistant: true,
        contextType,
        contextId,
        ...(mode && { modeOverride: mode }),
      },
    } as Partial<Task>)

    const flowTaskId = result?.data?._id
    if (!flowTaskId) {
      throw new Error('Failed to create AI task')
    }

    setState(prev => ({ ...prev, activeTaskId: flowTaskId }))

    // Start polling as a fallback (SSE might miss events)
    pollingRef.current = setInterval(() => {
      checkCompletionRef.current(flowTaskId)
    }, 5000)
  }, [contextType, contextId, currentGroupId, resolveWorkflowId])

  // Send a new message
  const sendMessage = useCallback(async (instruction: string) => {
    if (!instruction.trim() || state.isProcessing) return

    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: instruction,
      timestamp: new Date(),
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isProcessing: true,
      error: null,
    }))

    try {
      await dispatchToWorkflow(instruction)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message'
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: errorMessage,
      }))
    }
  }, [state.isProcessing, dispatchToWorkflow])

  // Retry the last instruction with an explicit mode override
  const retryWithMode = useCallback(async (mode: AiIntentMode) => {
    if (state.isProcessing) return

    // Find the last user message to get the original instruction
    const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) return

    const instruction = lastUserMsg.content

    // Add a system-style message explaining the retry
    const retryMessage: AiMessage = {
      id: `retry-${Date.now()}`,
      role: 'assistant',
      content: `Retrying as **${mode}**...`,
      timestamp: new Date(),
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, retryMessage],
      isProcessing: true,
      error: null,
    }))

    try {
      await dispatchToWorkflow(instruction, mode)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retry'
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: errorMessage,
      }))
    }
  }, [state.isProcessing, state.messages, dispatchToWorkflow])

  // Clear conversation
  const clearMessages = useCallback(() => {
    setState({
      messages: [],
      isProcessing: false,
      error: null,
      activeTaskId: null,
    })
    stopPolling()
  }, [stopPolling])

  return {
    messages: state.messages,
    isProcessing: state.isProcessing,
    error: state.error,
    activeTaskId: state.activeTaskId,
    sendMessage,
    retryWithMode,
    clearMessages,
  }
}
