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
import { errorHandler } from './middleware/error-handler.js';
import { activityLogService } from './services/activity-log.js';
import { webhookService } from './services/webhook-service.js';

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

// API Routes
app.use('/api/tasks', tasksRouter);
app.use('/api/lookups', lookupsRouter);
app.use('/api/field-configs', fieldConfigsRouter);
app.use('/api/views', viewsRouter);
app.use('/api/users', usersRouter);
app.use('/api/external-jobs', externalJobsRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/auth/api-keys', apiKeysRouter);
app.use('/api/activity-logs', activityLogsRouter);
app.use('/api/webhooks', webhooksRouter);

// Error handling
app.use(errorHandler);

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
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
