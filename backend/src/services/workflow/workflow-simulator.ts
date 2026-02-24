/**
 * Workflow Simulator
 *
 * Runs an end-to-end simulation of a workflow with sample data.
 * Executes deterministic steps (code, decision, foreach, join) in-memory
 * and mocks non-deterministic steps (agent, manual, external, webhook).
 * Produces a step-by-step execution trace showing input → output at each stage.
 *
 * Does NOT create real tasks or workflow runs - everything runs in-memory.
 * Works on inactive workflows (skips isActive check).
 */

import { WorkflowStep, WorkflowStepType } from '../../routes/workflows/types.js';
import { executeCode } from './code-executor.js';
import { getValueByPath, resolveTemplateValue } from './template-utils.js';
import { validateWorkflow, ValidationResult } from './workflow-validator.js';

// ============================================================================
// Types
// ============================================================================

export interface SimulationOptions {
  /** Data passed to the workflow trigger */
  inputPayload: Record<string, unknown>;
  /** Mock outputs keyed by step ID, used for agent/manual/external steps */
  mockOutputs?: Record<string, Record<string, unknown>>;
  /** Max foreach items to simulate (default: 3) */
  maxForeachItems?: number;
  /** Actually execute webhook HTTP calls (default: false) */
  executeWebhooks?: boolean;
  /** Overall simulation timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Recurse into nested flow steps if workflow is accessible (default: false) */
  simulateNestedFlows?: boolean;
}

export interface SimulationStepTrace {
  stepId: string;
  stepName: string;
  stepType: WorkflowStepType;
  status: 'success' | 'failed' | 'skipped' | 'mocked';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  resolvedTemplates?: Record<string, string>;
  durationMs?: number;
  error?: string;
  suggestion?: string;
  children?: SimulationStepTrace[];
  branchTaken?: string;
  branchLabel?: string;
  logs?: string[];
}

export interface SimulationResult {
  success: boolean;
  workflowName?: string;
  totalSteps: number;
  executedSteps: number;
  failedSteps: number;
  mockedSteps: number;
  durationMs: number;
  trace: SimulationStepTrace[];
  finalOutput: Record<string, unknown> | null;
  validation: ValidationResult;
  dataFlowSummary: {
    stepId: string;
    stepName: string;
    stepType: WorkflowStepType;
    inputKeys: string[];
    outputKeys: string[];
  }[];
}

// Internal context passed through the simulation
interface SimContext {
  steps: WorkflowStep[];
  stepMap: Map<string, WorkflowStep>;
  stepIndex: Map<string, number>;
  triggerPayload: Record<string, unknown>;
  /** Completed step outputs keyed by step ID */
  stepOutputs: Map<string, Record<string, unknown>>;
  mockOutputs: Record<string, Record<string, unknown>>;
  maxForeachItems: number;
  executeWebhooks: boolean;
  startTime: number;
  timeoutMs: number;
  trace: SimulationStepTrace[];
  counters: { executed: number; failed: number; mocked: number };
}

// ============================================================================
// Main Simulate Function
// ============================================================================

export async function simulateWorkflow(
  steps: WorkflowStep[],
  options: SimulationOptions,
  workflowName?: string,
): Promise<SimulationResult> {
  const startTime = Date.now();

  // Validate first
  const validation = await validateWorkflow(steps, { checkReferences: false });

  // Build context
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));

  const ctx: SimContext = {
    steps,
    stepMap,
    stepIndex,
    triggerPayload: options.inputPayload || {},
    stepOutputs: new Map(),
    mockOutputs: options.mockOutputs || {},
    maxForeachItems: options.maxForeachItems ?? 3,
    executeWebhooks: options.executeWebhooks ?? false,
    startTime,
    timeoutMs: options.timeoutMs ?? 30000,
    trace: [],
    counters: { executed: 0, failed: 0, mocked: 0 },
  };

  // If there are validation errors, still attempt simulation but include them
  let finalOutput: Record<string, unknown> | null = null;

  if (steps.length > 0) {
    // Start from first step
    const result = await simulateFromStep(ctx, steps[0], options.inputPayload);
    finalOutput = result;
  }

  // Build data flow summary
  const dataFlowSummary = ctx.trace.map(t => ({
    stepId: t.stepId,
    stepName: t.stepName,
    stepType: t.stepType,
    inputKeys: safeKeys(t.input),
    outputKeys: safeKeys(t.output),
  }));

  return {
    success: ctx.counters.failed === 0,
    workflowName,
    totalSteps: steps.length,
    executedSteps: ctx.counters.executed,
    failedSteps: ctx.counters.failed,
    mockedSteps: ctx.counters.mocked,
    durationMs: Date.now() - startTime,
    trace: ctx.trace,
    finalOutput,
    validation,
    dataFlowSummary,
  };
}

function safeKeys(obj: Record<string, unknown> | null | undefined): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj);
}

// ============================================================================
// Step Simulation
// ============================================================================

async function simulateFromStep(
  ctx: SimContext,
  step: WorkflowStep,
  inputPayload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  // Check timeout
  if (Date.now() - ctx.startTime > ctx.timeoutMs) {
    ctx.trace.push({
      stepId: step.id,
      stepName: step.name,
      stepType: step.stepType,
      status: 'failed',
      input: inputPayload,
      output: {},
      error: `Simulation timeout exceeded (${ctx.timeoutMs}ms)`,
      suggestion: 'Increase timeoutMs or simplify the workflow.',
    });
    ctx.counters.failed++;
    return null;
  }

  const stepStart = Date.now();
  let output: Record<string, unknown> = {};
  let status: SimulationStepTrace['status'] = 'success';
  let error: string | undefined;
  let suggestion: string | undefined;
  let children: SimulationStepTrace[] | undefined;
  let branchTaken: string | undefined;
  let branchLabel: string | undefined;
  let logs: string[] | undefined;

  try {
    // Resolve step input using inputConfig if present
    const resolvedInput = await resolveSimulatedInput(ctx, step, inputPayload);

    switch (step.stepType) {
      case 'trigger': {
        output = { ...ctx.triggerPayload };
        break;
      }

      case 'code': {
        if (!step.codeConfig?.code) {
          error = 'Code step has no code configured';
          status = 'failed';
          break;
        }
        try {
          const result = await executeCode(step.codeConfig.code, {
            input: resolvedInput,
            trigger: ctx.triggerPayload,
            steps: buildStepsContext(ctx),
          }, {
            packages: step.codeConfig.packages || [],
            timeout: Math.min(step.codeConfig.timeout || 5000, 10000), // Cap at 10s for simulation
          });

          if (result.success) {
            output = typeof result.output === 'object' && result.output !== null
              ? result.output as Record<string, unknown>
              : { result: result.output };
            logs = result.logs;
          } else {
            error = result.error || 'Code execution failed';
            status = 'failed';
            logs = result.logs;
            suggestion = 'Check the code for errors. The input data available is shown in the input field.';
          }
        } catch (e) {
          error = `Code execution error: ${e instanceof Error ? e.message : String(e)}`;
          status = 'failed';
          suggestion = 'The code threw an exception. Check syntax and ensure all referenced variables exist.';
        }
        break;
      }

      case 'decision': {
        const result = evaluateDecision(ctx, step, resolvedInput);
        output = result.output;
        branchTaken = result.targetStepId;
        branchLabel = result.label;
        if (!result.matched) {
          error = `No condition matched and no default connection. Decision field "${step.decisionField || 'N/A'}" had value "${result.actualValue}".`;
          status = 'failed';
          suggestion = 'Add a defaultConnection or ensure conditions cover all possible values.';
        }
        break;
      }

      case 'foreach': {
        const foreachResult = await simulateForeach(ctx, step, resolvedInput);
        output = foreachResult.output;
        children = foreachResult.children;
        if (!foreachResult.success) {
          error = foreachResult.error;
          status = 'failed';
          suggestion = foreachResult.suggestion;
        }
        break;
      }

      case 'join': {
        // In simulation, join aggregates the outputs from the foreach children
        // The join step receives the aggregated results from previous foreach children
        const awaitStepId = step.awaitStepId;
        if (awaitStepId) {
          const foreachOutput = ctx.stepOutputs.get(awaitStepId);
          if (foreachOutput && Array.isArray(foreachOutput._childResults)) {
            output = {
              aggregatedResults: foreachOutput._childResults,
              totalItems: foreachOutput._childResults.length,
            };
          } else {
            output = { aggregatedResults: [], totalItems: 0 };
          }
        } else {
          output = resolvedInput;
        }
        break;
      }

      case 'agent':
      case 'manual': {
        // Use mock output if provided, otherwise generate placeholder
        const mockOutput = ctx.mockOutputs[step.id];
        if (mockOutput) {
          output = mockOutput;
          status = 'mocked';
          ctx.counters.mocked++;
        } else {
          output = {
            _mocked: true,
            _stepId: step.id,
            _stepName: step.name,
            _stepType: step.stepType,
            _note: `No mock output provided for ${step.stepType} step "${step.name}". Provide mockOutputs.${step.id} to simulate realistic data.`,
            ...resolvedInput,
          };
          status = 'mocked';
          ctx.counters.mocked++;
        }
        break;
      }

      case 'external':
      case 'webhook': {
        // Show what would be sent, use mock if provided
        const mockOutput = ctx.mockOutputs[step.id];
        if (mockOutput) {
          output = mockOutput;
          status = 'mocked';
          ctx.counters.mocked++;
        } else {
          const config = step.externalConfig || step.webhookConfig;
          output = {
            _mocked: true,
            _dryRun: true,
            _stepId: step.id,
            request: {
              url: (step.externalConfig?.endpoint || (step.webhookConfig as any)?.url) || 'N/A',
              method: (config as any)?.method || 'POST',
            },
            _note: `HTTP call simulated (dry-run). Provide mockOutputs.${step.id} to simulate a response.`,
          };
          status = 'mocked';
          ctx.counters.mocked++;
        }
        break;
      }

      case 'findDocument': {
        const mockOutput = ctx.mockOutputs[step.id];
        if (mockOutput) {
          output = mockOutput;
          status = 'mocked';
          ctx.counters.mocked++;
        } else {
          output = {
            _mocked: true,
            _stepId: step.id,
            documents: [],
            _note: `Document search simulated. Provide mockOutputs.${step.id} to simulate search results.`,
          };
          status = 'mocked';
          ctx.counters.mocked++;
        }
        break;
      }

      case 'flow': {
        const mockOutput = ctx.mockOutputs[step.id];
        if (mockOutput) {
          output = mockOutput;
          status = 'mocked';
          ctx.counters.mocked++;
        } else {
          output = {
            _mocked: true,
            _stepId: step.id,
            _flowId: step.flowId,
            _note: `Nested workflow simulated. Provide mockOutputs.${step.id} to simulate the nested workflow output.`,
          };
          status = 'mocked';
          ctx.counters.mocked++;
        }
        break;
      }

      default: {
        error = `Unknown step type "${step.stepType}"`;
        status = 'failed';
        suggestion = `Valid step types: trigger, agent, manual, code, decision, foreach, join, external, webhook, findDocument, flow`;
      }
    }
  } catch (e) {
    error = `Unexpected error simulating step "${step.name}": ${e instanceof Error ? e.message : String(e)}`;
    status = 'failed';
  }

  // Record trace
  const traceEntry: SimulationStepTrace = {
    stepId: step.id,
    stepName: step.name,
    stepType: step.stepType,
    status,
    input: inputPayload,
    output,
    durationMs: Date.now() - stepStart,
    ...(error && { error }),
    ...(suggestion && { suggestion }),
    ...(children && { children }),
    ...(branchTaken && { branchTaken }),
    ...(branchLabel && { branchLabel }),
    ...(logs && { logs }),
  };
  ctx.trace.push(traceEntry);

  if (status === 'success' || status === 'mocked') {
    ctx.counters.executed++;
  } else if (status === 'failed') {
    ctx.counters.failed++;
    return null; // Stop simulation on failure
  }

  // Store output for use by subsequent steps
  ctx.stepOutputs.set(step.id, output);

  // Advance to next step(s)
  if (step.stepType === 'decision' && branchTaken) {
    // Decision step - follow the selected branch
    const nextStep = ctx.stepMap.get(branchTaken);
    if (nextStep) {
      return await simulateFromStep(ctx, nextStep, wrapOutput(output));
    }
    return output;
  }

  // Follow connections or sequential flow
  const nextStepIds = getNextStepIds(ctx, step);

  if (nextStepIds.length === 0) {
    return output; // Terminal step
  }

  // For foreach, the children are already simulated - advance to the next step after foreach
  // (typically a join or the step after the child processing step)
  if (step.stepType === 'foreach') {
    // Skip child step connections - foreach children are simulated inline
    // Find the join step or next sequential step after the foreach child
    const joinStep = ctx.steps.find(s =>
      s.stepType === 'join' && s.awaitStepId === step.id
    );
    if (joinStep) {
      return await simulateFromStep(ctx, joinStep, wrapOutput(output));
    }
    // No join - follow connections of the foreach itself past child steps
    // Fall through to regular connection handling
  }

  // Execute next steps (for simplicity, sequential in simulation even if parallel in reality)
  let lastOutput = output;
  for (const nextStepId of nextStepIds) {
    // Skip child steps of foreach (already handled)
    if (step.stepType === 'foreach') continue;

    const nextStep = ctx.stepMap.get(nextStepId);
    if (nextStep) {
      const result = await simulateFromStep(ctx, nextStep, wrapOutput(lastOutput));
      if (result) {
        lastOutput = result;
      } else {
        return null; // propagate failure
      }
    }
  }

  return lastOutput;
}

// ============================================================================
// Decision Evaluation
// ============================================================================

function evaluateDecision(
  ctx: SimContext,
  step: WorkflowStep,
  inputPayload: Record<string, unknown>,
): {
  matched: boolean;
  targetStepId?: string;
  label?: string;
  actualValue: unknown;
  output: Record<string, unknown>;
} {
  const connections = step.connections || [];
  const effectiveDecisionField = step.decisionField || (step as any).inputPath;

  // Get actual value to compare
  let actualValue: unknown;
  if (effectiveDecisionField) {
    // Support trigger.payload.* paths
    if (effectiveDecisionField.startsWith('trigger.payload.')) {
      const triggerPath = effectiveDecisionField.substring('trigger.payload.'.length);
      actualValue = getValueByPath(ctx.triggerPayload, triggerPath);
    } else if (effectiveDecisionField === 'trigger.payload') {
      actualValue = ctx.triggerPayload;
    } else {
      actualValue = getValueByPath(inputPayload, effectiveDecisionField);
    }
  }

  // Evaluate conditions
  for (const conn of connections) {
    if (!conn.condition) continue;

    if (effectiveDecisionField) {
      // Simple value match (supports comma-separated values)
      const expectedValues = conn.condition.split(',').map(v => v.trim().toLowerCase());
      const actualValueStr = String(actualValue).toLowerCase();
      if (expectedValues.includes(actualValueStr)) {
        return {
          matched: true,
          targetStepId: conn.targetStepId,
          label: conn.label,
          actualValue,
          output: {
            ...inputPayload,
            _decision: {
              selectedPath: conn.targetStepId,
              condition: conn.condition,
              matchedValue: actualValue,
              decisionField: effectiveDecisionField,
            },
          },
        };
      }
    } else {
      // Legacy format: "field:value"
      const parts = conn.condition.split(':');
      if (parts.length >= 2) {
        const field = parts[0];
        const values = parts.slice(1).join(':');
        const fieldValue = getValueByPath(inputPayload, field);
        const expectedValues = values.split(',').map(v => v.trim().toLowerCase());
        if (expectedValues.includes(String(fieldValue).toLowerCase())) {
          return {
            matched: true,
            targetStepId: conn.targetStepId,
            label: conn.label,
            actualValue: fieldValue,
            output: {
              ...inputPayload,
              _decision: {
                selectedPath: conn.targetStepId,
                condition: conn.condition,
                matchedValue: fieldValue,
                decisionField: field,
              },
            },
          };
        }
      }
    }
  }

  // Default connection
  if (step.defaultConnection) {
    return {
      matched: true,
      targetStepId: step.defaultConnection,
      label: 'default',
      actualValue,
      output: {
        ...inputPayload,
        _decision: {
          selectedPath: step.defaultConnection,
          condition: 'default',
          matchedValue: actualValue,
          decisionField: effectiveDecisionField,
          isDefault: true,
        },
      },
    };
  }

  // No match
  return {
    matched: false,
    actualValue,
    output: {
      ...inputPayload,
      _decision: {
        selectedPath: null,
        matchedValue: actualValue,
        decisionField: effectiveDecisionField,
        error: 'No condition matched',
      },
    },
  };
}

// ============================================================================
// ForEach Simulation
// ============================================================================

async function simulateForeach(
  ctx: SimContext,
  step: WorkflowStep,
  inputPayload: Record<string, unknown>,
): Promise<{
  success: boolean;
  output: Record<string, unknown>;
  children: SimulationStepTrace[];
  error?: string;
  suggestion?: string;
}> {
  const itemsPath = step.itemsPath || 'items';
  const items = getValueByPath(inputPayload, itemsPath);

  if (!Array.isArray(items)) {
    return {
      success: false,
      output: { extractedValue: items },
      children: [],
      error: `itemsPath "${itemsPath}" did not return an array (got ${typeof items}: ${JSON.stringify(items)?.substring(0, 100)})`,
      suggestion: `Ensure the previous step output has an array at path "${itemsPath}". Available keys: ${safeKeys(inputPayload).join(', ')}`,
    };
  }

  const maxItems = Math.min(items.length, step.maxItems || 100, ctx.maxForeachItems);
  const limitedItems = items.slice(0, maxItems);

  // Find the child step (first connection target)
  const connections = step.connections || [];
  const childStepId = connections[0]?.targetStepId;
  let childStep: WorkflowStep | undefined;
  if (childStepId) {
    childStep = ctx.stepMap.get(childStepId);
  } else {
    // Sequential fallback
    const idx = ctx.stepIndex.get(step.id);
    if (idx !== undefined && idx + 1 < ctx.steps.length) {
      const nextStep = ctx.steps[idx + 1];
      // Don't use join as child step
      if (nextStep.stepType !== 'join') {
        childStep = nextStep;
      }
    }
  }

  const children: SimulationStepTrace[] = [];
  const childResults: Record<string, unknown>[] = [];
  const itemVariable = step.itemVariable || 'item';

  for (let i = 0; i < limitedItems.length; i++) {
    const item = limitedItems[i];
    const childInput: Record<string, unknown> = {
      ...inputPayload,
      [itemVariable]: item,
      _item: item,
      _index: i,
      _total: items.length,
    };

    if (childStep) {
      const childCtx: SimContext = {
        ...ctx,
        trace: [], // Separate trace for each child
      };

      const childOutput = await simulateFromStep(childCtx, childStep, childInput);

      // Collect child trace entries
      for (const trace of childCtx.trace) {
        children.push({
          ...trace,
          stepName: `${trace.stepName} [${i}]`,
        });
      }

      if (childOutput) {
        childResults.push(childOutput);
      }
    } else {
      // No child step - just pass through the item
      children.push({
        stepId: `${step.id}_item_${i}`,
        stepName: `Item ${i}`,
        stepType: 'agent',
        status: 'skipped',
        input: childInput,
        output: { _item: item },
        durationMs: 0,
      });
      childResults.push({ _item: item });
    }
  }

  const output: Record<string, unknown> = {
    totalItems: items.length,
    processedItems: limitedItems.length,
    _childResults: childResults,
  };

  return {
    success: true,
    output,
    children,
  };
}

// ============================================================================
// Input Resolution (mirrors WorkflowExecutionService.resolveStepInput)
// ============================================================================

async function resolveSimulatedInput(
  ctx: SimContext,
  step: WorkflowStep,
  previousOutput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const inputConfig = step.inputConfig;

  if (!inputConfig) {
    return previousOutput;
  }

  // Determine source data
  let sourceData: Record<string, unknown>;

  if (inputConfig.source === 'previous') {
    sourceData = previousOutput;
  } else if (inputConfig.source === 'trigger') {
    sourceData = ctx.triggerPayload;
  } else {
    // inputConfig.source is a step ID
    const stepOutput = ctx.stepOutputs.get(inputConfig.source);
    sourceData = stepOutput ? { output: stepOutput, ...stepOutput } : {};
  }

  // extractPath
  if (inputConfig.extractPath) {
    const extracted = getValueByPath(sourceData, inputConfig.extractPath);
    return { _input: extracted, _source: sourceData };
  }

  // mapping with template resolution
  if (inputConfig.mapping && Object.keys(inputConfig.mapping).length > 0) {
    const resolved: Record<string, unknown> = {};
    for (const [key, template] of Object.entries(inputConfig.mapping)) {
      resolved[key] = await resolveTemplateValue(template, sourceData, ctx.triggerPayload);
    }
    return resolved;
  }

  return sourceData;
}

// ============================================================================
// Helpers
// ============================================================================

function wrapOutput(output: Record<string, unknown>): Record<string, unknown> {
  return {
    ...output,
    output: output,
  };
}

function getNextStepIds(ctx: SimContext, step: WorkflowStep): string[] {
  // Explicit connections
  if (step.connections && step.connections.length > 0) {
    return step.connections.map(c => c.targetStepId).filter(id => ctx.stepMap.has(id));
  }

  // Sequential fallback
  const idx = ctx.stepIndex.get(step.id);
  if (idx !== undefined && idx + 1 < ctx.steps.length) {
    return [ctx.steps[idx + 1].id];
  }

  return [];
}

function buildStepsContext(ctx: SimContext): Record<string, unknown> {
  const stepsCtx: Record<string, unknown> = {};
  for (const [stepId, output] of ctx.stepOutputs) {
    stepsCtx[stepId] = { output };
  }
  return stepsCtx;
}
