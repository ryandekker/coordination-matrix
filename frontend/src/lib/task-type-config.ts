import {
  FileText,
  Globe,
  Webhook,
  GitBranch,
  Repeat,
  Merge,
  Workflow,
  Zap,
  Bot,
  User,
  Network,
  type LucideIcon,
} from 'lucide-react'

/**
 * Task Type Configuration
 *
 * Colors are designed to match workflow step types since they map 1:1:
 * - flow: Slate (workflow parent tasks)
 * - agent: Blue (AI/automated tasks - default)
 * - external: Orange (API/webhook calls)
 * - webhook: Purple (legacy webhook type)
 * - trigger: Yellow (entry points)
 * - decision: Amber (conditional branching)
 * - foreach: Green (iteration/fan-out)
 * - join: Indigo (aggregation/fan-in)
 * - flow: Pink (nested workflows)
 * - manual: Purple (human tasks)
 */

export interface TaskTypeConfig {
  icon: LucideIcon
  label: string
  color: string           // Tailwind text color class
  bgColor: string         // Tailwind background color class
  hexColor: string        // Hex color for inline styles
  description?: string
}

// Mapping from task types to workflow step types
// This ensures consistent colors between tasks and workflow stages
export const TASK_TYPE_TO_STEP_TYPE: Record<string, string> = {
  flow: 'flow',
  agent: 'agent',
  external: 'external',
  webhook: 'external',  // Legacy - maps to external
  trigger: 'trigger',
  decision: 'decision',
  foreach: 'foreach',
  join: 'join',
  manual: 'manual',
}

// Central configuration for all task types
// Colors are aligned with workflow step types for consistency
export const TASK_TYPE_CONFIG: Record<string, TaskTypeConfig> = {
  flow: {
    icon: Network,
    label: 'Flow',
    color: 'text-pink-500',
    bgColor: 'bg-pink-50 dark:bg-pink-950/30',
    hexColor: '#EC4899',
    description: 'Nested workflow/flow task',
  },
  agent: {
    icon: Bot,
    label: 'Agent',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    hexColor: '#3B82F6',
    description: 'AI agent task',
  },
  external: {
    icon: Globe,
    label: 'External',
    color: 'text-orange-500',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    hexColor: '#F97316',
    description: 'External API/webhook call',
  },
  webhook: {
    icon: Webhook,
    label: 'Webhook',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    hexColor: '#A855F7',
    description: 'Webhook endpoint',
  },
  trigger: {
    icon: Zap,
    label: 'Trigger',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
    hexColor: '#EAB308',
    description: 'Workflow entry point',
  },
  decision: {
    icon: GitBranch,
    label: 'Decision',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    hexColor: '#F59E0B',
    description: 'Conditional branching',
  },
  foreach: {
    icon: Repeat,
    label: 'ForEach',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
    hexColor: '#22C55E',
    description: 'Loop over items',
  },
  join: {
    icon: Merge,
    label: 'Join',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
    hexColor: '#6366F1',
    description: 'Aggregate results',
  },
  manual: {
    icon: User,
    label: 'Manual',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    hexColor: '#A855F7',
    description: 'Human task',
  },
}

// Workflow step type configuration (for workflow editor)
// Separate from task types to allow customization but sharing core colors
export const WORKFLOW_STEP_TYPE_CONFIG: Record<string, TaskTypeConfig> = {
  agent: {
    icon: Bot,
    label: 'Agent',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    hexColor: '#3B82F6',
    description: 'AI agent task',
  },
  external: {
    icon: Globe,
    label: 'External',
    color: 'text-orange-500',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    hexColor: '#F97316',
    description: 'API/webhook call',
  },
  manual: {
    icon: User,
    label: 'Manual',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    hexColor: '#A855F7',
    description: 'Human task',
  },
  decision: {
    icon: GitBranch,
    label: 'Decision',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    hexColor: '#F59E0B',
    description: 'Route by condition',
  },
  foreach: {
    icon: Repeat,
    label: 'ForEach',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
    hexColor: '#22C55E',
    description: 'Loop over items',
  },
  join: {
    icon: Merge,
    label: 'Join',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
    hexColor: '#6366F1',
    description: 'Aggregate results',
  },
  flow: {
    icon: Workflow,
    label: 'Flow',
    color: 'text-pink-500',
    bgColor: 'bg-pink-50 dark:bg-pink-950/30',
    hexColor: '#EC4899',
    description: 'Nested workflow',
  },
}

// Helper function to get config for a task type with fallback
export function getTaskTypeConfig(taskType?: string): TaskTypeConfig {
  return TASK_TYPE_CONFIG[taskType || 'agent'] || TASK_TYPE_CONFIG.agent
}

// Helper function to get config for a workflow step type with fallback
export function getStepTypeConfig(stepType?: string): TaskTypeConfig {
  return WORKFLOW_STEP_TYPE_CONFIG[stepType || 'agent'] || WORKFLOW_STEP_TYPE_CONFIG.agent
}

// LocalStorage key for persisting the last opened tab
export const TASK_MODAL_TAB_KEY = 'task-modal-last-tab'

// Available tabs in the task modal (new single-column layout)
export const TASK_MODAL_TABS = {
  OUTPUT: 'output',
  SUBTASKS: 'subtasks',
  DOCUMENTS: 'documents',
  ACTIVITY: 'activity',
  METADATA: 'metadata',
  STEP_CONFIG: 'step-config',
  DETAILS: 'details',
} as const

export type TaskModalTab = typeof TASK_MODAL_TABS[keyof typeof TASK_MODAL_TABS]

// Default tab when no preference is stored
export const DEFAULT_TASK_MODAL_TAB: TaskModalTab = TASK_MODAL_TABS.ACTIVITY

// Helper to check if a task has output data
export function taskHasOutput(task: { metadata?: Record<string, unknown>; webhookConfig?: { attempts?: Array<{ responseBody?: unknown }> } }): boolean {
  const metadata = task.metadata
  const attempts = task.webhookConfig?.attempts || []
  const lastAttempt = attempts[attempts.length - 1]

  // Check for daemon-style output
  if (metadata?.output !== undefined) return true
  // Check for webhook response
  if (lastAttempt?.responseBody !== undefined) return true
  // Check for result field
  if (metadata?.result !== undefined) return true

  return false
}

// Smart default tab based on task status and content
export function getSmartDefaultTab(task: { status: string; metadata?: Record<string, unknown>; webhookConfig?: { attempts?: Array<{ responseBody?: unknown }> } }): TaskModalTab {
  // For completed/failed tasks with output, show output first
  if (['completed', 'failed'].includes(task.status) && taskHasOutput(task)) {
    return TASK_MODAL_TABS.OUTPUT
  }
  // For other statuses, check localStorage or use activity
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(TASK_MODAL_TAB_KEY)
    if (stored && Object.values(TASK_MODAL_TABS).includes(stored as TaskModalTab)) {
      return stored as TaskModalTab
    }
  }
  return DEFAULT_TASK_MODAL_TAB
}
