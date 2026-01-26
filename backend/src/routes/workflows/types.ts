import { ObjectId } from 'mongodb';

// Step types for workflow routing - maps 1:1 to TaskType
// - trigger: Entry point / workflow start
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - manual: Human-in-the-loop task
// - external: External service call - waits for callback
// - webhook: Outbound HTTP call (fire-and-forget or await response)
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection (spawns subtasks)
// - join: Fan-in aggregation point (awaits boundary conditions)
// - flow: Delegate to another workflow (nested)
// - code: Execute JavaScript code in a sandboxed environment
// - findDocument: Search for documents using semantic search or fetch by ID
export type WorkflowStepType = 'trigger' | 'agent' | 'manual' | 'external' | 'webhook' | 'decision' | 'foreach' | 'join' | 'flow' | 'code' | 'findDocument';

// Connection between steps (for non-linear flows)
export interface StepConnection {
  targetStepId: string;
  condition?: string | null;  // JSONPath condition or null for default/unconditional
  label?: string;             // Display label for the connection
}

// External service configuration - supports both async callback and fire-and-forget modes
export interface ExternalConfig {
  endpoint?: string;          // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payloadTemplate?: string;   // JSON template with {{variable}} interpolation
  responseMapping?: Record<string, string>;  // Map response fields to output
  // When false, operates in fire-and-forget mode (like webhook)
  // When true (default), waits for external system to call back
  waitForCallback?: boolean;
  // HTTP status codes that indicate success (for fire-and-forget mode)
  successStatusCodes?: number[];
}

// Join boundary conditions
export interface JoinBoundary {
  minCount?: number;          // Minimum tasks that must complete
  minPercent?: number;        // Minimum percentage (default: 100)
  maxWaitMs?: number;         // Maximum time to wait
  failOnTimeout?: boolean;    // Fail or continue with partial results
}

// Available packages for code sandbox
export type CodeSandboxPackage = 'lodash' | 'date-fns' | 'uuid' | 'zod' | 'jsonpath-plus';

// Code step configuration
export interface CodeStepConfig {
  code: string;                       // JavaScript code to execute
  packages?: CodeSandboxPackage[];    // Packages to inject into sandbox
  timeout?: number;                   // Max execution time in ms (default: 30000)
  memoryLimit?: number;               // Memory limit in MB (default: 128)
  outputSchema?: object;              // JSON Schema for output validation
  continueOnError?: boolean;          // Complete with error in output instead of failing
}

// FindDocument step configuration
export interface FindDocumentConfig {
  mode?: 'static' | 'dynamic';        // Static fetches by ID, dynamic searches
  documentId?: string;                // Specific document ID (for static mode)
  searchPrompt?: string;              // Search query template (for dynamic mode)
  documentTypes?: string[];           // Filter by document type
  documentStatus?: string[];          // Filter by status
  tags?: string[];                    // Filter by tags
  limit?: number;                     // Max results (default: 1)
  minScore?: number;                  // Minimum similarity threshold
  storeAs?: string;                   // Variable name for result
  failIfNotFound?: boolean;           // Fail step if no documents found
}

// Webhook step configuration
export interface WebhookConfig {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  maxRetries?: number;
  timeoutMs?: number;
  successStatusCodes?: number[];
}

// Unified input configuration for workflow steps
export interface StepInputConfig {
  source: 'previous' | 'trigger' | string;  // Where to get input from
  mapping?: Record<string, string>;         // Field mapping with template expressions
  extractPath?: string;                     // Simple path extraction (alternative to mapping)
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;

  // Step classification
  stepType: WorkflowStepType;

  // Non-linear flow: explicit connections to next steps
  // If empty/undefined for non-decision steps, assumes linear flow to next step in array
  connections?: StepConnection[];

  // Agent/manual step configuration
  additionalInstructions?: string;  // Extra context for the agent (not required)
  defaultAssigneeId?: string;       // Agent or user to assign to
  promptDocumentIds?: string[];     // IDs of workflow-prompt documents to prepend

  // External step configuration (waits for callback or fire-and-forget)
  externalConfig?: ExternalConfig;

  // Decision step configuration
  // Uses connections[] with conditions for routing
  // Each connection.condition is evaluated against previous step output
  defaultConnection?: string;       // targetStepId for when no conditions match

  // ForEach configuration - spawns subtasks
  itemsPath?: string;               // JSONPath to array in previous output
  itemVariable?: string;            // Template variable name for each item
  maxItems?: number;                // Safety limit (default: 100)

  // Join configuration - explicit reference to which step's tasks to await
  awaitStepId?: string;             // Step ID whose tasks we're waiting for (can be earlier in flow)
  joinBoundary?: JoinBoundary;      // Boundary conditions for when the join fires
  minSuccessPercent?: number;       // Legacy: percentage of tasks that must succeed
  expectedCountPath?: string;       // JSONPath to get expected count from previous step

  // Flow configuration (nested workflow)
  flowId?: string;
  inputMapping?: Record<string, string>;

  // Webhook step configuration
  webhookConfig?: WebhookConfig;

  // Unified input configuration (new model)
  inputConfig?: StepInputConfig;

  // Legacy input aggregation (deprecated - use inputConfig)
  inputSource?: string;             // Step ID to get input from (default: previous step)
  inputPath?: string;               // JSONPath to extract input from source step

  // Code step configuration
  codeConfig?: CodeStepConfig;

  // FindDocument step configuration
  findDocumentConfig?: FindDocumentConfig;

  // Legacy fields (kept for compatibility)
  execution?: 'automated' | 'manual';
  type?: 'automated' | 'manual';
  prompt?: string;                  // Mapped to additionalInstructions
  hitlPhase?: string;
  config?: Record<string, unknown>;
  branches?: { condition: string | null; targetStepId: string }[];  // Legacy, use connections
}

export interface Workflow {
  _id: ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  steps: WorkflowStep[];
  mermaidDiagram?: string;
  rootTaskTitleTemplate?: string;
  // Sample payload template for triggering this workflow - helps agents/callers know what data to provide
  samplePayload?: string;
  // Organization and display
  folderId?: ObjectId | null;  // Reference to workflow folder
  color?: string;              // Pastel hex color for visual identification
  // Group access control - workflows must belong to a group (admin-only if null)
  groupId?: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  createdById?: ObjectId | null;
}

// Valid step types for normalization
export const VALID_STEP_TYPES: WorkflowStepType[] = ['trigger', 'agent', 'manual', 'external', 'webhook', 'decision', 'foreach', 'join', 'flow', 'code', 'findDocument'];
