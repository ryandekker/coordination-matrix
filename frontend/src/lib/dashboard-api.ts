import { authFetch } from './api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

export interface KanbanColumn {
  name: string
  tasks: KanbanTask[]
  count: number
}

export interface KanbanTask {
  _id: string
  title: string
  status: string
  urgency?: string
  tags?: string[]
  creatorType?: string
  createdAt: string
  updatedAt: string
  _resolved?: {
    assignee?: { _id: string; displayName: string; isAgent?: boolean; botColor?: string }
    createdBy?: { _id: string; displayName: string }
    workflow?: { name: string; color?: string }
    project?: { displayName: string; color?: string }
  }
  metadata?: Record<string, unknown>
  workflowStage?: string
}

export interface KanbanData {
  columns: Record<string, KanbanColumn>
  stats: {
    totalNeedingAttention: number
    questionsWaiting: number
    escalatedCount: number
  }
}

export interface DashboardFilters {
  groupId?: string
  projectId?: string
  workflowId?: string
  tags?: string[]
  assigneeId?: string
}

export async function fetchKanbanData(
  groupId?: string,
  projectId?: string,
  filters?: Omit<DashboardFilters, 'groupId' | 'projectId'>,
): Promise<KanbanData> {
  const params = new URLSearchParams()
  if (groupId) params.set('groupId', groupId)
  if (projectId) params.set('projectId', projectId)
  if (filters?.workflowId) params.set('workflowId', filters.workflowId)
  if (filters?.tags && filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (filters?.assigneeId) params.set('assigneeId', filters.assigneeId)
  const url = `${API_BASE}/dashboard/kanban${params.toString() ? '?' + params.toString() : ''}`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch kanban data')
  return response.json()
}
