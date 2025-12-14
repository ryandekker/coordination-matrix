const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface ApiResponse<T> {
  data: T
  success?: boolean
  message?: string
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    // Token expired or invalid - redirect to login
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token')
      window.location.href = '/login'
    }
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'An error occurred' }))
    throw new Error(error.error?.message || error.message || 'Request failed')
  }
  return response.json()
}

// Helper to make authenticated requests
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...options.headers,
  }
  return fetch(url, { ...options, headers })
}

// Tasks API
export const tasksApi = {
  list: async (params?: Record<string, string | number | boolean | string[]>): Promise<PaginatedResponse<Task>> => {
    const searchParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          // Handle arrays - append each value separately
          if (Array.isArray(value)) {
            value.forEach((v) => searchParams.append(key, String(v)))
          } else {
            searchParams.append(key, String(value))
          }
        }
      })
    }
    const response = await authFetch(`${API_BASE}/tasks?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string, params?: Record<string, string>): Promise<ApiResponse<Task>> => {
    const searchParams = new URLSearchParams(params)
    const response = await authFetch(`${API_BASE}/tasks/${id}?${searchParams}`)
    return handleResponse(response)
  },

  getTree: async (params?: Record<string, string>): Promise<ApiResponse<Task[]>> => {
    const searchParams = new URLSearchParams(params)
    const response = await authFetch(`${API_BASE}/tasks/tree?${searchParams}`)
    return handleResponse(response)
  },

  getChildren: async (id: string): Promise<ApiResponse<Task[]>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/children`)
    return handleResponse(response)
  },

  getDescendants: async (id: string, maxDepth?: number): Promise<ApiResponse<Task[]>> => {
    const params = maxDepth ? `?maxDepth=${maxDepth}` : ''
    const response = await authFetch(`${API_BASE}/tasks/${id}/descendants${params}`)
    return handleResponse(response)
  },

  getAncestors: async (id: string): Promise<ApiResponse<Task[]>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/ancestors`)
    return handleResponse(response)
  },

  create: async (data: Partial<Task>): Promise<ApiResponse<Task>> => {
    const response = await authFetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<Task>): Promise<ApiResponse<Task>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string, deleteChildren = true): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}?deleteChildren=${deleteChildren}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  bulkUpdate: async (taskIds: string[], updates: Partial<Task>): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'update', taskIds, updates }),
    })
    return handleResponse(response)
  },

  bulkDelete: async (taskIds: string[]): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'delete', taskIds }),
    })
    return handleResponse(response)
  },
}

// Lookups API
export const lookupsApi = {
  getAll: async (): Promise<ApiResponse<Record<string, LookupValue[]>>> => {
    const response = await authFetch(`${API_BASE}/lookups`)
    return handleResponse(response)
  },

  getByType: async (type: string, includeInactive = false): Promise<ApiResponse<LookupValue[]>> => {
    const params = includeInactive ? '?includeInactive=true' : ''
    const response = await authFetch(`${API_BASE}/lookups/${type}${params}`)
    return handleResponse(response)
  },

  getTypes: async (): Promise<ApiResponse<string[]>> => {
    const response = await authFetch(`${API_BASE}/lookups/types`)
    return handleResponse(response)
  },

  create: async (data: Omit<LookupValue, '_id'>): Promise<ApiResponse<LookupValue>> => {
    const response = await authFetch(`${API_BASE}/lookups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<LookupValue>): Promise<ApiResponse<LookupValue>> => {
    const response = await authFetch(`${API_BASE}/lookups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/lookups/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  reorder: async (type: string, order: { id: string; sortOrder: number }[]): Promise<ApiResponse<LookupValue[]>> => {
    const response = await authFetch(`${API_BASE}/lookups/${type}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    return handleResponse(response)
  },
}

// Field Configs API
export const fieldConfigsApi = {
  getForCollection: async (collection: string): Promise<ApiResponse<FieldConfig[]>> => {
    const response = await authFetch(`${API_BASE}/field-configs/${collection}`)
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<FieldConfig>): Promise<ApiResponse<FieldConfig>> => {
    const response = await authFetch(`${API_BASE}/field-configs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },
}

// Views API
export const viewsApi = {
  list: async (collectionName?: string): Promise<ApiResponse<View[]>> => {
    const params = collectionName ? `?collectionName=${collectionName}` : ''
    const response = await authFetch(`${API_BASE}/views${params}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<View>> => {
    const response = await authFetch(`${API_BASE}/views/${id}`)
    return handleResponse(response)
  },

  create: async (data: Partial<View>): Promise<ApiResponse<View>> => {
    const response = await authFetch(`${API_BASE}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<View>): Promise<ApiResponse<View>> => {
    const response = await authFetch(`${API_BASE}/views/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/views/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  savePreferences: async (
    viewId: string,
    userId: string,
    preferences: { visibleColumns?: string[]; columnWidths?: Record<string, number>; columnOrder?: string[] }
  ): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/views/${viewId}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...preferences }),
    })
    return handleResponse(response)
  },
}

// Users API
export const usersApi = {
  list: async (): Promise<ApiResponse<User[]>> => {
    const response = await authFetch(`${API_BASE}/users`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<User>> => {
    const response = await authFetch(`${API_BASE}/users/${id}`)
    return handleResponse(response)
  },

  create: async (data: Partial<User>): Promise<ApiResponse<User>> => {
    const response = await authFetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<User>): Promise<ApiResponse<User>> => {
    const response = await authFetch(`${API_BASE}/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  listAgents: async (): Promise<ApiResponse<User[]>> => {
    const response = await authFetch(`${API_BASE}/users/agents`)
    return handleResponse(response)
  },

  ensureAgent: async (agentId: string): Promise<ApiResponse<User>> => {
    const response = await authFetch(`${API_BASE}/users/agents/ensure/${agentId}`, {
      method: 'POST',
    })
    return handleResponse(response)
  },
}

// Workflows API
export const workflowsApi = {
  list: async (): Promise<ApiResponse<Workflow[]>> => {
    const response = await authFetch(`${API_BASE}/workflows`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Workflow>> => {
    const response = await authFetch(`${API_BASE}/workflows/${id}`)
    return handleResponse(response)
  },
}

// External Jobs API
export const externalJobsApi = {
  list: async (params?: Record<string, string>): Promise<PaginatedResponse<ExternalJob>> => {
    const searchParams = new URLSearchParams(params)
    const response = await authFetch(`${API_BASE}/external-jobs?${searchParams}`)
    return handleResponse(response)
  },

  create: async (data: { taskId: string; type: string; payload?: Record<string, unknown> }): Promise<ApiResponse<ExternalJob>> => {
    const response = await authFetch(`${API_BASE}/external-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  claim: async (id: string, workerId?: string): Promise<ApiResponse<ExternalJob>> => {
    const response = await authFetch(`${API_BASE}/external-jobs/${id}/claim`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId }),
    })
    return handleResponse(response)
  },

  complete: async (id: string, result?: Record<string, unknown>): Promise<ApiResponse<ExternalJob>> => {
    const response = await authFetch(`${API_BASE}/external-jobs/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    })
    return handleResponse(response)
  },

  fail: async (id: string, error: string, retryAfter?: number): Promise<ApiResponse<ExternalJob>> => {
    const response = await authFetch(`${API_BASE}/external-jobs/${id}/fail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error, retryAfter }),
    })
    return handleResponse(response)
  },

  getStats: async (): Promise<ApiResponse<{ byStatus: Record<string, number> }>> => {
    const response = await authFetch(`${API_BASE}/external-jobs/stats/summary`)
    return handleResponse(response)
  },
}

// Types
export interface Task {
  _id: string
  title: string
  summary?: string
  extraPrompt?: string
  additionalInfo?: string
  status: string
  urgency?: string
  parentId: string | null
  workflowId?: string | null
  workflowStage?: string
  externalId?: string
  externalHoldDate?: string | null
  assigneeId?: string | null
  createdById?: string | null
  tags?: string[]
  createdAt: string
  updatedAt: string
  dueAt?: string | null
  metadata?: Record<string, unknown>
  children?: Task[]
  _resolved?: {
    assignee?: { _id: string; displayName: string }
    createdBy?: { _id: string; displayName: string }
    parent?: { _id: string; title: string }
    workflow?: { _id: string; name: string }
    status?: { code: string; displayName: string; color: string }
    urgency?: { code: string; displayName: string; color: string }
  }
}

export interface LookupValue {
  _id: string
  type: string
  code: string
  displayName: string
  color?: string
  icon?: string
  sortOrder: number
  isActive: boolean
}

export interface FieldConfig {
  _id: string
  collectionName: string
  fieldPath: string
  displayName: string
  fieldType: string
  isRequired: boolean
  isEditable: boolean
  isSearchable: boolean
  isSortable: boolean
  isFilterable: boolean
  displayOrder: number
  width?: number
  minWidth?: number
  lookupType?: string
  options?: Array<{ value: string; label: string } | { code: string; displayName: string }>
  referenceCollection?: string
  referenceDisplayField?: string
  defaultValue?: unknown
  defaultVisible: boolean
  renderAs?: string
}

export interface View {
  _id: string
  name: string
  collectionName: string
  isDefault: boolean
  isSystem: boolean
  filters: Record<string, unknown>
  sorting: Array<{ field: string; direction: 'asc' | 'desc' }>
  visibleColumns: string[]
  columnWidths?: Record<string, number>
  createdById?: string | null
  createdAt: string
  userPreference?: {
    visibleColumns?: string[]
    columnWidths?: Record<string, number>
    columnOrder?: string[]
  }
}

export interface User {
  _id: string
  email?: string                  // Optional for agent users
  displayName: string
  role: string
  isActive: boolean
  isAgent?: boolean               // Is this user an AI agent?
  agentPrompt?: string            // Agent's base prompt/persona
  createdAt?: string
  updatedAt?: string
}

export interface ExternalJob {
  _id: string
  taskId: string
  type: string
  status: string
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
}

// Workflow step types
export type WorkflowStepType = 'task' | 'decision' | 'foreach' | 'join' | 'subflow'
export type ExecutionMode = 'automated' | 'manual'

export interface DecisionBranch {
  condition: string | null        // null = default branch
  targetStepId: string
}

export interface WorkflowStep {
  id: string
  name: string
  stepType?: WorkflowStepType     // What kind of step (default: 'task')
  execution?: ExecutionMode       // Execution mode for task steps
  type?: 'automated' | 'manual'   // DEPRECATED: Use execution instead
  hitlPhase: string
  description?: string
  config?: Record<string, unknown>
  prompt?: string                 // Prompt for AI execution
  defaultAssigneeId?: string      // Default assignee for this step
  branches?: DecisionBranch[]     // Decision routing
  defaultBranch?: string
  itemsPath?: string              // ForEach: JSONPath to array
  itemVariable?: string           // ForEach: Template variable name
  maxItems?: number               // ForEach: Limit (default: 100)
  awaitTag?: string               // Join: Tag pattern
  subflowId?: string              // Subflow: Target workflow ID
  inputMapping?: Record<string, string>  // Subflow: Input mapping
}

export interface Workflow {
  _id: string
  name: string
  description?: string
  steps?: WorkflowStep[]
  stages?: string[]  // Legacy format - simple stage names
  mermaidDiagram?: string
  isActive: boolean
  createdAt: string
  updatedAt?: string
}

// Activity Log Types
export interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

export interface ActivityLogEntry {
  _id: string
  taskId: string
  eventType: string
  actorId?: string | null
  actorType: 'user' | 'system' | 'daemon'
  changes?: FieldChange[]
  comment?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

// Webhook Types
export interface Webhook {
  _id: string
  name: string
  url: string
  secret: string
  triggers: string[]
  savedSearchId?: string | null
  filterQuery?: string
  isActive: boolean
  createdById?: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookDelivery {
  _id: string
  webhookId: string
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  status: 'pending' | 'success' | 'failed' | 'retrying'
  statusCode?: number
  responseBody?: string
  error?: string
  attempts: number
  maxAttempts: number
  nextRetryAt?: string | null
  createdAt: string
  completedAt?: string | null
}

// Activity Logs API
export const activityLogsApi = {
  getTaskActivity: async (
    taskId: string,
    params?: { limit?: number; offset?: number; eventTypes?: string[] }
  ): Promise<{ data: ActivityLogEntry[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    if (params?.eventTypes) {
      params.eventTypes.forEach(t => searchParams.append('eventTypes', t))
    }
    const response = await authFetch(`${API_BASE}/activity-logs/task/${taskId}?${searchParams}`)
    return handleResponse(response)
  },

  getRecentActivity: async (
    params?: { limit?: number; offset?: number; eventTypes?: string[]; actorId?: string }
  ): Promise<{ data: ActivityLogEntry[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    if (params?.actorId) searchParams.append('actorId', params.actorId)
    if (params?.eventTypes) {
      params.eventTypes.forEach(t => searchParams.append('eventTypes', t))
    }
    const response = await authFetch(`${API_BASE}/activity-logs/recent?${searchParams}`)
    return handleResponse(response)
  },

  addComment: async (
    taskId: string,
    comment: string,
    actorId?: string
  ): Promise<ApiResponse<ActivityLogEntry>> => {
    const response = await authFetch(`${API_BASE}/activity-logs/task/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment, actorId }),
    })
    return handleResponse(response)
  },
}

// Webhooks API
export const webhooksApi = {
  list: async (params?: { isActive?: boolean; limit?: number; offset?: number }): Promise<{
    data: Webhook[]
    pagination: { limit: number; offset: number; total: number }
  }> => {
    const searchParams = new URLSearchParams()
    if (params?.isActive !== undefined) searchParams.append('isActive', String(params.isActive))
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/webhooks?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Webhook>> => {
    const response = await authFetch(`${API_BASE}/webhooks/${id}`)
    return handleResponse(response)
  },

  create: async (data: Partial<Webhook>): Promise<ApiResponse<Webhook>> => {
    const response = await authFetch(`${API_BASE}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<Webhook>): Promise<ApiResponse<Webhook>> => {
    const response = await authFetch(`${API_BASE}/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/webhooks/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  rotateSecret: async (id: string): Promise<ApiResponse<{ secret: string }>> => {
    const response = await authFetch(`${API_BASE}/webhooks/${id}/rotate-secret`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  test: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/webhooks/${id}/test`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  getDeliveries: async (
    webhookId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ data: WebhookDelivery[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/webhooks/${webhookId}/deliveries?${searchParams}`)
    return handleResponse(response)
  },

  retryDelivery: async (deliveryId: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/webhooks/deliveries/${deliveryId}/retry`, {
      method: 'POST',
    })
    return handleResponse(response)
  },
}
