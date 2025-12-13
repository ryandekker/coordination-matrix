import { ObjectId } from 'mongodb';

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting'      // Waiting for child tasks (foreach, subflow)
  | 'on_hold'
  | 'completed'
  | 'failed'       // Execution failed (distinct from on_hold)
  | 'cancelled';

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  _id: ObjectId;
  title: string;
  summary?: string;
  extraPrompt?: string;
  additionalInfo?: string;
  status: TaskStatus;
  urgency?: Urgency;

  // Hierarchy - simplified to just parent reference
  parentId: ObjectId | null;

  // Workflow
  workflowId?: ObjectId | null;
  workflowStage?: string;

  // External tracking
  externalId?: string;
  externalHoldDate?: Date | null;

  // Assignment
  assigneeId?: ObjectId | null;
  createdById?: ObjectId | null;

  // Tags
  tags?: string[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  dueAt?: Date | null;
}

export interface TaskWithChildren extends Task {
  children?: TaskWithChildren[];
}

export interface TaskWithResolved extends Task {
  _resolved?: {
    assignee?: { _id: string; displayName: string };
    createdBy?: { _id: string; displayName: string };
    parent?: { _id: string; title: string };
    workflow?: { _id: string; name: string };
    status?: LookupValue;
    urgency?: LookupValue;
  };
}

// ============================================================================
// Field Configuration Types
// ============================================================================

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'reference'
  | 'datetime'
  | 'date'
  | 'tags'
  | 'json';

export type RenderAs = 'text' | 'badge' | 'link' | 'avatar' | 'progress' | 'custom';

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  required?: boolean;
}

export interface FieldConfig {
  _id: ObjectId;
  collectionName: string;
  fieldPath: string;
  displayName: string;
  fieldType: FieldType;
  isRequired: boolean;
  isEditable: boolean;
  isSearchable: boolean;
  isSortable: boolean;
  isFilterable: boolean;
  displayOrder: number;
  width?: number;
  minWidth?: number;

  // For select/multiselect fields
  lookupType?: string;
  options?: Array<{ value: string; label: string }>;

  // For reference fields
  referenceCollection?: string;
  referenceDisplayField?: string;

  // Default values
  defaultValue?: unknown;
  defaultVisible: boolean;

  // Rendering
  renderAs?: RenderAs;

  // Validation
  validation?: FieldValidation;
}

// ============================================================================
// Lookup Types
// ============================================================================

export interface LookupValue {
  _id: ObjectId;
  type: string;
  code: string;
  displayName: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// View Types
// ============================================================================

export interface ViewSorting {
  field: string;
  direction: 'asc' | 'desc';
}

export interface View {
  _id: ObjectId;
  name: string;
  collectionName: string;
  isDefault: boolean;
  isSystem: boolean;
  filters: Record<string, unknown>;
  sorting: ViewSorting[];
  visibleColumns: string[];
  columnWidths?: Record<string, number>;
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// User Preference Types
// ============================================================================

export interface UserPreference {
  _id: ObjectId;
  userId: ObjectId;
  viewId: ObjectId;
  visibleColumns?: string[];
  columnWidths?: Record<string, number>;
  columnOrder?: string[];
}

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'admin' | 'operator' | 'reviewer' | 'viewer';

export interface User {
  _id: ObjectId;
  email?: string;                 // Optional for agent users
  displayName: string;
  role: UserRole;
  isActive: boolean;
  isAgent?: boolean;              // Is this user an AI agent?
  agentPrompt?: string;           // Agent's base prompt/persona
  teamIds?: ObjectId[];
  preferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// Team Types
// ============================================================================

export interface Team {
  _id: ObjectId;
  name: string;
  description?: string;
  memberIds: ObjectId[];
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// External Job Types
// ============================================================================

export type ExternalJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ExternalJob {
  _id: ObjectId;
  taskId: ObjectId;
  type: string;
  status: ExternalJobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  scheduledFor?: Date | null;
}

// ============================================================================
// API Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface QueryParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, unknown>;
  includeChildren?: boolean;
  resolveReferences?: boolean;
}

// ============================================================================
// Event System Types
// ============================================================================

export type TaskEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status.changed'
  | 'task.assignee.changed'
  | 'task.priority.changed'
  | 'task.moved'
  | 'task.comment.added';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface TaskEvent {
  id: string;
  type: TaskEventType;
  taskId: ObjectId;
  task: Task;
  changes?: FieldChange[];
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export type EventHandler = (event: TaskEvent) => void | Promise<void>;

// ============================================================================
// Activity Log Types
// ============================================================================

export interface ActivityLogEntry {
  _id: ObjectId;
  taskId: ObjectId;
  eventType: TaskEventType;
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  changes?: FieldChange[];
  comment?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Webhook Types
// ============================================================================

export type WebhookTrigger =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status.changed'
  | 'task.assignee.changed'
  | 'task.priority.changed'
  | 'task.entered_filter';

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

export interface Webhook {
  _id: ObjectId;
  name: string;
  url: string;
  secret: string;
  triggers: WebhookTrigger[];
  savedSearchId?: ObjectId | null;
  filterQuery?: string;
  isActive: boolean;
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  _id: ObjectId;
  webhookId: ObjectId;
  eventId: string;
  eventType: TaskEventType;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date | null;
  createdAt: Date;
  completedAt?: Date | null;
}

// ============================================================================
// Automation Daemon Types
// ============================================================================

export interface DaemonTrigger {
  event: TaskEventType;
  filter?: string;
}

export interface DaemonAction {
  command: string;
  update_fields?: Record<string, string>;
  timeout?: number;
}

export interface DaemonRule {
  name: string;
  trigger: DaemonTrigger;
  action: DaemonAction;
  enabled?: boolean;
}

export interface DaemonConfig {
  concurrency: number;
  rules: DaemonRule[];
}

export interface DaemonExecution {
  _id: ObjectId;
  ruleName: string;
  taskId: ObjectId;
  eventId: string;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  updatedFields?: Record<string, unknown>;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}
