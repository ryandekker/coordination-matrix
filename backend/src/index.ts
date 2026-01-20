import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load env files in order of precedence (first found value wins):
// 1. backend/.env.local (auto-generated for multi-worktree dev)
// 2. backend/.env (backend-specific overrides)
// 3. .env (monorepo root - shared config)
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, '..');
const monorepoRoot = join(backendDir, '..');

const envFiles = [
  join(backendDir, '.env.local'),
  join(backendDir, '.env'),
  join(monorepoRoot, '.env'),
];

for (const envFile of envFiles) {
  if (existsSync(envFile)) {
    dotenv.config({ path: envFile }); // Won't override existing vars
  }
}
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
import { documentsRouter } from './routes/documents.js';
import { variablePackagesRouter } from './routes/variable-packages.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/auth.js';
import { requireScope, SCOPES } from './middleware/authorize.js';
import { generalApiRateLimiter } from './middleware/rate-limit.js';
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
// Use 'short' format in production for reduced I/O overhead, 'combined' in development
const morganFormat = process.env.NODE_ENV === 'production' ? 'short' : 'combined';
app.use(morgan(morganFormat, {
  // Skip health check logging to reduce noise
  skip: (req) => req.url === '/health'
}));
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

// Apply general rate limiting to all API routes
app.use('/api', generalApiRateLimiter);

// Protected API Routes - require authentication and scope checks for API keys
// Note: JWT-authenticated users bypass scope checks (they use role-based access)
// API key users must have appropriate scopes

// Tasks - most daemon operations use this
app.use('/api/tasks', requireAuth, requireScope(SCOPES.TASKS_READ), tasksRouter);

// Lookups and field configs - configuration data, read-only for most
app.use('/api/lookups', requireAuth, requireScope(SCOPES.TASKS_READ), lookupsRouter);
app.use('/api/field-configs', requireAuth, requireScope(SCOPES.TASKS_READ), fieldConfigsRouter);

// Views/saved searches
app.use('/api/views', requireAuth, requireScope(SCOPES.VIEWS_READ), viewsRouter);

// Users - admin operations handled within route
app.use('/api/users', requireAuth, requireScope(SCOPES.USERS_READ), usersRouter);

// External jobs - workflow execution
app.use('/api/external-jobs', requireAuth, requireScope(SCOPES.TASKS_READ), externalJobsRouter);

// Workflows - read access for viewing, write handled within route
app.use('/api/workflows', requireAuth, requireScope(SCOPES.WORKFLOWS_READ), workflowsRouter);

// API keys - admin/self-management, handled within route
app.use('/api/auth/api-keys', requireAuth, requireScope(SCOPES.API_KEYS_READ), apiKeysRouter);

// Activity logs - read-only for most users
app.use('/api/activity-logs', requireAuth, requireScope(SCOPES.TASKS_READ), activityLogsRouter);

// Webhooks - admin feature
app.use('/api/webhooks', requireAuth, requireScope(SCOPES.WEBHOOKS_READ), webhooksRouter);

// Batch jobs - workflow execution
app.use('/api/batch-jobs', requireAuth, requireScope(SCOPES.WORKFLOWS_READ), batchJobsRouter);

// Workflow runs - execution control
app.use('/api/workflow-runs', requireAuth, requireScope(SCOPES.WORKFLOWS_READ), workflowRunsRouter);

// SSE events - needs task read access
app.use('/api/events', requireAuth, requireScope(SCOPES.TASKS_READ), eventsRouter);

// Tags - task-related
app.use('/api/tags', requireAuth, requireScope(SCOPES.TASKS_READ), tagsRouter);

// Documents - separate scope
app.use('/api/documents', requireAuth, requireScope(SCOPES.DOCUMENTS_READ), documentsRouter);

// Variable packages - configuration data, requires admin for write
app.use('/api/variable-packages', requireAuth, requireScope(SCOPES.ADMIN), variablePackagesRouter);

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
