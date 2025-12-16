import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';

export const workflowsRouter = Router();

// Step types for workflow routing - maps 1:1 to TaskType
// - trigger: Entry point / workflow start
// - agent: AI agent task (Claude, GPT, etc.) - optional additional instructions
// - manual: Human-in-the-loop task
// - external: External service call - waits for callback
// - webhook: Outbound HTTP call (fire-and-forget or await response)
// - decision: Routing based on conditions from previous step output
// - foreach: Fan-out loop over collection (spawns subtasks)
// - join: Fan-in aggregation point (awaits boundary conditions)
// - subflow: Delegate to another workflow
type WorkflowStepType = 'trigger' | 'agent' | 'manual' | 'external' | 'webhook' | 'decision' | 'foreach' | 'join' | 'subflow';

// Connection between steps (for non-linear flows)
interface StepConnection {
  targetStepId: string;
  condition?: string | null;  // JSONPath condition or null for default/unconditional
  label?: string;             // Display label for the connection
}

// External service configuration (waits for callback)
interface ExternalConfig {
  endpoint?: string;          // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payloadTemplate?: string;   // JSON template with {{variable}} interpolation
  responseMapping?: Record<string, string>;  // Map response fields to output
}

// Webhook step configuration (outbound HTTP call, does not wait for callback)
interface WebhookConfig {
  url?: string;               // URL to call
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;      // JSON template with {{variable}} interpolation
  maxRetries?: number;        // Max retry attempts (default: 3)
  timeoutMs?: number;         // Request timeout (default: 30000)
  successStatusCodes?: number[];  // HTTP status codes considered success
}

// Join boundary conditions
interface JoinBoundary {
  minCount?: number;          // Minimum tasks that must complete
  minPercent?: number;        // Minimum percentage (default: 100)
  maxWaitMs?: number;         // Maximum time to wait
  failOnTimeout?: boolean;    // Fail or continue with partial results
}

interface WorkflowStep {
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
  awaitTag?: string;                // Alternative: await tasks with this tag
  joinBoundary?: JoinBoundary;      // Boundary conditions for when the join fires
  minSuccessPercent?: number;       // Legacy: percentage of tasks that must succeed
  expectedCountPath?: string;       // JSONPath to get expected count from previous step

  // Subflow configuration
  subflowId?: string;
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

interface Workflow {
  _id: ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  steps: WorkflowStep[];
  mermaidDiagram?: string;
  createdAt: Date;
  updatedAt: Date;
  createdById?: ObjectId | null;
}

// GET /api/workflows - List all workflows
workflowsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflows = await db
      .collection<Workflow>('workflows')
      .find()
      .sort({ name: 1 })
      .toArray();

    res.json({ data: workflows });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/stats - Get workflow run statistics
workflowsRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = getDb();

    // Check if workflowRuns collection exists to avoid errors on empty databases
    const collections = await db.listCollections({ name: 'workflowRuns' }).toArray();
    if (collections.length === 0) {
      // Collection doesn't exist yet - return empty stats
      res.json({ data: {} });
      return;
    }

    // Aggregate run statistics per workflow
    const stats = await db.collection('workflowRuns').aggregate([
      {
        $group: {
          _id: '$workflowId',
          runCount: { $sum: 1 },
          lastRunAt: { $max: '$createdAt' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    // Convert to a map keyed by workflow ID
    const statsMap: Record<string, {
      runCount: number;
      lastRunAt: Date | null;
      completedCount: number;
      failedCount: number;
    }> = {};

    for (const stat of stats) {
      if (stat._id) {
        statsMap[stat._id.toString()] = {
          runCount: stat.runCount,
          lastRunAt: stat.lastRunAt,
          completedCount: stat.completedCount,
          failedCount: stat.failedCount
        };
      }
    }

    res.json({ data: statsMap });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:id - Get a specific workflow
workflowsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const workflow = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!workflow) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: workflow });
  } catch (error) {
    next(error);
  }
});

// Helper to ensure all steps have IDs
function ensureStepIds(steps: WorkflowStep[]): WorkflowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  return steps.map((step) => {
    if (!step.id) {
      // Generate a unique ID if missing
      return { ...step, id: new ObjectId().toString() };
    }
    return step;
  });
}

// POST /api/workflows - Create a new workflow
workflowsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { name, description, steps, mermaidDiagram, isActive } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    const now = new Date();
    const newWorkflow: Omit<Workflow, '_id'> = {
      name,
      description: description || '',
      isActive: isActive ?? true,
      steps: ensureStepIds(steps || []),
      mermaidDiagram: mermaidDiagram || '',
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflows/:id - Update a workflow
workflowsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);
    const updates = req.body;

    delete updates._id;
    delete updates.createdAt;
    updates.updatedAt = new Date();

    // Ensure step IDs are generated when updating steps
    if (updates.steps) {
      updates.steps = ensureStepIds(updates.steps);
    }

    const result = await db.collection<Workflow>('workflows').findOneAndUpdate(
      { _id: workflowId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Workflow not found', 404);
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id - Delete a workflow
workflowsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const result = await db.collection('workflows').deleteOne({ _id: workflowId });

    if (result.deletedCount === 0) {
      throw createError('Workflow not found', 404);
    }

    res.json({ success: true, message: 'Workflow deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/duplicate - Duplicate a workflow
workflowsRouter.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const workflowId = new ObjectId(req.params.id);

    const original = await db.collection<Workflow>('workflows').findOne({ _id: workflowId });

    if (!original) {
      throw createError('Workflow not found', 404);
    }

    const now = new Date();
    const duplicate: Omit<Workflow, '_id'> = {
      name: `${original.name} (Copy)`,
      description: original.description,
      isActive: false,
      steps: original.steps.map((step) => ({ ...step, id: new ObjectId().toString() })),
      mermaidDiagram: original.mermaidDiagram,
      createdAt: now,
      updatedAt: now,
      createdById: req.body.createdById ? new ObjectId(req.body.createdById) : null,
    };

    const result = await db.collection<Workflow>('workflows').insertOne(duplicate as Workflow);
    const inserted = await db.collection<Workflow>('workflows').findOne({ _id: result.insertedId });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/parse-mermaid - Parse Mermaid diagram to workflow steps
workflowsRouter.post('/parse-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mermaidDiagram } = req.body;

    if (!mermaidDiagram) {
      throw createError('mermaidDiagram is required', 400);
    }

    const steps = parseMermaidToSteps(mermaidDiagram);

    res.json({ data: { steps, mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/generate-mermaid - Generate Mermaid diagram from steps
workflowsRouter.post('/generate-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { steps, name } = req.body;

    if (!steps || !Array.isArray(steps)) {
      throw createError('steps array is required', 400);
    }

    const mermaidDiagram = generateMermaidFromSteps(steps, name);

    res.json({ data: { mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// Helper function to parse Mermaid flowchart to workflow steps
function parseMermaidToSteps(mermaid: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lines = mermaid.split('\n').map((l) => l.trim()).filter(Boolean);

  // Node storage with full step info
  interface ParsedNode {
    id: string;  // Keep original mermaid ID for connection mapping
    name: string;
    stepType: WorkflowStepType;
  }

  const nodes: Map<string, ParsedNode> = new Map();
  const connections: Array<{ from: string; to: string; label?: string }> = [];

  // Parse step configurations from comments
  // Format: %% @step(stepId): {"key": "value", ...}
  const stepConfigs: Map<string, Record<string, unknown>> = new Map();

  for (const line of lines) {
    // Parse step configuration comments first
    const stepConfigMatch = line.match(/%% @step\(([^)]+)\):\s*(.+)/);
    if (stepConfigMatch) {
      try {
        const [, stepId, configJson] = stepConfigMatch;
        const config = JSON.parse(configJson);
        stepConfigs.set(stepId, config);
      } catch {
        // Invalid JSON, skip
      }
      continue;
    }

    // Skip diagram type declarations, styling, and other comments
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;
    if (line.startsWith('classDef') || line.startsWith('class ')) continue;
    if (line.startsWith('%%')) continue;
    if (line.startsWith('subgraph') || line === 'end' || line.startsWith('direction')) continue;

    // Parse node definitions - order matters! More specific patterns first

    // Hexagon {{ }} - external service/API call
    // Pattern: ID{{"text"}} or ID{{text}}
    const hexagonMatch = line.match(/^([\w-]+)\{\{["']?([^"}]+?)["']?\}\}/);
    if (hexagonMatch) {
      const [, id, text] = hexagonMatch;
      // Check for ext:, api:, trigger:, or webhook: prefix
      const cleanName = text.replace(/^(ext|api|webhook|trigger):\s*/i, '').trim();
      nodes.set(id, { id, name: cleanName, stepType: 'external' });
      continue;
    }

    // Double square brackets [[ ]] - foreach/join/subflow
    // Pattern: ID[["text"]] or ID[[text]]
    const doubleSquareMatch = line.match(/^([\w-]+)\[\[["']?([^"\]]+?)["']?\]\]/);
    if (doubleSquareMatch) {
      const [, id, text] = doubleSquareMatch;
      const lowerText = text.toLowerCase();

      let stepType: WorkflowStepType = 'agent';
      let cleanName = text;
      let itemsPath: string | undefined;
      let minSuccessPercent: number | undefined;

      if (lowerText.startsWith('each:') || lowerText.startsWith('foreach:')) {
        stepType = 'foreach';
        cleanName = text.replace(/^(each|foreach):\s*/i, '').trim();
        // Extract itemsPath from format: "Name (path.to.items)"
        const itemsMatch = cleanName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (itemsMatch) {
          cleanName = itemsMatch[1].trim();
          itemsPath = itemsMatch[2].trim();
        }
      } else if (lowerText.startsWith('join:') || lowerText.startsWith('merge:')) {
        stepType = 'join';
        cleanName = text.replace(/^(join|merge):\s*/i, '').trim();
        // Extract minSuccessPercent from format: "Name @95%"
        const pctMatch = cleanName.match(/^(.+?)\s*@(\d+)%\s*$/);
        if (pctMatch) {
          cleanName = pctMatch[1].trim();
          minSuccessPercent = parseInt(pctMatch[2]);
        }
      } else if (lowerText.startsWith('run:') || lowerText.startsWith('subflow:')) {
        stepType = 'subflow';
        cleanName = text.replace(/^(run|subflow):\s*/i, '').trim();
      } else {
        // Default double brackets to foreach if no prefix
        stepType = 'foreach';
        cleanName = text;
      }

      // Store with extracted config (will be used when creating steps)
      const node: ParsedNode & { itemsPath?: string; minSuccessPercent?: number } = {
        id, name: cleanName, stepType, itemsPath, minSuccessPercent
      };
      nodes.set(id, node);
      continue;
    }

    // Diamond brackets { } - decision/routing
    // Pattern: ID{"text"} or ID{text}
    const diamondMatch = line.match(/^([\w-]+)\{["']?([^"}]+?)["']?\}/);
    if (diamondMatch) {
      const [, id, text] = diamondMatch;
      nodes.set(id, { id, name: text, stepType: 'decision' });
      continue;
    }

    // Double round brackets (( )) - manual/HITL task (stadium shape)
    // Pattern: ID(("text")) or ID((text))
    const stadiumMatch = line.match(/^([\w-]+)\(\(["']?([^")]+?)["']?\)\)/);
    if (stadiumMatch) {
      const [, id, text] = stadiumMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single round brackets ( ) - manual/HITL task
    // Pattern: ID("text") or ID(text)
    const roundMatch = line.match(/^([\w-]+)\(["']?([^")]+?)["']?\)/);
    if (roundMatch) {
      const [, id, text] = roundMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single square brackets [ ] - agent task (default)
    // Pattern: ID["text"] or ID[text]
    // Check for ext: prefix to make it external
    const squareMatch = line.match(/^([\w-]+)\[["']?([^"\]]+?)["']?\]/);
    if (squareMatch) {
      const [, id, text] = squareMatch;
      const lowerText = text.toLowerCase();

      if (lowerText.startsWith('ext:') || lowerText.startsWith('api:') || lowerText.startsWith('webhook:')) {
        const cleanName = text.replace(/^(ext|api|webhook):\s*/i, '').trim();
        nodes.set(id, { id, name: cleanName, stepType: 'external' });
      } else {
        nodes.set(id, { id, name: text, stepType: 'agent' });
      }
      continue;
    }

    // Parse connections
    // Labeled connections: A -->|"label"| B or A -->|label| B
    const labeledConnMatch = line.match(/([\w-]+)\s*-->?\|["']?([^|"']+?)["']?\|\s*([\w-]+)/);
    if (labeledConnMatch) {
      connections.push({
        from: labeledConnMatch[1],
        to: labeledConnMatch[3],
        label: labeledConnMatch[2].trim()
      });
      continue;
    }

    // Simple connections: A --> B
    const simpleConnMatch = line.match(/([\w-]+)\s*-->\s*([\w-]+)/);
    if (simpleConnMatch) {
      // Check if already added as labeled connection
      const from = simpleConnMatch[1];
      const to = simpleConnMatch[2];
      if (!connections.some((c) => c.from === from && c.to === to)) {
        connections.push({ from, to });
      }
    }
  }

  // Build ordered steps using topological sort
  const visited = new Set<string>();
  const orderedNodes: string[] = [];

  // Count incoming connections for each node
  const incomingCount: Map<string, number> = new Map();
  for (const node of nodes.keys()) {
    incomingCount.set(node, 0);
  }
  for (const conn of connections) {
    if (nodes.has(conn.to)) {
      incomingCount.set(conn.to, (incomingCount.get(conn.to) || 0) + 1);
    }
  }

  // Start with nodes that have no incoming connections
  const queue: string[] = [];
  for (const [node, count] of incomingCount) {
    if (count === 0) queue.push(node);
  }

  // Topological sort
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    orderedNodes.push(node);

    for (const conn of connections) {
      if (conn.from === node && nodes.has(conn.to)) {
        const newCount = (incomingCount.get(conn.to) || 1) - 1;
        incomingCount.set(conn.to, newCount);
        if (newCount === 0 && !visited.has(conn.to)) {
          queue.push(conn.to);
        }
      }
    }
  }

  // Add any remaining nodes not connected
  for (const node of nodes.keys()) {
    if (!visited.has(node)) {
      orderedNodes.push(node);
    }
  }

  // Create a map from mermaid ID to generated step ID for connection mapping
  const mermaidIdToStepId: Map<string, string> = new Map();

  // Create workflow steps
  for (const mermaidId of orderedNodes) {
    const node = nodes.get(mermaidId) as ParsedNode & { itemsPath?: string; minSuccessPercent?: number } | undefined;
    if (node) {
      // Use original mermaid ID if it was a step ID (for round-trip preservation)
      const stepId = mermaidId.startsWith('step-') ? mermaidId : new ObjectId().toString();
      mermaidIdToStepId.set(mermaidId, stepId);

      const step: WorkflowStep = {
        id: stepId,
        name: node.name,
        stepType: node.stepType,
      };

      // Apply config extracted from node label
      if (node.itemsPath) step.itemsPath = node.itemsPath;
      if (node.minSuccessPercent !== undefined) step.minSuccessPercent = node.minSuccessPercent;

      // Apply saved configuration from comments if available (overrides label-extracted config)
      const savedConfig = stepConfigs.get(mermaidId);
      if (savedConfig) {
        // Apply all saved configuration fields
        if (savedConfig.description) step.description = savedConfig.description as string;
        if (savedConfig.additionalInstructions) step.additionalInstructions = savedConfig.additionalInstructions as string;
        if (savedConfig.defaultAssigneeId) step.defaultAssigneeId = savedConfig.defaultAssigneeId as string;
        if (savedConfig.inputSource) step.inputSource = savedConfig.inputSource as string;
        if (savedConfig.inputPath) step.inputPath = savedConfig.inputPath as string;

        // External config
        if (savedConfig.externalConfig) step.externalConfig = savedConfig.externalConfig as ExternalConfig;

        // ForEach config
        if (savedConfig.itemsPath) step.itemsPath = savedConfig.itemsPath as string;
        if (savedConfig.itemVariable) step.itemVariable = savedConfig.itemVariable as string;
        if (savedConfig.maxItems) step.maxItems = savedConfig.maxItems as number;
        if (savedConfig.expectedCountPath) step.expectedCountPath = savedConfig.expectedCountPath as string;

        // Join config
        if (savedConfig.awaitTag) step.awaitTag = savedConfig.awaitTag as string;
        if (savedConfig.minSuccessPercent !== undefined) step.minSuccessPercent = savedConfig.minSuccessPercent as number;

        // Subflow config
        if (savedConfig.subflowId) step.subflowId = savedConfig.subflowId as string;
        if (savedConfig.inputMapping) step.inputMapping = savedConfig.inputMapping as Record<string, string>;
      }

      // Build connections for this step (non-linear flow support)
      const stepConnections: StepConnection[] = [];
      for (const conn of connections) {
        if (conn.from === mermaidId) {
          stepConnections.push({
            targetStepId: conn.to,  // Will be remapped after all steps created
            condition: conn.label || undefined,
            label: conn.label || undefined,
          });
        }
      }

      if (stepConnections.length > 0) {
        step.connections = stepConnections;
      }

      // Legacy compatibility
      if (node.stepType === 'agent') {
        step.execution = 'automated';
        step.type = 'automated';
      } else if (node.stepType === 'manual') {
        step.execution = 'manual';
        step.type = 'manual';
        step.hitlPhase = 'approval_required';
      }

      steps.push(step);
    }
  }

  // Remap connection targetStepIds from mermaid IDs to actual step IDs
  for (const step of steps) {
    if (step.connections) {
      for (const conn of step.connections) {
        const actualStepId = mermaidIdToStepId.get(conn.targetStepId);
        if (actualStepId) {
          conn.targetStepId = actualStepId;
        }
      }
    }
    // Also handle legacy branches for decision nodes
    if (step.stepType === 'decision' && step.connections) {
      step.branches = step.connections.map(c => ({
        condition: c.condition || null,
        targetStepId: c.targetStepId,
      }));
    }
  }

  return steps;
}

// Helper function to generate Mermaid diagram from workflow steps
function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return '';

  const lines: string[] = ['flowchart TD'];

  // Generate node definitions based on step type
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;
    const nodeName = step.name.replace(/"/g, "'");

    switch (step.stepType) {
      case 'agent':
        // Square brackets for agent tasks (AI)
        lines.push(`    ${nodeId}["${nodeName}"]`);
        break;
      case 'external':
        // Hexagon for external/API tasks
        lines.push(`    ${nodeId}{{"${nodeName}"}}`);
        break;
      case 'manual':
        // Round brackets for manual/HITL tasks
        lines.push(`    ${nodeId}("${nodeName}")`);
        break;
      case 'decision':
        // Diamond for decision/routing
        lines.push(`    ${nodeId}{"${nodeName}"}`);
        break;
      case 'foreach':
        lines.push(`    ${nodeId}[["Each: ${nodeName}"]]`);
        break;
      case 'join':
        lines.push(`    ${nodeId}[["Join: ${nodeName}"]]`);
        break;
      case 'subflow':
        lines.push(`    ${nodeId}[["Run: ${nodeName}"]]`);
        break;
      default:
        // Legacy support: check execution mode
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${nodeName}")`);
        } else {
          lines.push(`    ${nodeId}["${nodeName}"]`);
        }
    }
  }

  // Generate connections - use explicit connections if available, otherwise linear
  const connectedFrom = new Set<string>();  // Track which nodes have outgoing connections

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    // Use explicit connections if defined
    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`    ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`);
        } else {
          lines.push(`    ${nodeId} --> ${conn.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
    // Legacy: use branches for decision nodes
    else if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${branch.targetStepId}`);
        } else {
          lines.push(`    ${nodeId} --> ${branch.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
  }

  // Add linear connections for nodes without explicit connections
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    if (!connectedFrom.has(nodeId)) {
      const nextNodeId = steps[i + 1].id || `step${i + 1}`;
      lines.push(`    ${nodeId} --> ${nextNodeId}`);
    }
  }

  // Add styling classes with distinct colors for each type
  lines.push('');
  lines.push('    classDef agent fill:#3B82F6,color:#fff');      // Blue - AI agent
  lines.push('    classDef external fill:#F97316,color:#fff');   // Orange - External/API
  lines.push('    classDef manual fill:#8B5CF6,color:#fff');     // Purple - Human/HITL
  lines.push('    classDef decision fill:#F59E0B,color:#fff');   // Amber - Decision
  lines.push('    classDef foreach fill:#10B981,color:#fff');    // Green - Loop
  lines.push('    classDef join fill:#6366F1,color:#fff');       // Indigo - Join
  lines.push('    classDef subflow fill:#EC4899,color:#fff');    // Pink - Subflow

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    agent: [],
    external: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    subflow: [],
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    switch (step.stepType) {
      case 'agent':
        classGroups.agent.push(nodeId);
        break;
      case 'external':
        classGroups.external.push(nodeId);
        break;
      case 'manual':
        classGroups.manual.push(nodeId);
        break;
      case 'decision':
        classGroups.decision.push(nodeId);
        break;
      case 'foreach':
        classGroups.foreach.push(nodeId);
        break;
      case 'join':
        classGroups.join.push(nodeId);
        break;
      case 'subflow':
        classGroups.subflow.push(nodeId);
        break;
      default:
        // Legacy support
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          classGroups.manual.push(nodeId);
        } else {
          classGroups.agent.push(nodeId);
        }
    }
  }

  // Output class assignments
  for (const [className, nodeIds] of Object.entries(classGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${className}`);
    }
  }

  return lines.join('\n');
}
