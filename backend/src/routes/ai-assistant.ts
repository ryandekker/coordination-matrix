import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { workflowExecutionService } from '../services/workflow-execution-service.js';
import { getDb } from '../db/connection.js';
import { Workflow } from '../types/index.js';

const ASSISTANT_WORKFLOW_NAMES = {
  workflow: 'AI Workflow Assistant',
  document: 'AI Document Assistant',
} as const;

type AssistantContext = keyof typeof ASSISTANT_WORKFLOW_NAMES;

export const aiAssistantRouter = Router();

// POST /api/ai-assistant/follow-up
// Triggers an AI assistant workflow run for a given workflow or document target.
// Resolves the assistant workflow by name server-side so callers don't need to know IDs.
aiAssistantRouter.post('/follow-up', async (req: Request, res: Response): Promise<void> => {
  try {
    const { context, targetId, instruction, mode } = req.body as {
      context?: AssistantContext;
      targetId?: string;
      instruction?: string;
      mode?: 'question' | 'edit';
    };

    if (!context || (context !== 'workflow' && context !== 'document')) {
      res.status(400).json({ error: "context must be 'workflow' or 'document'" });
      return;
    }

    if (!targetId || typeof targetId !== 'string' || !ObjectId.isValid(targetId)) {
      res.status(400).json({ error: 'targetId is required and must be a valid ObjectId' });
      return;
    }

    if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }

    if (mode && mode !== 'question' && mode !== 'edit') {
      res.status(400).json({ error: "mode must be 'question' or 'edit' if provided" });
      return;
    }

    const workflowName = ASSISTANT_WORKFLOW_NAMES[context];
    const db = getDb();

    // Resolve the assistant workflow by name. Prefer the active one in the
    // target's group when possible; fall back to any active match.
    const targetCollection = context === 'workflow' ? 'workflows' : 'documents';
    const targetDoc = await db
      .collection(targetCollection)
      .findOne({ _id: new ObjectId(targetId) }, { projection: { groupId: 1 } });

    if (!targetDoc) {
      res.status(404).json({ error: `${context} not found` });
      return;
    }

    const groupId = (targetDoc.groupId as ObjectId | null) || null;

    let assistant = groupId
      ? await db.collection<Workflow>('workflows').findOne({
          name: workflowName,
          isActive: true,
          groupId,
        })
      : null;

    if (!assistant) {
      assistant = await db.collection<Workflow>('workflows').findOne({
        name: workflowName,
        isActive: true,
      });
    }

    if (!assistant) {
      res.status(404).json({
        error: `Assistant workflow "${workflowName}" not found. Deploy AI assistant workflows first.`,
      });
      return;
    }

    const inputPayload: Record<string, unknown> = { instruction: instruction.trim() };
    if (context === 'workflow') {
      inputPayload.workflowId = targetId;
    } else {
      inputPayload.documentId = targetId;
    }
    if (mode) {
      inputPayload.mode = mode;
    }

    const actorId =
      req.user?.userId && ObjectId.isValid(req.user.userId)
        ? new ObjectId(req.user.userId)
        : null;

    const { run, rootTask } = await workflowExecutionService.startWorkflow(
      {
        workflowId: assistant._id.toString(),
        inputPayload,
        humanInstruction: instruction.trim(),
      },
      actorId
    );

    res.status(201).json({
      run,
      rootTask,
      assistantWorkflowId: assistant._id.toString(),
      assistantWorkflowName: workflowName,
    });
  } catch (error: unknown) {
    console.error('[AiAssistant] follow-up error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start assistant follow-up';
    const isSchemaError = message.startsWith('Input validation failed:');
    res.status(isSchemaError ? 422 : 500).json({
      error: message,
      ...(isSchemaError && { code: 'INPUT_SCHEMA_VALIDATION_FAILED' }),
    });
  }
});
