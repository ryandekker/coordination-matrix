import { ObjectId } from 'mongodb';
import { WorkflowStep, WorkflowStepType, StepConnection } from './types.js';

// Result type for parseMermaidToSteps that includes parse warnings
export interface ParseMermaidResult {
  steps: WorkflowStep[];
  warnings: string[];
}

// Helper function to parse Mermaid flowchart to workflow steps
export function parseMermaidToSteps(mermaid: string): WorkflowStep[] {
  const result = parseMermaidToStepsWithWarnings(mermaid);
  return result.steps;
}

// Version that returns warnings for error reporting
export function parseMermaidToStepsWithWarnings(mermaid: string): ParseMermaidResult {
  const steps: WorkflowStep[] = [];
  const warnings: string[] = [];
  const lines = mermaid.split('\n').map((l) => l.trim()).filter(Boolean);

  // Node storage with full step info
  interface ParsedNode {
    id: string;  // Keep original mermaid ID for connection mapping
    name: string;
    stepType: WorkflowStepType;
    itemsPath?: string;
    minSuccessPercent?: number;
  }

  const nodes: Map<string, ParsedNode> = new Map();
  const connections: Array<{ from: string; to: string; label?: string }> = [];

  // Step metadata from comments: %% @step(nodeId): {json}
  const stepMetadata: Map<string, Record<string, unknown>> = new Map();

  // Track class definitions for step type inference from :::class suffix
  const nodeClasses: Map<string, string> = new Map();

  for (const line of lines) {
    // Parse step configuration comments first
    const stepConfigMatch = line.match(/%% @step\(([^)]+)\):\s*(.+)/);
    if (stepConfigMatch) {
      try {
        const [, stepId, configJson] = stepConfigMatch;
        const config = JSON.parse(configJson);
        stepMetadata.set(stepId, config);
      } catch (e) {
        // Capture JSON parse errors with details
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        warnings.push(`Invalid JSON in @step(${stepConfigMatch[1]}): ${errorMsg}`);
      }
      continue;
    }

    // Extract :::class suffix from any node definition
    const classMatch = line.match(/:::([\w-]+)\s*$/);
    if (classMatch) {
      // Find the node ID at the start of the line
      const nodeIdMatch = line.match(/^([\w-]+)/);
      if (nodeIdMatch) {
        nodeClasses.set(nodeIdMatch[1], classMatch[1]);
      }
    }

    // Skip diagram type declarations, styling, and other comments
    if (line.startsWith('graph') || line.startsWith('flowchart')) continue;
    if (line.startsWith('classDef') || line.startsWith('class ')) continue;
    if (line.startsWith('%%')) continue;
    if (line.startsWith('subgraph') || line === 'end' || line.startsWith('direction')) continue;

    // Parse node definitions - order matters! More specific patterns first

    // Hexagon {{ }} - external service/API call
    const hexagonMatch = line.match(/^([\w-]+)\{\{["']?([^"}]+?)["']?\}\}/);
    if (hexagonMatch) {
      const [, id, text] = hexagonMatch;
      const cleanName = text.replace(/^(ext|api|webhook|trigger):\s*/i, '').trim();
      nodes.set(id, { id, name: cleanName, stepType: 'external' });
      continue;
    }

    // Double square brackets [[ ]] - foreach/join/flow
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
        const itemsMatch = cleanName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (itemsMatch) {
          cleanName = itemsMatch[1].trim();
          itemsPath = itemsMatch[2].trim();
        }
      } else if (lowerText.startsWith('join:') || lowerText.startsWith('merge:')) {
        stepType = 'join';
        cleanName = text.replace(/^(join|merge):\s*/i, '').trim();
        const pctMatch = cleanName.match(/^(.+?)\s*@(\d+)%\s*$/);
        if (pctMatch) {
          cleanName = pctMatch[1].trim();
          minSuccessPercent = parseInt(pctMatch[2]);
        }
      } else if (lowerText.startsWith('run:') || lowerText.startsWith('flow:')) {
        stepType = 'flow';
        cleanName = text.replace(/^(run|flow):\s*/i, '').trim();
      } else {
        stepType = 'foreach';
        cleanName = text;
      }

      nodes.set(id, { id, name: cleanName, stepType, itemsPath, minSuccessPercent });
      continue;
    }

    // Diamond brackets { } - decision/routing
    const diamondMatch = line.match(/^([\w-]+)\{["']?([^"}]+?)["']?\}/);
    if (diamondMatch) {
      const [, id, text] = diamondMatch;
      nodes.set(id, { id, name: text, stepType: 'decision' });
      continue;
    }

    // Double round brackets (( )) - manual/HITL task (stadium shape)
    const stadiumMatch = line.match(/^([\w-]+)\(\(["']?([^")]+?)["']?\)\)/);
    if (stadiumMatch) {
      const [, id, text] = stadiumMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single round brackets ( ) - manual/HITL task
    const roundMatch = line.match(/^([\w-]+)\(["']?([^")]+?)["']?\)/);
    if (roundMatch) {
      const [, id, text] = roundMatch;
      nodes.set(id, { id, name: text, stepType: 'manual' });
      continue;
    }

    // Single square brackets [ ] - agent task (default)
    const squareMatch = line.match(/^([\w-]+)\[["']?([^"\]]+?)["']?\]/);
    if (squareMatch) {
      const [, id, text] = squareMatch;
      const lowerText = text.toLowerCase();

      const classType = nodeClasses.get(id);
      let stepType: WorkflowStepType = 'agent';

      if (classType) {
        const classToType: Record<string, WorkflowStepType> = {
          'agent': 'agent',
          'manual': 'manual',
          'external': 'external',
          'webhook': 'external',
          'decision': 'decision',
          'foreach': 'foreach',
          'join': 'join',
          'flow': 'flow',
        };
        stepType = classToType[classType] || 'agent';
      } else if (lowerText.startsWith('ext:') || lowerText.startsWith('api:') || lowerText.startsWith('webhook:')) {
        stepType = 'external';
      }

      const cleanName = text.replace(/^(ext|api|webhook):\s*/i, '').trim();
      nodes.set(id, { id, name: cleanName, stepType });
      continue;
    }

    // Parse connections
    const extractInlineNode = (segment: string): string | null => {
      const doubleSquare = segment.match(/([\w-]+)\[\[["']?([^"\]]+?)["']?\]\]/);
      if (doubleSquare) {
        const [, id, text] = doubleSquare;
        const lowerText = text.toLowerCase();
        let stepType: WorkflowStepType = 'flow';
        let cleanName = text;
        if (lowerText.startsWith('run:') || lowerText.startsWith('flow:')) {
          cleanName = text.replace(/^(run|flow):\s*/i, '').trim();
        } else if (lowerText.startsWith('each:') || lowerText.startsWith('foreach:')) {
          stepType = 'foreach';
          cleanName = text.replace(/^(each|foreach):\s*/i, '').trim();
        } else if (lowerText.startsWith('join:') || lowerText.startsWith('merge:')) {
          stepType = 'join';
          cleanName = text.replace(/^(join|merge):\s*/i, '').trim();
        }
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: cleanName, stepType });
        }
        return id;
      }

      const diamond = segment.match(/([\w-]+)\{["']?([^"}]+?)["']?\}/);
      if (diamond) {
        const [, id, text] = diamond;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: text, stepType: 'decision' });
        }
        return id;
      }

      const round = segment.match(/([\w-]+)\(["']?([^")]+?)["']?\)/);
      if (round) {
        const [, id, text] = round;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: text, stepType: 'manual' });
        }
        return id;
      }

      const square = segment.match(/([\w-]+)\[["']?([^"\]]+?)["']?\]/);
      if (square) {
        const [, id, text] = square;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: text, stepType: 'agent' });
        }
        return id;
      }

      return null;
    };

    // Find labeled connections
    const labeledConnRegex = /([\w-]+(?:\[\[.*?\]\]|\{.*?\}|\(.*?\)|\[.*?\])?)\s*-->?\|["']?([^|"']+?)["']?\|\s*([\w-]+(?:\[\[.*?\]\]|\{.*?\}|\(.*?\)|\[.*?\])?)/g;
    let labeledMatch;
    const labeledFromTo = new Set<string>();

    while ((labeledMatch = labeledConnRegex.exec(line)) !== null) {
      let from = labeledMatch[1];
      let to = labeledMatch[3];
      const label = labeledMatch[2].trim();

      const fromNode = extractInlineNode(from);
      const toNode = extractInlineNode(to);

      from = fromNode || from.match(/^([\w-]+)/)?.[1] || from;
      to = toNode || to.match(/^([\w-]+)/)?.[1] || to;

      connections.push({ from, to, label });
      labeledFromTo.add(`${from}->${to}`);
    }

    // Find simple connections
    const simpleConnRegex = /([\w-]+(?:\[\[.*?\]\]|\{.*?\}|\(.*?\)|\[.*?\])?)\s*-->\s*([\w-]+(?:\[\[.*?\]\]|\{.*?\}|\(.*?\)|\[.*?\])?)/g;
    let simpleMatch;

    while ((simpleMatch = simpleConnRegex.exec(line)) !== null) {
      let from = simpleMatch[1];
      let to = simpleMatch[2];

      const fromNode = extractInlineNode(from);
      const toNode = extractInlineNode(to);

      from = fromNode || from.match(/^([\w-]+)/)?.[1] || from;
      to = toNode || to.match(/^([\w-]+)/)?.[1] || to;

      if (!labeledFromTo.has(`${from}->${to}`) && !connections.some((c) => c.from === from && c.to === to)) {
        connections.push({ from, to });
      }
    }
  }

  // Build ordered steps using topological sort
  const visited = new Set<string>();
  const orderedNodes: string[] = [];

  const incomingCount: Map<string, number> = new Map();
  for (const node of nodes.keys()) {
    incomingCount.set(node, 0);
  }
  for (const conn of connections) {
    if (nodes.has(conn.to)) {
      incomingCount.set(conn.to, (incomingCount.get(conn.to) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [node, count] of incomingCount) {
    if (count === 0) queue.push(node);
  }

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

  for (const node of nodes.keys()) {
    if (!visited.has(node)) {
      orderedNodes.push(node);
    }
  }

  const mermaidIdToStepId: Map<string, string> = new Map();

  for (const mermaidId of orderedNodes) {
    const node = nodes.get(mermaidId);
    if (node) {
      const stepId = mermaidId.startsWith('step-') ? mermaidId : new ObjectId().toString();
      mermaidIdToStepId.set(mermaidId, stepId);

      const step: WorkflowStep = {
        id: stepId,
        name: node.name,
        stepType: node.stepType,
      };

      if (node.itemsPath) step.itemsPath = node.itemsPath;
      if (node.minSuccessPercent !== undefined) step.minSuccessPercent = node.minSuccessPercent;

      const metadata = stepMetadata.get(mermaidId);
      if (metadata) {
        const { id: _id, name: _name, stepType: _stepType, ...safeMetadata } = metadata as Record<string, unknown>;
        Object.assign(step, safeMetadata);
      }

      const stepConnections: StepConnection[] = [];
      for (const conn of connections) {
        if (conn.from === mermaidId) {
          stepConnections.push({
            targetStepId: conn.to,
            condition: conn.label || undefined,
            label: conn.label || undefined,
          });
        }
      }

      if (stepConnections.length > 0) {
        step.connections = stepConnections;
      }

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

  // Remap connection targetStepIds
  for (const step of steps) {
    if (step.connections) {
      for (const conn of step.connections) {
        const actualStepId = mermaidIdToStepId.get(conn.targetStepId);
        if (actualStepId) {
          conn.targetStepId = actualStepId;
        }
      }
    }
    if (step.stepType === 'decision' && step.connections) {
      step.branches = step.connections.map(c => ({
        condition: c.condition || null,
        targetStepId: c.targetStepId,
      }));
    }
  }

  return { steps, warnings };
}

// Helper function to generate Mermaid diagram from workflow steps
export function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return '';

  const lines: string[] = ['flowchart TD'];
  const metadataComments: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;
    // Use placeholder for empty names to avoid Mermaid syntax errors
    const rawName = step.name?.trim() || '(unnamed)';
    const nodeName = rawName.replace(/"/g, "'");

    const metadata: Record<string, unknown> = {};
    if (step.description) metadata.description = step.description;
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId;
    if (step.inputPath) metadata.inputPath = step.inputPath;
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions;
    if (step.externalConfig) metadata.externalConfig = step.externalConfig;
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection;
    if (step.itemsPath) metadata.itemsPath = step.itemsPath;
    if (step.itemVariable) metadata.itemVariable = step.itemVariable;
    if (step.maxItems) metadata.maxItems = step.maxItems;
    if (step.stepType === 'foreach' && step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath;
    if (step.awaitStepId) metadata.awaitStepId = step.awaitStepId;
    if (step.joinBoundary) metadata.joinBoundary = step.joinBoundary;
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent;
    if (step.stepType === 'join' && step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath;
    if (step.flowId) metadata.flowId = step.flowId;
    if (step.inputMapping) metadata.inputMapping = step.inputMapping;

    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`    %% @step(${nodeId}): ${JSON.stringify(metadata)}`);
    }

    switch (step.stepType) {
      case 'agent':
        lines.push(`    ${nodeId}["${nodeName}"]`);
        break;
      case 'external':
        lines.push(`    ${nodeId}{{"${nodeName}"}}`);
        break;
      case 'manual':
        lines.push(`    ${nodeId}("${nodeName}")`);
        break;
      case 'decision':
        lines.push(`    ${nodeId}{"${nodeName}"}`);
        break;
      case 'foreach':
        lines.push(`    ${nodeId}[["Each: ${nodeName}"]]`);
        break;
      case 'join':
        lines.push(`    ${nodeId}[["Join: ${nodeName}"]]`);
        break;
      case 'flow':
        lines.push(`    ${nodeId}[["Run: ${nodeName}"]]`);
        break;
      default:
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          lines.push(`    ${nodeId}("${nodeName}")`);
        } else {
          lines.push(`    ${nodeId}["${nodeName}"]`);
        }
    }
  }

  const connectedFrom = new Set<string>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`    ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`);
        } else {
          lines.push(`    ${nodeId} --> ${conn.targetStepId}`);
        }
      }
      connectedFrom.add(nodeId);
    } else if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
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

  if (connectedFrom.size === 0) {
    for (let i = 0; i < steps.length - 1; i++) {
      const step = steps[i];
      const nodeId = step.id || `step${i}`;
      const nextNodeId = steps[i + 1].id || `step${i + 1}`;
      lines.push(`    ${nodeId} --> ${nextNodeId}`);
    }
  }

  lines.push('');
  lines.push('    classDef agent fill:#3B82F6,color:#fff');
  lines.push('    classDef external fill:#F97316,color:#fff');
  lines.push('    classDef manual fill:#8B5CF6,color:#fff');
  lines.push('    classDef decision fill:#F59E0B,color:#fff');
  lines.push('    classDef foreach fill:#10B981,color:#fff');
  lines.push('    classDef join fill:#6366F1,color:#fff');
  lines.push('    classDef flow fill:#EC4899,color:#fff');

  const classGroups: Record<string, string[]> = {
    agent: [], external: [], manual: [], decision: [], foreach: [], join: [], flow: [],
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = step.id || `step${i}`;

    switch (step.stepType) {
      case 'agent': classGroups.agent.push(nodeId); break;
      case 'external': classGroups.external.push(nodeId); break;
      case 'manual': classGroups.manual.push(nodeId); break;
      case 'decision': classGroups.decision.push(nodeId); break;
      case 'foreach': classGroups.foreach.push(nodeId); break;
      case 'join': classGroups.join.push(nodeId); break;
      case 'flow': classGroups.flow.push(nodeId); break;
      default:
        const execution = step.execution || step.type || 'automated';
        if (execution === 'manual') {
          classGroups.manual.push(nodeId);
        } else {
          classGroups.agent.push(nodeId);
        }
    }
  }

  for (const [className, nodeIds] of Object.entries(classGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${className}`);
    }
  }

  if (metadataComments.length > 0) {
    lines.push('');
    lines.push('    %% Step configuration (preserved on import)');
    lines.push(...metadataComments);
  }

  return lines.join('\n');
}

// Generate subgraph content for multi-workflow export
export function generateMermaidSubgraphContent(steps: WorkflowStep[], workflowId: string): string {
  if (steps.length === 0) return '';

  const lines: string[] = [];
  const metadataComments: string[] = [];
  const connectedFrom = new Set<string>();

  const stepIdToNodeId = new Map<string, string>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const originalId = step.id || `step${i}`;
    const nodeId = `${workflowId}_${originalId}`;
    stepIdToNodeId.set(originalId, nodeId);
    if (step.id) {
      stepIdToNodeId.set(step.id, nodeId);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const originalId = step.id || `step${i}`;
    const nodeId = stepIdToNodeId.get(originalId)!;
    // Use placeholder for empty names to avoid Mermaid syntax errors
    const rawName = step.name?.trim() || '(unnamed)';
    const nodeName = rawName.replace(/"/g, "'");

    const metadata: Record<string, unknown> = {};
    if (step.description) metadata.description = step.description;
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId;
    if (step.inputPath) metadata.inputPath = step.inputPath;
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions;
    if (step.externalConfig) metadata.externalConfig = step.externalConfig;
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection;
    if (step.itemsPath) metadata.itemsPath = step.itemsPath;
    if (step.itemVariable) metadata.itemVariable = step.itemVariable;
    if (step.maxItems) metadata.maxItems = step.maxItems;
    if (step.awaitStepId) metadata.awaitStepId = step.awaitStepId;
    if (step.joinBoundary) metadata.joinBoundary = step.joinBoundary;
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent;
    if (step.flowId) metadata.flowId = step.flowId;
    if (step.inputMapping) metadata.inputMapping = step.inputMapping;

    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`        %% @step(${nodeId}): ${JSON.stringify(metadata)}`);
    }

    let nodeShape: string;
    let nodeClass: string;

    switch (step.stepType) {
      case 'agent':
        nodeShape = `${nodeId}["${nodeName}"]`;
        nodeClass = 'agent';
        break;
      case 'external':
        nodeShape = `${nodeId}{{"${nodeName}"}}`;
        nodeClass = 'external';
        break;
      case 'manual':
        nodeShape = `${nodeId}("${nodeName}")`;
        nodeClass = 'manual';
        break;
      case 'decision':
        nodeShape = `${nodeId}{"${nodeName}"}`;
        nodeClass = 'decision';
        break;
      case 'foreach':
        nodeShape = `${nodeId}[["Each: ${nodeName}"]]`;
        nodeClass = 'foreach';
        break;
      case 'join':
        nodeShape = `${nodeId}[["Join: ${nodeName}"]]`;
        nodeClass = 'join';
        break;
      case 'flow':
        nodeShape = `${nodeId}[["Run: ${nodeName}"]]`;
        nodeClass = 'flow';
        break;
      default:
        nodeShape = `${nodeId}["${nodeName}"]`;
        nodeClass = 'agent';
    }

    lines.push(`        ${nodeShape}:::${nodeClass}`);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const originalId = step.id || `step${i}`;
    const nodeId = stepIdToNodeId.get(originalId)!;

    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        const targetNodeId = stepIdToNodeId.get(conn.targetStepId) || `${workflowId}_${conn.targetStepId}`;
        if (conn.condition || conn.label) {
          lines.push(`        ${nodeId} -->|"${conn.label || conn.condition}"| ${targetNodeId}`);
        } else {
          lines.push(`        ${nodeId} --> ${targetNodeId}`);
        }
      }
      connectedFrom.add(nodeId);
    }
  }

  // Only add linear fallback connections if no steps have explicit connections
  // (i.e., it's a truly linear workflow)
  if (connectedFrom.size === 0) {
    for (let i = 0; i < steps.length - 1; i++) {
      const step = steps[i];
      const originalId = step.id || `step${i}`;
      const nodeId = stepIdToNodeId.get(originalId)!;
      const nextOriginalId = steps[i + 1].id || `step${i + 1}`;
      const nextNodeId = stepIdToNodeId.get(nextOriginalId)!;
      lines.push(`        ${nodeId} --> ${nextNodeId}`);
    }
  }

  if (metadataComments.length > 0) {
    lines.push('');
    lines.push(...metadataComments);
  }

  return lines.join('\n');
}
