import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../db/connection.js';
import { createError } from '../../middleware/error-handler.js';
import { Workflow, WorkflowStep, VALID_STEP_TYPES } from './types.js';
import { parseMermaidToStepsWithWarnings, generateMermaidFromSteps, generateMermaidSubgraphContent } from './mermaid-parser.js';

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
    const { mermaid, dryRun = false } = req.body;

    if (!mermaid || typeof mermaid !== 'string') {
      throw createError('mermaid is required', 400);
    }

    const workflowSections = parseMultiWorkflowMermaid(mermaid);

    if (workflowSections.length === 0) {
      throw createError('No workflow subgraphs found. Use subgraph blocks with @workflow metadata.', 400);
    }

    const results: Array<{
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
          results.push({
            name: '(unknown)',
            action: 'skip',
            stepCount: 0,
            error: 'Missing @workflow metadata',
          });
          continue;
        }

        const mermaidDiagram = `flowchart TD\n${mermaidContent}`;
        const { steps, warnings } = parseMermaidToStepsWithWarnings(mermaidDiagram);

        if (dryRun) {
          results.push({
            name: workflowName,
            id: workflowId || undefined,
            action: workflowId ? 'update' : 'create',
            stepCount: steps.length,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        } else {
          if (workflowId) {
            const updateResult = await db.collection<Workflow>('workflows').findOneAndUpdate(
              { _id: new ObjectId(workflowId) },
              {
                $set: {
                  name: workflowName,
                  description,
                  isActive,
                  rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                  steps: ensureStepIds(steps),
                  mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
                  updatedAt: new Date(),
                },
              },
              { returnDocument: 'after' }
            );

            if (updateResult) {
              results.push({
                name: workflowName,
                id: workflowId,
                action: 'update',
                stepCount: steps.length,
                warnings: warnings.length > 0 ? warnings : undefined,
              });
            } else {
              const now = new Date();
              const newWorkflow: Omit<Workflow, '_id'> = {
                name: workflowName,
                description,
                isActive,
                rootTaskTitleTemplate: rootTaskTitleTemplate || undefined,
                steps: ensureStepIds(steps),
                mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
                createdAt: now,
                updatedAt: now,
                createdById: null,
              };

              const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
              results.push({
                name: workflowName,
                id: insertResult.insertedId.toString(),
                action: 'create',
                stepCount: steps.length,
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
              steps: ensureStepIds(steps),
              mermaidDiagram: generateMermaidFromSteps(steps, workflowName),
              createdAt: now,
              updatedAt: now,
              createdById: null,
            };

            const insertResult = await db.collection<Workflow>('workflows').insertOne(newWorkflow as Workflow);
            results.push({
              name: workflowName,
              id: insertResult.insertedId.toString(),
              action: 'create',
              stepCount: steps.length,
              warnings: warnings.length > 0 ? warnings : undefined,
            });
          }
        }
      } catch (sectionError) {
        results.push({
          name: '(parse error)',
          action: 'skip',
          stepCount: 0,
          error: sectionError instanceof Error ? sectionError.message : 'Unknown error',
        });
      }
    }

    res.json({
      data: {
        results,
        summary: {
          total: results.length,
          created: results.filter(r => r.action === 'create').length,
          updated: results.filter(r => r.action === 'update').length,
          skipped: results.filter(r => r.action === 'skip').length,
        },
        dryRun,
      },
    });
  } catch (error) {
    next(error);
  }
}
