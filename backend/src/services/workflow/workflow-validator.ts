import { ObjectId } from 'mongodb';
import { getDb } from '../../db/connection.js';
import { WorkflowStep, WorkflowStepType, VALID_STEP_TYPES } from '../../routes/workflows/types.js';

// ============================================================================
// Diagnostic Types
// ============================================================================

export type DiagnosticLevel = 'error' | 'warning' | 'info';

export interface WorkflowDiagnostic {
  level: DiagnosticLevel;
  code: string;
  stepId?: string;
  stepName?: string;
  field?: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: WorkflowDiagnostic[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  stepGraph: {
    reachableSteps: string[];
    unreachableSteps: string[];
    terminalSteps: string[];
  };
}

// ============================================================================
// Validation Context
// ============================================================================

export interface ValidationContext {
  steps: WorkflowStep[];
  stepIds: Set<string>;
  stepMap: Map<string, WorkflowStep>;
  /** Index position of each step in the array */
  stepIndex: Map<string, number>;
}

// ============================================================================
// Step Type Validator Registry
// ============================================================================

interface StepTypeValidator {
  stepType: WorkflowStepType;
  requiredFields: { field: string; description: string }[];
  validate(step: WorkflowStep, ctx: ValidationContext): WorkflowDiagnostic[];
}

const stepTypeValidators = new Map<WorkflowStepType, StepTypeValidator>();

function registerValidator(validator: StepTypeValidator) {
  stepTypeValidators.set(validator.stepType, validator);
}

// -- trigger --
registerValidator({
  stepType: 'trigger',
  requiredFields: [],
  validate(step, ctx) {
    const diags: WorkflowDiagnostic[] = [];
    const idx = ctx.stepIndex.get(step.id);
    if (idx !== undefined && idx !== 0) {
      diags.push({
        level: 'warning',
        code: 'TRIGGER_NOT_FIRST',
        stepId: step.id,
        stepName: step.name,
        message: 'Trigger step should be the first step in the workflow.',
        suggestion: 'Move the trigger step to position 0.',
      });
    }
    return diags;
  },
});

// -- agent --
registerValidator({
  stepType: 'agent',
  requiredFields: [
    { field: 'defaultAssigneeId', description: 'Agent user to execute the task' },
  ],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];
    if (!step.defaultAssigneeId && !step.additionalInstructions && (!step.promptDocumentIds || step.promptDocumentIds.length === 0)) {
      diags.push({
        level: 'warning',
        code: 'AGENT_NO_INSTRUCTIONS',
        stepId: step.id,
        stepName: step.name,
        message: 'Agent step has no instructions, prompt documents, or assignee. The agent will have no context for what to do.',
        suggestion: 'Add additionalInstructions, promptDocumentIds, or a defaultAssigneeId with an agent prompt.',
      });
    }
    return diags;
  },
});

// -- manual --
registerValidator({
  stepType: 'manual',
  requiredFields: [],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];
    if (!step.additionalInstructions && !step.description) {
      diags.push({
        level: 'info',
        code: 'MANUAL_NO_INSTRUCTIONS',
        stepId: step.id,
        stepName: step.name,
        message: 'Manual step has no instructions or description. The user will need to know what action to take.',
        suggestion: 'Add a description or additionalInstructions explaining what the user should do.',
      });
    }
    return diags;
  },
});

// -- decision --
registerValidator({
  stepType: 'decision',
  requiredFields: [],
  validate(step, ctx) {
    const diags: WorkflowDiagnostic[] = [];
    const connections = step.connections || [];
    const conditionConnections = connections.filter(c => c.condition);

    if (conditionConnections.length === 0 && !step.defaultConnection) {
      diags.push({
        level: 'error',
        code: 'DECISION_NO_ROUTES',
        stepId: step.id,
        stepName: step.name,
        message: 'Decision step has no conditional connections and no default connection. Workflow will dead-end here.',
        suggestion: 'Add connections with conditions, or set a defaultConnection.',
      });
    }

    if (conditionConnections.length > 0 && !step.defaultConnection) {
      diags.push({
        level: 'warning',
        code: 'DECISION_NO_DEFAULT',
        stepId: step.id,
        stepName: step.name,
        field: 'defaultConnection',
        message: 'Decision step has conditions but no default/fallback connection. If no condition matches, the workflow will dead-end.',
        suggestion: 'Add a defaultConnection to handle unmatched cases.',
      });
    }

    if (step.defaultConnection && !ctx.stepIds.has(step.defaultConnection)) {
      diags.push({
        level: 'error',
        code: 'DECISION_DEFAULT_INVALID',
        stepId: step.id,
        stepName: step.name,
        field: 'defaultConnection',
        message: `Default connection references non-existent step "${step.defaultConnection}".`,
        suggestion: `Change defaultConnection to a valid step ID. Available: ${[...ctx.stepIds].join(', ')}`,
      });
    }

    return diags;
  },
});

// -- foreach --
registerValidator({
  stepType: 'foreach',
  requiredFields: [
    { field: 'itemsPath', description: 'Path to the array in the input payload to iterate over' },
  ],
  validate(step, ctx) {
    const diags: WorkflowDiagnostic[] = [];

    if (!step.itemsPath) {
      diags.push({
        level: 'error',
        code: 'FOREACH_NO_ITEMS_PATH',
        stepId: step.id,
        stepName: step.name,
        field: 'itemsPath',
        message: 'ForEach step is missing itemsPath. Cannot determine which array to iterate over.',
        suggestion: 'Set itemsPath to the dot-notation path of the array in the input (e.g., "items" or "data.records").',
      });
    }

    // Check that the foreach has at least one child step to execute per item
    const connections = step.connections || [];
    if (connections.length === 0) {
      const idx = ctx.stepIndex.get(step.id);
      const nextStep = idx !== undefined ? ctx.steps[idx + 1] : undefined;
      if (!nextStep || nextStep.stepType === 'join') {
        diags.push({
          level: 'warning',
          code: 'FOREACH_NO_CHILD_STEP',
          stepId: step.id,
          stepName: step.name,
          message: 'ForEach step has no connections to child steps. Each item needs a step to process it.',
          suggestion: 'Add a connection to the step that should execute for each item.',
        });
      }
    }

    return diags;
  },
});

// -- join --
registerValidator({
  stepType: 'join',
  requiredFields: [
    { field: 'awaitStepId', description: 'Step ID of the ForEach step whose child tasks to wait for' },
  ],
  validate(step, ctx) {
    const diags: WorkflowDiagnostic[] = [];

    if (!step.awaitStepId) {
      diags.push({
        level: 'error',
        code: 'JOIN_NO_AWAIT_STEP',
        stepId: step.id,
        stepName: step.name,
        field: 'awaitStepId',
        message: 'Join step is missing awaitStepId. Cannot determine which ForEach step to wait for.',
        suggestion: 'Set awaitStepId to the ID of the ForEach step whose child tasks should be aggregated.',
      });
    } else if (!ctx.stepIds.has(step.awaitStepId)) {
      diags.push({
        level: 'error',
        code: 'JOIN_AWAIT_STEP_NOT_FOUND',
        stepId: step.id,
        stepName: step.name,
        field: 'awaitStepId',
        message: `Join step references non-existent step "${step.awaitStepId}" in awaitStepId.`,
        suggestion: `Change awaitStepId to a valid ForEach step ID. Available: ${[...ctx.stepIds].join(', ')}`,
      });
    } else {
      const referencedStep = ctx.stepMap.get(step.awaitStepId);
      if (referencedStep && referencedStep.stepType !== 'foreach') {
        diags.push({
          level: 'warning',
          code: 'JOIN_AWAIT_NOT_FOREACH',
          stepId: step.id,
          stepName: step.name,
          field: 'awaitStepId',
          message: `Join step references "${referencedStep.name}" (${referencedStep.stepType}) but usually should reference a ForEach step.`,
          suggestion: 'Verify that awaitStepId points to the correct ForEach step.',
        });
      }
    }

    return diags;
  },
});

// -- flow --
registerValidator({
  stepType: 'flow',
  requiredFields: [
    { field: 'flowId', description: 'ID of the nested workflow to execute' },
  ],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];

    if (!step.flowId) {
      diags.push({
        level: 'error',
        code: 'FLOW_NO_WORKFLOW_ID',
        stepId: step.id,
        stepName: step.name,
        field: 'flowId',
        message: 'Flow step is missing flowId. Cannot determine which nested workflow to execute.',
        suggestion: 'Set flowId to the ID of an existing workflow.',
      });
    }

    return diags;
  },
});

// -- code --
registerValidator({
  stepType: 'code',
  requiredFields: [
    { field: 'codeConfig.code', description: 'JavaScript code to execute in the sandbox' },
  ],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];

    if (!step.codeConfig?.code) {
      diags.push({
        level: 'error',
        code: 'CODE_NO_SOURCE',
        stepId: step.id,
        stepName: step.name,
        field: 'codeConfig.code',
        message: 'Code step has no code configured.',
        suggestion: 'Add codeConfig.code with JavaScript source code. The code receives `input`, `trigger`, and `steps` variables.',
      });
    }

    return diags;
  },
});

// -- findDocument --
registerValidator({
  stepType: 'findDocument',
  requiredFields: [],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];
    const config = step.findDocumentConfig;

    if (!config) {
      diags.push({
        level: 'error',
        code: 'FIND_DOC_NO_CONFIG',
        stepId: step.id,
        stepName: step.name,
        field: 'findDocumentConfig',
        message: 'FindDocument step has no configuration.',
        suggestion: 'Add findDocumentConfig with mode, searchPrompt (for dynamic), or documentId (for static).',
      });
    } else if (config.mode === 'dynamic' && !config.searchPrompt) {
      diags.push({
        level: 'error',
        code: 'FIND_DOC_NO_SEARCH_PROMPT',
        stepId: step.id,
        stepName: step.name,
        field: 'findDocumentConfig.searchPrompt',
        message: 'FindDocument step in dynamic mode requires a searchPrompt.',
        suggestion: 'Add a searchPrompt template (e.g., "Find documents about {{input.topic}}").',
      });
    } else if (config.mode === 'static' && !config.documentId) {
      diags.push({
        level: 'error',
        code: 'FIND_DOC_NO_DOCUMENT_ID',
        stepId: step.id,
        stepName: step.name,
        field: 'findDocumentConfig.documentId',
        message: 'FindDocument step in static mode requires a documentId.',
        suggestion: 'Set documentId to the ID of the document to retrieve.',
      });
    }

    return diags;
  },
});

// -- external --
registerValidator({
  stepType: 'external',
  requiredFields: [],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];
    const config = step.externalConfig;

    if (!config) {
      diags.push({
        level: 'warning',
        code: 'EXTERNAL_NO_CONFIG',
        stepId: step.id,
        stepName: step.name,
        field: 'externalConfig',
        message: 'External step has no configuration. It will wait for a callback but won\'t initiate any outbound request.',
        suggestion: 'Add externalConfig with endpoint, method, and payloadTemplate if an outbound call is needed.',
      });
    } else if (config.endpoint) {
      try {
        new URL(config.endpoint.replace(/\{\{.*?\}\}/g, 'placeholder'));
      } catch {
        if (!config.endpoint.includes('{{')) {
          diags.push({
            level: 'warning',
            code: 'EXTERNAL_INVALID_URL',
            stepId: step.id,
            stepName: step.name,
            field: 'externalConfig.endpoint',
            message: `External step endpoint "${config.endpoint}" does not appear to be a valid URL.`,
            suggestion: 'Use a full URL (e.g., "https://api.example.com/endpoint").',
          });
        }
      }
    }

    return diags;
  },
});

// -- webhook --
registerValidator({
  stepType: 'webhook',
  requiredFields: [],
  validate(step) {
    const diags: WorkflowDiagnostic[] = [];
    const config = step.webhookConfig;

    if (!config?.url) {
      diags.push({
        level: 'error',
        code: 'WEBHOOK_NO_URL',
        stepId: step.id,
        stepName: step.name,
        field: 'webhookConfig.url',
        message: 'Webhook step has no URL configured.',
        suggestion: 'Add webhookConfig.url with the target endpoint URL.',
      });
    } else {
      try {
        new URL(config.url.replace(/\{\{.*?\}\}/g, 'placeholder'));
      } catch {
        if (!config.url.includes('{{')) {
          diags.push({
            level: 'warning',
            code: 'WEBHOOK_INVALID_URL',
            stepId: step.id,
            stepName: step.name,
            field: 'webhookConfig.url',
            message: `Webhook URL "${config.url}" does not appear to be valid.`,
            suggestion: 'Use a full URL (e.g., "https://hooks.slack.com/services/...").',
          });
        }
      }
    }

    return diags;
  },
});

// ============================================================================
// Structural Validation
// ============================================================================

function validateStructure(steps: WorkflowStep[], ctx: ValidationContext): WorkflowDiagnostic[] {
  const diags: WorkflowDiagnostic[] = [];

  // 1. Check for empty workflow
  if (steps.length === 0) {
    diags.push({
      level: 'error',
      code: 'EMPTY_WORKFLOW',
      message: 'Workflow has no steps.',
      suggestion: 'Add at least one step to the workflow.',
    });
    return diags;
  }

  // 2. Check for duplicate step IDs
  const seenIds = new Set<string>();
  for (const step of steps) {
    if (!step.id) {
      diags.push({
        level: 'error',
        code: 'STEP_NO_ID',
        stepName: step.name,
        message: `Step "${step.name}" has no ID.`,
        suggestion: 'Ensure all steps have unique IDs.',
      });
    } else if (seenIds.has(step.id)) {
      diags.push({
        level: 'error',
        code: 'DUPLICATE_STEP_ID',
        stepId: step.id,
        stepName: step.name,
        message: `Duplicate step ID "${step.id}".`,
        suggestion: 'Ensure all step IDs are unique.',
      });
    }
    seenIds.add(step.id);
  }

  // 3. Check for missing/invalid step names
  for (const step of steps) {
    if (!step.name || !step.name.trim()) {
      diags.push({
        level: 'warning',
        code: 'STEP_NO_NAME',
        stepId: step.id,
        message: `Step "${step.id}" has no name.`,
        suggestion: 'Give the step a descriptive name.',
      });
    }
  }

  // 4. Check for invalid step types
  for (const step of steps) {
    if (!step.stepType) {
      diags.push({
        level: 'error',
        code: 'STEP_NO_TYPE',
        stepId: step.id,
        stepName: step.name,
        field: 'stepType',
        message: `Step "${step.name || step.id}" has no stepType.`,
        suggestion: `Set stepType to one of: ${VALID_STEP_TYPES.join(', ')}`,
      });
    } else if (!VALID_STEP_TYPES.includes(step.stepType)) {
      diags.push({
        level: 'error',
        code: 'INVALID_STEP_TYPE',
        stepId: step.id,
        stepName: step.name,
        field: 'stepType',
        message: `Step "${step.name || step.id}" has invalid stepType "${step.stepType}".`,
        suggestion: `Valid types: ${VALID_STEP_TYPES.join(', ')}`,
      });
    }
  }

  // 5. Check all connections reference valid step IDs
  for (const step of steps) {
    if (step.connections) {
      for (const conn of step.connections) {
        if (!ctx.stepIds.has(conn.targetStepId)) {
          diags.push({
            level: 'error',
            code: 'BROKEN_CONNECTION',
            stepId: step.id,
            stepName: step.name,
            field: 'connections',
            message: `Step "${step.name}" has a connection to non-existent step "${conn.targetStepId}".`,
            suggestion: `Change targetStepId to a valid step ID. Available: ${[...ctx.stepIds].join(', ')}`,
          });
        }
        if (conn.targetStepId === step.id) {
          diags.push({
            level: 'warning',
            code: 'SELF_CONNECTION',
            stepId: step.id,
            stepName: step.name,
            field: 'connections',
            message: `Step "${step.name}" has a connection to itself.`,
            suggestion: 'Remove the self-referencing connection to avoid infinite loops.',
          });
        }
      }
    }
  }

  // 6. Check trigger count
  const triggers = steps.filter(s => s.stepType === 'trigger');
  if (triggers.length > 1) {
    diags.push({
      level: 'warning',
      code: 'MULTIPLE_TRIGGERS',
      message: `Workflow has ${triggers.length} trigger steps. Only the first will be used.`,
      suggestion: 'Remove extra trigger steps or consolidate into one.',
    });
  }

  return diags;
}

// ============================================================================
// Graph Analysis
// ============================================================================

interface StepGraphResult {
  reachableSteps: string[];
  unreachableSteps: string[];
  terminalSteps: string[];
  hasCycle: boolean;
  cyclePath?: string[];
}

function analyzeStepGraph(steps: WorkflowStep[], ctx: ValidationContext): { graph: StepGraphResult; diagnostics: WorkflowDiagnostic[] } {
  const diags: WorkflowDiagnostic[] = [];

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const targets: string[] = [];

    if (step.connections && step.connections.length > 0) {
      for (const conn of step.connections) {
        if (ctx.stepIds.has(conn.targetStepId)) {
          targets.push(conn.targetStepId);
        }
      }
    }

    // Sequential fallback: if no explicit connections and not a decision step, next step is implicit
    if (targets.length === 0 && step.stepType !== 'decision' && i < steps.length - 1) {
      targets.push(steps[i + 1].id);
    }

    // Decision default connection
    if (step.stepType === 'decision' && step.defaultConnection && ctx.stepIds.has(step.defaultConnection)) {
      if (!targets.includes(step.defaultConnection)) {
        targets.push(step.defaultConnection);
      }
    }

    adjacency.set(step.id, targets);
  }

  // BFS from first step (or trigger) to find reachable steps
  const startId = steps[0]?.id;
  const reachable = new Set<string>();
  if (startId) {
    const queue = [startId];
    reachable.add(startId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  const unreachable = steps.filter(s => !reachable.has(s.id));
  for (const step of unreachable) {
    // Skip join steps - they're triggered by foreach child completion, not direct connections
    if (step.stepType === 'join') continue;

    diags.push({
      level: 'warning',
      code: 'UNREACHABLE_STEP',
      stepId: step.id,
      stepName: step.name,
      message: `Step "${step.name}" is not reachable from the start of the workflow.`,
      suggestion: 'Add a connection from another step to this one, or remove it if unused.',
    });
  }

  // Find terminal steps (no outgoing connections)
  const terminalSteps = steps.filter(s => {
    const targets = adjacency.get(s.id) || [];
    return targets.length === 0;
  });

  // Cycle detection via DFS
  let hasCycle = false;
  let cyclePath: string[] | undefined;
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(stepId: string): boolean {
    visited.add(stepId);
    inStack.add(stepId);
    pathStack.push(stepId);

    for (const neighbor of adjacency.get(stepId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (inStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = pathStack.indexOf(neighbor);
        cyclePath = pathStack.slice(cycleStart);
        cyclePath.push(neighbor);
        return true;
      }
    }

    pathStack.pop();
    inStack.delete(stepId);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      if (dfs(step.id)) {
        hasCycle = true;
        break;
      }
    }
  }

  if (hasCycle && cyclePath) {
    const cycleNames = cyclePath.map(id => {
      const s = ctx.stepMap.get(id);
      return s ? s.name : id;
    });
    diags.push({
      level: 'error',
      code: 'CYCLE_DETECTED',
      message: `Cycle detected in workflow: ${cycleNames.join(' → ')}`,
      suggestion: 'Remove one of the connections in the cycle to break it.',
    });
  }

  return {
    graph: {
      reachableSteps: [...reachable],
      unreachableSteps: unreachable.map(s => s.id),
      terminalSteps: terminalSteps.map(s => s.id),
      hasCycle,
      cyclePath,
    },
    diagnostics: diags,
  };
}

// ============================================================================
// Template Validation
// ============================================================================

const TEMPLATE_REGEX = /\{\{([^}]+)\}\}/g;

function validateTemplates(steps: WorkflowStep[], ctx: ValidationContext): WorkflowDiagnostic[] {
  const diags: WorkflowDiagnostic[] = [];

  for (const step of steps) {
    const templates: { field: string; value: string }[] = [];

    // Collect all template strings from the step
    if (step.additionalInstructions) {
      templates.push({ field: 'additionalInstructions', value: step.additionalInstructions });
    }
    if (step.externalConfig?.payloadTemplate) {
      templates.push({ field: 'externalConfig.payloadTemplate', value: step.externalConfig.payloadTemplate });
    }
    if (step.externalConfig?.endpoint) {
      templates.push({ field: 'externalConfig.endpoint', value: step.externalConfig.endpoint });
    }
    if (step.webhookConfig?.bodyTemplate) {
      templates.push({ field: 'webhookConfig.bodyTemplate', value: step.webhookConfig.bodyTemplate });
    }
    if (step.webhookConfig?.url) {
      templates.push({ field: 'webhookConfig.url', value: step.webhookConfig.url });
    }
    if (step.findDocumentConfig?.searchPrompt) {
      templates.push({ field: 'findDocumentConfig.searchPrompt', value: step.findDocumentConfig.searchPrompt });
    }
    if (step.codeConfig?.code) {
      // Don't validate templates inside code - they're JS, not template strings
    }
    if (step.inputMapping) {
      for (const [key, val] of Object.entries(step.inputMapping)) {
        templates.push({ field: `inputMapping.${key}`, value: val });
      }
    }
    if (step.inputConfig?.mapping) {
      for (const [key, val] of Object.entries(step.inputConfig.mapping)) {
        templates.push({ field: `inputConfig.mapping.${key}`, value: val });
      }
    }
    // titleTemplate exists at runtime but isn't in the TS interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepAny = step as any;
    if (typeof stepAny.titleTemplate === 'string') {
      templates.push({ field: 'titleTemplate', value: stepAny.titleTemplate });
    }

    // Validate each template
    for (const { field, value } of templates) {
      let match;
      TEMPLATE_REGEX.lastIndex = 0;
      while ((match = TEMPLATE_REGEX.exec(value)) !== null) {
        const varPath = match[1].trim();

        // Check for steps.STEP_ID references
        if (varPath.startsWith('steps.')) {
          const parts = varPath.split('.');
          const referencedStepId = parts[1];
          if (referencedStepId && !ctx.stepIds.has(referencedStepId)) {
            diags.push({
              level: 'error',
              code: 'TEMPLATE_INVALID_STEP_REF',
              stepId: step.id,
              stepName: step.name,
              field,
              message: `Template "{{${varPath}}}" references non-existent step "${referencedStepId}".`,
              suggestion: `Available step IDs: ${[...ctx.stepIds].join(', ')}`,
            });
          } else if (referencedStepId) {
            // Check if the referenced step comes before this one in execution order
            const refIdx = ctx.stepIndex.get(referencedStepId);
            const thisIdx = ctx.stepIndex.get(step.id);
            if (refIdx !== undefined && thisIdx !== undefined && refIdx >= thisIdx) {
              diags.push({
                level: 'warning',
                code: 'TEMPLATE_FORWARD_REF',
                stepId: step.id,
                stepName: step.name,
                field,
                message: `Template "{{${varPath}}}" references step "${referencedStepId}" which appears at or after this step. Its output may not be available.`,
                suggestion: 'Ensure the referenced step executes before this one, or use a different input source.',
              });
            }
          }
        }

        // Check for empty variable names
        if (!varPath) {
          diags.push({
            level: 'error',
            code: 'TEMPLATE_EMPTY_VAR',
            stepId: step.id,
            stepName: step.name,
            field,
            message: 'Template contains an empty variable "{{}}".',
            suggestion: 'Use a valid variable path like {{input.field}} or {{trigger.payload.field}}.',
          });
        }
      }
    }
  }

  return diags;
}

// ============================================================================
// Cross-Reference Validation (requires DB access)
// ============================================================================

async function validateCrossReferences(steps: WorkflowStep[]): Promise<WorkflowDiagnostic[]> {
  const diags: WorkflowDiagnostic[] = [];

  try {
    const db = getDb();

    // Collect IDs to check
    const userIds = new Set<string>();
    const workflowIds = new Set<string>();
    const documentIds = new Set<string>();

    for (const step of steps) {
      // Skip template patterns — resolved at runtime (e.g., {{agent.*}}, {{variables.*}})
      if (step.defaultAssigneeId && !step.defaultAssigneeId.includes('{{')) {
        userIds.add(step.defaultAssigneeId);
      }
      if (step.flowId) {
        workflowIds.add(step.flowId);
      }
      if (step.promptDocumentIds) {
        for (const id of step.promptDocumentIds) {
          documentIds.add(id);
        }
      }
    }

    // Check user references
    if (userIds.size > 0) {
      const validUserIds = userIds.size > 0
        ? new Set(
            (await db.collection('users').find({
              _id: { $in: [...userIds].filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) },
            }).project({ _id: 1 }).toArray()).map(u => u._id.toString())
          )
        : new Set<string>();

      for (const step of steps) {
        if (step.defaultAssigneeId && !step.defaultAssigneeId.includes('{{') && !validUserIds.has(step.defaultAssigneeId)) {
          diags.push({
            level: 'warning',
            code: 'INVALID_ASSIGNEE',
            stepId: step.id,
            stepName: step.name,
            field: 'defaultAssigneeId',
            message: `Step "${step.name}" references non-existent user "${step.defaultAssigneeId}".`,
            suggestion: 'Update defaultAssigneeId to a valid user ID.',
          });
        }
      }
    }

    // Check workflow references (flow steps)
    if (workflowIds.size > 0) {
      const validWorkflowIds = new Set(
        (await db.collection('workflows').find({
          _id: { $in: [...workflowIds].filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) },
        }).project({ _id: 1, isActive: 1, name: 1 }).toArray()).map(w => ({
          id: w._id.toString(),
          isActive: w.isActive,
          name: w.name,
        }))
      );
      const validIds = new Map<string, { isActive: boolean; name: string }>();
      for (const w of validWorkflowIds) {
        validIds.set(w.id, { isActive: w.isActive, name: w.name });
      }

      for (const step of steps) {
        if (step.flowId) {
          const ref = validIds.get(step.flowId);
          if (!ref) {
            diags.push({
              level: 'error',
              code: 'FLOW_WORKFLOW_NOT_FOUND',
              stepId: step.id,
              stepName: step.name,
              field: 'flowId',
              message: `Flow step "${step.name}" references non-existent workflow "${step.flowId}".`,
              suggestion: 'Update flowId to the ID of an existing workflow.',
            });
          } else if (!ref.isActive) {
            diags.push({
              level: 'warning',
              code: 'FLOW_WORKFLOW_INACTIVE',
              stepId: step.id,
              stepName: step.name,
              field: 'flowId',
              message: `Flow step "${step.name}" references inactive workflow "${ref.name}".`,
              suggestion: 'Activate the referenced workflow or choose a different one.',
            });
          }
        }
      }
    }

    // Check document references
    if (documentIds.size > 0) {
      const validDocIds = new Set(
        (await db.collection('documents').find({
          _id: { $in: [...documentIds].filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) },
        }).project({ _id: 1 }).toArray()).map(d => d._id.toString())
      );

      for (const step of steps) {
        if (step.promptDocumentIds) {
          for (const docId of step.promptDocumentIds) {
            if (!validDocIds.has(docId)) {
              diags.push({
                level: 'warning',
                code: 'INVALID_PROMPT_DOCUMENT',
                stepId: step.id,
                stepName: step.name,
                field: 'promptDocumentIds',
                message: `Step "${step.name}" references non-existent prompt document "${docId}".`,
                suggestion: 'Remove the invalid document ID or create the referenced document.',
              });
            }
          }
        }
      }
    }
  } catch (error) {
    diags.push({
      level: 'info',
      code: 'CROSS_REF_SKIPPED',
      message: `Cross-reference validation skipped: ${error instanceof Error ? error.message : 'Database unavailable'}`,
    });
  }

  return diags;
}

// ============================================================================
// Input Schema Cross-Reference Validation
// ============================================================================

const INPUT_FIELD_REGEX = /\{\{(?:input\.|trigger\.payload\.)([^}]+)\}\}/g;

interface InputFieldRef {
  stepId?: string;
  stepName?: string;
  field: string;
  fullPath: string;
}

/**
 * Extract all input/trigger.payload field references from template strings across the workflow.
 * Returns a Map from top-level field name to its reference locations.
 */
function extractInputFieldReferences(
  steps: WorkflowStep[],
  rootTaskTitleTemplate?: string
): Map<string, InputFieldRef[]> {
  const fieldRefs = new Map<string, InputFieldRef[]>();

  const addRef = (topLevelField: string, ref: InputFieldRef) => {
    if (!fieldRefs.has(topLevelField)) {
      fieldRefs.set(topLevelField, []);
    }
    fieldRefs.get(topLevelField)!.push(ref);
  };

  const scanTemplate = (text: string, stepId?: string, stepName?: string, field?: string) => {
    let match;
    INPUT_FIELD_REGEX.lastIndex = 0;
    while ((match = INPUT_FIELD_REGEX.exec(text)) !== null) {
      const fullPath = match[1].trim();
      const topLevelField = fullPath.split('.')[0];
      addRef(topLevelField, { stepId, stepName, field: field || '', fullPath });
    }
  };

  // Scan rootTaskTitleTemplate
  if (rootTaskTitleTemplate) {
    scanTemplate(rootTaskTitleTemplate, undefined, undefined, 'rootTaskTitleTemplate');
  }

  // Scan all step templates
  for (const step of steps) {
    if (step.additionalInstructions) {
      scanTemplate(step.additionalInstructions, step.id, step.name, 'additionalInstructions');
    }
    if (step.prompt) {
      scanTemplate(step.prompt, step.id, step.name, 'prompt');
    }
    // externalConfig templates
    if (step.externalConfig) {
      const ext = step.externalConfig as Record<string, unknown>;
      if (typeof ext.payloadTemplate === 'string') {
        scanTemplate(ext.payloadTemplate, step.id, step.name, 'externalConfig.payloadTemplate');
      }
      if (typeof ext.endpoint === 'string') {
        scanTemplate(ext.endpoint, step.id, step.name, 'externalConfig.endpoint');
      }
    }
    // webhookConfig templates
    if (step.webhookConfig) {
      const wh = step.webhookConfig as Record<string, unknown>;
      if (typeof wh.bodyTemplate === 'string') {
        scanTemplate(wh.bodyTemplate, step.id, step.name, 'webhookConfig.bodyTemplate');
      }
      if (typeof wh.url === 'string') {
        scanTemplate(wh.url, step.id, step.name, 'webhookConfig.url');
      }
    }
    // inputConfig.mapping values
    if (step.inputConfig?.mapping) {
      for (const [key, val] of Object.entries(step.inputConfig.mapping)) {
        scanTemplate(val, step.id, step.name, `inputConfig.mapping.${key}`);
      }
    }
    // inputMapping (flow steps)
    if (step.inputMapping) {
      for (const [key, val] of Object.entries(step.inputMapping)) {
        scanTemplate(val, step.id, step.name, `inputMapping.${key}`);
      }
    }
    // findDocumentConfig.searchPrompt
    const stepAny = step as unknown as Record<string, unknown>;
    const findDocConfig = stepAny.findDocumentConfig as Record<string, unknown> | undefined;
    if (findDocConfig && typeof findDocConfig.searchPrompt === 'string') {
      scanTemplate(findDocConfig.searchPrompt, step.id, step.name, 'findDocumentConfig.searchPrompt');
    }
    // Decision field
    if (step.decisionField) {
      if (step.decisionField.startsWith('input.') || step.decisionField.startsWith('trigger.payload.')) {
        scanTemplate(`{{${step.decisionField}}}`, step.id, step.name, 'decisionField');
      }
    }
    // ForEach itemsPath
    if (step.itemsPath) {
      if (step.itemsPath.startsWith('input.') || step.itemsPath.startsWith('trigger.payload.')) {
        scanTemplate(`{{${step.itemsPath}}}`, step.id, step.name, 'itemsPath');
      }
    }
  }

  return fieldRefs;
}

function validateInputSchemaCrossReferences(
  steps: WorkflowStep[],
  inputSchema?: Record<string, unknown>,
  rootTaskTitleTemplate?: string
): WorkflowDiagnostic[] {
  const diags: WorkflowDiagnostic[] = [];

  // Extract all input.* and trigger.payload.* references
  const fieldRefs = extractInputFieldReferences(steps, rootTaskTitleTemplate);

  if (!inputSchema) {
    // No schema defined — if there are input references, suggest adding one
    if (fieldRefs.size > 0) {
      const fieldNames = [...fieldRefs.keys()].join(', ');
      diags.push({
        level: 'info',
        code: 'NO_INPUT_SCHEMA',
        message: `Workflow references input fields (${fieldNames}) but has no inputSchema defined. Consider adding one to validate inputs.`,
        suggestion: 'Add an inputSchema in workflow settings to ensure callers provide the required data.',
      });
    }
    return diags;
  }

  // Get schema property names
  const schemaProperties = inputSchema.properties
    ? new Set(Object.keys(inputSchema.properties as Record<string, unknown>))
    : new Set<string>();
  const requiredFields = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : []
  );

  // Fields referenced in templates but not in schema
  for (const [fieldName, refs] of fieldRefs) {
    if (!schemaProperties.has(fieldName)) {
      const firstRef = refs[0];
      diags.push({
        level: 'warning',
        code: 'INPUT_FIELD_NOT_IN_SCHEMA',
        stepId: firstRef.stepId,
        stepName: firstRef.stepName,
        field: firstRef.field,
        message: `Template references "input.${fieldName}" but "${fieldName}" is not defined in the inputSchema.`,
        suggestion: `Add "${fieldName}" to the inputSchema properties, or remove the template reference if it's unused.`,
      });
    }
  }

  // Required schema fields that are never referenced
  for (const requiredField of requiredFields) {
    if (!fieldRefs.has(requiredField)) {
      diags.push({
        level: 'info',
        code: 'REQUIRED_FIELD_UNREFERENCED',
        message: `Schema requires "${requiredField}" but no template in the workflow references "input.${requiredField}".`,
        suggestion: `Verify "${requiredField}" is needed. It may be consumed by agent instructions rather than templates.`,
      });
    }
  }

  return diags;
}

// ============================================================================
// Main Validate Function
// ============================================================================

export interface ValidateOptions {
  /** Check references against the database (users, workflows, documents). Default: true */
  checkReferences?: boolean;
  /** Include inputSchema cross-reference checks */
  inputSchema?: Record<string, unknown>;
  /** Root task title template for input field scanning */
  rootTaskTitleTemplate?: string;
}

export async function validateWorkflow(
  steps: WorkflowStep[],
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const { checkReferences = true, inputSchema, rootTaskTitleTemplate } = options;

  // Build context
  const stepIds = new Set(steps.map(s => s.id).filter(Boolean));
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));
  const ctx: ValidationContext = { steps, stepIds, stepMap, stepIndex };

  const allDiagnostics: WorkflowDiagnostic[] = [];

  // 1. Structural validation
  allDiagnostics.push(...validateStructure(steps, ctx));

  // 2. Per-step type validation
  for (const step of steps) {
    const validator = stepTypeValidators.get(step.stepType);
    if (validator) {
      allDiagnostics.push(...validator.validate(step, ctx));
    }
  }

  // 3. Graph analysis (reachability, cycles)
  const { graph, diagnostics: graphDiags } = analyzeStepGraph(steps, ctx);
  allDiagnostics.push(...graphDiags);

  // 4. Template validation
  allDiagnostics.push(...validateTemplates(steps, ctx));

  // 5. Cross-reference validation (optional, needs DB)
  if (checkReferences) {
    allDiagnostics.push(...await validateCrossReferences(steps));
  }

  // 6. Input schema cross-reference validation
  allDiagnostics.push(
    ...validateInputSchemaCrossReferences(steps, inputSchema, rootTaskTitleTemplate)
  );

  const errors = allDiagnostics.filter(d => d.level === 'error').length;
  const warnings = allDiagnostics.filter(d => d.level === 'warning').length;
  const info = allDiagnostics.filter(d => d.level === 'info').length;

  return {
    valid: errors === 0,
    diagnostics: allDiagnostics,
    summary: { errors, warnings, info },
    stepGraph: {
      reachableSteps: graph.reachableSteps,
      unreachableSteps: graph.unreachableSteps,
      terminalSteps: graph.terminalSteps,
    },
  };
}

// ============================================================================
// Exports for AI Prompt Context
// ============================================================================

/** Returns a reference of all validation rules for inclusion in AI prompts */
export function getValidationRulesReference(): {
  stepTypeRules: Record<string, { requiredFields: { field: string; description: string }[] }>;
  structuralRules: string[];
  diagnosticCodes: { code: string; level: string; description: string }[];
} {
  const stepTypeRules: Record<string, { requiredFields: { field: string; description: string }[] }> = {};
  for (const [stepType, validator] of stepTypeValidators) {
    stepTypeRules[stepType] = {
      requiredFields: validator.requiredFields,
    };
  }

  return {
    stepTypeRules,
    structuralRules: [
      'All step IDs must be unique',
      'All connection targetStepIds must reference existing step IDs',
      'No self-referencing connections',
      'Trigger step should be first',
      'Only one trigger step allowed',
      'All steps should be reachable from the start',
      'No circular connections (cycles)',
      'Template variables like {{steps.STEP_ID.*}} must reference valid step IDs',
      'Template forward references (referencing a step that hasn\'t executed yet) produce warnings',
    ],
    diagnosticCodes: [
      { code: 'EMPTY_WORKFLOW', level: 'error', description: 'Workflow has no steps' },
      { code: 'STEP_NO_ID', level: 'error', description: 'Step is missing an ID' },
      { code: 'DUPLICATE_STEP_ID', level: 'error', description: 'Multiple steps share the same ID' },
      { code: 'STEP_NO_TYPE', level: 'error', description: 'Step has no stepType' },
      { code: 'INVALID_STEP_TYPE', level: 'error', description: 'Step has an unrecognized stepType' },
      { code: 'BROKEN_CONNECTION', level: 'error', description: 'Connection references non-existent step' },
      { code: 'SELF_CONNECTION', level: 'warning', description: 'Step connects to itself' },
      { code: 'MULTIPLE_TRIGGERS', level: 'warning', description: 'More than one trigger step' },
      { code: 'TRIGGER_NOT_FIRST', level: 'warning', description: 'Trigger is not the first step' },
      { code: 'UNREACHABLE_STEP', level: 'warning', description: 'Step cannot be reached from workflow start' },
      { code: 'CYCLE_DETECTED', level: 'error', description: 'Circular connection path detected' },
      { code: 'DECISION_NO_ROUTES', level: 'error', description: 'Decision step has no routing rules' },
      { code: 'DECISION_NO_DEFAULT', level: 'warning', description: 'Decision step has no fallback path' },
      { code: 'DECISION_DEFAULT_INVALID', level: 'error', description: 'Decision defaultConnection references non-existent step' },
      { code: 'FOREACH_NO_ITEMS_PATH', level: 'error', description: 'ForEach missing itemsPath' },
      { code: 'FOREACH_NO_CHILD_STEP', level: 'warning', description: 'ForEach has no child step to process items' },
      { code: 'JOIN_NO_AWAIT_STEP', level: 'error', description: 'Join missing awaitStepId' },
      { code: 'JOIN_AWAIT_STEP_NOT_FOUND', level: 'error', description: 'Join references non-existent step' },
      { code: 'JOIN_AWAIT_NOT_FOREACH', level: 'warning', description: 'Join references a non-ForEach step' },
      { code: 'FLOW_NO_WORKFLOW_ID', level: 'error', description: 'Flow step missing flowId' },
      { code: 'FLOW_WORKFLOW_NOT_FOUND', level: 'error', description: 'Flow references non-existent workflow' },
      { code: 'FLOW_WORKFLOW_INACTIVE', level: 'warning', description: 'Flow references inactive workflow' },
      { code: 'CODE_NO_SOURCE', level: 'error', description: 'Code step has no code' },
      { code: 'FIND_DOC_NO_CONFIG', level: 'error', description: 'FindDocument has no configuration' },
      { code: 'FIND_DOC_NO_SEARCH_PROMPT', level: 'error', description: 'Dynamic FindDocument missing searchPrompt' },
      { code: 'FIND_DOC_NO_DOCUMENT_ID', level: 'error', description: 'Static FindDocument missing documentId' },
      { code: 'WEBHOOK_NO_URL', level: 'error', description: 'Webhook step has no URL' },
      { code: 'AGENT_NO_INSTRUCTIONS', level: 'warning', description: 'Agent has no instructions or prompt docs' },
      { code: 'TEMPLATE_INVALID_STEP_REF', level: 'error', description: 'Template references non-existent step' },
      { code: 'TEMPLATE_FORWARD_REF', level: 'warning', description: 'Template references step that hasn\'t executed yet' },
      { code: 'TEMPLATE_EMPTY_VAR', level: 'error', description: 'Template contains empty variable {{}}' },
      { code: 'INVALID_ASSIGNEE', level: 'warning', description: 'defaultAssigneeId references unknown user' },
      { code: 'INVALID_PROMPT_DOCUMENT', level: 'warning', description: 'promptDocumentIds references unknown document' },
      { code: 'NO_INPUT_SCHEMA', level: 'info', description: 'Workflow uses input fields but has no inputSchema defined' },
      { code: 'INPUT_FIELD_NOT_IN_SCHEMA', level: 'warning', description: 'Template references an input field not defined in the schema' },
      { code: 'REQUIRED_FIELD_UNREFERENCED', level: 'info', description: 'Required schema field is never used in any template' },
    ],
  };
}
