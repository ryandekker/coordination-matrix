import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectToDatabase, closeDatabase } from './db/connection.js';
import { tasksRouter } from './routes/tasks.js';
import { lookupsRouter } from './routes/lookups.js';
import { fieldConfigsRouter } from './routes/field-configs.js';
import { viewsRouter } from './routes/views.js';
import { usersRouter } from './routes/users.js';
import { externalJobsRouter } from './routes/external-jobs.js';
import { workflowsRouter } from './routes/workflows.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { activityLogsRouter } from './routes/activity-logs.js';
import { webhooksRouter } from './routes/webhooks.js';
import batchJobsRouter from './routes/batch-jobs.js';
import workflowRunsRouter from './routes/workflow-runs.js';
import { eventsRouter } from './routes/events.js';
import { authRouter } from './routes/auth.js';
import { tagsRouter } from './routes/tags.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/auth.js';
import { activityLogService } from './services/activity-log.js';
import { webhookService } from './services/webhook-service.js';
import { batchJobService } from './services/batch-job-service.js';
import { workflowExecutionService } from './services/workflow-execution-service.js';
import { webhookTaskService } from './services/webhook-task-service.js';
import { setupSwagger } from './swagger.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Swagger documentation
setupSwagger(app);

// Auth routes (public)
app.use('/api/auth', authRouter);

// Public callback endpoints for external services (requires X-Workflow-Secret header)
// Foreach item callback - for streaming items to foreach steps
app.post('/api/workflow-runs/:id/foreach/:stepId/item', async (req, res) => {
  try {
    const { id, stepId } = req.params;
    const { ObjectId } = await import('mongodb');

    console.log(`[ForeachCallback] Received request for run=${id}, step=${stepId}`);

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      res.status(401).json({ error: 'Missing X-Workflow-Secret header' });
      return;
    }

    const { item, expectedCount, complete } = req.body;

    // Validate payload
    if (item === undefined && expectedCount === undefined && !complete) {
      res.status(400).json({
        error: 'Request body must include at least one of: item, expectedCount, or complete'
      });
      return;
    }

    const result = await workflowExecutionService.handleForeachItemCallback(
      id,
      stepId,
      { item, expectedCount, complete },
      secret
    );

    console.log(`[ForeachCallback] Success: received=${result.receivedCount}/${result.expectedCount}`);
    res.json(result);
  } catch (error: unknown) {
    console.error('[ForeachCallback] Error:', error);

    // Extract error details
    const err = error as Error & { code?: number; codeName?: string; errInfo?: unknown };
    const message = err.message || 'Failed to process foreach item';

    // Log additional MongoDB error details if present
    if (err.code) {
      console.error(`[ForeachCallback] MongoDB error code: ${err.code}, codeName: ${err.codeName}`);
      if (err.errInfo) {
        console.error('[ForeachCallback] Error info:', JSON.stringify(err.errInfo, null, 2));
      }
    }

    if (message.includes('Invalid callback secret') || message.includes('secret')) {
      res.status(401).json({ error: message });
      return;
    }
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    // Handle MongoDB validation errors
    if (message.includes('Document failed validation') || err.code === 121) {
      res.status(400).json({
        error: 'Invalid task data',
        details: message,
        validationError: err.errInfo || null
      });
      return;
    }

    res.status(500).json({ error: message });
  }
});

// General step callback
app.post('/api/workflow-runs/:id/callback/:stepId', async (req, res) => {
  try {
    const { id, stepId } = req.params;
    const { ObjectId } = await import('mongodb');

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid workflow run ID' });
      return;
    }

    const secret = req.headers['x-workflow-secret'] as string;
    if (!secret) {
      res.status(401).json({ error: 'Missing X-Workflow-Secret header' });
      return;
    }

    const payload = req.body;

    // Build request info for logging
    const requestInfo = {
      url: req.originalUrl,
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !['x-workflow-secret', 'authorization'].includes(key.toLowerCase()))
          .map(([key, value]) => [key, String(value)])
      ),
      receivedAt: new Date(),
    };

    const task = await workflowExecutionService.handleExternalCallback(id, stepId, payload, secret, requestInfo);

    res.json({
      acknowledged: true,
      taskId: task._id,
      taskStatus: task.status,
    });
  } catch (error: unknown) {
    console.error('[WorkflowRuns] Callback error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process callback';

    if (message.includes('Invalid callback secret')) {
      res.status(401).json({ error: message });
      return;
    }
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
});

// Protected API Routes - require authentication
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/lookups', requireAuth, lookupsRouter);
app.use('/api/field-configs', requireAuth, fieldConfigsRouter);
app.use('/api/views', requireAuth, viewsRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/external-jobs', requireAuth, externalJobsRouter);
app.use('/api/workflows', requireAuth, workflowsRouter);
app.use('/api/auth/api-keys', requireAuth, apiKeysRouter);
app.use('/api/activity-logs', requireAuth, activityLogsRouter);
app.use('/api/webhooks', requireAuth, webhooksRouter);
app.use('/api/batch-jobs', requireAuth, batchJobsRouter);
app.use('/api/workflow-runs', requireAuth, workflowRunsRouter);
app.use('/api/events', requireAuth, eventsRouter);
app.use('/api/tags', requireAuth, tagsRouter);

// Error handling
app.use(errorHandler);

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  await batchJobService.shutdown();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const start = async () => {
  try {
    await connectToDatabase();

    // Initialize event system services
    activityLogService.initialize();
    webhookService.initialize();
    batchJobService.initialize();
    workflowExecutionService.initialize();
    webhookTaskService.initialize();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Event system initialized');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
