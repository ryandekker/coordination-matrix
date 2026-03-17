// API base URL - must be set via NEXT_PUBLIC_API_URL env var for auth headers to work
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
  error?: string
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
    // Throw to prevent further processing
    throw new Error('Unauthorized - redirecting to login')
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

  getChildren: async (id: string, params?: {
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }): Promise<PaginatedResponse<Task>> => {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.append('page', params.page.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.sortBy) searchParams.append('sortBy', params.sortBy)
    if (params?.sortOrder) searchParams.append('sortOrder', params.sortOrder)
    const queryString = searchParams.toString()
    const response = await authFetch(`${API_BASE}/tasks/${id}/children${queryString ? `?${queryString}` : ''}`)
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

  // Rerun a task (reset to pending)
  rerun: async (id: string, options?: { clearMetadata?: boolean; preserveInput?: boolean }): Promise<ApiResponse<Task>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    })
    return handleResponse(response)
  },

  // Webhook task operations
  executeWebhook: async (id: string): Promise<ApiResponse<WebhookAttempt>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/webhook/execute`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  retryWebhook: async (id: string): Promise<ApiResponse<WebhookAttempt>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/webhook/retry`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  getWebhookStatus: async (
    id: string
  ): Promise<ApiResponse<{ task: Task; attempts: WebhookAttempt[]; canRetry: boolean; lastError?: string }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/webhook/status`)
    return handleResponse(response)
  },

  cancelWebhookRetry: async (id: string): Promise<ApiResponse<{ success: boolean; message: string }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/webhook/retry`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  // Decision task operations
  forceDecision: async (id: string, targetStepId: string): Promise<ApiResponse<{ success: boolean; message: string; task: Task }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/force-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStepId }),
    })
    return handleResponse(response)
  },

  // Flow task operations (subflow/nested workflow)
  executeFlow: async (id: string, inputPayload?: Record<string, unknown>): Promise<ApiResponse<FlowAttempt>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/flow/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputPayload }),
    })
    return handleResponse(response)
  },

  retryFlow: async (id: string, inputPayload?: Record<string, unknown>): Promise<ApiResponse<FlowAttempt>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/flow/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputPayload }),
    })
    return handleResponse(response)
  },

  getFlowStatus: async (id: string): Promise<ApiResponse<{
    taskStatus: string
    targetWorkflow?: { id: string; name: string }
    spawnedWorkflowRunId?: string
    spawnedWorkflowStatus?: string
    currentAttempt?: FlowAttempt
    attemptCount: number
    attempts: FlowAttempt[]
  }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/flow/status`)
    return handleResponse(response)
  },

  // Rollback a manual review task to the previous step
  rollback: async (id: string, comment?: string): Promise<ApiResponse<{ success: boolean; message: string; newTaskId?: string }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    })
    return handleResponse(response)
  },

  // Submit answers to agent questions
  answerQuestions: async (id: string, answers: AgentQuestionAnswer[]): Promise<ApiResponse<{ success: boolean; message: string; data: Task }>> => {
    const response = await authFetch(`${API_BASE}/tasks/${id}/answer-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
    return handleResponse(response)
  },

  // Get all webhook task attempts across all tasks
  getWebhookAttempts: async (params?: {
    status?: 'pending' | 'success' | 'failed'
    taskStatus?: string
    taskType?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<{ data: WebhookTaskAttempt[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.append('status', params.status)
    if (params?.taskStatus) searchParams.append('taskStatus', params.taskStatus)
    if (params?.taskType) searchParams.append('taskType', params.taskType)
    if (params?.assigneeId) searchParams.append('assigneeId', params.assigneeId)
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/tasks/webhook-attempts?${searchParams}`)
    return handleResponse(response)
  },

  // Get workflow callback tasks (inbound requests from external systems)
  getWorkflowCallbacks: async (params?: {
    taskStatus?: string
    taskType?: string
    limit?: number
    offset?: number
  }): Promise<{ data: WorkflowCallback[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.taskStatus) searchParams.append('taskStatus', params.taskStatus)
    if (params?.taskType) searchParams.append('taskType', params.taskType)
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/tasks/workflow-callbacks?${searchParams}`)
    return handleResponse(response)
  },

  // Document attachment operations
  getDocuments: async (taskId: string): Promise<ApiResponse<Document[]>> => {
    const response = await authFetch(`${API_BASE}/tasks/${taskId}/documents`)
    return handleResponse(response)
  },

  attachDocument: async (
    taskId: string,
    data: { documentId: string } | {
      title: string
      content: string
      type?: DocumentType
      status?: DocumentStatus
      summary?: string
      tags?: string[]
      metadata?: Record<string, unknown>
    }
  ): Promise<ApiResponse<Document>> => {
    const response = await authFetch(`${API_BASE}/tasks/${taskId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  detachDocument: async (taskId: string, documentId: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/tasks/${taskId}/documents/${documentId}`, {
      method: 'DELETE',
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
  list: async (collectionName?: string, groupId?: string): Promise<ApiResponse<View[]>> => {
    const params = new URLSearchParams()
    if (collectionName) params.set('collectionName', collectionName)
    if (groupId) params.set('groupId', groupId)
    const queryString = params.toString()
    const response = await authFetch(`${API_BASE}/views${queryString ? `?${queryString}` : ''}`)
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

// View Folders API
export const viewFoldersApi = {
  list: async (collectionName?: string): Promise<ApiResponse<ViewFolder[]>> => {
    const params = collectionName ? `?collectionName=${collectionName}` : ''
    const response = await authFetch(`${API_BASE}/view-folders${params}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<ViewFolder>> => {
    const response = await authFetch(`${API_BASE}/view-folders/${id}`)
    return handleResponse(response)
  },

  create: async (data: {
    name: string
    collectionName: string
    sortOrder?: number
    isExpanded?: boolean
  }): Promise<ApiResponse<ViewFolder>> => {
    const response = await authFetch(`${API_BASE}/view-folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<ViewFolder>): Promise<ApiResponse<ViewFolder>> => {
    const response = await authFetch(`${API_BASE}/view-folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string, moveViewsToRoot = true): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/view-folders/${id}?moveViewsToRoot=${moveViewsToRoot}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  reorder: async (
    order: Array<{ id: string; sortOrder: number }>,
    collectionName?: string
  ): Promise<ApiResponse<ViewFolder[]>> => {
    const response = await authFetch(`${API_BASE}/view-folders/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, collectionName }),
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

// Groups API
export const groupsApi = {
  list: async (params?: { all?: boolean }): Promise<ApiResponse<Group[]>> => {
    const searchParams = new URLSearchParams()
    if (params?.all) searchParams.set('all', 'true')
    const queryString = searchParams.toString()
    const response = await authFetch(`${API_BASE}/groups${queryString ? `?${queryString}` : ''}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Group>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}`)
    return handleResponse(response)
  },

  create: async (data: {
    name: string
    displayName: string
    description?: string
    visibility?: GroupVisibility
  }): Promise<ApiResponse<Group>> => {
    const response = await authFetch(`${API_BASE}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: {
    displayName?: string
    description?: string
    visibility?: GroupVisibility
  }): Promise<ApiResponse<Group>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  // Member management
  getMembers: async (id: string): Promise<ApiResponse<GroupMember[]>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}/members`)
    return handleResponse(response)
  },

  addMember: async (id: string, data: { userId: string; role?: GroupRole }): Promise<ApiResponse<Group>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  updateMemberRole: async (id: string, userId: string, role: GroupRole): Promise<ApiResponse<Group>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    return handleResponse(response)
  },

  removeMember: async (id: string, userId: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/groups/${id}/members/${userId}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },
}

// Projects API
export const projectsApi = {
  list: async (params?: { groupId?: string; status?: ProjectStatus }): Promise<ApiResponse<Project[]>> => {
    const searchParams = new URLSearchParams()
    if (params?.groupId) searchParams.set('groupId', params.groupId)
    if (params?.status) searchParams.set('status', params.status)
    const queryString = searchParams.toString()
    const response = await authFetch(`${API_BASE}/projects${queryString ? `?${queryString}` : ''}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Project>> => {
    const response = await authFetch(`${API_BASE}/projects/${id}`)
    return handleResponse(response)
  },

  create: async (data: {
    name: string
    displayName: string
    description?: string
    groupId: string
    color?: string
  }): Promise<ApiResponse<Project>> => {
    const response = await authFetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: {
    displayName?: string
    description?: string
    status?: ProjectStatus
    color?: string
  }): Promise<ApiResponse<Project>> => {
    const response = await authFetch(`${API_BASE}/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  getStats: async (groupId: string): Promise<ApiResponse<Record<string, {
    totalTasks: number
    pendingTasks: number
    inProgressTasks: number
    completedTasks: number
  }>>> => {
    const response = await authFetch(`${API_BASE}/projects/stats?groupId=${groupId}`)
    return handleResponse(response)
  },
}

// Workflows API
export const workflowsApi = {
  list: async (options?: { includeInactive?: boolean }): Promise<ApiResponse<Workflow[]>> => {
    const params = new URLSearchParams()
    if (options?.includeInactive) {
      params.set('includeInactive', 'true')
    }
    const queryString = params.toString()
    const response = await authFetch(`${API_BASE}/workflows${queryString ? `?${queryString}` : ''}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Workflow>> => {
    const response = await authFetch(`${API_BASE}/workflows/${id}`)
    return handleResponse(response)
  },
}

// External Jobs API
export const externalJobsApi = {
  list: async (params?: {
    status?: string
    type?: string
    taskId?: string
    taskStatus?: string
    taskType?: string
    assigneeId?: string
    page?: string
    limit?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }): Promise<PaginatedResponse<ExternalJob>> => {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.append('status', params.status)
    if (params?.type) searchParams.append('type', params.type)
    if (params?.taskId) searchParams.append('taskId', params.taskId)
    if (params?.taskStatus) searchParams.append('taskStatus', params.taskStatus)
    if (params?.taskType) searchParams.append('taskType', params.taskType)
    if (params?.assigneeId) searchParams.append('assigneeId', params.assigneeId)
    if (params?.page) searchParams.append('page', params.page)
    if (params?.limit) searchParams.append('limit', params.limit)
    if (params?.sortBy) searchParams.append('sortBy', params.sortBy)
    if (params?.sortOrder) searchParams.append('sortOrder', params.sortOrder)
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

// Tags API
export interface Tag {
  _id: string
  name: string
  displayName: string
  color: string
  description?: string | null
  isActive: boolean
  createdById?: string | null
  createdAt: string
  updatedAt?: string | null
}

export const tagsApi = {
  list: async (params?: { includeInactive?: boolean; search?: string }): Promise<ApiResponse<Tag[]>> => {
    const searchParams = new URLSearchParams()
    if (params?.includeInactive) searchParams.append('includeInactive', 'true')
    if (params?.search) searchParams.append('search', params.search)
    const queryString = searchParams.toString()
    const response = await authFetch(`${API_BASE}/tags${queryString ? `?${queryString}` : ''}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Tag>> => {
    const response = await authFetch(`${API_BASE}/tags/${id}`)
    return handleResponse(response)
  },

  create: async (data: { name: string; displayName?: string; color?: string; description?: string }): Promise<ApiResponse<Tag>> => {
    const response = await authFetch(`${API_BASE}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<Tag>): Promise<ApiResponse<Tag>> => {
    const response = await authFetch(`${API_BASE}/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/tags/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },
}

// Types
export type TaskType =
  | 'flow'
  | 'trigger'
  | 'agent'
  | 'manual'
  | 'decision'
  | 'foreach'
  | 'join'
  | 'external'
  | 'webhook'
  | 'code'
  | 'findDocument'

// Review decision for manual workflow steps
export type ManualReviewDecision = 'approved' | 'request_changes' | 'approved_with_notes'

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface WebhookAttempt {
  attemptNumber: number
  startedAt: string
  completedAt?: string
  status: 'pending' | 'success' | 'failed'
  // Request details (resolved from templates)
  requestUrl?: string
  requestMethod?: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  // Response details
  httpStatus?: number
  responseBody?: unknown
  errorMessage?: string
  durationMs?: number
}

export interface WebhookConfig {
  url: string
  method: WebhookMethod
  headers?: Record<string, string>
  // Template string for headers - supports {{variables}}
  // Takes precedence over headers if set
  headersTemplate?: string
  body?: string
  maxRetries?: number
  retryDelayMs?: number
  timeoutMs?: number
  successStatusCodes?: number[]
  attempts?: WebhookAttempt[]
  lastAttemptAt?: string
  nextRetryAt?: string
}

// Flow (subflow) execution attempt record
export interface FlowAttempt {
  attemptNumber: number
  startedAt: string
  completedAt?: string
  status: 'pending' | 'running' | 'success' | 'failed'
  // Input details
  inputPayload?: Record<string, unknown>
  resolvedInputMapping?: Record<string, string>
  // Spawned workflow details
  spawnedWorkflowRunId?: string
  targetWorkflowId?: string
  targetWorkflowName?: string
  // Result details
  outputPayload?: Record<string, unknown>
  errorMessage?: string
  durationMs?: number
}

// Flow task configuration (nested workflow execution)
export interface FlowConfig {
  workflowId: string
  inputMapping?: Record<string, string>
  attempts?: FlowAttempt[]
  lastAttemptAt?: string
}

// Step connection (for decision routing)
export interface StepConnection {
  targetStepId: string
  condition?: string | null
  label?: string
}

// Join boundary conditions
export interface JoinBoundary {
  minCount?: number
  minPercent?: number
  maxWaitMs?: number
  failOnTimeout?: boolean
}

// FindDocument step configuration
export interface FindDocumentConfig {
  mode?: 'static' | 'dynamic'
  documentId?: string
  searchPrompt?: string
  documentTypes?: string[]
  documentStatus?: string[]
  tags?: string[]
  limit?: number
  minScore?: number
  storeAs?: string
  failIfNotFound?: boolean
}

// Unified input configuration for workflow steps
export interface StepInputConfig {
  source: 'previous' | 'trigger' | string
  mapping?: Record<string, string>
  extractPath?: string
}

// Execution summary - programmatic rollup of what happened in a task/workflow
export type ExecutionOutcome = 'success' | 'partial' | 'failed' | 'escalated'

export interface ExecutionSummaryStep {
  stepName: string
  stepType: string
  outcome: 'success' | 'failed' | 'skipped'
  summary?: string
  error?: string
  durationMs?: number
}

export interface ExecutionSummaryChildFlow {
  taskId: string
  title: string
  workflowName?: string
  outcome: ExecutionOutcome
  summary?: string
  error?: string
}

export interface ExecutionSummary {
  outcome: ExecutionOutcome
  completedAt: string
  durationMs?: number
  trigger?: {
    source: string
    inputSummary?: string
  }
  steps?: ExecutionSummaryStep[]
  stats?: {
    total: number
    succeeded: number
    failed: number
    skipped: number
  }
  childFlowSummaries?: ExecutionSummaryChildFlow[]
  errorChain?: Array<{
    stepName: string
    error: string
    taskId: string
  }>
}

// Standardized step output
export interface StepOutput {
  data: unknown
  summary?: string
  producedAt: string
  durationMs?: number
  httpResponse?: {
    status: number
    headers?: Record<string, string>
    body?: unknown
  }
  aggregatedResults?: Array<{
    taskId: string
    stepId?: string
    data: unknown
    status: 'success' | 'failed'
  }>
  selectedBranch?: {
    targetStepId: string
    condition?: string
  }
  foreachMeta?: {
    totalItems: number
    itemsPath: string
  }
  logs?: string[]
  nestedWorkflow?: {
    runId: string
    status: string
    output?: unknown
  }
  documents?: Array<{
    id: string
    title: string
    type: string
    score?: number
  }>
}

// Complete workflow step configuration stored on task
export interface TaskStepConfig {
  // Step identification
  stepId: string
  stepType: string
  stepName?: string
  stepDescription?: string

  // Agent/Manual step config
  additionalInstructions?: string
  promptDocumentIds?: string[]
  titleTemplate?: string
  defaultAssigneeId?: string

  // External step config
  externalEndpoint?: string
  externalMethod?: string
  externalHeaders?: Record<string, string>
  externalPayloadTemplate?: string
  externalResponseMapping?: Record<string, string>
  waitForCallback?: boolean

  // Webhook step config
  webhookUrl?: string
  webhookMethod?: string
  webhookHeaders?: Record<string, string>
  webhookBodyTemplate?: string
  webhookMaxRetries?: number
  webhookTimeoutMs?: number
  webhookSuccessStatusCodes?: number[]

  // Foreach step config
  itemsPath?: string
  itemVariable?: string
  maxItems?: number
  expectedCountPath?: string

  // Join step config
  awaitStepId?: string
  joinBoundary?: JoinBoundary
  joinInputPath?: string

  // Decision step config
  connections?: StepConnection[]
  defaultConnection?: string

  // Flow step config (nested workflow)
  flowId?: string
  inputMapping?: Record<string, string>

  // FindDocument step config
  findDocumentConfig?: FindDocumentConfig

  // Unified input configuration
  inputConfig?: StepInputConfig

  // Legacy input aggregation config
  inputPath?: string
  inputSource?: string
}

// Agent question types for tasks that need human input
export type AgentQuestionType = 'text' | 'choice' | 'multiselect' | 'confirm' | 'number'

export interface AgentQuestionOption {
  value: string
  label: string
  description?: string
}

export interface AgentQuestion {
  id: string
  type: AgentQuestionType
  question: string
  description?: string
  required?: boolean
  options?: AgentQuestionOption[]  // For choice/multiselect types
  placeholder?: string            // For text/number types
  defaultValue?: string | number | boolean | string[]
  validation?: {
    min?: number                  // For number type
    max?: number                  // For number type
    minLength?: number            // For text type
    maxLength?: number            // For text type
    pattern?: string              // Regex pattern for text
  }
}

export interface AgentQuestionAnswer {
  questionId: string
  value: string | number | boolean | string[]
}

export interface AgentQuestionsOutput {
  questions: AgentQuestion[]
  context?: string               // Optional context explaining why questions are needed
  answeredAt?: string            // ISO timestamp when answered
  answers?: AgentQuestionAnswer[] // Populated when questions are answered
}

// Task result status
export type TaskResultStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'running'

// A single execution result
export interface TaskResultEntry {
  id: string
  status: TaskResultStatus
  output?: unknown
  summary?: string
  error?: string
  executedAt: string
  completedAt?: string
  durationMs?: number

  // Webhook-specific result
  webhookResponse?: {
    httpStatus: number
    body: unknown
    headers?: Record<string, string>
    durationMs: number
  }

  // Join-specific result
  aggregatedResults?: unknown[]
  aggregationStats?: {
    expectedCount: number
    successCount: number
    failedCount: number
    successPercent: number
  }

  // Decision-specific result
  selectedPath?: string
  evaluatedCondition?: string

  // FindDocument-specific result
  documentResults?: {
    count: number
    documents: Array<{
      id: string
      title: string
      score?: number
    }>
  }

  // Flow-specific result
  spawnedWorkflow?: {
    runId: string
    status: string
    outputPayload?: unknown
  }

  // Code step result
  codeExecution?: {
    logs: string[]
    executionTimeMs: number
    packages: string[]
  }
}

// Task result with history
export interface TaskResult {
  current: TaskResultEntry
  history?: TaskResultEntry[]
}

// Summary of child task statuses for parent tasks
export interface ChildStatusSummary {
  total: number
  pending: number
  in_progress: number
  waiting: number
  on_hold: number
  completed: number
  failed: number
  cancelled: number
}

export interface Task {
  _id: string
  title: string
  summary?: string
  extraPrompt?: string
  humanInstruction?: string
  status: string
  urgency?: string
  groupId?: string | null
  projectId?: string | null
  parentId: string | null
  workflowId?: string | null
  workflowRunId?: string | null
  workflowStepId?: string | null
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
  childCount?: number
  childStatusSummary?: ChildStatusSummary
  taskType?: TaskType
  webhookConfig?: WebhookConfig
  flowConfig?: FlowConfig
  batchCounters?: {
    expectedCount?: number
    completedCount?: number
    failedCount?: number
  }
  joinConfig?: {
    minSuccessPercent?: number
    expectedCount?: number
    timeoutMs?: number
    maxWaitMs?: number
  }
  // Write-only: trigger a workflow from this task
  triggerWorkflowId?: string
  // Read-only: workflow run spawned by this task
  spawnedWorkflowRunId?: string
  workflowResult?: {
    status?: 'completed' | 'failed' | 'running'
    error?: string
  }
  // Original workflow step configuration (for visibility and reruns)
  stepConfig?: TaskStepConfig
  // Standardized task result with history
  taskResult?: TaskResult
  // Unified step input/output (new model for workflow tasks)
  stepInput?: Record<string, unknown>
  stepOutput?: StepOutput
  // Decision result: which branch was selected
  decisionResult?: string
  // Programmatic rollup of execution outcome (built at completion time)
  executionSummary?: ExecutionSummary
  // Manual review fields (for manual workflow steps)
  reviewDecision?: ManualReviewDecision
  reviewComment?: string
  reviewedAt?: string
  reviewedById?: string | null
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
  folderId?: string | null
  groupId?: string | null
  projectId?: string | null
  createdById?: string | null
  createdAt: string
  userPreference?: {
    visibleColumns?: string[]
    columnWidths?: Record<string, number>
    columnOrder?: string[]
  }
}

export interface ViewFolder {
  _id: string
  name: string
  collectionName: string
  sortOrder: number
  isExpanded: boolean
  createdById?: string | null
  createdAt: string
  updatedAt?: string
}

// Agent complexity levels - determines which capability documents are available
// 1 = basic (haiku-class), 2 = intermediate (sonnet-class), 3 = advanced (opus-class)
export type AgentComplexity = 1 | 2 | 3

export interface User {
  _id: string
  email?: string                  // Optional for agent users
  displayName: string
  role: string
  isActive: boolean
  isAgent?: boolean               // Is this user an AI agent?
  isSystem?: boolean              // Is this the system user? (for automated workflow tasks)
  agentPrompt?: string            // Agent's base prompt/persona
  agentComplexity?: AgentComplexity // Agent's capability level (1=basic, 2=intermediate, 3=advanced)
  agentTags?: string[]            // Capability tags for dynamic agent matching
  profilePicture?: string         // URL to profile picture (for humans)
  botColor?: string               // Custom color for bot users (hex code)
  createdAt?: string
  updatedAt?: string
}

// Well-known system user ID (matches backend)
export const SYSTEM_USER_ID = '000000000000000000000001'

// Group types
export type GroupRole = 'owner' | 'admin' | 'member' | 'viewer'
export type GroupVisibility = 'private' | 'internal'

export interface GroupMember {
  userId: string
  role: GroupRole
  addedAt: string
  addedById?: string | null
  user?: User  // Resolved user info
}

export interface Group {
  _id: string
  name: string              // Unique slug identifier
  displayName: string
  description?: string
  members: GroupMember[]
  visibility: GroupVisibility
  defaultProjectRole?: GroupRole
  createdById?: string | null
  createdAt: string
  updatedAt: string
}

// Project types
export type ProjectStatus = 'active' | 'archived'

export interface Project {
  _id: string
  name: string              // Unique slug within group
  displayName: string
  description?: string
  groupId: string
  status: ProjectStatus
  color?: string            // Hex color for visual identification
  createdById?: string | null
  createdAt: string
  updatedAt: string
  group?: Group             // Resolved group info
}

/**
 * Check if a user is the system user
 */
export function isSystemUser(user: User | null | undefined): boolean {
  if (!user) return false
  return user.isSystem === true || user._id === SYSTEM_USER_ID
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
export type WorkflowStepType = 'task' | 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument' | 'code'
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
  flowId?: string                 // Flow: Target workflow ID (nested workflow)
  inputMapping?: Record<string, string>  // Flow: Input mapping
  inputConfig?: StepInputConfig   // Unified input configuration
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
  rootTaskTitleTemplate?: string
  // Sample payload template for triggering this workflow - helps agents/callers know what data to provide
  samplePayload?: string
  // JSON Schema defining the expected structure of inputPayload when starting workflow runs
  inputSchema?: Record<string, unknown>
  // Organization and display
  folderId?: string | null
  color?: string  // Pastel hex color for visual identification
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
  // Populated user info (resolved by backend)
  actor?: {
    displayName: string
    email?: string
  } | null
}

// Workflow Run Types
export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowRun {
  _id: string
  workflowId: string
  status: WorkflowRunStatus
  rootTaskId?: string | null
  inputPayload?: Record<string, unknown>
  outputPayload?: Record<string, unknown>
  humanInstruction?: string
  currentStepIds: string[]
  completedStepIds: string[]
  failedStepId?: string | null
  pausedStepId?: string | null
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
  pausedAt?: string | null
  // Rerun tracking
  supersededBy?: string | null  // This run was replaced by another run
  supersededAt?: string | null  // When this run was superseded
  supersedes?: string | null    // This run replaces another run
  createdAt: string
  updatedAt: string
  _resolved?: {
    workflow?: { _id: string; name: string }
    rootTask?: { _id: string; title: string; status: string }
  }
}

export interface WorkflowRunWithTasks extends WorkflowRun {
  tasks: Task[]
  workflow?: Workflow
}

// Task defaults that apply to all tasks created in a workflow run
export interface WorkflowTaskDefaults {
  assigneeId?: string
  urgency?: 'low' | 'normal' | 'high' | 'urgent'
  tags?: string[]
  dueOffsetHours?: number
}

// Execution options for workflow runs
export interface WorkflowExecutionOptions {
  pauseAtSteps?: string[]
  skipSteps?: string[]
  dryRun?: boolean
}

// Input for starting a workflow run
export interface StartWorkflowInput {
  workflowId: string
  inputPayload?: Record<string, unknown>
  taskDefaults?: WorkflowTaskDefaults
  executionOptions?: WorkflowExecutionOptions
  externalId?: string
  source?: string
}

// Workflow Runs API
export const workflowRunsApi = {
  list: async (params?: {
    workflowId?: string
    groupId?: string
    status?: WorkflowRunStatus | WorkflowRunStatus[]
    dateFrom?: string
    dateTo?: string
    page?: number
    limit?: number
  }): Promise<PaginatedResponse<WorkflowRun>> => {
    const searchParams = new URLSearchParams()
    if (params?.workflowId) searchParams.append('workflowId', params.workflowId)
    if (params?.groupId) searchParams.append('groupId', params.groupId)
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      searchParams.append('status', statuses.join(','))
    }
    if (params?.dateFrom) searchParams.append('dateFrom', params.dateFrom)
    if (params?.dateTo) searchParams.append('dateTo', params.dateTo)
    if (params?.page) searchParams.append('page', String(params.page))
    if (params?.limit) searchParams.append('limit', String(params.limit))
    const response = await authFetch(`${API_BASE}/workflow-runs?${searchParams}`)
    return handleResponse(response)
  },

  get: async (
    id: string,
    options: {
      includeTasks?: boolean
      taskLimit?: number
      taskOffset?: number
      includeChildCounts?: boolean
    } | boolean = false
  ): Promise<ApiResponse<WorkflowRun | WorkflowRunWithTasks & { totalTasks?: number; hasMore?: boolean }>> => {
    // Support legacy boolean signature
    const opts = typeof options === 'boolean' ? { includeTasks: options } : options

    const searchParams = new URLSearchParams()
    if (opts.includeTasks) searchParams.append('includeTasks', 'true')
    if (opts.taskLimit !== undefined) searchParams.append('taskLimit', String(opts.taskLimit))
    if (opts.taskOffset !== undefined) searchParams.append('taskOffset', String(opts.taskOffset))
    if (opts.includeChildCounts) searchParams.append('includeChildCounts', 'true')

    const queryString = searchParams.toString()
    const url = `${API_BASE}/workflow-runs/${id}${queryString ? `?${queryString}` : ''}`
    const response = await authFetch(url)
    return handleResponse(response)
  },

  getChildTasks: async (
    runId: string,
    taskId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ApiResponse<{ tasks: Task[]; hasMore: boolean }>> => {
    const searchParams = new URLSearchParams()
    if (options.limit !== undefined) searchParams.append('limit', String(options.limit))
    if (options.offset !== undefined) searchParams.append('offset', String(options.offset))

    const queryString = searchParams.toString()
    const url = `${API_BASE}/workflow-runs/${runId}/tasks/${taskId}/children${queryString ? `?${queryString}` : ''}`
    const response = await authFetch(url)
    return handleResponse(response)
  },

  start: async (data: StartWorkflowInput): Promise<ApiResponse<{ run: WorkflowRun; rootTask: Task }>> => {
    const response = await authFetch(`${API_BASE}/workflow-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  cancel: async (id: string): Promise<ApiResponse<WorkflowRun>> => {
    const response = await authFetch(`${API_BASE}/workflow-runs/${id}/cancel`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  rerun: async (
    id: string,
    options?: { fromStart?: boolean }
  ): Promise<ApiResponse<{
    success: boolean
    workflowRunId: string
    message: string
    rerunFromStep?: string
    resetTaskIds?: string[]
    error?: string
  }>> => {
    const response = await authFetch(`${API_BASE}/workflow-runs/${id}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    })
    return handleResponse(response)
  },

  callback: async (
    runId: string,
    stepId: string,
    payload: Record<string, unknown>,
    secret: string
  ): Promise<ApiResponse<{ acknowledged: boolean; taskId: string; taskStatus: string }>> => {
    const response = await authFetch(`${API_BASE}/workflow-runs/${runId}/callback/${stepId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workflow-Secret': secret,
      },
      body: JSON.stringify(payload),
    })
    return handleResponse(response)
  },

  // Workflow request logging
  listRequests: async (params?: {
    type?: WorkflowRequestType
    status?: 'success' | 'failed'
    workflowId?: string
    workflowRunId?: string
    limit?: number
    offset?: number
  }): Promise<{ data: WorkflowRequest[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.type) searchParams.append('type', params.type)
    if (params?.status) searchParams.append('status', params.status)
    if (params?.workflowId) searchParams.append('workflowId', params.workflowId)
    if (params?.workflowRunId) searchParams.append('workflowRunId', params.workflowRunId)
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/workflow-runs/requests?${searchParams}`)
    return handleResponse(response)
  },

  getRequest: async (requestId: string): Promise<ApiResponse<WorkflowRequest>> => {
    const response = await authFetch(`${API_BASE}/workflow-runs/requests/${requestId}`)
    return handleResponse(response)
  },
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
  // Added from aggregation lookup
  webhookName?: string
  webhookUrl?: string
}

// Webhook task attempt (from tasks with webhookConfig)
export interface WebhookTaskAttempt {
  _id: string
  taskId: string
  taskTitle: string
  taskStatus: string
  attemptNumber: number
  status: 'pending' | 'success' | 'failed'
  httpStatus?: number
  responseBody?: unknown
  errorMessage?: string
  durationMs?: number
  url: string
  method: string
  headers?: Record<string, string>
  requestBody?: unknown
  startedAt: string
  completedAt?: string
}

// Workflow callback (inbound requests from external systems)
export interface WorkflowCallback {
  _id: string
  taskId: string
  taskTitle: string
  taskStatus: string
  taskType: string
  workflowRunId?: string
  workflowStepId?: string
  // Request details
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
  receivedAt: string
  status: string
  // Error message if request failed
  error?: string
  // Created tasks from this callback
  createdTaskIds?: string[]
}

// Workflow request (logged inbound requests that trigger or interact with workflows)
export type WorkflowRequestType = 'workflow_start' | 'workflow_callback'
export type WorkflowRequestActorType = 'user' | 'api_key' | 'anonymous' | 'system'

export interface WorkflowRequest {
  _id: string
  // Request type
  type: WorkflowRequestType
  // HTTP request details
  method: string
  url: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  // Processing status
  status: 'success' | 'failed'
  error?: string
  // Workflow correlation
  workflowId?: string
  workflowName?: string
  workflowRunId?: string
  rootTaskId?: string
  // For callback requests
  stepId?: string
  taskId?: string
  // Actor info
  actorId?: string
  actorType: WorkflowRequestActorType
  source?: string
  externalId?: string
  // Timestamps
  receivedAt: string
  processedAt?: string
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
    params?: { limit?: number; offset?: number; eventTypes?: string[]; actorId?: string; groupId?: string }
  ): Promise<{ data: ActivityLogEntry[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    if (params?.actorId) searchParams.append('actorId', params.actorId)
    if (params?.groupId) searchParams.append('groupId', params.groupId)
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

// Batch Job Types
export type BatchJobStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_responses'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'manual_review'

export type BatchItemStatus = 'pending' | 'received' | 'processing' | 'completed' | 'failed' | 'skipped'

export type ReviewDecision = 'approved' | 'rejected' | 'proceed_with_partial'

export interface BatchItem {
  _id: string
  batchJobId: string
  itemKey: string
  externalId?: string
  status: BatchItemStatus
  inputData?: Record<string, unknown>
  resultData?: Record<string, unknown>
  error?: string
  createdAt: string
  receivedAt?: string
  completedAt?: string
}

export interface BatchJob {
  _id: string
  name?: string
  type?: string
  status: BatchJobStatus
  expectedCount: number
  receivedCount: number
  processedCount: number
  failedCount: number
  minSuccessPercent: number
  workflowId?: string
  workflowStepId?: string
  taskId?: string
  callbackUrl?: string
  callbackSecret?: string
  inputPayload?: Record<string, unknown>
  aggregateResult?: Record<string, unknown>
  requiresManualReview: boolean
  reviewedById?: string
  reviewDecision?: ReviewDecision
  reviewNotes?: string
  createdAt: string
  completedAt?: string
  _resolved?: {
    workflow?: { _id: string; name: string }
    task?: { _id: string; title: string }
    reviewedBy?: { _id: string; displayName: string }
  }
}

export interface BatchJobWithItems extends BatchJob {
  items: BatchItem[]
}

// Batch Jobs API
export const batchJobsApi = {
  list: async (params?: {
    status?: BatchJobStatus | BatchJobStatus[]
    type?: string
    workflowId?: string
    taskId?: string
    requiresManualReview?: boolean
    taskStatus?: string
    taskType?: string
    assigneeId?: string
    page?: number
    limit?: number
  }): Promise<PaginatedResponse<BatchJob>> => {
    const searchParams = new URLSearchParams()
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      searchParams.append('status', statuses.join(','))
    }
    if (params?.type) searchParams.append('type', params.type)
    if (params?.workflowId) searchParams.append('workflowId', params.workflowId)
    if (params?.taskId) searchParams.append('taskId', params.taskId)
    if (params?.requiresManualReview !== undefined) {
      searchParams.append('requiresManualReview', String(params.requiresManualReview))
    }
    if (params?.taskStatus) searchParams.append('taskStatus', params.taskStatus)
    if (params?.taskType) searchParams.append('taskType', params.taskType)
    if (params?.assigneeId) searchParams.append('assigneeId', params.assigneeId)
    if (params?.page) searchParams.append('page', String(params.page))
    if (params?.limit) searchParams.append('limit', String(params.limit))
    const response = await authFetch(`${API_BASE}/batch-jobs?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string, includeItems = false): Promise<ApiResponse<BatchJob | BatchJobWithItems>> => {
    const params = includeItems ? '?includeItems=true' : ''
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}${params}`)
    return handleResponse(response)
  },

  create: async (data: {
    name?: string
    type?: string
    expectedCount: number
    minSuccessPercent?: number
    workflowId?: string
    workflowStepId?: string
    taskId?: string
    inputPayload?: Record<string, unknown>
    items?: Array<{ itemKey: string; inputData?: Record<string, unknown> }>
  }): Promise<ApiResponse<BatchJob & { callbackUrl: string; callbackSecretHint: string }>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  start: async (id: string): Promise<ApiResponse<BatchJob>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}/start`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  cancel: async (id: string): Promise<ApiResponse<BatchJob>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}/cancel`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  submitReview: async (
    id: string,
    decision: ReviewDecision,
    notes?: string
  ): Promise<ApiResponse<BatchJob>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes }),
    })
    return handleResponse(response)
  },

  requestReview: async (id: string, reason?: string): Promise<ApiResponse<BatchJob>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}/request-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    return handleResponse(response)
  },

  getAggregate: async (id: string): Promise<ApiResponse<{
    totalItems: number
    processedCount: number
    failedCount: number
    successPercent: number
    results: Record<string, unknown>[]
    aggregateResult?: Record<string, unknown>
  }>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/${id}/aggregate`)
    return handleResponse(response)
  },

  getStats: async (): Promise<ApiResponse<{ byStatus: Record<string, number> }>> => {
    const response = await authFetch(`${API_BASE}/batch-jobs/stats/summary`)
    return handleResponse(response)
  },
}

// API Keys Types
export interface ApiKey {
  _id: string
  name: string
  description?: string
  key?: string // Only present on creation/regeneration
  keyPrefix: string
  scopes: string[]
  userId?: string | null // User this key acts as (inherits their permissions)
  groupId?: string | null // Group this key is scoped to
  createdById?: string | null // User who created this key
  createdAt: string
  expiresAt?: string | null
  lastUsedAt?: string | null
  isActive: boolean
}

export interface ScopeDefinition {
  value: string
  label: string
  description: string
  category: string
}

// API Keys API
export const apiKeysApi = {
  list: async (): Promise<ApiResponse<ApiKey[]>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys`)
    return handleResponse(response)
  },

  create: async (data: { name: string; description?: string; scopes: string[]; userId?: string | null }): Promise<ApiResponse<ApiKey>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  regenerate: async (id: string): Promise<ApiResponse<ApiKey>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys/${id}/regenerate`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  update: async (
    id: string,
    data: { name?: string; description?: string; scopes?: string[]; expiresAt?: string | null; isActive?: boolean; userId?: string | null }
  ): Promise<ApiResponse<ApiKey>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  getScopes: async (): Promise<ApiResponse<ScopeDefinition[]>> => {
    const response = await authFetch(`${API_BASE}/auth/api-keys/scopes`)
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

  // Get all webhook deliveries across all webhooks
  getAllDeliveries: async (params?: {
    status?: 'pending' | 'success' | 'failed' | 'retrying'
    limit?: number
    offset?: number
  }): Promise<{ data: WebhookDelivery[]; pagination: { limit: number; offset: number; total: number } }> => {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.append('status', params.status)
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    const response = await authFetch(`${API_BASE}/webhooks/deliveries?${searchParams}`)
    return handleResponse(response)
  },
}

// Document Types
export type DocumentType = 'sop' | 'strategy' | 'plan' | 'template' | 'reference' | 'output' | 'custom' | 'workflow-prompt' | 'capability'
export type DocumentStatus = 'draft' | 'review' | 'approved' | 'archived'

// Capability document complexity - determines which agents can access
export type CapabilityComplexity = 1 | 2 | 3

export interface Document {
  _id: string
  title: string
  content: string
  summary?: string
  type: DocumentType
  status: DocumentStatus
  tags?: string[]
  createdById: string | null
  lastModifiedById?: string | null
  parentDocumentId?: string | null
  relatedTaskIds?: string[]
  workflowRunId?: string | null
  version: number
  metadata?: Record<string, unknown>
  // Capability document fields (only for type='capability')
  capabilityId?: string
  capabilityComplexity?: CapabilityComplexity
  createdAt: string
  updatedAt: string
  _resolved?: {
    createdBy?: { _id: string; displayName: string }
    lastModifiedBy?: { _id: string; displayName: string }
    parentDocument?: { _id: string; title: string }
  }
}

export interface DocumentVersion {
  _id: string
  documentId: string
  version: number
  title: string
  content: string
  summary?: string
  changeDescription?: string
  modifiedById: string
  modifiedByName?: string
  modifiedAt: string
}

export interface DocumentSearchQuery {
  prompt: string
  type?: DocumentType[]
  status?: DocumentStatus[]
  tags?: string[]
  limit?: number
  minScore?: number
}

export interface DocumentSearchResult {
  document: Document
  score: number
  highlights?: string[]
}

// Documents API
export const documentsApi = {
  list: async (params?: {
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    search?: string
    type?: DocumentType | DocumentType[]
    status?: DocumentStatus | DocumentStatus[]
    tags?: string[]
    includeArchived?: boolean
    createdById?: string
    workflowRunId?: string
    parentDocumentId?: string | null
    resolveReferences?: boolean
    groupId?: string
    projectId?: string
  }): Promise<PaginatedResponse<Document>> => {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.append('page', String(params.page))
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.sortBy) searchParams.append('sortBy', params.sortBy)
    if (params?.sortOrder) searchParams.append('sortOrder', params.sortOrder)
    if (params?.search) searchParams.append('search', params.search)
    if (params?.type) {
      const types = Array.isArray(params.type) ? params.type : [params.type]
      types.forEach(t => searchParams.append('type', t))
    }
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      statuses.forEach(s => searchParams.append('status', s))
    }
    if (params?.tags) {
      params.tags.forEach(t => searchParams.append('tags', t))
    }
    if (params?.includeArchived) searchParams.append('includeArchived', 'true')
    if (params?.createdById) searchParams.append('createdById', params.createdById)
    if (params?.workflowRunId) searchParams.append('workflowRunId', params.workflowRunId)
    if (params?.parentDocumentId !== undefined) {
      searchParams.append('parentDocumentId', params.parentDocumentId || '__root__')
    }
    if (params?.resolveReferences) searchParams.append('resolveReferences', 'true')
    if (params?.groupId) searchParams.append('groupId', params.groupId)
    if (params?.projectId) searchParams.append('projectId', params.projectId)
    const response = await authFetch(`${API_BASE}/documents?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string, resolveReferences = false): Promise<ApiResponse<Document>> => {
    const params = resolveReferences ? '?resolveReferences=true' : ''
    const response = await authFetch(`${API_BASE}/documents/${id}${params}`)
    return handleResponse(response)
  },

  create: async (data: {
    title: string
    content: string
    summary?: string
    type?: DocumentType
    status?: DocumentStatus
    tags?: string[]
    parentDocumentId?: string | null
    workflowRunId?: string | null
    metadata?: Record<string, unknown>
    groupId?: string
    projectId?: string
  }): Promise<ApiResponse<Document>> => {
    const response = await authFetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: {
    title?: string
    content?: string
    summary?: string
    type?: DocumentType
    status?: DocumentStatus
    tags?: string[]
    parentDocumentId?: string | null
    metadata?: Record<string, unknown>
    changeDescription?: string
  }): Promise<ApiResponse<Document>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string, permanent = false): Promise<ApiResponse<void>> => {
    const params = permanent ? '?permanent=true' : ''
    const response = await authFetch(`${API_BASE}/documents/${id}${params}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  // Version management
  getVersions: async (id: string): Promise<ApiResponse<DocumentVersion[]>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/versions`)
    return handleResponse(response)
  },

  getVersion: async (id: string, version: number): Promise<ApiResponse<DocumentVersion>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/versions/${version}`)
    return handleResponse(response)
  },

  restoreVersion: async (id: string, version: number): Promise<ApiResponse<Document>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/restore/${version}`, {
      method: 'POST',
    })
    return handleResponse(response)
  },

  diffVersions: async (id: string, fromVersion: number, toVersion: number): Promise<ApiResponse<{
    from: DocumentVersion
    to: DocumentVersion
  }>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromVersion, toVersion }),
    })
    return handleResponse(response)
  },

  // Task linking
  linkTask: async (id: string, taskId: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/link-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    return handleResponse(response)
  },

  unlinkTask: async (id: string, taskId: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/documents/${id}/link-task/${taskId}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  // Semantic search
  search: async (query: DocumentSearchQuery): Promise<ApiResponse<DocumentSearchResult[]>> => {
    const response = await authFetch(`${API_BASE}/documents/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    })
    return handleResponse(response)
  },

  // Workflow prompts - convenience method
  listWorkflowPrompts: async (params?: {
    status?: DocumentStatus | DocumentStatus[]
    search?: string
  }): Promise<PaginatedResponse<Document>> => {
    return documentsApi.list({
      type: 'workflow-prompt',
      status: params?.status,
      search: params?.search,
      sortBy: 'title',
      sortOrder: 'asc',
    })
  },
}

// Variable Types (simplified model)
export interface VariableRecord {
  _id: string
  name: string
  displayName?: string
  description?: string
  value: string              // Raw value or JSON string (redacted if encrypted)
  encrypted: boolean         // If true, value is encrypted at rest
  createdById?: string | null
  updatedById?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Path/value info for nested object keys
export interface KeyValuePath {
  path: string               // e.g., "user.profile.name"
  value: unknown             // The actual value
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
}

// Token browser format for variables
export interface VariableToken {
  variableId: string
  name: string
  description?: string
  encrypted: boolean
  isObject: boolean          // True if value is a JSON/YAML object
  value?: string | null      // For simple (non-object) values
  paths: KeyValuePath[]      // All paths with values for objects
}

// Legacy aliases for backwards compatibility
export type VariablePackage = VariableRecord
export type Variable = VariableRecord
export type PackageToken = VariableToken

// Variables API (simplified)
export const variablePackagesApi = {
  list: async (params?: { includeInactive?: boolean; search?: string }): Promise<ApiResponse<Variable[]>> => {
    const searchParams = new URLSearchParams()
    if (params?.includeInactive) searchParams.append('includeInactive', 'true')
    if (params?.search) searchParams.append('search', params.search)
    const queryString = searchParams.toString()
    const response = await authFetch(`${API_BASE}/variable-packages${queryString ? `?${queryString}` : ''}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<Variable>> => {
    const response = await authFetch(`${API_BASE}/variable-packages/${id}`)
    return handleResponse(response)
  },

  create: async (data: {
    name: string
    displayName?: string
    description?: string
    value: string
    encrypted?: boolean
  }): Promise<ApiResponse<Variable>> => {
    const response = await authFetch(`${API_BASE}/variable-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  update: async (id: string, data: Partial<{
    name: string
    displayName: string
    description: string
    value: string
    encrypted: boolean
    isActive: boolean
  }>): Promise<ApiResponse<Variable>> => {
    const response = await authFetch(`${API_BASE}/variable-packages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/variable-packages/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },

  // Reveal decrypted value
  reveal: async (id: string): Promise<ApiResponse<{
    variableId: string
    variableName: string
    value: string
    encrypted: boolean
  }>> => {
    const response = await authFetch(`${API_BASE}/variable-packages/${id}/reveal`)
    return handleResponse(response)
  },

  // Token browser format
  getTokens: async (): Promise<ApiResponse<VariableToken[]>> => {
    const response = await authFetch(`${API_BASE}/variable-packages/tokens/list`)
    return handleResponse(response)
  },
}

// Conversation Records API
export interface ConversationMessage {
  type: 'system' | 'user' | 'assistant' | 'tool_use' | 'tool_result'
  timestamp: string
  content?: string | unknown
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
  toolResult?: unknown
  isError?: boolean
}

export interface ConversationUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalCostUsd: number
}

export interface PermissionDenial {
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown>
}

export interface ConversationRecord {
  _id: string
  taskId: string
  sessionId: string
  jobName?: string
  model?: string
  execCommand?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  exitCode?: number
  messages?: ConversationMessage[]
  result?: string
  parsedResult?: Record<string, unknown>
  usage?: ConversationUsage
  permissionDenials?: PermissionDenial[]
  error?: string
  stderr?: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  durationApiMs?: number
  numTurns?: number
}

export interface ConversationStats {
  summary: {
    totalConversations: number
    completedCount: number
    failedCount: number
    totalCostUsd: number
    totalInputTokens: number
    totalOutputTokens: number
    avgDurationMs: number
    avgTurns: number
    totalToolCalls: number
  }
  byJob: Array<{
    _id: string
    count: number
    totalCostUsd: number
    avgDurationMs: number
  }>
  byStatus: Array<{
    _id: string
    count: number
  }>
}

export const conversationRecordsApi = {
  list: async (params?: {
    taskId?: string
    sessionId?: string
    jobName?: string
    status?: string
    model?: string
    limit?: number
    offset?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }): Promise<{
    data: ConversationRecord[]
    pagination: { limit: number; offset: number; total: number }
  }> => {
    const searchParams = new URLSearchParams()
    if (params?.taskId) searchParams.append('taskId', params.taskId)
    if (params?.sessionId) searchParams.append('sessionId', params.sessionId)
    if (params?.jobName) searchParams.append('jobName', params.jobName)
    if (params?.status) searchParams.append('status', params.status)
    if (params?.model) searchParams.append('model', params.model)
    if (params?.limit) searchParams.append('limit', String(params.limit))
    if (params?.offset) searchParams.append('offset', String(params.offset))
    if (params?.sortBy) searchParams.append('sortBy', params.sortBy)
    if (params?.sortOrder) searchParams.append('sortOrder', params.sortOrder)
    const response = await authFetch(`${API_BASE}/conversation-records?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string): Promise<ApiResponse<ConversationRecord>> => {
    const response = await authFetch(`${API_BASE}/conversation-records/${id}`)
    return handleResponse(response)
  },

  getByTask: async (taskId: string): Promise<ApiResponse<ConversationRecord[]>> => {
    const response = await authFetch(`${API_BASE}/conversation-records/task/${taskId}`)
    return handleResponse(response)
  },

  getStats: async (params?: {
    jobName?: string
    since?: string
  }): Promise<ApiResponse<ConversationStats>> => {
    const searchParams = new URLSearchParams()
    if (params?.jobName) searchParams.append('jobName', params.jobName)
    if (params?.since) searchParams.append('since', params.since)
    const response = await authFetch(`${API_BASE}/conversation-records/stats/summary?${searchParams}`)
    return handleResponse(response)
  },

  delete: async (id: string): Promise<ApiResponse<void>> => {
    const response = await authFetch(`${API_BASE}/conversation-records/${id}`, {
      method: 'DELETE',
    })
    return handleResponse(response)
  },
}
