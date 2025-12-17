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

// Types
export type TaskType =
  | 'flow'
  | 'trigger'
  | 'agent'
  | 'manual'
  | 'decision'
  | 'foreach'
  | 'join'
  | 'subflow'
  | 'external'
  | 'webhook'

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface WebhookAttempt {
  attemptNumber: number
  startedAt: string
  completedAt?: string
  status: 'pending' | 'success' | 'failed'
  httpStatus?: number
  responseBody?: unknown
  errorMessage?: string
  durationMs?: number
}

export interface WebhookConfig {
  url: string
  method: WebhookMethod
  headers?: Record<string, string>
  body?: string
  maxRetries?: number
  retryDelayMs?: number
  timeoutMs?: number
  successStatusCodes?: number[]
  attempts?: WebhookAttempt[]
  lastAttemptAt?: string
  nextRetryAt?: string
}

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
  taskType?: TaskType
  webhookConfig?: WebhookConfig
  batchCounters?: {
    expectedCount?: number
    completedCount?: number
    failedCount?: number
  }
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

// Workflow Run Types
export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowRun {
  _id: string
  workflowId: string
  status: WorkflowRunStatus
  rootTaskId?: string | null
  inputPayload?: Record<string, unknown>
  outputPayload?: Record<string, unknown>
  currentStepIds: string[]
  completedStepIds: string[]
  failedStepId?: string | null
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
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
    status?: WorkflowRunStatus | WorkflowRunStatus[]
    page?: number
    limit?: number
  }): Promise<PaginatedResponse<WorkflowRun>> => {
    const searchParams = new URLSearchParams()
    if (params?.workflowId) searchParams.append('workflowId', params.workflowId)
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      searchParams.append('status', statuses.join(','))
    }
    if (params?.page) searchParams.append('page', String(params.page))
    if (params?.limit) searchParams.append('limit', String(params.limit))
    const response = await authFetch(`${API_BASE}/workflow-runs?${searchParams}`)
    return handleResponse(response)
  },

  get: async (id: string, includeTasks = false): Promise<ApiResponse<WorkflowRun | WorkflowRunWithTasks>> => {
    const params = includeTasks ? '?includeTasks=true' : ''
    const response = await authFetch(`${API_BASE}/workflow-runs/${id}${params}`)
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
