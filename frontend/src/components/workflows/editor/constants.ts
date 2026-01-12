import {
  Bot,
  User,
  Globe,
  GitBranch,
  Repeat,
  Merge,
  Workflow as WorkflowIcon,
  FileSearch,
} from 'lucide-react'
import type { StepTypeInfo, WorkflowStepType } from './types'

export const STEP_TYPES: StepTypeInfo[] = [
  { type: 'agent', label: 'Agent', description: 'AI agent task', icon: Bot, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  { type: 'external', label: 'External Call', description: 'HTTP call (async or fire-and-forget)', icon: Globe, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  { type: 'manual', label: 'Manual', description: 'Human task', icon: User, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
  { type: 'decision', label: 'Decision', description: 'Route by condition', icon: GitBranch, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  { type: 'foreach', label: 'ForEach', description: 'Loop over items', icon: Repeat, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  { type: 'join', label: 'Join', description: 'Aggregate results', icon: Merge, color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
  { type: 'flow', label: 'Flow', description: 'Nested workflow', icon: WorkflowIcon, color: 'text-pink-500', bgColor: 'bg-pink-500/10' },
  { type: 'findDocument', label: 'Find Document', description: 'Search documents', icon: FileSearch, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
]

export function getStepTypeInfo(stepType?: WorkflowStepType): StepTypeInfo {
  return STEP_TYPES.find(st => st.type === (stepType || 'task')) || STEP_TYPES[0]
}
