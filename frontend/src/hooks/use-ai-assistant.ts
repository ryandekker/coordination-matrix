'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tasksApi, workflowsApi, Task, Workflow } from '@/lib/api'
import { useGroupContext } from '@/lib/group-context'
import { useEventStream } from './use-event-stream'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  taskId?: string
  editSummary?: string
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

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  // Listen for task completion events via SSE
  useEventStream({
    enabled: !!state.activeTaskId,
    onEvent: (event) => {
      if (!state.activeTaskId) return
      // We need to watch for task.status.changed events on workflow child tasks
      // The flow task itself won't complete until the workflow finishes
      if (event.type === 'task.status.changed' && 'task' in event) {
        const task = event.task as Task | undefined
        if (!task) return

        // Check if this is a completed agent task from our workflow run
        const flowTaskId = state.activeTaskId
        if (task.status === 'completed' && task.workflowRunId) {
          // Check if this task belongs to our flow task's spawned workflow
          checkFlowTaskCompletion(flowTaskId)
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

  // Check if the flow task's workflow has completed
  const checkFlowTaskCompletion = useCallback(async (flowTaskId: string) => {
    try {
      const result = await tasksApi.get(flowTaskId, { resolveReferences: 'true' })
      const flowTask = result?.data
      if (!flowTask?.spawnedWorkflowRunId) return

      // Check the workflow run status
      const flowStatus = await tasksApi.getFlowStatus(flowTaskId)
      const status = flowStatus?.data

      if (status?.spawnedWorkflowStatus === 'completed' || status?.spawnedWorkflowStatus === 'failed') {
        // Workflow is done — find the result
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        await handleWorkflowComplete(flowTaskId, status.spawnedWorkflowStatus)
      }
    } catch {
      // Silently ignore — we'll catch it on next poll
    }
  }, [])

  // Handle workflow completion — extract result and display
  const handleWorkflowComplete = useCallback(async (flowTaskId: string, workflowStatus: string) => {
    try {
      // Get the flow task to find the workflow run
      const flowResult = await tasksApi.get(flowTaskId, { resolveReferences: 'true' })
      const flowTask = flowResult?.data
      if (!flowTask?.spawnedWorkflowRunId) return

      // Find the last completed agent task in this workflow run
      const tasksResult = await tasksApi.list({
        workflowRunId: flowTask.spawnedWorkflowRunId,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: 20,
      })
      const workflowTasks = tasksResult?.data || []

      // Helper to safely access nested metadata properties
      const getOutput = (t: Task): Record<string, unknown> | null => {
        const output = t.metadata?.output as Record<string, unknown> | undefined
        return output || null
      }
      const getResult = (t: Task): Record<string, unknown> | null => {
        const output = getOutput(t)
        return (output?.result as Record<string, unknown>) || null
      }

      // Find the agent task that has output
      const agentTask = workflowTasks.find((t: Task) =>
        t.status === 'completed' && getResult(t) !== null
      )

      let content = ''
      let editSummary = ''

      if (workflowStatus === 'failed') {
        content = 'The AI assistant encountered an error processing your request. Please try again.'
      } else if (agentTask) {
        const result = getResult(agentTask)!
        const output = getOutput(agentTask)!
        if (result.answer) {
          // Q&A response
          content = String(result.answer)
        } else if (result.editSummary) {
          // Edit response
          editSummary = String(result.editSummary)
          content = `Document updated: ${editSummary}`
        } else {
          content = output.summary
            ? String(output.summary)
            : 'Task completed successfully.'
        }
      } else {
        // Fallback: check for code step result (workflow editing saves via code step)
        const codeTask = workflowTasks.find((t: Task) => {
          const out = getOutput(t)
          return t.status === 'completed' && out?.success
        })
        if (codeTask) {
          const output = getOutput(codeTask)!
          editSummary = String(output.editSummary || 'Changes applied')
          content = contextType === 'workflow'
            ? `Workflow updated: ${editSummary}`
            : `Updated: ${editSummary}`
        } else {
          content = 'Task completed.'
        }
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
      if (contextType === 'document') {
        queryClient.invalidateQueries({ queryKey: ['document', contextId] })
        queryClient.invalidateQueries({ queryKey: ['documents'] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['workflows'] })
        queryClient.invalidateQueries({ queryKey: ['workflow', contextId] })
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isProcessing: false,
        activeTaskId: null,
        error: error instanceof Error ? error.message : 'Failed to retrieve result',
      }))
    }
  }, [contextType, contextId, queryClient])

  // Send a message — creates a flow task that triggers the stock workflow
  const sendMessage = useCallback(async (instruction: string) => {
    if (!instruction.trim() || state.isProcessing) return

    // Add user message
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

      // Create a flow task that auto-triggers the workflow
      const result = await tasksApi.create({
        title: `AI: ${instruction.slice(0, 80)}${instruction.length > 80 ? '...' : ''}`,
        summary: instruction,
        humanInstruction: instruction,
        triggerWorkflowId: workflowId,
        groupId: currentGroupId || undefined,
        metadata: {
          flowInputPayloadTemplate: JSON.stringify(inputPayload),
          aiAssistant: true,
          contextType,
          contextId,
        },
      } as Partial<Task>)

      const flowTaskId = result?.data?._id
      if (!flowTaskId) {
        throw new Error('Failed to create AI task')
      }

      setState(prev => ({ ...prev, activeTaskId: flowTaskId }))

      // Start polling as a fallback in case SSE events are missed
      pollingRef.current = setInterval(() => {
        checkFlowTaskCompletion(flowTaskId)
      }, 5000)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message'
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: errorMessage,
      }))
    }
  }, [state.isProcessing, contextType, contextId, currentGroupId, resolveWorkflowId, checkFlowTaskCompletion])

  // Clear conversation
  const clearMessages = useCallback(() => {
    setState({
      messages: [],
      isProcessing: false,
      error: null,
      activeTaskId: null,
    })
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  return {
    messages: state.messages,
    isProcessing: state.isProcessing,
    error: state.error,
    activeTaskId: state.activeTaskId,
    sendMessage,
    clearMessages,
  }
}
