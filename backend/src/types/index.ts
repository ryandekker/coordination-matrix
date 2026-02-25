import { ObjectId } from 'mongodb';

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting'      // Waiting for child tasks (foreach, flow)
  | 'on_hold'
  | 'completed'
  | 'failed'       // Execution failed (distinct from on_hold)
  | 'cancelled'
  | 'archived';    // Soft-deleted / hidden from default views

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

// Task types that map 1:1 to workflow step types
export type TaskType =
  | 'flow'          // Workflow parent task (root task of a workflow run)
  | 'trigger'       // Entry point / trigger step
  | 'agent'         // Automated/AI execution (default)
  | 'manual'        // Human execution
  | 'decision'      // Conditional branching
  | 'foreach'       // Fan-out iteration (spawns subtasks)
  | 'join'          // Fan-in synchronization (awaits boundary conditions)
  | 'flow'          // Nested workflow
  | 'external'      // Outbound HTTP call with callback
  | 'webhook'       // Outbound HTTP call (fire-and-forget)
  | 'findDocument'  // Search for a document using semantic search
  | 'code';         // Execute JavaScript code in sandboxed environment

// How the task gets executed
export type ExecutionMode =
  | 'immediate'           // Runs immediately (trigger, decision, foreach, join)
  | 'automated'           // System/AI executes
  | 'manual'              // Human executes
  | 'external_callback';  // Waits for external callback

// Foreach task configuration
export interface ForeachConfig {
  itemsSource: 'payload' | 'external_callback' | 'previous_step';
  itemsPath?: string;           // JSONPath to items array
  maxItems?: number;            // Safety limit
  batchSize?: number;           // For chunked processing
  minSuccessPercent?: number;   // Required success rate (default: 100)
  deadlineAt?: Date;            // Timeout for receiving all items
}

// Join boundary conditions - defines when the join step fires
export interface JoinBoundary {
  minCount?: number;           // Minimum tasks that must complete
  minPercent?: number;         // Minimum percentage of expected that must complete (default: 100)
  maxWaitMs?: number;          // Maximum time to wait before firing (soft deadline)
  failOnTimeout?: boolean;     // If true, fail when maxWait exceeded; if false, continue with partial results
}

// Join task configuration
export interface JoinConfig {
  // Reference to what we're joining on
  awaitStepId?: string;         // Step ID whose tasks we're waiting for (can reference earlier steps)
  awaitTaskId?: ObjectId;       // Runtime-resolved task ID whose descendants we're waiting for
  scope: 'children' | 'descendants' | 'step_tasks';  // step_tasks: all tasks from awaitStepId

  // Boundary conditions for when the join fires
  boundary?: JoinBoundary;

  // Data extraction
  inputPath?: string;           // JSONPath to extract specific data from child task metadata

  // Legacy fields (maintained for backward compatibility)
  minSuccessPercent?: number;   // Use boundary.minPercent instead
  expectedCountPath?: string;   // JSONPath to get expected count from previous step output
  expectedCount?: number;       // Static expected count (if not from previous step)
  deadlineAt?: Date;            // Use boundary.maxWaitMs instead
}

// External task configuration
export interface ExternalConfig {
  callbackSecret?: string;
  expectedCallbacks?: number;
  timeoutAt?: Date;
}

// HTTP method for webhook calls
export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Webhook execution attempt record
export interface WebhookAttempt {
  attemptNumber: number;
  startedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'success' | 'failed';
  // Request details (resolved from templates)
  requestUrl?: string;
  requestMethod?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  // Response details
  httpStatus?: number;
  responseBody?: unknown;
  errorMessage?: string;
  durationMs?: number;
}

// Webhook task configuration
export interface WebhookConfig {
  // Request configuration
  url: string;                          // The endpoint URL (can contain template variables)
  method: WebhookMethod;                // HTTP method
  headers?: Record<string, string>;     // Custom headers (can contain template variables)
  body?: string;                        // Request body template (JSON string with template variables)

  // Retry configuration
  maxRetries?: number;                  // Max retry attempts (default: 3)
  retryDelayMs?: number;                // Delay between retries (default: 1000, exponential backoff)
  timeoutMs?: number;                   // Request timeout (default: 30000)

  // Success criteria
  successStatusCodes?: number[];        // HTTP status codes considered success (default: [200-299])

  // Execution tracking
  attempts?: WebhookAttempt[];          // History of execution attempts
  lastAttemptAt?: Date;                 // When the last attempt was made
  nextRetryAt?: Date;                   // Scheduled time for next retry (if pending)

  // Workflow management flag - if true, webhook is executed by WorkflowExecutionService
  // and WebhookTaskService should not also execute it
  workflowManaged?: boolean;
}

// Counters for foreach/batch tasks
export interface BatchCounters {
  expectedCount: number;
  receivedCount: number;
  processedCount: number;
  failedCount: number;
}

// Flow (subflow) execution attempt record - similar to WebhookAttempt
export interface FlowAttempt {
  attemptNumber: number;
  startedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'running' | 'success' | 'failed';
  // Input details
  inputPayload?: Record<string, unknown>;
  resolvedInputMapping?: Record<string, string>;
  // Spawned workflow details
  spawnedWorkflowRunId?: string;
  targetWorkflowId?: string;
  targetWorkflowName?: string;
  // Result details
  outputPayload?: Record<string, unknown>;
  errorMessage?: string;
  durationMs?: number;
}

// Flow task configuration (nested workflow execution)
export interface FlowConfig {
  // Target workflow
  workflowId: string;                   // The workflow to execute
  inputMapping?: Record<string, string>; // Template mapping for input payload

  // Execution tracking
  attempts?: FlowAttempt[];             // History of execution attempts
  lastAttemptAt?: Date;                 // When the last attempt was made
}

// ============================================================================
// Step Configuration - Original workflow step config stored on task
// ============================================================================

// Workflow step connection (for decision routing)
export interface StepConnection {
  targetStepId: string;
  condition?: string | null;
  label?: string;
}

// FindDocument step configuration
export interface FindDocumentConfig {
  mode?: 'static' | 'dynamic';
  documentId?: string;
  searchPrompt?: string;
  documentTypes?: string[];
  documentStatus?: string[];
  tags?: string[];
  limit?: number;
  minScore?: number;
  storeAs?: string;
  failIfNotFound?: boolean;
}

// Available packages that can be injected into the code sandbox
// Organized by category for easier browsing
export type CodeSandboxPackage =
  // === HTTP & Networking ===
  | 'node-fetch'       // HTTP fetch API (as `fetch`)
  | 'axios'            // HTTP client
  | 'qs'               // Query string parsing

  // === Data Manipulation ===
  | 'lodash'           // Utility functions (as `_`)
  | 'ramda'            // Functional programming (as `R`)
  | 'immer'            // Immutable state (as `immer.produce`)
  | 'deepmerge'        // Deep object merging

  // === String & Text ===
  | 'validator'        // String validation
  | 'slugify'          // URL-safe strings
  | 'change-case'      // Case conversion (camelCase, snake_case, etc.)
  | 'marked'           // Markdown to HTML
  | 'sanitize-html'    // HTML sanitization

  // === Numbers & Math ===
  | 'bignumber.js'     // Arbitrary precision math (as `BigNumber`)
  | 'decimal.js'       // Decimal arithmetic (as `Decimal`)
  | 'mathjs'           // Math library (as `math`)
  | 'currency.js'      // Currency handling (as `currency`)

  // === Date & Time ===
  | 'date-fns'         // Date manipulation (as `dateFns`)
  | 'dayjs'            // Lightweight date library
  | 'luxon'            // Modern date library (as `luxon.DateTime`, etc.)
  | 'ms'               // Millisecond conversion

  // === JSON & Data Formats ===
  | 'jsonpath-plus'    // JSONPath querying (as `JSONPath`)
  | 'json5'            // Extended JSON (as `JSON5`)
  | 'yaml'             // YAML parsing (as `YAML`)
  | 'csv-parse'        // CSV parsing (as `csvParse`)
  | 'csv-stringify'    // CSV generation (as `csvStringify`)
  | 'papaparse'        // CSV parsing (as `Papa`)
  | 'fast-xml-parser'  // Fast XML parsing (as `XMLParser`)

  // === Validation & Schema ===
  | 'zod'              // Schema validation (as `z`)
  | 'yup'              // Schema validation
  | 'ajv'              // JSON Schema validation (as `Ajv`)

  // === UUID & IDs ===
  | 'uuid'             // UUID generation (as `uuid.v4()`, etc.)
  | 'nanoid'           // Tiny ID generator (as `nanoid.nanoid()`)
  | 'ulid'             // Sortable unique IDs
  | 'hashids'          // Obfuscated IDs (as `Hashids`)

  // === Crypto & Security ===
  | 'crypto-js'        // Crypto functions (as `CryptoJS`)
  | 'bcryptjs'         // Password hashing (as `bcrypt`)
  | 'jsonwebtoken'     // JWT handling (as `jwt`)
  | 'js-base64'        // Base64 utilities (as `Base64`)

  // === Async & Flow Control ===
  | 'p-limit'          // Limit concurrent promises (as `pLimit`)
  | 'p-map'            // Concurrent map (as `pMap`)
  | 'p-retry'          // Promise retry (as `pRetry`)
  | 'delay'            // Simple delay

  // === Templating ===
  | 'handlebars'       // Handlebars templates (as `Handlebars`)
  | 'mustache'         // Mustache templates (as `Mustache`)
  | 'ejs'              // EJS templates

  // === Comparison & Diff ===
  | 'fast-json-patch'  // JSON Patch (RFC 6902) (as `jsonPatch`)
  | 'diff'             // Text diff (as `Diff`)

  // === Encoding & Compression ===
  | 'pako'             // zlib compression
  | 'lz-string'        // LZ compression for strings (as `LZString`)

  // === Random & Fake Data ===
  | '@faker-js/faker'; // Fake data generation (as `faker`)

// Variable mapping for code steps - maps a variable name to a context path
export interface CodeVariableMapping {
  name: string;   // Variable name available in code (e.g., "apiUrl")
  path: string;   // Context path to resolve (e.g., "trigger._API_URL")
}

// Code step configuration - sandboxed JavaScript execution
export interface CodeStepConfig {
  // The code to execute (JavaScript/TypeScript)
  // Receives `input` variable with previous step output
  // Must return a value (becomes the step output)
  code: string;

  // Packages to inject into sandbox (subset of CodeSandboxPackage)
  // Each package is available under its standard name (e.g., _ for lodash)
  packages?: CodeSandboxPackage[];

  // Variable mappings - inject context values as named variables
  // e.g., { name: "apiUrl", path: "trigger._API_URL" } makes apiUrl available in code
  variables?: CodeVariableMapping[];

  // Execution limits
  timeout?: number;        // Max execution time in ms (default: 30000)
  memoryLimit?: number;    // Memory limit in MB (default: 128)

  // Output validation
  outputSchema?: object;   // JSON Schema to validate output against

  // Error handling
  continueOnError?: boolean;  // If true, step completes with error in output instead of failing
}

// ============================================================================
// Unified Step Input/Output Configuration
// ============================================================================

/**
 * Unified input configuration for workflow steps.
 * All step types use this same model to define where their input comes from.
 *
 * Input resolution flow:
 * 1. Determine source (previous step output, trigger payload, or specific step)
 * 2. If `mapping` is defined, resolve each template to build input object
 * 3. If `extractPath` is defined (and no mapping), extract that path from source
 * 4. Otherwise, pass entire source as input
 */
export interface StepInputConfig {
  /**
   * Where to get input data from:
   * - 'previous': Output from the immediately previous step (default)
   * - 'trigger': Initial workflow trigger payload
   * - '<stepId>': Output from a specific earlier step by ID
   */
  source: 'previous' | 'trigger' | string;

  /**
   * Field mapping using template expressions.
   * Each key becomes a field in the step input, value is a template expression.
   *
   * Examples:
   * - { "userId": "{{output.user.id}}" }
   * - { "items": "{{output.data.records}}", "count": "{{output.data.total}}" }
   * - { "item": "{{item}}", "index": "{{_index}}" } (inside foreach)
   *
   * When mapping is defined, the step receives an object with these fields.
   * If not defined, the step receives the entire source output.
   */
  mapping?: Record<string, string>;

  /**
   * Simple path extraction (alternative to full mapping).
   * Extracts a single path from the source and passes that as input.
   *
   * Examples:
   * - "output.data" - extracts just the data field
   * - "output.results[0]" - extracts first result
   *
   * Cannot be used together with `mapping`.
   */
  extractPath?: string;
}

/**
 * Standardized step output that gets passed to subsequent steps.
 * This is stored on the task after execution completes.
 */
export interface StepOutput {
  /**
   * Primary output data from step execution.
   * This is what gets passed to the next step's input.
   */
  data: unknown;

  /**
   * Human-readable summary of what the step produced.
   */
  summary?: string;

  /**
   * Timestamp when output was produced.
   */
  producedAt: Date;

  /**
   * Duration of step execution in milliseconds.
   */
  durationMs?: number;

  /**
   * For webhook/external steps: HTTP response details
   */
  httpResponse?: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };

  /**
   * For join steps: aggregated results from child tasks
   */
  aggregatedResults?: Array<{
    taskId: string;
    stepId?: string;
    data: unknown;
    status: 'success' | 'failed';
  }>;

  /**
   * For decision steps: which branch was selected
   */
  selectedBranch?: {
    targetStepId: string;
    condition?: string;
  };

  /**
   * For foreach steps: iteration metadata
   */
  foreachMeta?: {
    totalItems: number;
    itemsPath: string;
  };

  /**
   * For code steps: execution logs
   */
  logs?: string[];

  /**
   * For flow steps: nested workflow result
   */
  nestedWorkflow?: {
    runId: string;
    status: string;
    output?: unknown;
  };

  /**
   * For findDocument steps: found documents
   */
  documents?: Array<{
    id: string;
    title: string;
    type: string;
    score?: number;
  }>;
}

// Complete workflow step configuration stored on task for rerun/visibility
export interface TaskStepConfig {
  // Step identification
  stepId: string;
  stepType: string;
  stepName?: string;
  stepDescription?: string;

  // Agent/Manual step config
  additionalInstructions?: string;
  promptDocumentIds?: string[];
  titleTemplate?: string;
  defaultAssigneeId?: string;

  // External step config
  externalEndpoint?: string;
  externalMethod?: string;
  externalHeaders?: Record<string, string>;
  externalPayloadTemplate?: string;
  externalResponseMapping?: Record<string, string>;
  waitForCallback?: boolean;

  // Webhook step config
  webhookUrl?: string;
  webhookMethod?: string;
  webhookHeaders?: Record<string, string>;
  webhookBodyTemplate?: string;
  webhookMaxRetries?: number;
  webhookTimeoutMs?: number;
  webhookSuccessStatusCodes?: number[];

  // Foreach step config
  itemsPath?: string;
  itemVariable?: string;
  maxItems?: number;
  expectedCountPath?: string;

  // Join step config
  awaitStepId?: string;
  joinBoundary?: JoinBoundary;
  joinInputPath?: string;

  // Decision step config
  connections?: StepConnection[];
  defaultConnection?: string;
  decisionField?: string;

  // Flow step config (nested workflow)
  flowId?: string;
  inputMapping?: Record<string, string>;

  // FindDocument step config
  findDocumentConfig?: FindDocumentConfig;

  // Code step config
  codeConfig?: CodeStepConfig;

  // Unified input configuration (new model)
  inputConfig?: StepInputConfig;

  // Legacy input aggregation config (deprecated - use inputConfig)
  inputPath?: string;
  inputSource?: string;
}

// ============================================================================
// Task Result - Standardized output storage with history
// ============================================================================

export type TaskResultStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'running';

// A single execution result
export interface TaskResultEntry {
  id: string;                     // Unique ID for this result entry
  status: TaskResultStatus;
  output?: unknown;               // Primary output data
  summary?: string;               // Human-readable summary
  error?: string;                 // Error message if failed
  executedAt: Date;
  completedAt?: Date;
  durationMs?: number;

  // Webhook-specific result
  webhookResponse?: {
    httpStatus: number;
    body: unknown;
    headers?: Record<string, string>;
    durationMs: number;
  };

  // Join-specific result
  aggregatedResults?: unknown[];
  aggregationStats?: {
    expectedCount: number;
    successCount: number;
    failedCount: number;
    successPercent: number;
  };

  // Decision-specific result
  selectedPath?: string;
  evaluatedCondition?: string;

  // FindDocument-specific result
  documentResults?: {
    count: number;
    documents: Array<{
      id: string;
      title: string;
      score?: number;
    }>;
  };

  // Flow-specific result (nested workflow)
  spawnedWorkflow?: {
    runId: string;
    status: string;
    outputPayload?: unknown;
  };

  // Code step result
  codeExecution?: {
    logs: string[];
    executionTimeMs: number;
    packages: string[];
  };
}

// Task result with history (latest first)
export interface TaskResult {
  current: TaskResultEntry;           // Most recent result
  history?: TaskResultEntry[];        // Previous results (capped, e.g., last 10)
}

// ============================================================================
// Execution Summary - Programmatic rollup of what happened in a task/workflow
// ============================================================================

export type ExecutionOutcome = 'success' | 'partial' | 'failed' | 'escalated';

export interface ExecutionSummaryStep {
  stepName: string;
  stepType: string;
  outcome: 'success' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  durationMs?: number;
}

export interface ExecutionSummaryChildFlow {
  taskId: string;
  title: string;
  workflowName?: string;
  outcome: ExecutionOutcome;
  summary?: string;
  error?: string;
}

export interface ExecutionSummaryStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface ExecutionSummaryError {
  stepName: string;
  error: string;
  taskId: string;
}

export interface ExecutionSummary {
  outcome: ExecutionOutcome;
  completedAt: Date;
  durationMs?: number;

  trigger?: {
    source: string;
    inputSummary?: string;
  };

  steps?: ExecutionSummaryStep[];

  stats?: ExecutionSummaryStats;

  childFlowSummaries?: ExecutionSummaryChildFlow[];

  errorChain?: ExecutionSummaryError[];
}

export interface Task {
  _id: ObjectId;
  title: string;
  summary?: string;
  extraPrompt?: string;
  humanInstruction?: string;      // Original human request/goal — propagated unchanged to all child tasks
  status: TaskStatus;
  urgency?: Urgency;

  // Group and Project access control
  groupId?: ObjectId | null;       // Group this task belongs to (admin-only if null)
  projectId?: ObjectId | null;     // Project within the group (optional)

  // Hierarchy - simplified to just parent reference
  parentId: ObjectId | null;

  // Workflow definition reference
  workflowId?: ObjectId | null;
  workflowStage?: string;

  // Workflow execution context
  workflowRunId?: ObjectId | null;    // Which run this task belongs to
  workflowStepId?: string;            // Which step in the workflow

  // Task type and execution mode (for workflow tasks)
  taskType?: TaskType;
  executionMode?: ExecutionMode;

  // Expected quantity of subtasks/results this task will produce
  // Set by foreach tasks to indicate how many child tasks will be created
  // Used by join tasks to know when all expected results have arrived
  expectedQuantity?: number;

  // Foreach/batch configuration
  foreachConfig?: ForeachConfig;
  batchCounters?: BatchCounters;

  // Join configuration
  joinConfig?: JoinConfig;

  // External callback configuration
  externalConfig?: ExternalConfig;

  // Webhook task configuration (outbound HTTP calls)
  webhookConfig?: WebhookConfig;

  // Flow task configuration (nested workflow execution)
  flowConfig?: FlowConfig;

  // Decision result (which branch was taken)
  decisionResult?: string;

  // Task-to-workflow routing: workflow spawned FROM this task
  spawnedWorkflowRunId?: ObjectId | null;
  workflowResult?: {
    status: WorkflowRunStatus;
    outputPayload?: Record<string, unknown>;
    error?: string;
    completedAt?: Date;
  };

  // Trigger field: when set, system auto-starts this workflow with task as trigger
  triggerWorkflowId?: ObjectId | null;

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

  // Flexible metadata for task outputs and custom data
  metadata?: Record<string, unknown>;

  // Original workflow step configuration (for visibility and reruns)
  stepConfig?: TaskStepConfig;

  // Standardized task result with history
  taskResult?: TaskResult;

  // Unified step input/output (new model for workflow tasks)
  stepInput?: Record<string, unknown>;   // Resolved input data received by this step
  stepOutput?: StepOutput;               // Standardized output produced by this step

  // Programmatic rollup of execution outcome (built at completion time)
  executionSummary?: ExecutionSummary;

  // Manual review fields (for manual workflow steps)
  reviewDecision?: ManualReviewDecision;
  reviewComment?: string;
  reviewedAt?: Date;
  reviewedById?: ObjectId | null;
}

// Review decision for manual workflow steps
export type ManualReviewDecision = 'approved' | 'request_changes' | 'approved_with_notes';

// Summary of child task statuses for parent tasks
export interface ChildStatusSummary {
  total: number;
  pending: number;
  in_progress: number;
  waiting: number;
  on_hold: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface TaskWithChildren extends Task {
  children?: TaskWithChildren[];
  childCount?: number;
  childStatusSummary?: ChildStatusSummary;
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
  folderId?: ObjectId | null;
  // Group and Project scoping for views
  groupId?: ObjectId | null;       // View is scoped to this group
  projectId?: ObjectId | null;     // View is scoped to this project
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// View Folder Types
// ============================================================================

export interface ViewFolder {
  _id: ObjectId;
  name: string;
  collectionName: string;
  sortOrder: number;
  isExpanded: boolean;
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// Workflow Folder Types
// ============================================================================

export interface WorkflowFolder {
  _id: ObjectId;
  name: string;
  description?: string;
  sortOrder: number;
  isExpanded: boolean;
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt?: Date;
}

// Pastel color palette for workflows (softer than UI colors)
export const WORKFLOW_COLORS = [
  { name: 'Sky', value: '#BAE6FD' },      // pastel blue
  { name: 'Lavender', value: '#DDD6FE' }, // pastel purple
  { name: 'Rose', value: '#FECDD3' },     // pastel pink
  { name: 'Mint', value: '#A7F3D0' },     // pastel green
  { name: 'Peach', value: '#FED7AA' },    // pastel orange
  { name: 'Coral', value: '#FECACA' },    // pastel red
  { name: 'Lemon', value: '#FEF08A' },    // pastel yellow
  { name: 'Periwinkle', value: '#C7D2FE' }, // pastel indigo
  { name: 'Aqua', value: '#99F6E4' },     // pastel teal
  { name: 'Stone', value: '#D6D3D1' },    // pastel gray
] as const;

export type WorkflowColor = typeof WORKFLOW_COLORS[number]['value'];

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

// Agent complexity levels - determines which capability documents are available
// 1 = basic (haiku-class), 2 = intermediate (sonnet-class), 3 = advanced (opus-class)
export type AgentComplexity = 1 | 2 | 3;

export interface User {
  _id: ObjectId;
  email?: string;                 // Optional for agent users
  displayName: string;
  role: UserRole;
  isActive: boolean;
  isAgent?: boolean;              // Is this user an AI agent?
  isSystem?: boolean;             // Is this the system user? (for automated workflow tasks)
  agentPrompt?: string;           // Agent's base prompt/persona
  agentComplexity?: AgentComplexity; // Agent's capability level (1=basic, 2=intermediate, 3=advanced)
  profilePicture?: string;        // URL to profile picture (for humans)
  botColor?: string;              // Custom color for bot users (hex code)
  defaultGroupId?: ObjectId;      // User's preferred/default group
  preferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// Group Types (Access Control)
// ============================================================================

export type GroupRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface GroupMember {
  userId: ObjectId;
  role: GroupRole;
  addedAt: Date;
  addedById: ObjectId | null;
}

export interface Group {
  _id: ObjectId;
  name: string;              // Unique slug (lowercase, no spaces)
  displayName: string;       // Human-readable name
  description?: string;
  members: GroupMember[];
  visibility: 'private' | 'internal';  // 'internal' = visible to all authenticated users
  createdById: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

// Group role hierarchy for permission checks
export const GROUP_ROLE_HIERARCHY: Record<GroupRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

// ============================================================================
// Project Types (Organizational)
// ============================================================================

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  _id: ObjectId;
  name: string;              // Unique per group (lowercase, no spaces)
  displayName: string;       // Human-readable name
  description?: string;
  groupId: ObjectId;         // Required - projects belong to a group
  status: ProjectStatus;
  color?: string;            // Hex color for UI display
  createdById: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
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
  | 'task.metadata.changed'
  | 'task.moved'
  | 'task.comment.added';

export type DocumentEventType =
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'document.status.changed'
  | 'document.version.created'
  | 'document.restored'
  | 'document.linked'
  | 'document.unlinked';

export type ActivityEventType = TaskEventType | DocumentEventType;

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
  taskId?: ObjectId | null;
  documentId?: ObjectId | null;
  eventType: ActivityEventType;
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  changes?: FieldChange[];
  comment?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  // Populated user info (not stored in DB, resolved at query time)
  actor?: {
    displayName: string;
    email?: string;
  } | null;
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

// ============================================================================
// Workflow Execution Types
// ============================================================================

export type WorkflowRunStatus =
  | 'pending'     // Created but not started
  | 'running'     // Currently executing
  | 'paused'      // Paused (manual intervention needed)
  | 'completed'   // Successfully completed
  | 'failed'      // Failed with error
  | 'cancelled';  // Manually cancelled

// Workflow step types - maps 1:1 to TaskType
export type WorkflowStepType =
  | 'trigger'       // Entry point / workflow start
  | 'agent'         // Automated/AI execution
  | 'manual'        // Human execution
  | 'external'      // Wait for external callback
  | 'webhook'       // Outbound HTTP call
  | 'decision'      // Conditional branching
  | 'foreach'       // Fan-out iteration (spawns subtasks)
  | 'join'          // Fan-in synchronization (awaits boundary conditions)
  | 'flow'          // Nested workflow
  | 'findDocument'  // Search for a document using semantic search
  | 'code';         // Execute JavaScript code in sandboxed environment

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  stepType: WorkflowStepType;

  // Dynamic title template - supports {{input.field}}, {{output.field}}, {{_item}}, etc.
  titleTemplate?: string;
  connections?: Array<{
    targetStepId: string;
    condition?: string | null;
    label?: string;
  }>;

  // Agent/manual step config
  additionalInstructions?: string;
  defaultAssigneeId?: string;
  promptDocumentIds?: string[];  // IDs of workflow-prompt documents to prepend

  // External step config - supports both async callback and fire-and-forget modes
  externalConfig?: {
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    payloadTemplate?: string;
    responseMapping?: Record<string, string>;
    // When false, operates in fire-and-forget mode (like webhook)
    // When true (default), waits for external system to call back
    waitForCallback?: boolean;
    // HTTP status codes that indicate success (for fire-and-forget mode)
    successStatusCodes?: number[];
  };

  // Webhook step config (outbound HTTP call)
  webhookConfig?: {
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    bodyTemplate?: string;
    maxRetries?: number;
    timeoutMs?: number;
    successStatusCodes?: number[];
  };

  // Decision step config
  defaultConnection?: string;
  decisionField?: string;                // Field path to evaluate (e.g., "output.route") - conditions then just specify values

  // Foreach step config
  itemsPath?: string;                   // JSONPath to items array in previous output
  itemVariable?: string;                // Template variable name for each item
  maxItems?: number;                    // Safety limit (default: 100)
  expectedCountPath?: string;           // JSONPath to get expected count from input (alternative to items.length)

  // Join step config - explicit reference to which step's tasks to await
  awaitStepId?: string;                 // Step ID whose tasks we're waiting for (can reference earlier steps)
  joinBoundary?: JoinBoundary;          // Boundary conditions for when the join fires
  minSuccessPercent?: number;           // Legacy: percentage of tasks that must succeed (default: 100)

  // Flow step config (nested workflow)
  flowId?: string;
  inputMapping?: Record<string, string>;

  // Unified input configuration (new model - use this instead of inputPath/inputMapping)
  inputConfig?: StepInputConfig;

  // Legacy: Input aggregation (deprecated - use inputConfig)
  inputPath?: string;                   // JSONPath to extract input from previous steps

  // FindDocument step config - semantic search for documents or static document reference
  findDocumentConfig?: {
    // Mode selection: 'static' = specific document, 'dynamic' = runtime search (default)
    mode?: 'static' | 'dynamic';

    // Static mode: reference a specific document by ID
    documentId?: string;                // ObjectId of the document to fetch

    // Dynamic mode: search at runtime
    searchPrompt?: string;              // Template for search prompt (e.g., "Find SOPs about {{input.topic}}")
    documentTypes?: DocumentType[];     // Filter by document types
    documentStatus?: DocumentStatus[];  // Filter by status (default: ['approved'])
    tags?: string[];                    // Filter by tags
    limit?: number;                     // Max results (default: 1)
    minScore?: number;                  // Minimum similarity score (default: 0.5)

    // Shared options
    storeAs?: string;                   // Variable name to store result (default: 'document')
    failIfNotFound?: boolean;           // Fail the step if no document found (default: false)
  };

  // Code step config - sandboxed JavaScript execution
  codeConfig?: CodeStepConfig;
}

export interface Workflow {
  _id: ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  steps: WorkflowStep[];
  mermaidDiagram?: string;

  // Dynamic title template for the root task - supports {{input.field}} variables
  rootTaskTitleTemplate?: string;

  // Group and Project access control - workflows belong to a group and optionally a project
  groupId?: ObjectId | null;     // Group this workflow belongs to (admin-only if null)
  projectId?: ObjectId | null;   // Project within the group (optional)

  // Organization and display
  folderId?: ObjectId | null;  // Reference to workflow folder
  color?: string;              // Pastel hex color (e.g., "#BAE6FD")

  createdAt: Date;
  updatedAt: Date;
  createdById?: ObjectId | null;
}

// Step-level execution log entry for workflow run tracing
export interface WorkflowRunStepLog {
  stepId: string;
  stepName: string;
  stepType: string;
  taskId?: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export interface WorkflowRun {
  _id: ObjectId;
  workflowId: ObjectId;
  workflowVersion?: number;

  // Group and Project access control - inherited from workflow
  groupId?: ObjectId | null;
  projectId?: ObjectId | null;

  // Execution status
  status: WorkflowRunStatus;

  // Task tracking
  rootTaskId?: ObjectId | null;
  currentStepIds: string[];
  completedStepIds: string[];

  // Task-to-workflow routing: the task that triggered/spawned this workflow
  triggerTaskId?: ObjectId | null;
  triggerContext?: Record<string, unknown>;

  // Input/Output
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;

  // Original human request/goal — propagated to all tasks in this run
  humanInstruction?: string;

  // Task defaults - applied to all tasks created in this run
  taskDefaults?: {
    assigneeId?: ObjectId;
    urgency?: Urgency;
    tags?: string[];
    dueOffsetHours?: number;
  };

  // Execution options
  executionOptions?: {
    pauseAtSteps?: string[];
    skipSteps?: string[];
    dryRun?: boolean;
  };

  // External correlation
  externalId?: string;
  source?: string;

  // Error handling
  error?: string;
  failedStepId?: string;

  // Execution trace - step-by-step log of what happened during the run
  stepLog?: WorkflowRunStepLog[];

  // Pause handling (for escalations)
  pausedStepId?: string;
  pausedAt?: Date | null;

  // Rerun tracking - links between superseded and superseding runs
  supersededBy?: ObjectId | null;  // This run was replaced by another run
  supersededAt?: Date | null;      // When this run was superseded
  supersedes?: ObjectId | null;    // This run replaces another run

  // Callback configuration
  callbackSecret?: string;

  // Ownership
  createdById?: ObjectId | null;

  // Timestamps
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

// Workflow run event types
export type WorkflowRunEventType =
  | 'workflow.run.created'
  | 'workflow.run.started'
  | 'workflow.run.step.started'
  | 'workflow.run.step.completed'
  | 'workflow.run.step.failed'
  | 'workflow.run.step.escalated'
  | 'workflow.run.completed'
  | 'workflow.run.failed'
  | 'workflow.run.paused'
  | 'workflow.run.cancelled';

export interface WorkflowRunEvent {
  id: string;
  type: WorkflowRunEventType;
  workflowRunId: ObjectId;
  workflowRun: WorkflowRun;
  stepId?: string;
  taskId?: ObjectId;
  error?: string;
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Input for starting a workflow run
// Task defaults that apply to all tasks created in a workflow run
export interface WorkflowTaskDefaults {
  assigneeId?: ObjectId | string;   // Default assignee for tasks
  urgency?: Urgency;                 // Default priority level
  tags?: string[];                   // Tags to apply to all tasks
  dueOffsetHours?: number;           // Hours from task creation for due date
}

// Execution options for workflow runs
export interface WorkflowExecutionOptions {
  pauseAtSteps?: string[];           // Step IDs to pause before executing
  skipSteps?: string[];              // Step IDs to bypass entirely
  dryRun?: boolean;                  // Simulate without creating real tasks
}

export interface StartWorkflowInput {
  workflowId: string;

  // Input data that flows through the workflow
  inputPayload?: Record<string, unknown>;

  // Original human request/goal — propagated to all tasks in this run
  humanInstruction?: string;

  // Defaults applied to all tasks created in this run
  taskDefaults?: WorkflowTaskDefaults;

  // Execution control options
  executionOptions?: WorkflowExecutionOptions;

  // External correlation
  externalId?: string;               // ID from external system for correlation
  source?: string;                   // Where this run was triggered from

  // Task-to-workflow routing: link back to the task that spawned this workflow
  triggerTaskId?: string;            // Task that triggered this workflow (for routing patterns)
  triggerContext?: Record<string, unknown>;  // Context passed from the trigger task
}

// ============================================================================
// Batch Job Types (Fan-out/Fan-in Workflow Coordination)
// ============================================================================

export type BatchJobStatus =
  | 'pending'           // Created but not started
  | 'processing'        // Initial request sent to external service
  | 'awaiting_responses' // Waiting for callbacks
  | 'completed'         // All items processed successfully
  | 'completed_with_warnings' // Completed but below threshold or with failures
  | 'failed'            // Critical failure
  | 'cancelled'         // Manually cancelled
  | 'manual_review';    // Requires human intervention

export type BatchItemStatus =
  | 'pending'    // Created, waiting to be sent
  | 'received'   // Callback received, not yet processed
  | 'processing' // Currently being processed
  | 'completed'  // Successfully processed
  | 'failed'     // Processing failed
  | 'skipped';   // Intentionally skipped

export type ReviewDecision = 'approved' | 'rejected' | 'proceed_with_partial';

export interface BatchJob {
  _id: ObjectId;

  // Core identification
  name?: string;
  type?: string;

  // Workflow correlation
  workflowId?: ObjectId | null;
  workflowStepId?: string;
  taskId?: ObjectId | null;

  // Callback configuration
  callbackUrl?: string;
  callbackSecret?: string;

  // Batch tracking
  status: BatchJobStatus;
  expectedCount: number;
  receivedCount: number;
  processedCount: number;
  failedCount: number;

  // Completion policy
  minSuccessPercent: number;  // Default: 100
  deadlineAt?: Date | null;

  // Payload and results
  inputPayload?: Record<string, unknown>;
  aggregateResult?: Record<string, unknown>;
  isResultSealed: boolean;

  // Manual review
  requiresManualReview: boolean;
  reviewedById?: ObjectId | null;
  reviewedAt?: Date | null;
  reviewDecision?: ReviewDecision;
  reviewNotes?: string;

  // Ownership
  createdById?: ObjectId | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface BatchItem {
  _id: ObjectId;
  batchJobId: ObjectId;

  // Idempotency key
  itemKey: string;

  // External reference
  externalId?: string;

  // Processing status
  status: BatchItemStatus;

  // Item data
  inputData?: Record<string, unknown>;
  resultData?: Record<string, unknown>;
  error?: string;

  // Tracking
  attempts: number;

  // Timestamps
  createdAt: Date;
  receivedAt?: Date | null;
  completedAt?: Date | null;
}

// Join condition evaluation result
export interface JoinConditionResult {
  isSatisfied: boolean;
  reason: 'count_met' | 'threshold_met_with_deadline' | 'deadline_passed' | 'not_satisfied';
  successPercent: number;
  details: {
    expectedCount: number;
    processedCount: number;
    failedCount: number;
    minSuccessPercent: number;
    deadlineAt?: Date | null;
    isDeadlinePassed: boolean;
  };
}

// Batch job event types
export type BatchJobEventType =
  | 'batch.created'
  | 'batch.started'
  | 'batch.item.received'
  | 'batch.item.completed'
  | 'batch.item.failed'
  | 'batch.join.satisfied'
  | 'batch.completed'
  | 'batch.completed_with_warnings'
  | 'batch.failed'
  | 'batch.manual_review_required'
  | 'batch.reviewed';

export interface BatchJobEvent {
  id: string;
  type: BatchJobEventType;
  batchJobId: ObjectId;
  batchJob: BatchJob;
  itemId?: ObjectId;
  item?: BatchItem;
  joinResult?: JoinConditionResult;
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Create batch job input
export interface CreateBatchJobInput {
  name?: string;
  type?: string;
  expectedCount: number;
  workflowId?: string;
  workflowStepId?: string;
  taskId?: string;
  minSuccessPercent?: number;  // Default: 100
  deadlineAt?: Date | string;
  inputPayload?: Record<string, unknown>;
  items?: Array<{
    itemKey: string;
    externalId?: string;
    inputData?: Record<string, unknown>;
  }>;
}

// Callback payload from external service
export interface BatchCallbackPayload {
  jobId: string;
  itemKey: string;
  externalId?: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Tag Types
// ============================================================================

export interface Tag {
  _id: ObjectId;
  name: string;                    // Unique, lowercase tag identifier
  displayName: string;             // Human-readable display name
  color: string;                   // Hex color code
  description?: string | null;     // Optional description
  isActive: boolean;
  createdById?: ObjectId | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

// ============================================================================
// Document Types (Markdown Documentation)
// ============================================================================

export type DocumentType = 'sop' | 'strategy' | 'plan' | 'template' | 'reference' | 'output' | 'custom' | 'workflow-prompt' | 'capability';

// Capability document complexity - determines which agents can access this capability
// 1 = basic (all agents), 2 = intermediate (sonnet+), 3 = advanced (opus only)
export type CapabilityComplexity = 1 | 2 | 3;

export type DocumentStatus = 'draft' | 'review' | 'approved' | 'archived';

export interface Document {
  _id: ObjectId;

  // Core fields
  title: string;
  content: string;           // Markdown content
  summary?: string;          // AI-generated or manual summary

  // Group and Project access control
  groupId?: ObjectId | null;       // Group this document belongs to (admin-only if null)
  projectId?: ObjectId | null;     // Project within the group (optional)

  // Classification
  type: DocumentType;
  status: DocumentStatus;
  tags?: string[];

  // Capability document fields (only used when type='capability')
  capabilityId?: string;           // Unique identifier for capability (e.g., 'ask-questions')
  capabilityComplexity?: CapabilityComplexity;  // Required complexity level to access (1-3)

  // Ownership
  createdById: ObjectId | null;
  lastModifiedById?: ObjectId | null;

  // Semantic search
  embedding?: number[];      // Vector embedding for semantic search
  embeddingModel?: string;   // e.g., 'text-embedding-3-small'
  embeddingUpdatedAt?: Date | null;

  // Relationships
  parentDocumentId?: ObjectId | null;  // For document hierarchies
  relatedTaskIds?: ObjectId[];         // Tasks that reference this doc
  workflowRunId?: ObjectId | null;     // If created by a workflow

  // Versioning
  version: number;

  // Metadata
  metadata?: Record<string, unknown>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersion {
  _id: ObjectId;
  documentId: ObjectId;
  version: number;
  title: string;
  content: string;
  summary?: string;
  changeDescription?: string;
  modifiedById: ObjectId;
  modifiedAt: Date;
}

export interface DocumentWithResolved extends Document {
  _resolved?: {
    createdBy?: { _id: string; displayName: string };
    lastModifiedBy?: { _id: string; displayName: string };
    parentDocument?: { _id: string; title: string };
  };
}

// DocumentEvent interface uses the DocumentEventType already defined above
export interface DocumentEvent {
  id: string;
  type: DocumentEventType;
  documentId: ObjectId;
  document: Document;
  changes?: FieldChange[];
  actorId?: ObjectId | null;
  actorType: 'user' | 'system' | 'daemon';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Variable Types (Configuration Variables)
// ============================================================================

/**
 * Simplified variable model:
 * - name: unique identifier for use in templates ({{variables.name}} or {{variables.name.path}})
 * - value: string or JSON/YAML object stored as string
 * - encrypted: if true, the entire value is encrypted at rest
 *
 * Template usage:
 *   {{variables.api_key}} - returns the raw value
 *   {{variables.config.database.host}} - traverses into JSON object
 */
export interface VariablePackage {
  _id: ObjectId;
  name: string;                     // Unique variable name (used in templates)
  displayName?: string;             // Human-readable display name
  description?: string;

  // The value - can be a simple string or a JSON/YAML object stored as string
  // When encrypted=true, this is stored as "enc:..." format
  value: string;

  // If true, the entire value is encrypted at rest
  encrypted: boolean;

  // Ownership and audit
  createdById?: ObjectId | null;
  updatedById?: ObjectId | null;
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Semantic search types
export interface DocumentSearchQuery {
  prompt: string;                    // Natural language search prompt
  type?: DocumentType[];             // Filter by document types
  status?: DocumentStatus[];         // Filter by status
  tags?: string[];                   // Filter by tags
  limit?: number;                    // Max results (default: 10)
  minScore?: number;                 // Minimum similarity score (0-1)
}

export interface DocumentSearchResult {
  document: Document;
  score: number;                     // Similarity score (0-1)
  highlights?: string[];             // Relevant text snippets
}

// ============================================================================
// Workflow Request Types (Inbound Request Logging)
// ============================================================================

export type WorkflowRequestType = 'workflow_start' | 'workflow_callback';

export type WorkflowRequestActorType = 'user' | 'api_key' | 'anonymous' | 'system';

export interface WorkflowRequest {
  _id: ObjectId;

  // Request type
  type: WorkflowRequestType;

  // HTTP request details
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;

  // Processing status
  status: 'success' | 'failed';
  error?: string;

  // Workflow correlation
  workflowId?: ObjectId | null;
  workflowName?: string;
  workflowRunId?: ObjectId | null;
  rootTaskId?: ObjectId | null;

  // For callback requests
  stepId?: string;
  taskId?: ObjectId | null;

  // Actor info
  actorId?: ObjectId | null;
  actorType: WorkflowRequestActorType;
  source?: string;
  externalId?: string;

  // Timestamps
  receivedAt: Date;
  processedAt?: Date | null;
}
