import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';

export const workflowsRouter = Router();

interface WorkflowStep {
  id: string;
  name: string;
  type: 'automated' | 'manual';
  hitlPhase: string;
  description?: string;
  config?: Record<string, unknown>;
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

  // Extract node definitions and connections
  const nodePattern = /(\w+)\[([^\]]+)\]/g;
  const nodePatternRound = /(\w+)\(([^)]+)\)/g;
  const nodePatternDiamond = /(\w+)\{([^}]+)\}/g;
  const connectionPattern = /(\w+)\s*-->\s*(\w+)/g;
  const connectionPatternLabeled = /(\w+)\s*-->?\|([^|]+)\|\s*(\w+)/g;

  const nodes: Map<string, { name: string; type: 'automated' | 'manual' }> = new Map();
  const connections: Array<{ from: string; to: string; label?: string }> = [];

  for (const line of lines) {
    // Skip diagram type declarations
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;

    // Extract nodes with square brackets (automated)
    let match;
    while ((match = nodePattern.exec(line)) !== null) {
      nodes.set(match[1], { name: match[2], type: 'automated' });
    }

    // Extract nodes with round brackets (manual/HITL)
    while ((match = nodePatternRound.exec(line)) !== null) {
      nodes.set(match[1], { name: match[2], type: 'manual' });
    }

    // Extract nodes with diamond brackets (decision - treat as HITL)
    while ((match = nodePatternDiamond.exec(line)) !== null) {
      nodes.set(match[1], { name: match[2], type: 'manual' });
    }

    // Extract connections with labels
    while ((match = connectionPatternLabeled.exec(line)) !== null) {
      connections.push({ from: match[1], to: match[3], label: match[2] });
    }

    // Extract simple connections
    while ((match = connectionPattern.exec(line)) !== null) {
      // Avoid duplicates from labeled connections
      if (!connections.some((c) => c.from === match![1] && c.to === match![2])) {
        connections.push({ from: match[1], to: match[2] });
      }
    }
  }

  // Build ordered steps from connections
  const visited = new Set<string>();
  const orderedNodes: string[] = [];

  // Find starting nodes (nodes with no incoming connections)
  const incomingCount: Map<string, number> = new Map();
  for (const node of nodes.keys()) {
    incomingCount.set(node, 0);
  }
  for (const conn of connections) {
    incomingCount.set(conn.to, (incomingCount.get(conn.to) || 0) + 1);
  }

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
      if (conn.from === node) {
        const newCount = (incomingCount.get(conn.to) || 1) - 1;
        incomingCount.set(conn.to, newCount);
        if (newCount === 0 && !visited.has(conn.to)) {
          queue.push(conn.to);
        }
      }
    }
  }

  // Add any remaining nodes
  for (const node of nodes.keys()) {
    if (!visited.has(node)) {
      orderedNodes.push(node);
    }
  }

  // Create steps
  for (const nodeId of orderedNodes) {
    const node = nodes.get(nodeId);
    if (node) {
      steps.push({
        id: new ObjectId().toString(),
        name: node.name,
        type: node.type,
        hitlPhase: node.type === 'manual' ? 'approval_required' : 'none',
      });
    }
  }

  return steps;
}

// Helper function to generate Mermaid diagram from workflow steps
function generateMermaidFromSteps(steps: WorkflowStep[], name?: string): string {
  const lines: string[] = ['flowchart TD'];

  if (name) {
    lines.push(`    subgraph ${name.replace(/\s+/g, '_')}`);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = `step${i}`;
    const nodeName = step.name.replace(/"/g, "'");

    // Use different bracket styles based on type
    if (step.type === 'manual') {
      lines.push(`    ${nodeId}(("${nodeName}"))`);
    } else if (step.hitlPhase !== 'none') {
      lines.push(`    ${nodeId}["${nodeName}"]:::hitl`);
    } else {
      lines.push(`    ${nodeId}["${nodeName}"]`);
    }
  }

  // Add connections
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`    step${i} --> step${i + 1}`);
  }

  if (name) {
    lines.push('    end');
  }

  // Add styling
  lines.push('');
  lines.push('    classDef hitl fill:#8B5CF6,color:#fff');
  lines.push('    classDef manual fill:#EC4899,color:#fff');

  // Apply manual class to manual nodes
  const manualNodes = steps
    .map((s, i) => (s.type === 'manual' ? `step${i}` : null))
    .filter(Boolean);
  if (manualNodes.length > 0) {
    lines.push(`    class ${manualNodes.join(',')} manual`);
  }

  return lines.join('\n');
}
