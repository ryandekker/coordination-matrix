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
export type WorkflowStepType = 'trigger' | 'agent' | 'manual' | 'external' | 'webhook' | 'decision' | 'foreach' | 'join' | 'flow';

// Connection between steps (for non-linear flows)
export interface StepConnection {
  targetStepId: string;
  condition?: string | null;  // JSONPath condition or null for default/unconditional
  label?: string;             // Display label for the connection
}

// External service configuration (waits for callback)
export interface ExternalConfig {
  endpoint?: string;          // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payloadTemplate?: string;   // JSON template with {{variable}} interpolation
  responseMapping?: Record<string, string>;  // Map response fields to output
}

// Webhook step configuration (outbound HTTP call, does not wait for callback)
export interface WebhookConfig {
  url?: string;               // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;      // JSON template with {{variable}} interpolation
  maxRetries?: number;        // Max retry attempts (default: 3)
  timeoutMs?: number;         // Request timeout (default: 30000)
  successStatusCodes?: number[];  // HTTP status codes considered success
}

// Join boundary conditions
export interface JoinBoundary {
  minCount?: number;          // Minimum tasks that must complete
  minPercent?: number;        // Minimum percentage (default: 100)
  maxWaitMs?: number;         // Maximum time to wait
  failOnTimeout?: boolean;    // Fail or continue with partial results
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

  // External step configuration (waits for callback)
  externalConfig?: ExternalConfig;

  // Webhook step configuration (outbound HTTP call)
  webhookConfig?: WebhookConfig;

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

  // Input aggregation
  inputSource?: string;             // Step ID to get input from (default: previous step)
  inputPath?: string;               // JSONPath to extract input from source step

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
  createdAt: Date;
  updatedAt: Date;
  createdById?: ObjectId | null;
}

// Valid step types for normalization
export const VALID_STEP_TYPES: WorkflowStepType[] = ['trigger', 'agent', 'manual', 'external', 'webhook', 'decision', 'foreach', 'join', 'flow'];
