// Step types for workflow routing
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - external: External HTTP call - can wait for callback or fire-and-forget (controlled by waitForCallback)
// - manual: Human-in-the-loop task
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection
// - join: Fan-in aggregation point
// - flow: Delegate to another workflow (nested)
// - findDocument: Search for documents using semantic search
// - code: Execute JavaScript code in a sandboxed environment
export type WorkflowStepType = 'agent' | 'external' | 'manual' | 'decision' | 'foreach' | 'join' | 'flow' | 'findDocument' | 'code'

// Available packages for code sandbox - matches backend CodeSandboxPackage type
export type CodeSandboxPackage =
  // HTTP & Networking
  | 'node-fetch' | 'axios' | 'qs'
  // Data Manipulation
  | 'lodash' | 'ramda' | 'immer' | 'deepmerge'
  // String & Text
  | 'validator' | 'slugify' | 'change-case' | 'marked' | 'sanitize-html'
  // Numbers & Math
  | 'bignumber.js' | 'decimal.js' | 'mathjs' | 'currency.js'
  // Date & Time
  | 'date-fns' | 'dayjs' | 'luxon' | 'ms'
  // JSON & Data Formats
  | 'jsonpath-plus' | 'json5' | 'yaml' | 'csv-parse' | 'csv-stringify' | 'papaparse' | 'fast-xml-parser'
  // Validation & Schema
  | 'zod' | 'yup' | 'ajv'
  // UUID & IDs
  | 'uuid' | 'nanoid' | 'ulid' | 'hashids'
  // Crypto & Security
  | 'crypto-js' | 'bcryptjs' | 'jsonwebtoken' | 'js-base64'
  // Async & Flow Control
  | 'p-limit' | 'p-map' | 'p-retry' | 'delay'
  // Templating
  | 'handlebars' | 'mustache' | 'ejs'
  // Comparison & Diff
  | 'fast-json-patch' | 'diff'
  // Encoding & Compression
  | 'pako' | 'lz-string'
  // Random & Fake Data
  | '@faker-js/faker'

// Code step configuration
export interface CodeStepConfig {
  code: string                        // JavaScript code to execute
  packages?: CodeSandboxPackage[]     // Packages to inject into sandbox
  timeout?: number                    // Max execution time in ms (default: 30000)
  continueOnError?: boolean           // Complete with error in output instead of failing
}

// Unified input configuration for workflow steps
export interface StepInputConfig {
  source: 'previous' | 'trigger' | string  // Where to get input from
  mapping?: Record<string, string>         // Field mapping with template expressions
  extractPath?: string                     // Simple path extraction (alternative to mapping)
}

// Connection between steps (for non-linear flows)
export interface StepConnection {
  targetStepId: string
  condition?: string | null
  label?: string
}

// External service configuration - supports both async callback and fire-and-forget modes
export interface ExternalConfig {
  endpoint?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  payloadTemplate?: string
  // When false, operates in fire-and-forget mode (like webhook)
  // When true (default), waits for external system to call back
  waitForCallback?: boolean
  // HTTP status codes that indicate success (for fire-and-forget mode)
  successStatusCodes?: number[]
}

export interface WorkflowStep {
  id: string
  name: string
  description?: string
  stepType?: WorkflowStepType  // Optional for backward compatibility

  // Dynamic title template - supports {{input.field}}, {{item}}, {{_index}}, etc.
  titleTemplate?: string

  // Non-linear flow: explicit connections to next steps
  connections?: StepConnection[]

  // Agent step configuration
  additionalInstructions?: string
  defaultAssigneeId?: string
  promptDocumentIds?: string[]  // IDs of workflow-prompt documents to prepend

  // External step configuration (async with callback or fire-and-forget)
  externalConfig?: ExternalConfig

  // Decision step configuration
  defaultConnection?: string

  // ForEach fields
  itemsPath?: string
  itemVariable?: string
  maxItems?: number

  // Unified input configuration (new model - use this instead of inputSource/inputPath)
  inputConfig?: StepInputConfig

  // Legacy data flow config (deprecated - use inputConfig)
  inputSource?: string               // Step ID to get input from (default: previous step)
  inputPath?: string                 // JSONPath to extract data from source step

  // Join fields
  awaitTag?: string
  minSuccessPercent?: number       // Percentage of tasks that must succeed (0-100)

  // Shared by ForEach and Join
  expectedCountPath?: string       // JSONPath to expected count from input/external step response

  // Flow fields (nested workflow)
  flowId?: string
  inputMapping?: Record<string, string>

  // Code step configuration
  codeConfig?: CodeStepConfig

  // Legacy compatibility
  execution?: 'automated' | 'manual'
  type?: 'automated' | 'manual'
  prompt?: string
  hitlPhase?: string
  branches?: { condition: string | null; targetStepId: string }[]
}

export interface Workflow {
  _id?: string
  name: string
  description: string
  isActive: boolean
  steps?: WorkflowStep[]
  stages?: string[]  // Legacy format
  mermaidDiagram?: string

  // Dynamic title template for the root task - supports {{input.field}} variables
  rootTaskTitleTemplate?: string

  // Sample payload template for triggering this workflow - helps agents/callers know what data to provide
  samplePayload?: string

  // Organization and display
  folderId?: string | null  // Reference to workflow folder
  color?: string            // Pastel hex color for visual identification
}

export interface WorkflowEditorProps {
  workflow: Workflow | null
  isOpen: boolean
  onClose: () => void
  onSave: (workflow: Workflow) => void
}

// Detect loop scopes (ForEach → Join boundaries)
export interface LoopScope {
  foreachIndex: number
  joinIndex: number
  foreachStep: WorkflowStep
  joinStep: WorkflowStep
}

// Step type configuration for UI rendering
export interface StepTypeInfo {
  type: WorkflowStepType
  label: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
}
