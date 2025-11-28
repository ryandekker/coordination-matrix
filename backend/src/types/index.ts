import { ObjectId } from 'mongodb';

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting_review'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export type HITLPhase =
  | 'none'
  | 'pre_execution'
  | 'during_execution'
  | 'post_execution'
  | 'on_error'
  | 'approval_required';

export type HITLStatus =
  | 'not_required'
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'escalated';

export interface Task {
  _id: ObjectId;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: Priority;

  // Hierarchy
  parentId: ObjectId | null;
  rootId: ObjectId | null;
  depth: number;
  path: ObjectId[];
  childCount: number;

  // HITL
  hitlRequired: boolean;
  hitlPhase: HITLPhase;
  hitlStatus: HITLStatus;
  hitlAssigneeId?: ObjectId | null;
  hitlNotes?: string;

  // Workflow
  workflowId?: ObjectId | null;
  workflowStepIndex?: number;

  // External job tracking
  externalJobId?: string;
  externalJobStatus?: string;
  externalJobResult?: Record<string, unknown>;

  // Assignment
  assigneeId?: ObjectId | null;
  createdById?: ObjectId | null;
  teamId?: ObjectId | null;

  // Metadata
  metadata?: Record<string, unknown>;
  tags?: string[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  dueAt?: Date | null;
}

export interface TaskWithChildren extends Task {
  children?: TaskWithChildren[];
}

export interface TaskWithResolved extends Task {
  _resolved?: {
    assignee?: { displayName: string };
    createdBy?: { displayName: string };
    hitlAssignee?: { displayName: string };
    team?: { name: string };
    status?: LookupValue;
    priority?: LookupValue;
    hitlPhase?: LookupValue;
    hitlStatus?: LookupValue;
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
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
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
