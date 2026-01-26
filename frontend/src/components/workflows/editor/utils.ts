import type { WorkflowStep, LoopScope } from './types'

// Detect loop scopes (ForEach → Join boundaries)
export function detectLoopScopes(steps: WorkflowStep[]): LoopScope[] {
  const scopes: LoopScope[] = []
  const foreachStack: { index: number; step: WorkflowStep }[] = []

  steps.forEach((step, index) => {
    if (step.stepType === 'foreach') {
      foreachStack.push({ index, step })
    } else if (step.stepType === 'join' && foreachStack.length > 0) {
      // Match this join with the most recent foreach
      const foreach = foreachStack.pop()!
      scopes.push({
        foreachIndex: foreach.index,
        joinIndex: index,
        foreachStep: foreach.step,
        joinStep: step,
      })
    }
  })

  return scopes
}

// Get available outputs from a step (for variable picker)
export function getStepOutputs(step: WorkflowStep): { path: string; description: string }[] {
  const outputs: { path: string; description: string }[] = []

  switch (step.stepType) {
    case 'external':
      outputs.push(
        { path: 'output', description: 'Full webhook response' },
        { path: 'output.data', description: 'Response data field' },
        { path: 'output.status', description: 'Response status' },
      )
      break
    case 'foreach':
      outputs.push(
        { path: step.itemVariable || 'item', description: 'Current loop item' },
        { path: '_index', description: 'Current item index (0-based)' },
        { path: '_total', description: 'Total items in loop' },
      )
      break
    case 'join':
      outputs.push(
        { path: 'aggregatedResults', description: 'Array of all completed task outputs' },
        { path: 'aggregatedResults[0]', description: 'First result' },
        { path: 'completedCount', description: 'Number of completed tasks' },
        { path: 'expectedCount', description: 'Total expected tasks' },
      )
      break
    case 'agent':
    case 'manual':
      outputs.push(
        { path: 'output', description: 'Task output/response' },
        { path: 'output.result', description: 'Result field (if set)' },
        { path: 'metadata', description: 'Full task metadata' },
      )
      break
    case 'decision':
      outputs.push(
        { path: 'selectedBranch', description: 'Which branch was selected' },
        { path: 'condition', description: 'Evaluated condition' },
      )
      break
    default:
      outputs.push({ path: 'output', description: 'Step output' })
  }

  return outputs
}

// Get the full input path with step reference
export function buildInputPath(sourceStepId: string | undefined, path: string): string {
  // Normalize path - remove leading/trailing dots and collapse multiple dots
  const normalizedPath = path?.replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.') || ''

  if (!sourceStepId || sourceStepId === 'previous') {
    return normalizedPath
  }
  if (sourceStepId === 'trigger') {
    return normalizedPath ? `trigger.${normalizedPath}` : 'trigger'
  }
  return normalizedPath ? `steps.${sourceStepId}.${normalizedPath}` : `steps.${sourceStepId}`
}

// Parse input path to extract source and path
export function parseInputPath(inputPath: string | undefined): { source: string; path: string } {
  if (!inputPath) return { source: 'previous', path: '' }

  if (inputPath.startsWith('steps.')) {
    const parts = inputPath.split('.')
    return { source: parts[1], path: parts.slice(2).join('.') }
  }
  if (inputPath.startsWith('trigger.')) {
    return { source: 'trigger', path: inputPath.slice(8) }
  }
  return { source: 'previous', path: inputPath }
}

// Generate Mermaid diagram from workflow steps
export function generateMermaidFromSteps(steps: WorkflowStep[], _name?: string): string {
  if (steps.length === 0) return ''

  const lines: string[] = ['flowchart TD']
  const metadataComments: string[] = []  // Collect metadata comments to add at the end
  const loopScopes = detectLoopScopes(steps)

  // Build a map of which steps are in which loop scope
  const stepLoopScope = new Map<number, LoopScope>()
  for (const scope of loopScopes) {
    // Steps between foreach (exclusive) and join (exclusive) are in the loop
    for (let i = scope.foreachIndex + 1; i < scope.joinIndex; i++) {
      stepLoopScope.set(i, scope)
    }
  }

  // Generate node definitions (no subgraphs - they break mermaid rendering)
  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`
    const label = step.name.replace(/"/g, '#quot;')

    // Collect step metadata to preserve in comments
    // Exclude fields that are represented in the Mermaid shape itself (id, name, stepType, connections)
    const metadata: Record<string, unknown> = {}

    // Common fields
    if (step.description) metadata.description = step.description
    if (step.defaultAssigneeId) metadata.defaultAssigneeId = step.defaultAssigneeId
    if (step.inputPath) metadata.inputPath = step.inputPath

    // Agent/manual step fields
    if (step.additionalInstructions) metadata.additionalInstructions = step.additionalInstructions

    // External step fields
    if (step.externalConfig && Object.keys(step.externalConfig).length > 0) {
      metadata.externalConfig = step.externalConfig
    }

    // Decision step fields
    if (step.defaultConnection) metadata.defaultConnection = step.defaultConnection

    // ForEach step fields
    if (step.itemsPath) metadata.itemsPath = step.itemsPath
    if (step.itemVariable) metadata.itemVariable = step.itemVariable
    if (step.maxItems) metadata.maxItems = step.maxItems

    // Join step fields
    if (step.awaitTag) metadata.awaitTag = step.awaitTag
    if (step.minSuccessPercent) metadata.minSuccessPercent = step.minSuccessPercent

    // Shared by ForEach and Join
    if (step.expectedCountPath) metadata.expectedCountPath = step.expectedCountPath

    // Flow step fields
    if (step.flowId) metadata.flowId = step.flowId
    if (step.inputMapping && Object.keys(step.inputMapping).length > 0) {
      metadata.inputMapping = step.inputMapping
    }

    // Queue metadata comment if there's any data to preserve (will add at the end)
    if (Object.keys(metadata).length > 0) {
      metadataComments.push(`    %% @step(${nodeId}): ${JSON.stringify(metadata)}`)
    }

    switch (step.stepType) {
      case 'agent':
        lines.push(`    ${nodeId}["${label}"]`)
        break
      case 'external':
        lines.push(`    ${nodeId}{{"${label}"}}`)
        break
      case 'manual':
        lines.push(`    ${nodeId}("${label}")`)
        break
      case 'decision':
        lines.push(`    ${nodeId}{"${label}"}`)
        break
      case 'foreach':
        const itemsPath = step.itemsPath ? ` (${step.itemsPath})` : ''
        lines.push(`    ${nodeId}[["Each: ${label}${itemsPath}"]]`)
        break
      case 'join':
        const pct = step.minSuccessPercent !== undefined ? ` @${step.minSuccessPercent}%` : ''
        lines.push(`    ${nodeId}[["Join: ${label}${pct}"]]`)
        break
      case 'flow':
        lines.push(`    ${nodeId}[["Run: ${label}"]]`)
        break
      default:
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          lines.push(`${nodeId}(["${label}"])`)
        } else {
          lines.push(`    ${nodeId}["${label}"]`)
        }
    }
  })

  // Generate connections with data flow labels
  lines.push('')
  const connectedFrom = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const nodeId = step.id || `step${i}`

    // Use explicit connections if defined
    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (conn.condition || conn.label) {
          lines.push(`    ${nodeId} -->|"${conn.label || conn.condition}"| ${conn.targetStepId}`)
        } else {
          lines.push(`    ${nodeId} --> ${conn.targetStepId}`)
        }
      }
      connectedFrom.add(nodeId)
    }
    // Legacy: use branches for decision nodes
    else if (step.stepType === 'decision' && step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        if (branch.condition) {
          lines.push(`    ${nodeId} -->|"${branch.condition}"| ${branch.targetStepId}`)
        } else {
          lines.push(`    ${nodeId} --> ${branch.targetStepId}`)
        }
      }
      connectedFrom.add(nodeId)
    }
  }

  // Only add linear connections if NO nodes have explicit connections defined
  // This preserves nonlinear workflows while supporting legacy linear-only workflows
  if (connectedFrom.size === 0) {
    for (let i = 0; i < steps.length - 1; i++) {
      const step = steps[i]
      const nodeId = step.id || `step${i}`
      const nextStep = steps[i + 1]
      const nextNodeId = nextStep.id || `step${i + 1}`

      if (step.stepType === 'foreach' && nextStep.stepType === 'join') {
        // Dashed line for parallel execution
        lines.push(`    ${nodeId} -.-> ${nextNodeId}`)
      } else {
        lines.push(`    ${nodeId} --> ${nextNodeId}`)
      }
    }
  }

  // Add styling classes with distinct colors
  lines.push('')
  lines.push('    classDef agent fill:#3B82F6,color:#fff,stroke:#2563EB')
  lines.push('    classDef external fill:#F97316,color:#fff,stroke:#EA580C')
  lines.push('    classDef manual fill:#8B5CF6,color:#fff,stroke:#7C3AED')
  lines.push('    classDef decision fill:#F59E0B,color:#fff,stroke:#D97706')
  lines.push('    classDef foreach fill:#10B981,color:#fff,stroke:#059669')
  lines.push('    classDef join fill:#6366F1,color:#fff,stroke:#4F46E5')
  lines.push('    classDef flow fill:#EC4899,color:#fff,stroke:#DB2777')

  // Apply classes to nodes
  const classGroups: Record<string, string[]> = {
    agent: [],
    external: [],
    manual: [],
    decision: [],
    foreach: [],
    join: [],
    flow: [],
  }

  steps.forEach((step, i) => {
    const nodeId = step.id || `step${i}`

    switch (step.stepType) {
      case 'agent':
        classGroups.agent.push(nodeId)
        break
      case 'external':
        classGroups.external.push(nodeId)
        break
      case 'manual':
        classGroups.manual.push(nodeId)
        break
      case 'decision':
        classGroups.decision.push(nodeId)
        break
      case 'foreach':
        classGroups.foreach.push(nodeId)
        break
      case 'join':
        classGroups.join.push(nodeId)
        break
      case 'flow':
        classGroups.flow.push(nodeId)
        break
      default:
        const execution = step.execution || step.type || 'automated'
        if (execution === 'manual') {
          classGroups.manual.push(nodeId)
        } else {
          classGroups.agent.push(nodeId)
        }
    }
  })

  // Output class assignments
  for (const [className, nodeIds] of Object.entries(classGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${className}`)
    }
  }

  // Add step metadata comments at the end (keeps diagram structure clean at the top)
  if (metadataComments.length > 0) {
    lines.push('')
    lines.push('    %% Step configuration (preserved on import)')
    lines.push(...metadataComments)
  }

  return lines.join('\n')
}
