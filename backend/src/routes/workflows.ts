import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import type {
  Workflow,
  WorkflowStep,
  WorkflowRegularStep,
  WorkflowBranchStep,
  WorkflowForeachStep,
  WorkflowSubworkflowStep,
  HITLPhase,
} from '../types/index.js';

export const workflowsRouter = Router();

// Legacy interface for backwards compatibility during parsing
interface LegacyWorkflowStep {
  id: string;
  name: string;
  type: 'automated' | 'manual';
  hitlPhase: string;
  description?: string;
  config?: Record<string, unknown>;
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
    const { name, description, steps, mermaidDiagram, isActive, entryStepId } = req.body;

    if (!name) {
      throw createError('name is required', 400);
    }

    const now = new Date();
    const normalizedSteps = normalizeSteps(steps || []);
    const newWorkflow: Omit<Workflow, '_id'> = {
      name,
      description: description || '',
      isActive: isActive ?? true,
      steps: normalizedSteps,
      entryStepId: entryStepId || (normalizedSteps.length > 0 ? normalizedSteps[0].id : null),
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

    // Normalize steps if provided
    if (updates.steps) {
      updates.steps = normalizeSteps(updates.steps);
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

    // Create ID mapping for duplication
    const idMap = new Map<string, string>();
    for (const step of original.steps) {
      idMap.set(step.id, new ObjectId().toString());
    }

    const now = new Date();
    const duplicate: Omit<Workflow, '_id'> = {
      name: `${original.name} (Copy)`,
      description: original.description,
      isActive: false,
      steps: original.steps.map((step) => remapStepIds(step, idMap)),
      entryStepId: original.entryStepId ? idMap.get(original.entryStepId) || null : null,
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

    const { steps, entryStepId } = parseMermaidToSteps(mermaidDiagram);

    res.json({ data: { steps, entryStepId, mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/generate-mermaid - Generate Mermaid diagram from steps
workflowsRouter.post('/generate-mermaid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { steps, name, entryStepId } = req.body;

    if (!steps || !Array.isArray(steps)) {
      throw createError('steps array is required', 400);
    }

    const normalizedSteps = normalizeSteps(steps);
    const mermaidDiagram = generateMermaidFromSteps(normalizedSteps, name, entryStepId);

    res.json({ data: { mermaidDiagram } });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

// Normalize steps to new format, handling both legacy and new formats
function normalizeSteps(steps: Array<WorkflowStep | LegacyWorkflowStep>): WorkflowStep[] {
  return steps.map((step) => {
    // Already in new format
    if ('stepType' in step) {
      return step as WorkflowStep;
    }

    // Convert from legacy format
    const legacyStep = step as LegacyWorkflowStep;
    return {
      id: legacyStep.id,
      name: legacyStep.name,
      stepType: 'step',
      type: legacyStep.type,
      hitlPhase: legacyStep.hitlPhase as HITLPhase,
      description: legacyStep.description,
      config: legacyStep.config,
    } as WorkflowRegularStep;
  });
}

// Remap step IDs during duplication
function remapStepIds(step: WorkflowStep, idMap: Map<string, string>): WorkflowStep {
  const newId = idMap.get(step.id) || step.id;

  switch (step.stepType) {
    case 'step':
      return {
        ...step,
        id: newId,
        nextStepId: step.nextStepId ? idMap.get(step.nextStepId) || step.nextStepId : null,
      };
    case 'branch':
      return {
        ...step,
        id: newId,
        trueBranchStepId: step.trueBranchStepId ? idMap.get(step.trueBranchStepId) || step.trueBranchStepId : null,
        falseBranchStepId: step.falseBranchStepId ? idMap.get(step.falseBranchStepId) || step.falseBranchStepId : null,
      };
    case 'foreach':
      return {
        ...step,
        id: newId,
        bodyStepIds: step.bodyStepIds.map((id) => idMap.get(id) || id),
        nextStepId: step.nextStepId ? idMap.get(step.nextStepId) || step.nextStepId : null,
      };
    case 'subworkflow':
      return {
        ...step,
        id: newId,
        nextStepId: step.nextStepId ? idMap.get(step.nextStepId) || step.nextStepId : null,
      };
  }
}

// ============================================================================
// Mermaid Parsing
// ============================================================================

interface ParsedNode {
  id: string;
  name: string;
  nodeType: 'step' | 'branch' | 'foreach' | 'subworkflow';
  stepType: 'automated' | 'manual';
  metadata?: Record<string, unknown>;
}

interface ParsedConnection {
  from: string;
  to: string;
  label?: string;
}

interface ParseResult {
  steps: WorkflowStep[];
  entryStepId: string | null;
}

function parseMermaidToSteps(mermaid: string): ParseResult {
  const lines = mermaid.split('\n');
  const nodes = new Map<string, ParsedNode>();
  const connections: ParsedConnection[] = [];
  const metadata = new Map<string, Record<string, unknown>>();
  const foreachBlocks: Array<{ id: string; nodeIds: string[] }> = [];

  let inForeachBlock = false;
  let currentForeachId = '';
  let currentForeachNodes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip diagram type declarations
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;
    if (line.startsWith('classDef') || line.startsWith('class ')) continue;
    if (line === 'end') {
      if (inForeachBlock) {
        foreachBlocks.push({ id: currentForeachId, nodeIds: currentForeachNodes });
        inForeachBlock = false;
        currentForeachId = '';
        currentForeachNodes = [];
      }
      continue;
    }

    // Parse metadata comments: %% @meta nodeId {"key": "value"}
    const metaMatch = line.match(/^%%\s*@meta\s+(\w+)\s+(.+)$/);
    if (metaMatch) {
      try {
        metadata.set(metaMatch[1], JSON.parse(metaMatch[2]));
      } catch {
        // Ignore invalid JSON
      }
      continue;
    }

    // Parse foreach subgraph: subgraph foreach_id["foreach: collection as item"]
    const foreachMatch = line.match(/^subgraph\s+(\w+)\s*\["foreach:\s*([^"]+)"\]/i);
    if (foreachMatch) {
      inForeachBlock = true;
      currentForeachId = foreachMatch[1];
      currentForeachNodes = [];
      const [collection, iterator] = foreachMatch[2].split(' as ').map((s) => s.trim());
      nodes.set(foreachMatch[1], {
        id: foreachMatch[1],
        name: `foreach: ${collection}`,
        nodeType: 'foreach',
        stepType: 'automated',
        metadata: { collection, iterator: iterator || 'item' },
      });
      continue;
    }

    // Parse regular subgraph (for grouping)
    if (line.startsWith('subgraph')) continue;

    // Parse nodes - order matters for regex matching
    let match;

    // Diamond/rhombus for branch: {Decision?} or {text}
    match = line.match(/(\w+)\s*\{([^}]+)\}/);
    if (match) {
      const nodeId = match[1];
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          name: match[2].replace(/\?$/, ''),
          nodeType: 'branch',
          stepType: 'manual',
        });
      }
      if (inForeachBlock && nodeId !== currentForeachId) {
        currentForeachNodes.push(nodeId);
      }
    }

    // Stadium shape for subworkflow: ([Subworkflow Name])
    match = line.match(/(\w+)\s*\(\[\s*([^\]]+)\s*\]\)/);
    if (match) {
      const nodeId = match[1];
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          name: match[2],
          nodeType: 'subworkflow',
          stepType: 'automated',
        });
      }
      if (inForeachBlock && nodeId !== currentForeachId) {
        currentForeachNodes.push(nodeId);
      }
    }

    // Double circle for manual: (( text ))
    match = line.match(/(\w+)\s*\(\(\s*"?([^")]+)"?\s*\)\)/);
    if (match) {
      const nodeId = match[1];
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          name: match[2],
          nodeType: 'step',
          stepType: 'manual',
        });
      }
      if (inForeachBlock && nodeId !== currentForeachId) {
        currentForeachNodes.push(nodeId);
      }
    }

    // Square brackets for automated: [text]
    match = line.match(/(\w+)\s*\[\s*"?([^"\]]+)"?\s*\]/);
    if (match && !line.match(/\(\[/)) {  // Exclude stadium shapes
      const nodeId = match[1];
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          name: match[2],
          nodeType: 'step',
          stepType: 'automated',
        });
      }
      if (inForeachBlock && nodeId !== currentForeachId) {
        currentForeachNodes.push(nodeId);
      }
    }

    // Round brackets for manual (single): (text)
    match = line.match(/(\w+)\s*\(\s*"?([^")]+)"?\s*\)(?!\))/);
    if (match && !line.match(/\(\[/) && !line.match(/\(\(/)) {
      const nodeId = match[1];
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          name: match[2],
          nodeType: 'step',
          stepType: 'manual',
        });
      }
      if (inForeachBlock && nodeId !== currentForeachId) {
        currentForeachNodes.push(nodeId);
      }
    }

    // Parse connections with labels: A -->|label| B or A -- label --> B
    const connLabelMatch = line.match(/(\w+)\s*-->\s*\|([^|]+)\|\s*(\w+)/);
    if (connLabelMatch) {
      connections.push({
        from: connLabelMatch[1],
        to: connLabelMatch[3],
        label: connLabelMatch[2].trim(),
      });
    }

    // Parse simple connections: A --> B
    const connMatches = line.matchAll(/(\w+)\s*-->\s*(?!\|)(\w+)/g);
    for (const connMatch of connMatches) {
      const from = connMatch[1];
      const to = connMatch[2];
      // Avoid duplicates from labeled connections
      if (!connections.some((c) => c.from === from && c.to === to)) {
        connections.push({ from, to });
      }
    }
  }

  // Build steps from parsed data
  const steps: WorkflowStep[] = [];

  // Calculate incoming connections for topological sort
  const incomingCount = new Map<string, number>();
  for (const node of nodes.keys()) {
    incomingCount.set(node, 0);
  }
  for (const conn of connections) {
    if (nodes.has(conn.to)) {
      incomingCount.set(conn.to, (incomingCount.get(conn.to) || 0) + 1);
    }
  }

  // Topological sort
  const visited = new Set<string>();
  const orderedNodeIds: string[] = [];
  const queue: string[] = [];

  for (const [nodeId, count] of incomingCount) {
    if (count === 0) queue.push(nodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    orderedNodeIds.push(nodeId);

    for (const conn of connections) {
      if (conn.from === nodeId && nodes.has(conn.to)) {
        const newCount = (incomingCount.get(conn.to) || 1) - 1;
        incomingCount.set(conn.to, newCount);
        if (newCount === 0 && !visited.has(conn.to)) {
          queue.push(conn.to);
        }
      }
    }
  }

  // Add any remaining unvisited nodes
  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      orderedNodeIds.push(nodeId);
    }
  }

  // Build connection lookup
  const outgoingConnections = new Map<string, ParsedConnection[]>();
  for (const conn of connections) {
    const existing = outgoingConnections.get(conn.from) || [];
    existing.push(conn);
    outgoingConnections.set(conn.from, existing);
  }

  // Convert nodes to steps
  for (const nodeId of orderedNodeIds) {
    const node = nodes.get(nodeId);
    if (!node) continue;

    const nodeMeta = metadata.get(nodeId) || node.metadata || {};
    const outgoing = outgoingConnections.get(nodeId) || [];

    switch (node.nodeType) {
      case 'step': {
        const step: WorkflowRegularStep = {
          id: nodeId,
          name: node.name,
          stepType: 'step',
          type: node.stepType,
          hitlPhase: (nodeMeta.hitlPhase as HITLPhase) || (node.stepType === 'manual' ? 'approval_required' : 'none'),
          nextStepId: outgoing.length > 0 ? outgoing[0].to : null,
        };
        if (nodeMeta.description) step.description = nodeMeta.description as string;
        if (nodeMeta.config) step.config = nodeMeta.config as Record<string, unknown>;
        steps.push(step);
        break;
      }

      case 'branch': {
        const trueConn = outgoing.find((c) => c.label?.toLowerCase() === 'yes' || c.label?.toLowerCase() === 'true');
        const falseConn = outgoing.find((c) => c.label?.toLowerCase() === 'no' || c.label?.toLowerCase() === 'false');
        const step: WorkflowBranchStep = {
          id: nodeId,
          name: node.name,
          stepType: 'branch',
          condition: (nodeMeta.condition as string) || node.name,
          trueBranchStepId: trueConn?.to || (outgoing.length > 0 ? outgoing[0].to : null),
          falseBranchStepId: falseConn?.to || (outgoing.length > 1 ? outgoing[1].to : null),
        };
        if (nodeMeta.description) step.description = nodeMeta.description as string;
        steps.push(step);
        break;
      }

      case 'foreach': {
        const foreachBlock = foreachBlocks.find((b) => b.id === nodeId);
        const step: WorkflowForeachStep = {
          id: nodeId,
          name: node.name,
          stepType: 'foreach',
          collection: (nodeMeta.collection as string) || 'items',
          iterator: (nodeMeta.iterator as string) || 'item',
          bodyStepIds: foreachBlock?.nodeIds || [],
          nextStepId: outgoing.length > 0 ? outgoing[0].to : null,
        };
        if (nodeMeta.description) step.description = nodeMeta.description as string;
        steps.push(step);
        break;
      }

      case 'subworkflow': {
        const step: WorkflowSubworkflowStep = {
          id: nodeId,
          name: node.name,
          stepType: 'subworkflow',
          workflowRef: (nodeMeta.workflowRef as string) || node.name,
          nextStepId: outgoing.length > 0 ? outgoing[0].to : null,
        };
        if (nodeMeta.description) step.description = nodeMeta.description as string;
        steps.push(step);
        break;
      }
    }
  }

  return {
    steps,
    entryStepId: orderedNodeIds.length > 0 ? orderedNodeIds[0] : null,
  };
}

// ============================================================================
// Mermaid Generation
// ============================================================================

function generateMermaidFromSteps(
  steps: WorkflowStep[],
  name?: string,
  entryStepId?: string
): string {
  const lines: string[] = ['flowchart TD'];
  const metadataLines: string[] = [];
  const connectionLines: string[] = [];
  const styleLines: string[] = [];

  const manualNodes: string[] = [];
  const hitlNodes: string[] = [];
  const branchNodes: string[] = [];
  const subworkflowNodes: string[] = [];

  // Create a map for quick step lookup
  const stepMap = new Map<string, WorkflowStep>();
  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  // Find foreach body steps to render inside subgraphs
  const foreachBodySteps = new Set<string>();
  for (const step of steps) {
    if (step.stepType === 'foreach') {
      for (const bodyStepId of step.bodyStepIds) {
        foreachBodySteps.add(bodyStepId);
      }
    }
  }

  // Generate node definitions and connections
  for (const step of steps) {
    const nodeName = step.name.replace(/"/g, "'");

    // Generate metadata comment for roundtrip
    const meta: Record<string, unknown> = {};
    if (step.description) meta.description = step.description;

    switch (step.stepType) {
      case 'step': {
        if (step.hitlPhase && step.hitlPhase !== 'none') {
          meta.hitlPhase = step.hitlPhase;
          hitlNodes.push(step.id);
        }
        if (step.config) meta.config = step.config;

        // Skip if inside a foreach block (handled separately)
        if (!foreachBodySteps.has(step.id)) {
          if (step.type === 'manual') {
            lines.push(`    ${step.id}(("${nodeName}"))`);
            manualNodes.push(step.id);
          } else if (step.hitlPhase !== 'none') {
            lines.push(`    ${step.id}["${nodeName}"]:::hitl`);
          } else {
            lines.push(`    ${step.id}["${nodeName}"]`);
          }
        }

        if (step.nextStepId) {
          connectionLines.push(`    ${step.id} --> ${step.nextStepId}`);
        }
        break;
      }

      case 'branch': {
        meta.condition = step.condition;
        lines.push(`    ${step.id}{${nodeName}?}`);
        branchNodes.push(step.id);

        if (step.trueBranchStepId) {
          connectionLines.push(`    ${step.id} -->|Yes| ${step.trueBranchStepId}`);
        }
        if (step.falseBranchStepId) {
          connectionLines.push(`    ${step.id} -->|No| ${step.falseBranchStepId}`);
        }
        break;
      }

      case 'foreach': {
        meta.collection = step.collection;
        meta.iterator = step.iterator;

        // Create a subgraph for the loop
        lines.push(`    subgraph ${step.id}["foreach: ${step.collection} as ${step.iterator}"]`);

        // Add body steps inside the subgraph
        for (const bodyStepId of step.bodyStepIds) {
          const bodyStep = stepMap.get(bodyStepId);
          if (bodyStep && bodyStep.stepType === 'step') {
            const bodyName = bodyStep.name.replace(/"/g, "'");
            if (bodyStep.type === 'manual') {
              lines.push(`        ${bodyStep.id}(("${bodyName}"))`);
              manualNodes.push(bodyStep.id);
            } else {
              lines.push(`        ${bodyStep.id}["${bodyName}"]`);
            }
          }
        }

        // Connect body steps internally
        for (let i = 0; i < step.bodyStepIds.length - 1; i++) {
          connectionLines.push(`    ${step.bodyStepIds[i]} --> ${step.bodyStepIds[i + 1]}`);
        }

        // Loop back arrow (last body step to first)
        if (step.bodyStepIds.length > 0) {
          const lastBody = step.bodyStepIds[step.bodyStepIds.length - 1];
          const firstBody = step.bodyStepIds[0];
          connectionLines.push(`    ${lastBody} -.->|next iteration| ${firstBody}`);
        }

        lines.push('    end');

        if (step.nextStepId) {
          connectionLines.push(`    ${step.id} --> ${step.nextStepId}`);
        }
        break;
      }

      case 'subworkflow': {
        meta.workflowRef = step.workflowRef;
        lines.push(`    ${step.id}(["${nodeName}"])`);
        subworkflowNodes.push(step.id);

        if (step.nextStepId) {
          connectionLines.push(`    ${step.id} --> ${step.nextStepId}`);
        }
        break;
      }
    }

    // Add metadata comment if there's any metadata
    if (Object.keys(meta).length > 0) {
      metadataLines.push(`%% @meta ${step.id} ${JSON.stringify(meta)}`);
    }
  }

  // Add connections
  lines.push('');
  lines.push(...connectionLines);

  // Add styling
  lines.push('');
  styleLines.push('    classDef hitl fill:#8B5CF6,color:#fff');
  styleLines.push('    classDef manual fill:#EC4899,color:#fff');
  styleLines.push('    classDef branch fill:#F59E0B,color:#fff');
  styleLines.push('    classDef subworkflow fill:#06B6D4,color:#fff,stroke-dasharray: 5 5');

  lines.push(...styleLines);

  if (manualNodes.length > 0) {
    lines.push(`    class ${manualNodes.join(',')} manual`);
  }
  if (branchNodes.length > 0) {
    lines.push(`    class ${branchNodes.join(',')} branch`);
  }
  if (subworkflowNodes.length > 0) {
    lines.push(`    class ${subworkflowNodes.join(',')} subworkflow`);
  }

  // Add metadata section at the end for AI collaboration
  if (metadataLines.length > 0) {
    lines.push('');
    lines.push('%% === WORKFLOW METADATA (DO NOT EDIT MANUALLY) ===');
    if (name) {
      lines.push(`%% @workflow {"name": "${name}", "entryStepId": "${entryStepId || steps[0]?.id || ''}"}`);
    }
    lines.push(...metadataLines);
  }

  return lines.join('\n');
}
