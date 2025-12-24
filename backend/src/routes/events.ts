import { Router, Request, Response } from 'express';
import { eventBus } from '../services/event-bus.js';
import { TaskEvent, WorkflowRunEvent } from '../types/index.js';

const router = Router();

// Store active connections for management
const activeConnections = new Set<Response>();

/**
 * SSE endpoint for real-time events
 * Clients connect here to receive live updates about tasks, activities, etc.
 */
router.get('/stream', (req: Request, res: Response) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Track this connection
  activeConnections.add(res);
  console.log(`[SSE] Client connected. Active connections: ${activeConnections.size}`);

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  // Keep connection alive with periodic heartbeat
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`:heartbeat\n\n`);
    }
  }, 30000); // Every 30 seconds

  // Subscribe to all task events from the event bus
  const unsubscribeTask = eventBus.subscribe('*', async (event: TaskEvent) => {
    if (res.writableEnded) return;

    try {
      // Send the event to the client
      const eventData = {
        id: event.id,
        type: event.type,
        taskId: event.taskId.toString(),
        timestamp: event.timestamp,
        changes: event.changes,
        actorType: event.actorType,
        // Include full task data for optimistic cache updates
        task: event.task ? {
          _id: event.task._id.toString(),
          title: event.task.title,
          summary: event.task.summary,
          status: event.task.status,
          urgency: event.task.urgency,
          parentId: event.task.parentId?.toString() || null,
          assigneeId: event.task.assigneeId?.toString() || null,
          createdById: event.task.createdById?.toString() || null,
          workflowId: event.task.workflowId?.toString() || null,
          workflowRunId: event.task.workflowRunId?.toString() || null,
          taskType: event.task.taskType,
          batchCounters: event.task.batchCounters,
          metadata: event.task.metadata,
          children: (event.task as unknown as Record<string, unknown>).children || [],
          createdAt: event.task.createdAt,
          updatedAt: event.task.updatedAt,
        } : undefined,
      };

      res.write(`event: ${event.type}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (error) {
      console.error('[SSE] Error sending task event:', error);
    }
  });

  // Subscribe to workflow run events for real-time workflow updates
  const unsubscribeWorkflowRun = eventBus.subscribeWorkflowRun('*', async (event: WorkflowRunEvent) => {
    if (res.writableEnded) return;

    try {
      // Send the workflow run event to the client
      const eventData = {
        id: event.id,
        type: event.type,
        workflowRunId: event.workflowRunId.toString(),
        timestamp: event.timestamp,
        stepId: event.stepId,
        taskId: event.taskId?.toString(),
        error: event.error,
        // Include workflow run data for cache updates
        workflowRun: event.workflowRun ? {
          _id: event.workflowRun._id.toString(),
          workflowId: event.workflowRun.workflowId.toString(),
          status: event.workflowRun.status,
          currentStepIds: event.workflowRun.currentStepIds,
          completedStepIds: event.workflowRun.completedStepIds,
          failedStepId: event.workflowRun.failedStepId,
          error: event.workflowRun.error,
          createdAt: event.workflowRun.createdAt,
          startedAt: event.workflowRun.startedAt,
          completedAt: event.workflowRun.completedAt,
        } : undefined,
      };

      res.write(`event: ${event.type}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (error) {
      console.error('[SSE] Error sending workflow run event:', error);
    }
  });

  // Clean up on disconnect
  const cleanup = () => {
    clearInterval(heartbeatInterval);
    unsubscribeTask();
    unsubscribeWorkflowRun();
    activeConnections.delete(res);
    console.log(`[SSE] Client disconnected. Active connections: ${activeConnections.size}`);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

/**
 * Get SSE stats (for monitoring)
 */
router.get('/stats', (_req: Request, res: Response) => {
  res.json({
    activeConnections: activeConnections.size,
    eventBusListeners: eventBus.listenerCount('*'),
  });
});

export { router as eventsRouter };
