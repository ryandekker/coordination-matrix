import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../db/connection.js';
import { createError } from '../../middleware/error-handler.js';
import { Workflow, WorkflowStep, VALID_STEP_TYPES } from './types.js';
import { parseMermaidToStepsWithWarnings, generateMermaidFromSteps, generateMermaidSubgraphContent } from './mermaid-parser.js';

// ============================================================================
// Diff Types for Change Preview
// ============================================================================

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface StepDiff {
  stepId: string;
  stepName: string;
  stepType: string;
  action: 'add' | 'remove' | 'modify' | 'unchanged';
  fieldChanges?: FieldChange[];
}

export interface WorkflowDiff {
  workflowId?: string;
  workflowName: string;
  action: 'create' | 'update' | 'skip';
  stepCount: number;
  stepDiffs: StepDiff[];
  metadataChanges?: FieldChange[];
  warnings?: string[];
  error?: string;
}

// Fields to compare for step diffs (excluding id, name, stepType which are used for matching)
const STEP_DIFF_FIELDS: (keyof WorkflowStep)[] = [
  'description',
  'additionalInstructions',
  'defaultAssigneeId',
  'promptDocumentIds',
  'externalConfig',
  'defaultConnection',
  'itemsPath',
  'itemVariable',
  'maxItems',
  'awaitStepId',
  'joinBoundary',
  'minSuccessPercent',
  'expectedCountPath',
  'flowId',
  'inputMapping',
  'inputSource',
  'inputPath',
  'connections',
  'branches',
];

// ============================================================================
// Diff Computation Functions
// ============================================================================

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    // Get all keys from both objects
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

    for (const key of allKeys) {
      const aVal = aObj[key];
      const bVal = bObj[key];

      // Treat undefined and missing keys as equivalent
      if (aVal === undefined && bVal === undefined) continue;
      if (aVal === undefined && !(key in bObj)) continue;
      if (bVal === undefined && !(key in aObj)) continue;

      if (!deepEqual(aVal, bVal)) return false;
    }
    return true;
  }

  return false;
}

// Normalize connections/branches for semantic comparison (by step name instead of ID)
// This allows us to detect when the actual routing is the same even if IDs changed
function normalizeConnectionsSemantic(
  connections: unknown,
  idToName: Map<string, string>
): unknown {
  if (!Array.isArray(connections)) return connections;

  return connections.map(conn => {
    if (typeof conn !== 'object' || conn === null) return conn;
    const c = conn as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    // Replace targetStepId with the step name for semantic comparison
    if (c.targetStepId) {
      const targetName = idToName.get(String(c.targetStepId));
      normalized.target = targetName || c.targetStepId; // Fall back to ID if name not found
    }

    // Include condition/label for comparison
    if (c.condition !== undefined && c.condition !== null && c.condition !== '') {
      normalized.condition = c.condition;
    }
    if (c.label !== undefined && c.label !== null && c.label !== '') {
      normalized.label = c.label;
    }

    return normalized;
  }).sort((a, b) => {
    // Sort by target name for consistent comparison
    const aTarget = (a as Record<string, unknown>).target || '';
    const bTarget = (b as Record<string, unknown>).target || '';
    return String(aTarget).localeCompare(String(bTarget));
  });
}

function matchSteps(
  importedSteps: WorkflowStep[],
  existingSteps: WorkflowStep[]
): Map<string, WorkflowStep | null> {
  // Map imported step ID -> matched existing step (or null if no match)
  const matches = new Map<string, WorkflowStep | null>();
  const usedExisting = new Set<string>();

  // Pass 1: Match by exact ID
  for (const imported of importedSteps) {
    const existing = existingSteps.find(e => e.id === imported.id && !usedExisting.has(e.id));
    if (existing) {
      matches.set(imported.id, existing);
      usedExisting.add(existing.id);
    }
  }

  // Pass 2: Match by name + stepType for unmatched steps
  for (const imported of importedSteps) {
    if (matches.has(imported.id)) continue;

    const existing = existingSteps.find(e =>
      !usedExisting.has(e.id) &&
      e.name === imported.name &&
      e.stepType === imported.stepType
    );
    if (existing) {
      matches.set(imported.id, existing);
      usedExisting.add(existing.id);
    }
  }

  // Pass 3: Match by position + stepType for remaining
  const unmatchedImported = importedSteps.filter(s => !matches.has(s.id));
  const unmatchedExisting = existingSteps.filter(s => !usedExisting.has(s.id));

  for (let i = 0; i < unmatchedImported.length && i < unmatchedExisting.length; i++) {
    const imported = unmatchedImported[i];
    const existing = unmatchedExisting[i];
    if (imported.stepType === existing.stepType) {
      matches.set(imported.id, existing);
      usedExisting.add(existing.id);
    }
  }

  // Mark remaining as unmatched (new steps)
  for (const imported of importedSteps) {
    if (!matches.has(imported.id)) {
      matches.set(imported.id, null);
    }
  }

  return matches;
}

function computeStepDiff(
  imported: WorkflowStep,
  existing: WorkflowStep | null,
  importedSteps: WorkflowStep[],
  existingSteps: WorkflowStep[]
): StepDiff {
  if (!existing) {
    return {
      stepId: imported.id,
      stepName: imported.name,
      stepType: imported.stepType,
      action: 'add',
    };
  }

  const fieldChanges: FieldChange[] = [];

  // Check name change
  if (imported.name !== existing.name) {
    fieldChanges.push({ field: 'name', oldValue: existing.name, newValue: imported.name });
  }

  // Check stepType change (rare but possible)
  if (imported.stepType !== existing.stepType) {
    fieldChanges.push({ field: 'stepType', oldValue: existing.stepType, newValue: imported.stepType });
  }

  // Build ID-to-name maps for semantic connection comparison
  const importedIdToName = new Map<string, string>();
  const existingIdToName = new Map<string, string>();
  for (const s of importedSteps) importedIdToName.set(s.id, s.name);
  for (const s of existingSteps) existingIdToName.set(s.id, s.name);

  // Check other fields
  for (const field of STEP_DIFF_FIELDS) {
    const rawOldVal = existing[field];
    const rawNewVal = imported[field];

    // Skip if both are undefined/null/empty
    const oldEmpty = rawOldVal === undefined || rawOldVal === null || (Array.isArray(rawOldVal) && rawOldVal.length === 0);
    const newEmpty = rawNewVal === undefined || rawNewVal === null || (Array.isArray(rawNewVal) && rawNewVal.length === 0);
    if (oldEmpty && newEmpty) continue;

    // For connections/branches, compare semantically (by target step name, not ID)
    if (field === 'connections' || field === 'branches') {
      const oldSemantic = normalizeConnectionsSemantic(rawOldVal, existingIdToName);
      const newSemantic = normalizeConnectionsSemantic(rawNewVal, importedIdToName);

      if (!deepEqual(oldSemantic, newSemantic)) {
        // Show the semantic values in the diff for clarity
        fieldChanges.push({ field, oldValue: oldSemantic, newValue: newSemantic });
      }
      continue;
    }

    if (!deepEqual(rawOldVal, rawNewVal)) {
      fieldChanges.push({ field, oldValue: rawOldVal, newValue: rawNewVal });
    }
  }

  return {
    stepId: imported.id,
    stepName: imported.name,
    stepType: imported.stepType,
    action: fieldChanges.length > 0 ? 'modify' : 'unchanged',
    fieldChanges: fieldChanges.length > 0 ? fieldChanges : undefined,
  };
}

function computeWorkflowMetadataDiff(
  imported: { name: string; description: string; isActive: boolean; rootTaskTitleTemplate: string },
  existing: Workflow
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (imported.name !== existing.name) {
    changes.push({ field: 'name', oldValue: existing.name, newValue: imported.name });
  }
  if (imported.description !== (existing.description || '')) {
    changes.push({ field: 'description', oldValue: existing.description || '', newValue: imported.description });
  }
  if (imported.isActive !== existing.isActive) {
    changes.push({ field: 'isActive', oldValue: existing.isActive, newValue: imported.isActive });
  }
  if (imported.rootTaskTitleTemplate !== (existing.rootTaskTitleTemplate || '')) {
    changes.push({
      field: 'rootTaskTitleTemplate',
      oldValue: existing.rootTaskTitleTemplate || '',
      newValue: imported.rootTaskTitleTemplate
    });
  }

  return changes;
}

// ============================================================================
// Step ID Helpers
// ============================================================================

// Helper to ensure all steps have IDs
function ensureStepIds(steps: WorkflowStep[]): WorkflowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  return steps.map((step) => {
    const normalized = { ...step };

    if (!normalized.id) {
      normalized.id = new ObjectId().toString();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepAny = step as any;
    if (!normalized.stepType && stepAny.type && VALID_STEP_TYPES.includes(stepAny.type)) {
      normalized.stepType = stepAny.type;
      delete stepAny.type;
    }

    return normalized;
  });
}

// Handler for GET /api/workflows/export-multi - Export workflows as multi-workflow Mermaid
export async function handleExportMulti(req: Request, res: Response, next: NextFunction) {
  try {
    const db = getDb();
    const { ids } = req.query;

    const query: Record<string, unknown> = {};
    if (ids && typeof ids === 'string') {
      const idStrings = ids.split(',').map(id => id.trim()).filter(Boolean);
      const validIds: ObjectId[] = [];
      for (const idStr of idStrings) {
        try {
          if (ObjectId.isValid(idStr)) {
            validIds.push(new ObjectId(idStr));
          }
        } catch {
          // Skip invalid IDs
        }
      }
      if (validIds.length > 0) {
        query._id = { $in: validIds };
      } else if (idStrings.length > 0) {
        throw createError('Invalid workflow IDs provided', 400);
      }
    }

    const workflows = await db
      .collection<Workflow>('workflows')
      .find(query)
      .sort({ name: 1 })
      .toArray();

    if (workflows.length === 0) {
      res.json({ data: { mermaid: '', workflows: [] } });
      return;
    }

    const lines: string[] = ['flowchart TD'];
    const workflowSummaries: Array<{ id: string; name: string; isNew: boolean }> = [];

    for (const workflow of workflows) {
      const workflowId = workflow._id.toString();
      const safeName = workflow.name.replace(/"/g, "'");

      lines.push('');
      lines.push(`    %% @workflow: "${workflow.name}"`);
      lines.push(`    %% @id: ${workflowId}`);
      if (workflow.description) {
        lines.push(`    %% @description: ${workflow.description}`);
      }
      if (workflow.isActive !== undefined) {
        lines.push(`    %% @isActive: ${workflow.isActive}`);
      }
      if (workflow.rootTaskTitleTemplate) {
        lines.push(`    %% @rootTaskTitleTemplate: ${workflow.rootTaskTitleTemplate}`);
      }

      lines.push(`    subgraph ${workflowId}["${safeName}"]`);
      lines.push('        direction TB');

      const subgraphContent = generateMermaidSubgraphContent(workflow.steps || [], workflowId);
      if (subgraphContent) {
        lines.push(subgraphContent);
      }

      lines.push('    end');

      workflowSummaries.push({
        id: workflowId,
        name: workflow.name,
        isNew: false,
      });
    }

    lines.push('');
    lines.push('    %% Styling');
    lines.push('    classDef agent fill:#3B82F6,color:#fff');
    lines.push('    classDef external fill:#F97316,color:#fff');
    lines.push('    classDef manual fill:#8B5CF6,color:#fff');
    lines.push('    classDef decision fill:#F59E0B,color:#fff');
    lines.push('    classDef foreach fill:#10B981,color:#fff');
    lines.push('    classDef join fill:#6366F1,color:#fff');
    lines.push('    classDef flow fill:#EC4899,color:#fff');

    const mermaid = lines.join('\n');

    res.json({
      data: {
        mermaid,
        workflows: workflowSummaries,
      }
    });
  } catch (error) {
    next(error);
  }
}

// Parse multi-workflow Mermaid document with subgraphs
interface ParsedWorkflowSection {
  name: string;
  id: string | null;
  description: string;
  isActive: boolean;
  rootTaskTitleTemplate: string;
  mermaidContent: string;
}

function parseMultiWorkflowMermaid(mermaid: string): ParsedWorkflowSection[] {
  const lines = mermaid.split('\n');
  const workflows: ParsedWorkflowSection[] = [];

  let currentWorkflow: Partial<ParsedWorkflowSection> = {};
  let currentContent: string[] = [];
  let inSubgraph = false;
  let subgraphDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!inSubgraph) {
      const nameMatch = trimmedLine.match(/^%% @workflow:\s*"?([^"]+)"?$/);
      if (nameMatch) {
        currentWorkflow.name = nameMatch[1].trim();
        continue;
      }

      const idMatch = trimmedLine.match(/^%% @id:\s*(\S+)$/);
      if (idMatch && idMatch[1] !== '(new)') {
        currentWorkflow.id = idMatch[1].trim();
        continue;
      }

      const descMatch = trimmedLine.match(/^%% @description:\s*(.+)$/);
      if (descMatch) {
        currentWorkflow.description = descMatch[1].trim();
        continue;
      }

      const activeMatch = trimmedLine.match(/^%% @isActive:\s*(true|false)$/);
      if (activeMatch) {
        currentWorkflow.isActive = activeMatch[1] === 'true';
        continue;
      }

      const templateMatch = trimmedLine.match(/^%% @rootTaskTitleTemplate:\s*(.+)$/);
      if (templateMatch) {
        currentWorkflow.rootTaskTitleTemplate = templateMatch[1].trim();
        continue;
      }
    }

    const subgraphMatch = trimmedLine.match(/^subgraph\s+(\S+)/);
    if (subgraphMatch) {
      if (subgraphDepth === 0) {
        inSubgraph = true;
        currentContent = [];
      }
      subgraphDepth++;
      continue;
    }

    if (trimmedLine === 'end') {
      subgraphDepth--;
      if (subgraphDepth === 0 && inSubgraph) {
        workflows.push({
          name: currentWorkflow.name || '',
          id: currentWorkflow.id || null,
          description: currentWorkflow.description || '',
          isActive: currentWorkflow.isActive !== undefined ? currentWorkflow.isActive : true,
          rootTaskTitleTemplate: currentWorkflow.rootTaskTitleTemplate || '',
          mermaidContent: currentContent.join('\n'),
        });

        currentWorkflow = {};
        currentContent = [];
        inSubgraph = false;
      }
      continue;
    }

    if (inSubgraph && subgraphDepth === 1) {
      if (!trimmedLine.startsWith('direction ')) {
        currentContent.push(line);
      }
    }
  }

  return workflows;
}

// Handler for POST /api/workflows/import-multi - Import workflows from multi-workflow Mermaid
export async function handleImportMulti(req: Request, res: Response, next: NextFunction) {
  try {
    const db = getDb();
    const { mermaid, dryRun = false, includeStepDiffs = false } = req.body;

    if (!mermaid || typeof mermaid !== 'string') {
      throw createError('mermaid is required', 400);
    }

    const workflowSections = parseMultiWorkflowMermaid(mermaid);

    if (workflowSections.length === 0) {
      throw createError('No workflow subgraphs found. Use subgraph blocks with @workflow metadata.', 400);
    }

    // For detailed diffs, we need to fetch existing workflows
    const existingWorkflowsMap = new Map<string, Workflow>();
    if (dryRun && includeStepDiffs) {
      const idsToFetch = workflowSections
        .filter(s => s.id && ObjectId.isValid(s.id))
        .map(s => new ObjectId(s.id!));

      if (idsToFetch.length > 0) {
        const existingWorkflows = await db
          .collection<Workflow>('workflows')
          .find({ _id: { $in: idsToFetch } })
          .toArray();

        for (const wf of existingWorkflows) {
          existingWorkflowsMap.set(wf._id.toString(), wf);
        }
      }
    }

    // Use WorkflowDiff for detailed results, or basic results
    const detailedResults: WorkflowDiff[] = [];
    const basicResults: Array<{
      name: string;
      id?: string;
      action: 'create' | 'update' | 'skip';
      stepCount: number;
      error?: string;
      warnings?: string[];
    }> = [];

    for (const section of workflowSections) {
      try {
        const { name: workflowName, id: workflowId, description, isActive, rootTaskTitleTemplate, mermaidContent } = section;

        if (!workflowName) {
          if (includeStepDiffs) {
            detailedResults.push({
              workflowName: '(unknown)',
              action: 'skip',
              stepCount: 0,
              stepDiffs: [],
              error: 'Missing @workflow metadata',
            });
          } else {
            basicResults.push({
              name: '(unknown)',
              action: 'skip',
              stepCount: 0,
              error: 'Missing @workflow metadata',
            });
          }
          continue;
        }

        const mermaidDiagram = `flowchart TD\n${mermaidContent}`;
        const { steps, warnings } = parseMermaidToStepsWithWarnings(mermaidDiagram);
        const stepsWithIds = ensureStepIds(steps);

        if (dryRun) {
          const action = workflowId ? 'update' : 'create';

          if (includeStepDiffs) {
            // Compute detailed diffs
            const existingWorkflow = workflowId ? existingWorkflowsMap.get(workflowId) : undefined;
            let stepDiffs: StepDiff[] = [];
            let metadataChanges: FieldChange[] | undefined;

            if (existingWorkflow) {
              // Match steps and compute diffs
              const existingSteps = existingWorkflow.steps || [];
              const matches = matchSteps(stepsWithIds, existingSteps);

              // Diff for imported steps
              for (const step of stepsWithIds) {
                const matchedExisting = matches.get(step.id) || null;
                stepDiffs.push(computeStepDiff(step, matchedExisting, stepsWithIds, existingSteps));
              }

              // Find removed steps (in existing but not matched)
              const matchedExistingIds = new Set<string>();
              for (const [, existing] of matches) {
                if (existing) matchedExistingIds.add(existing.id);
              }

              for (const existingStep of existingWorkflow.steps || []) {
                if (!matchedExistingIds.has(existingStep.id)) {
                  stepDiffs.push({
                    stepId: existingStep.id,
                    stepName: existingStep.name,
                    stepType: existingStep.stepType,
                    action: 'remove',
                  });
                }
              }

              // Compute metadata diff
              metadataChanges = computeWorkflowMetadataDiff(
                { name: workflowName, description, isActive, rootTaskTitleTemplate },
                existingWorkflow
              );
              if (metadataChanges.length === 0) metadataChanges = undefined;
            } else {
              // New workflow - all steps are 'add'
              stepDiffs = stepsWithIds.map(step => ({
                stepId: step.id,
                stepName: step.name,
                stepType: step.stepType,
                action: 'add' as const,
              }));
            }

            detailedResults.push({
              workflowId: workflowId || undefined,
              workflowName,
              action,
              stepCount: stepsWithIds.length,
              stepDiffs,
              metadataChanges,
              warnings: warnings.length > 0 ? warnings : undefined,
            });
          } else {
            basicResults.push({
              name: workflowName,
              id: workflowId || undefined,
              action,
              stepCount: steps.length,
              warnings: warnings.length > 0 ? warnings : undefined,
            });
          }
        } else {
          // Actual import (not dry run)
          if (workflowId) {
            const updateResult = await db.collection<Workflow>('workflows').findOneAndUpdate(
              { _id: new ObjectId(workflowId) },
              {
                $set: {
                  name: workflowName,
                  description,
                  isActive,
                  rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                  steps: stepsWithIds,
                  mermaidDiagram: generateMermaidFromSteps(stepsWithIds, workflowName),
                  updatedAt: new Date(),
                },
              },
              { returnDocument: 'after' }
            );

            if (updateResult) {
              basicResults.push({
                name: workflowName,
                id: workflowId,
                action: 'update',
                stepCount: stepsWithIds.length,
                warnings: warnings.length > 0 ? warnings : undefined,
              });
            } else {
              const now = new Date();
              const newWorkflow: Omit<Workflow, '_id'> = {
                name: workflowName,
                description,
                isActive,
                rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                steps: stepsWithIds,
                mermaidDiagram: generateMermaidFromSteps(stepsWithIds, workflowName),
                createdAt: now,
                updatedAt: now,
                createdById: null,
              };

              const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
              basicResults.push({
                name: workflowName,
                id: insertResult.insertedId.toString(),
                action: 'create',
                stepCount: stepsWithIds.length,
                warnings: warnings.length > 0 ? warnings : undefined,
              });
            }
          } else {
            const now = new Date();
            const newWorkflow: Omit<Workflow, '_id'> = {
              name: workflowName,
              description,
              isActive,
              rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
              steps: stepsWithIds,
              mermaidDiagram: generateMermaidFromSteps(stepsWithIds, workflowName),
              createdAt: now,
              updatedAt: now,
              createdById: null,
            };

            const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
            basicResults.push({
              name: workflowName,
              id: insertResult.insertedId.toString(),
              action: 'create',
              stepCount: stepsWithIds.length,
              warnings: warnings.length > 0 ? warnings : undefined,
            });
          }
        }
      } catch (sectionError) {
        const errorResult = {
          name: '(parse error)',
          action: 'skip' as const,
          stepCount: 0,
          error: sectionError instanceof Error ? sectionError.message : 'Unknown error',
        };

        if (includeStepDiffs) {
          detailedResults.push({
            workflowName: errorResult.name,
            action: errorResult.action,
            stepCount: 0,
            stepDiffs: [],
            error: errorResult.error,
          });
        } else {
          basicResults.push(errorResult);
        }
      }
    }

    // Compute summary
    const results = includeStepDiffs ? detailedResults : basicResults;
    const summary = {
      total: results.length,
      created: results.filter(r => r.action === 'create').length,
      updated: results.filter(r => r.action === 'update').length,
      skipped: results.filter(r => r.action === 'skip').length,
    };

    // Add step-level summary for detailed results
    let stepSummary;
    if (includeStepDiffs && dryRun) {
      const allStepDiffs = detailedResults.flatMap(r => r.stepDiffs);
      stepSummary = {
        added: allStepDiffs.filter(s => s.action === 'add').length,
        modified: allStepDiffs.filter(s => s.action === 'modify').length,
        removed: allStepDiffs.filter(s => s.action === 'remove').length,
        unchanged: allStepDiffs.filter(s => s.action === 'unchanged').length,
      };
    }

    res.json({
      data: {
        results: includeStepDiffs ? detailedResults : basicResults,
        summary,
        stepSummary,
        dryRun,
      },
    });
  } catch (error) {
    next(error);
  }
}
