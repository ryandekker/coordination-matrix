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

export async function fetchKanbanData(groupId?: string, projectId?: string): Promise<KanbanData> {
  const params = new URLSearchParams()
  if (groupId) params.set('groupId', groupId)
  if (projectId) params.set('projectId', projectId)
  const url = `${API_BASE}/dashboard/kanban${params.toString() ? '?' + params.toString() : ''}`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('Failed to fetch kanban data')
  return response.json()
}
