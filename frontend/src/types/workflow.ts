// Workflow Types for Frontend
// Mirrors backend types for type safety

export type WorkflowStepType = 'step' | 'branch' | 'foreach' | 'subworkflow';

export type HITLPhase =
  | 'none'
  | 'pre_execution'
  | 'during_execution'
  | 'post_execution'
  | 'on_error'
  | 'approval_required';

export interface WorkflowStepBase {
  id: string;
  name: string;
  description?: string;
}

export interface WorkflowRegularStep extends WorkflowStepBase {
  stepType: 'step';
  type: 'automated' | 'manual';
  hitlPhase: HITLPhase;
  config?: Record<string, unknown>;
  nextStepId?: string | null;
}

export interface WorkflowBranchStep extends WorkflowStepBase {
  stepType: 'branch';
  condition: string;
  trueBranchStepId: string | null;
  falseBranchStepId: string | null;
}

export interface WorkflowForeachStep extends WorkflowStepBase {
  stepType: 'foreach';
  collection: string;
  iterator: string;
  bodyStepIds: string[];
  nextStepId?: string | null;
}

export interface WorkflowSubworkflowStep extends WorkflowStepBase {
  stepType: 'subworkflow';
  workflowRef: string;
  nextStepId?: string | null;
}

export type WorkflowStep =
  | WorkflowRegularStep
  | WorkflowBranchStep
  | WorkflowForeachStep
  | WorkflowSubworkflowStep;

// Legacy step format for backwards compatibility
export interface LegacyWorkflowStep {
  id: string;
  name: string;
  type: 'automated' | 'manual';
  hitlPhase: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface Workflow {
  _id?: string;
  name: string;
  description: string;
  isActive: boolean;
  steps: WorkflowStep[];
  entryStepId?: string | null;
  mermaidDiagram?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Helper type guard functions
export function isRegularStep(step: WorkflowStep): step is WorkflowRegularStep {
  return step.stepType === 'step';
}

export function isBranchStep(step: WorkflowStep): step is WorkflowBranchStep {
  return step.stepType === 'branch';
}

export function isForeachStep(step: WorkflowStep): step is WorkflowForeachStep {
  return step.stepType === 'foreach';
}

export function isSubworkflowStep(step: WorkflowStep): step is WorkflowSubworkflowStep {
  return step.stepType === 'subworkflow';
}

// Helper to normalize legacy steps to new format
export function normalizeStep(step: WorkflowStep | LegacyWorkflowStep): WorkflowStep {
  if ('stepType' in step) {
    return step;
  }

  // Convert from legacy format
  return {
    id: step.id,
    name: step.name,
    stepType: 'step',
    type: step.type,
    hitlPhase: step.hitlPhase as HITLPhase,
    description: step.description,
    config: step.config,
  } as WorkflowRegularStep;
}

export function normalizeSteps(steps: Array<WorkflowStep | LegacyWorkflowStep>): WorkflowStep[] {
  return steps.map(normalizeStep);
}

// Create a new step with defaults
export function createStep(type: WorkflowStepType, id?: string): WorkflowStep {
  const stepId = id || `step-${Date.now()}`;

  switch (type) {
    case 'step':
      return {
        id: stepId,
        name: 'New Step',
        stepType: 'step',
        type: 'automated',
        hitlPhase: 'none',
      };
    case 'branch':
      return {
        id: stepId,
        name: 'Decision',
        stepType: 'branch',
        condition: '',
        trueBranchStepId: null,
        falseBranchStepId: null,
      };
    case 'foreach':
      return {
        id: stepId,
        name: 'Loop',
        stepType: 'foreach',
        collection: 'items',
        iterator: 'item',
        bodyStepIds: [],
      };
    case 'subworkflow':
      return {
        id: stepId,
        name: 'Subworkflow',
        stepType: 'subworkflow',
        workflowRef: '',
      };
  }
}
