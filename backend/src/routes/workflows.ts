import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';

export const workflowsRouter = Router();

// Step types for workflow routing
type WorkflowStepType = 'task' | 'decision' | 'foreach' | 'join' | 'subflow';

// Execution mode (only applicable to 'task' type)
type ExecutionMode = 'automated' | 'manual';

// Decision branch for routing
interface DecisionBranch {
  condition: string | null;       // null = default branch
  targetStepId: string;
}

interface WorkflowStep {
  id: string;
  name: string;

  // Step classification
  stepType?: WorkflowStepType;    // What kind of step (default: 'task')
  execution?: ExecutionMode;      // Execution mode for task steps

  // Legacy field (kept for compatibility)
  type?: 'automated' | 'manual';  // DEPRECATED: Use execution instead
  hitlPhase: string;
  description?: string;
  config?: Record<string, unknown>;

  // Prompt field for AI execution
  prompt?: string;

  // Default assignee for this step
  defaultAssigneeId?: string;

  // Decision routing (only for stepType='decision')
  branches?: DecisionBranch[];
  defaultBranch?: string;

  // ForEach configuration (only for stepType='foreach')
  itemsPath?: string;             // JSONPath to array in output
  itemVariable?: string;          // Template variable name
  maxItems?: number;              // Limit to prevent runaway (default: 100)

  // Join configuration (only for stepType='join')
  awaitTag?: string;              // Tag pattern: "foreach:{{parentId}}"

  // Subflow configuration (only for stepType='subflow')
  subflowId?: string;
  inputMapping?: Record<string, string>;
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
      steps: steps || [],
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
    name: string;
    stepType: WorkflowStepType;
    execution?: ExecutionMode;
  }

  const nodes: Map<string, ParsedNode> = new Map();
  const connections: Array<{ from: string; to: string; label?: string }> = [];

  for (const line of lines) {
    // Skip diagram type declarations, styling, and comments
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;
    if (line.startsWith('classDef') || line.startsWith('class ')) continue;
    if (line.startsWith('%%')) continue;
    if (line.startsWith('subgraph') || line === 'end') continue;

    // Parse node definitions - order matters! More specific patterns first

    // Double square brackets [[ ]] - foreach/join/subflow
    // Pattern: ID[["text"]] or ID[[text]]
    const doubleSquareMatch = line.match(/^(\w+)\[\[["']?([^"\]]+?)["']?\]\]/);
    if (doubleSquareMatch) {
      const [, id, text] = doubleSquareMatch;
      const lowerText = text.toLowerCase();

      let stepType: WorkflowStepType = 'task';
      let cleanName = text;

      if (lowerText.startsWith('each:') || lowerText.startsWith('foreach:')) {
        stepType = 'foreach';
        cleanName = text.replace(/^(each|foreach):\s*/i, '').trim();
      } else if (lowerText.startsWith('join:') || lowerText.startsWith('merge:')) {
        stepType = 'join';
        cleanName = text.replace(/^(join|merge):\s*/i, '').trim();
      } else if (lowerText.startsWith('run:') || lowerText.startsWith('subflow:')) {
        stepType = 'subflow';
        cleanName = text.replace(/^(run|subflow):\s*/i, '').trim();
      } else {
        // Default double brackets to foreach if no prefix
        stepType = 'foreach';
        cleanName = text;
      }

      nodes.set(id, { name: cleanName, stepType });
      continue;
    }

    // Diamond brackets { } - decision
    // Pattern: ID{"text"} or ID{text}
    const diamondMatch = line.match(/^(\w+)\{["']?([^"}]+?)["']?\}/);
    if (diamondMatch) {
      const [, id, text] = diamondMatch;
      nodes.set(id, { name: text, stepType: 'decision' });
      continue;
    }

    // Double round brackets (( )) - manual task (stadium shape)
    // Pattern: ID(("text")) or ID((text))
    const stadiumMatch = line.match(/^(\w+)\(\(["']?([^")]+?)["']?\)\)/);
    if (stadiumMatch) {
      const [, id, text] = stadiumMatch;
      nodes.set(id, { name: text, stepType: 'task', execution: 'manual' });
      continue;
    }

    // Single round brackets ( ) - manual task
    // Pattern: ID("text") or ID(text)
    const roundMatch = line.match(/^(\w+)\(["']?([^")]+?)["']?\)/);
    if (roundMatch) {
      const [, id, text] = roundMatch;
      nodes.set(id, { name: text, stepType: 'task', execution: 'manual' });
      continue;
    }

    // Single square brackets [ ] - automated task (default)
    // Pattern: ID["text"] or ID[text]
    const squareMatch = line.match(/^(\w+)\[["']?([^"\]]+?)["']?\]/);
    if (squareMatch) {
      const [, id, text] = squareMatch;
      nodes.set(id, { name: text, stepType: 'task', execution: 'automated' });
      continue;
    }

    // Parse connections
    // Labeled connections: A -->|"label"| B or A -->|label| B
    const labeledConnMatch = line.match(/(\w+)\s*-->?\|["']?([^|"']+?)["']?\|\s*(\w+)/);
    if (labeledConnMatch) {
      connections.push({
        from: labeledConnMatch[1],
        to: labeledConnMatch[3],
        label: labeledConnMatch[2].trim()
      });
      continue;
    }

    // Simple connections: A --> B
    const simpleConnMatch = line.match(/(\w+)\s*-->\s*(\w+)/);
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

  // Create workflow steps
  for (const nodeId of orderedNodes) {
    const node = nodes.get(nodeId);
    if (node) {
      const step: WorkflowStep = {
        id: new ObjectId().toString(),
        name: node.name,
        stepType: node.stepType,
        hitlPhase: node.execution === 'manual' ? 'approval_required' : 'none',
      };

      // Add execution mode for task steps
      if (node.stepType === 'task') {
        step.execution = node.execution || 'automated';
        // Legacy compatibility
        step.type = step.execution;
      }

      // For decision nodes, extract branches from connections
      if (node.stepType === 'decision') {
        const branches: DecisionBranch[] = [];
        for (const conn of connections) {
          if (conn.from === nodeId) {
            branches.push({
              condition: conn.label || null,
              targetStepId: conn.to,
            });
          }
        }
        if (branches.length > 0) {
          step.branches = branches;
        }
      }

      steps.push(step);
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
      case 'decision':
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
      case 'task':
      default:
        // Check execution mode (support both new and legacy)
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${nodeName}")`);
        } else {
          lines.push(`    ${nodeId}["${nodeName}"]`);
        }
    }
  }

  // Generate connections
  // For decision nodes with branches, use labeled edges
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      // Use branch connections
      for (const branch of step.branches) {
        const targetId = branch.targetStepId;
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${targetId}`);
        } else {
          lines.push(`    ${nodeId} --> ${targetId}`);
        }
      }
    } else if (i < steps.length - 1) {
      // Simple linear connection to next step
      const nextNodeId = steps[i + 1].id || `step${i + 1}`;
      lines.push(`    ${nodeId} --> ${nextNodeId}`);
    }
  }

  // Add styling classes
  lines.push('');
  lines.push('    classDef automated fill:#3B82F6,color:#fff');
  lines.push('    classDef manual fill:#8B5CF6,color:#fff');
  lines.push('    classDef decision fill:#F59E0B,color:#fff');
  lines.push('    classDef foreach fill:#10B981,color:#fff');
  lines.push('    classDef join fill:#8B5CF6,color:#fff');
  lines.push('    classDef subflow fill:#EC4899,color:#fff');

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    automated: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    subflow: [],
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    if (step.stepType === 'decision') {
      classGroups.decision.push(nodeId);
    } else if (step.stepType === 'foreach') {
      classGroups.foreach.push(nodeId);
    } else if (step.stepType === 'join') {
      classGroups.join.push(nodeId);
    } else if (step.stepType === 'subflow') {
      classGroups.subflow.push(nodeId);
    } else {
      const execution = step.execution || step.type || 'automated';
      if (execution === 'manual') {
        classGroups.manual.push(nodeId);
      } else {
        classGroups.automated.push(nodeId);
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
