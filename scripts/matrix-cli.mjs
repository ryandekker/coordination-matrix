#!/usr/bin/env node
/**
 * Matrix CLI - Command-line tool for Coordination Matrix API
 *
 * Maintains a session with stored credentials and provides easy access to all API endpoints.
 * Designed for both human users and AI tools to test and interact with the API.
 *
 * Usage:
 *   ./scripts/matrix-cli.mjs <command> [options]
 *
 * Session Commands:
 *   login           Login with email/password (stores JWT token)
 *   logout          Clear stored credentials
 *   use-key <key>   Use an API key instead of JWT
 *   status          Show current session info
 *   config          Show/set configuration
 *
 * Task Commands:
 *   tasks           List tasks with filtering
 *   task <id>       Get a specific task
 *   task:create     Create a new task
 *   task:update     Update a task
 *   task:delete     Delete a task
 *
 * Workflow Commands:
 *   workflows       List workflows
 *   workflow <id>   Get a workflow
 *   run <workflow>  Start a workflow run
 *   runs            List workflow runs
 *
 * View Commands:
 *   views           List saved views
 *   view:tasks <id> Get tasks from a view
 *
 * User Commands:
 *   users           List users
 *   agents          List AI agents
 *
 * Environment Variables:
 *   MATRIX_API_URL    API base URL (default: http://localhost:3001)
 *   MATRIX_API_KEY    API key for authentication
 *   MATRIX_CONFIG     Config file path (default: ~/.matrix-cli.json)
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_FILE = process.env.MATRIX_CONFIG || join(homedir(), '.matrix-cli.json');
const DEFAULT_API_URL = process.env.MATRIX_API_URL || 'http://localhost:3001';

function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveConfig(config) {
  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getApiUrl() {
  const config = loadConfig();
  return config.apiUrl || DEFAULT_API_URL;
}

function getAuthHeader() {
  const config = loadConfig();

  // Check environment variable first
  const envKey = process.env.MATRIX_API_KEY;
  if (envKey) {
    return { 'X-API-Key': envKey };
  }

  // Check stored API key
  if (config.apiKey) {
    return { 'X-API-Key': config.apiKey };
  }

  // Check stored JWT token
  if (config.token) {
    return { 'Authorization': `Bearer ${config.token}` };
  }

  return {};
}

// ============================================================================
// HTTP Client
// ============================================================================

async function apiRequest(method, path, body = null, options = {}) {
  const url = `${getApiUrl()}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...options.headers,
  };

  const fetchOptions = {
    method,
    headers,
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type');

    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message,
    };
  }
}

// Convenience methods
const api = {
  get: (path, options) => apiRequest('GET', path, null, options),
  post: (path, body, options) => apiRequest('POST', path, body, options),
  patch: (path, body, options) => apiRequest('PATCH', path, body, options),
  put: (path, body, options) => apiRequest('PUT', path, body, options),
  delete: (path, options) => apiRequest('DELETE', path, null, options),
};

// ============================================================================
// Input Helpers
// ============================================================================

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // For terminals that support it, we'd hide input
    // For simplicity, we just use regular prompt
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============================================================================
// Output Helpers
// ============================================================================

function output(data, format = 'json') {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === 'table' && Array.isArray(data)) {
    console.table(data);
  } else {
    console.log(data);
  }
}

function success(message) {
  console.log(`✓ ${message}`);
}

function error(message) {
  console.error(`✗ ${message}`);
}

function info(message) {
  console.log(`ℹ ${message}`);
}

// ============================================================================
// Session Commands
// ============================================================================

async function cmdLogin(args) {
  const email = args.email || await prompt('Email: ');
  const password = args.password || await promptPassword('Password: ');

  const result = await api.post('/api/auth/login', { email, password });

  if (!result.ok) {
    error(`Login failed: ${result.data?.error || result.error || 'Unknown error'}`);
    process.exit(1);
  }

  const config = loadConfig();
  config.token = result.data.data.token;
  config.user = result.data.data.user;
  delete config.apiKey; // Clear API key when logging in with credentials
  saveConfig(config);

  success(`Logged in as ${result.data.data.user.displayName} (${result.data.data.user.email})`);
}

async function cmdDevLogin(args) {
  // Default to admin user if no email provided
  const email = args.email || args._[0] || 'admin@example.com';

  info(`Attempting dev login as ${email}...`);

  const result = await api.post('/api/auth/dev-login', { email });

  if (!result.ok) {
    error(`Dev login failed: ${result.data?.error || result.error || 'Unknown error'}`);
    if (result.status === 403) {
      info('Dev login is only available in development mode (NODE_ENV != production)');
    }
    process.exit(1);
  }

  const config = loadConfig();
  config.token = result.data.token;
  config.user = result.data.user;
  delete config.apiKey;
  saveConfig(config);

  success(`Dev login successful as ${result.data.user.displayName} (${result.data.user.email})`);
}

async function cmdLogout() {
  const config = loadConfig();
  delete config.token;
  delete config.apiKey;
  delete config.user;
  saveConfig(config);
  success('Logged out');
}

async function cmdUseKey(args) {
  const key = args._[0];

  if (!key) {
    error('API key is required: matrix-cli use-key <key>');
    process.exit(1);
  }

  const config = loadConfig();
  config.apiKey = key;
  delete config.token; // Clear JWT when using API key
  delete config.user;
  saveConfig(config);

  // Verify the key works
  const result = await api.get('/api/auth/me');
  if (result.ok) {
    success(`API key set. Authenticated as ${result.data.data?.displayName || 'API user'}`);
  } else {
    config.apiKey = null;
    saveConfig(config);
    error('API key is invalid or expired');
    process.exit(1);
  }
}

async function cmdStatus() {
  const config = loadConfig();

  console.log('\n=== Matrix CLI Status ===\n');
  console.log(`API URL: ${getApiUrl()}`);
  console.log(`Config file: ${CONFIG_FILE}`);

  if (config.apiKey) {
    console.log(`Auth: API Key (${config.apiKey.substring(0, 15)}...)`);
  } else if (config.token) {
    console.log(`Auth: JWT Token`);
    if (config.user) {
      console.log(`User: ${config.user.displayName} (${config.user.email})`);
    }
  } else if (process.env.MATRIX_API_KEY) {
    console.log(`Auth: API Key from environment`);
  } else {
    console.log(`Auth: Not authenticated`);
  }

  // Check connection
  const health = await api.get('/health');
  if (health.ok) {
    console.log(`Server: Connected (${health.data.status})`);
  } else {
    console.log(`Server: Not reachable`);
  }

  console.log('');
}

async function cmdConfig(args) {
  const config = loadConfig();

  if (args.set) {
    const [key, value] = args.set.split('=');
    if (key && value !== undefined) {
      config[key] = value;
      saveConfig(config);
      success(`Set ${key} = ${value}`);
    } else {
      error('Usage: matrix-cli config --set key=value');
    }
    return;
  }

  if (args.get) {
    console.log(config[args.get] || '');
    return;
  }

  // Show all config (masking sensitive values)
  const display = { ...config };
  if (display.token) display.token = '[hidden]';
  if (display.apiKey) display.apiKey = display.apiKey.substring(0, 15) + '...';
  output(display);
}

// ============================================================================
// Task Commands
// ============================================================================

async function cmdTasks(args) {
  const params = new URLSearchParams();

  if (args.status) params.set('status', args.status);
  if (args.urgency) params.set('urgency', args.urgency);
  if (args.assignee) params.set('assigneeId', args.assignee);
  if (args.parent) params.set('parentId', args.parent);
  if (args.search) params.set('search', args.search);
  if (args.tags) params.set('tags', args.tags);
  if (args.limit) params.set('limit', args.limit);
  if (args.page) params.set('page', args.page);
  if (args['root-only']) params.set('rootOnly', 'true');
  if (args.resolve) params.set('resolveReferences', 'true');

  const result = await api.get(`/api/tasks?${params}`);

  if (!result.ok) {
    error(`Failed to fetch tasks: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.ids) {
    // Just output IDs, one per line
    result.data.data.forEach(t => console.log(t._id));
  } else if (args.brief) {
    // Brief format: id | status | title
    result.data.data.forEach(t => {
      console.log(`${t._id} | ${t.status.padEnd(12)} | ${t.title}`);
    });
    console.log(`\n(${result.data.pagination.total} total)`);
  } else {
    output(result.data);
  }
}

async function cmdTask(args) {
  const id = args._[0];

  if (!id) {
    error('Task ID is required: matrix-cli task <id>');
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (args.children) params.set('includeChildren', 'true');
  if (args.resolve) params.set('resolveReferences', 'true');

  const result = await api.get(`/api/tasks/${id}?${params}`);

  if (!result.ok) {
    error(`Failed to fetch task: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  output(result.data);
}

async function cmdTaskCreate(args) {
  const task = {};

  // Required
  task.title = args.title || await prompt('Title: ');

  // Optional - from args or interactive
  if (args.summary) task.summary = args.summary;
  if (args.status) task.status = args.status;
  if (args.urgency) task.urgency = args.urgency;
  if (args.parent) task.parentId = args.parent;
  if (args.assignee) task.assigneeId = args.assignee;
  if (args.workflow) task.workflowId = args.workflow;
  if (args.tags) task.tags = args.tags.split(',').map(t => t.trim());
  if (args.prompt) task.extraPrompt = args.prompt;
  if (args.info) task.additionalInfo = args.info;
  if (args.due) task.dueAt = args.due;
  if (args.metadata) {
    try {
      task.metadata = JSON.parse(args.metadata);
    } catch {
      error('Invalid JSON for metadata');
      process.exit(1);
    }
  }

  // Read from stdin if --stdin flag
  if (args.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');
    try {
      const stdinData = JSON.parse(input);
      Object.assign(task, stdinData);
    } catch {
      // If not JSON, treat as additionalInfo
      task.additionalInfo = input;
    }
  }

  const result = await api.post('/api/tasks', task);

  if (!result.ok) {
    error(`Failed to create task: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.quiet) {
    console.log(result.data.data._id);
  } else {
    success(`Created task: ${result.data.data._id}`);
    output(result.data);
  }
}

async function cmdTaskUpdate(args) {
  const id = args._[0];

  if (!id) {
    error('Task ID is required: matrix-cli task:update <id> [options]');
    process.exit(1);
  }

  const updates = {};

  if (args.title) updates.title = args.title;
  if (args.summary) updates.summary = args.summary;
  if (args.status) updates.status = args.status;
  if (args.urgency) updates.urgency = args.urgency;
  if (args.assignee) updates.assigneeId = args.assignee;
  if (args.tags) updates.tags = args.tags.split(',').map(t => t.trim());
  if (args.prompt) updates.extraPrompt = args.prompt;
  if (args.info) updates.additionalInfo = args.info;
  if (args.due) updates.dueAt = args.due;
  if (args.parent) updates.parentId = args.parent;
  if (args.metadata) {
    try {
      updates.metadata = JSON.parse(args.metadata);
    } catch {
      error('Invalid JSON for metadata');
      process.exit(1);
    }
  }

  // Read from stdin
  if (args.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');
    try {
      const stdinData = JSON.parse(input);
      Object.assign(updates, stdinData);
    } catch {
      error('Invalid JSON from stdin');
      process.exit(1);
    }
  }

  if (Object.keys(updates).length === 0) {
    error('No updates specified');
    process.exit(1);
  }

  const result = await api.patch(`/api/tasks/${id}`, updates);

  if (!result.ok) {
    error(`Failed to update task: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  success(`Updated task: ${id}`);
  output(result.data);
}

async function cmdTaskDelete(args) {
  const id = args._[0];

  if (!id) {
    error('Task ID is required: matrix-cli task:delete <id>');
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (args.children) params.set('deleteChildren', 'true');

  const result = await api.delete(`/api/tasks/${id}?${params}`);

  if (!result.ok) {
    error(`Failed to delete task: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  success(`Deleted task: ${id}`);
}

async function cmdTaskTree(args) {
  const params = new URLSearchParams();
  if (args.root) params.set('rootId', args.root);
  if (args.depth) params.set('maxDepth', args.depth);
  if (args.resolve) params.set('resolveReferences', 'true');

  const result = await api.get(`/api/tasks/tree?${params}`);

  if (!result.ok) {
    error(`Failed to fetch task tree: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  output(result.data);
}

// ============================================================================
// Workflow Commands
// ============================================================================

async function cmdWorkflows(args) {
  const result = await api.get('/api/workflows');

  if (!result.ok) {
    error(`Failed to fetch workflows: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(w => {
      console.log(`${w._id} | ${w.isActive ? 'active' : 'inactive'} | ${w.name}`);
    });
  } else {
    output(result.data);
  }
}

async function cmdWorkflow(args) {
  const id = args._[0];

  if (!id) {
    error('Workflow ID is required: matrix-cli workflow <id>');
    process.exit(1);
  }

  const result = await api.get(`/api/workflows/${id}`);

  if (!result.ok) {
    error(`Failed to fetch workflow: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  output(result.data);
}

async function cmdRun(args) {
  const workflowId = args._[0];

  if (!workflowId) {
    error('Workflow ID is required: matrix-cli run <workflowId>');
    process.exit(1);
  }

  const body = { workflowId };

  if (args.input) {
    try {
      body.inputPayload = JSON.parse(args.input);
    } catch {
      error('Invalid JSON for input payload');
      process.exit(1);
    }
  }

  if (args.defaults) {
    try {
      body.taskDefaults = JSON.parse(args.defaults);
    } catch {
      error('Invalid JSON for task defaults');
      process.exit(1);
    }
  }

  if (args.external) body.externalId = args.external;
  if (args.source) body.source = args.source;

  const result = await api.post('/api/workflow-runs', body);

  if (!result.ok) {
    error(`Failed to start workflow: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.quiet) {
    console.log(result.data.data._id);
  } else {
    success(`Started workflow run: ${result.data.data._id}`);
    output(result.data);
  }
}

async function cmdRuns(args) {
  const params = new URLSearchParams();
  if (args.workflow) params.set('workflowId', args.workflow);
  if (args.status) params.set('status', args.status);
  if (args.limit) params.set('limit', args.limit);
  if (args.page) params.set('page', args.page);

  const result = await api.get(`/api/workflow-runs?${params}`);

  if (!result.ok) {
    error(`Failed to fetch runs: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(r => {
      console.log(`${r._id} | ${r.status.padEnd(12)} | ${r.workflowId}`);
    });
  } else {
    output(result.data);
  }
}

// ============================================================================
// View Commands
// ============================================================================

async function cmdViews(args) {
  const params = new URLSearchParams();
  if (args.collection) params.set('collectionName', args.collection);

  const result = await api.get(`/api/views?${params}`);

  if (!result.ok) {
    error(`Failed to fetch views: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(v => {
      console.log(`${v._id} | ${v.collectionName} | ${v.name}`);
    });
  } else {
    output(result.data);
  }
}

async function cmdViewTasks(args) {
  const id = args._[0];

  if (!id) {
    error('View ID is required: matrix-cli view:tasks <id>');
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (args.limit) params.set('limit', args.limit);
  if (args.page) params.set('page', args.page);
  if (args.resolve) params.set('resolveReferences', 'true');

  const result = await api.get(`/api/views/${id}/tasks?${params}`);

  if (!result.ok) {
    error(`Failed to fetch tasks: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.ids) {
    result.data.data.forEach(t => console.log(t._id));
  } else if (args.brief) {
    result.data.data.forEach(t => {
      console.log(`${t._id} | ${t.status.padEnd(12)} | ${t.title}`);
    });
  } else {
    output(result.data);
  }
}

// ============================================================================
// User Commands
// ============================================================================

async function cmdUsers(args) {
  const params = new URLSearchParams();
  if (args.role) params.set('role', args.role);
  if (args.search) params.set('search', args.search);
  if (args.active !== undefined) params.set('isActive', args.active);

  const result = await api.get(`/api/users?${params}`);

  if (!result.ok) {
    error(`Failed to fetch users: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(u => {
      const type = u.isAgent ? 'agent' : 'user';
      console.log(`${u._id} | ${type.padEnd(6)} | ${u.displayName}`);
    });
  } else {
    output(result.data);
  }
}

async function cmdAgents(args) {
  const result = await api.get('/api/users/agents');

  if (!result.ok) {
    error(`Failed to fetch agents: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(a => {
      console.log(`${a._id} | ${a.displayName}`);
    });
  } else {
    output(result.data);
  }
}

// ============================================================================
// API Key Commands
// ============================================================================

async function cmdApiKeys(args) {
  const result = await api.get('/api/auth/api-keys');

  if (!result.ok) {
    error(`Failed to fetch API keys: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(k => {
      console.log(`${k._id} | ${k.isActive ? 'active' : 'inactive'} | ${k.name}`);
    });
  } else {
    output(result.data);
  }
}

async function cmdApiKeyCreate(args) {
  const body = {
    name: args.name || await prompt('Name: '),
  };

  if (args.description) body.description = args.description;
  if (args.scopes) body.scopes = args.scopes.split(',').map(s => s.trim());
  if (args.expires) body.expiresAt = args.expires;

  const result = await api.post('/api/auth/api-keys', body);

  if (!result.ok) {
    error(`Failed to create API key: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  console.log('\n=== API KEY CREATED ===');
  console.log('IMPORTANT: Save this key now - it will not be shown again!\n');
  console.log(`Key: ${result.data.data.key}\n`);

  if (args.quiet) {
    console.log(result.data.data.key);
  } else {
    output(result.data.data.apiKey);
  }
}

// ============================================================================
// Batch Job Commands
// ============================================================================

async function cmdBatchJobs(args) {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.type) params.set('type', args.type);
  if (args.workflow) params.set('workflowId', args.workflow);
  if (args.limit) params.set('limit', args.limit);
  if (args.page) params.set('page', args.page);

  const result = await api.get(`/api/batch-jobs?${params}`);

  if (!result.ok) {
    error(`Failed to fetch batch jobs: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(j => {
      console.log(`${j._id} | ${j.status.padEnd(15)} | ${j.name || j.type || 'unnamed'}`);
    });
  } else {
    output(result.data);
  }
}

// ============================================================================
// External Job Commands
// ============================================================================

async function cmdExternalJobs(args) {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.type) params.set('type', args.type);
  if (args.task) params.set('taskId', args.task);
  if (args.limit) params.set('limit', args.limit);
  if (args.page) params.set('page', args.page);

  const result = await api.get(`/api/external-jobs?${params}`);

  if (!result.ok) {
    error(`Failed to fetch external jobs: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(j => {
      console.log(`${j._id} | ${j.status.padEnd(12)} | ${j.type}`);
    });
  } else {
    output(result.data);
  }
}

async function cmdExternalJobsPending(args) {
  const params = new URLSearchParams();
  if (args.type) params.set('type', args.type);
  if (args.limit) params.set('limit', args.limit);

  const result = await api.get(`/api/external-jobs/pending?${params}`);

  if (!result.ok) {
    error(`Failed to fetch pending jobs: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  output(result.data);
}

// ============================================================================
// Webhook Commands
// ============================================================================

async function cmdWebhooks(args) {
  const result = await api.get('/api/webhooks');

  if (!result.ok) {
    error(`Failed to fetch webhooks: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  if (args.brief) {
    result.data.data.forEach(w => {
      console.log(`${w._id} | ${w.isActive ? 'active' : 'inactive'} | ${w.name}`);
    });
  } else {
    output(result.data);
  }
}

// ============================================================================
// Activity Log Commands
// ============================================================================

async function cmdActivityLogs(args) {
  const taskId = args._[0];

  if (!taskId) {
    error('Task ID is required: matrix-cli activity <taskId>');
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (args.limit) params.set('limit', args.limit);
  if (args.offset) params.set('offset', args.offset);

  const result = await api.get(`/api/activity-logs/task/${taskId}?${params}`);

  if (!result.ok) {
    error(`Failed to fetch activity: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  output(result.data);
}

async function cmdComment(args) {
  const taskId = args._[0];

  if (!taskId) {
    error('Task ID is required: matrix-cli comment <taskId> --text "comment"');
    process.exit(1);
  }

  const comment = args.text || await prompt('Comment: ');

  const result = await api.post(`/api/activity-logs/task/${taskId}/comments`, {
    comment,
    actorType: args.actor || 'user',
  });

  if (!result.ok) {
    error(`Failed to add comment: ${result.data?.error || result.error}`);
    process.exit(1);
  }

  success('Comment added');
}

// ============================================================================
// Generic Request Command
// ============================================================================

async function cmdRequest(args) {
  const method = (args.method || 'GET').toUpperCase();
  const path = args._[0];

  if (!path) {
    error('Path is required: matrix-cli request <path> [--method POST] [--body \'{"key":"value"}\']');
    process.exit(1);
  }

  let body = null;
  if (args.body) {
    try {
      body = JSON.parse(args.body);
    } catch {
      error('Invalid JSON for body');
      process.exit(1);
    }
  }

  // Read body from stdin
  if (args.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');
    try {
      body = JSON.parse(input);
    } catch {
      error('Invalid JSON from stdin');
      process.exit(1);
    }
  }

  const result = await apiRequest(method, path, body);

  if (!result.ok && !args.quiet) {
    error(`Request failed (${result.status}): ${result.data?.error || result.error}`);
  }

  output(result.data);

  if (!result.ok) {
    process.exit(1);
  }
}

// ============================================================================
// Help
// ============================================================================

function showHelp() {
  console.log(`
Matrix CLI - Coordination Matrix API Client

Usage: matrix-cli <command> [options]

Session Commands:
  login                     Login with email/password
  logout                    Clear stored credentials
  use-key <key>             Use an API key for authentication
  status                    Show current session info
  config                    Show/set configuration

Task Commands:
  tasks                     List tasks (--status, --urgency, --assignee, --search, --tags)
  task <id>                 Get a specific task (--children, --resolve)
  task:create               Create task (--title, --summary, --status, --parent, --assignee)
  task:update <id>          Update task (--status, --title, --assignee, etc.)
  task:delete <id>          Delete task (--children)
  task:tree                 Get task tree (--root, --depth)

Workflow Commands:
  workflows                 List workflows
  workflow <id>             Get workflow details
  run <workflowId>          Start workflow run (--input, --defaults)
  runs                      List workflow runs (--workflow, --status)

View Commands:
  views                     List saved views
  view:tasks <id>           Get tasks from a view (--limit, --resolve)

User Commands:
  users                     List users (--role, --search)
  agents                    List AI agents

API Key Commands:
  api-keys                  List API keys
  api-key:create            Create API key (--name, --scopes, --expires)

Other Commands:
  batch-jobs                List batch jobs (--status, --type)
  external-jobs             List external jobs (--status, --type, --task)
  external-jobs:pending     Get pending jobs for workers
  webhooks                  List webhooks
  activity <taskId>         Get activity log for task
  comment <taskId>          Add comment to task (--text)
  request <path>            Generic API request (--method, --body)

Global Options:
  --brief                   Show brief output (one line per item)
  --ids                     Output only IDs
  --quiet                   Minimal output
  --stdin                   Read JSON body from stdin

Environment Variables:
  MATRIX_API_URL            API base URL (default: http://localhost:3001)
  MATRIX_API_KEY            API key for authentication
  MATRIX_CONFIG             Config file path (default: ~/.matrix-cli.json)

Examples:
  # Login and create a task
  matrix-cli login
  matrix-cli task:create --title "Fix bug" --status pending

  # Use API key and list pending tasks
  matrix-cli use-key cm_ak_live_xxx
  matrix-cli tasks --status pending --brief

  # Start a workflow
  matrix-cli run 507f1f77bcf86cd799439011 --input '{"key":"value"}'

  # Generic API request
  matrix-cli request /api/tasks --method POST --body '{"title":"Test"}'
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const command = args[0];

  // Parse remaining args
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: {
      // Common options
      brief: { type: 'boolean', short: 'b' },
      quiet: { type: 'boolean', short: 'q' },
      ids: { type: 'boolean' },
      stdin: { type: 'boolean' },
      resolve: { type: 'boolean', short: 'r' },

      // Task options
      status: { type: 'string', short: 's' },
      urgency: { type: 'string', short: 'u' },
      assignee: { type: 'string', short: 'a' },
      parent: { type: 'string', short: 'p' },
      search: { type: 'string' },
      tags: { type: 'string', short: 't' },
      title: { type: 'string' },
      summary: { type: 'string' },
      prompt: { type: 'string' },
      info: { type: 'string' },
      due: { type: 'string' },
      metadata: { type: 'string' },
      children: { type: 'boolean' },
      'root-only': { type: 'boolean' },

      // Workflow options
      workflow: { type: 'string', short: 'w' },
      input: { type: 'string' },
      defaults: { type: 'string' },
      external: { type: 'string' },
      source: { type: 'string' },

      // View options
      collection: { type: 'string' },

      // User options
      role: { type: 'string' },
      active: { type: 'boolean' },

      // API key options
      name: { type: 'string', short: 'n' },
      description: { type: 'string', short: 'd' },
      scopes: { type: 'string' },
      expires: { type: 'string' },

      // Request options
      method: { type: 'string', short: 'm' },
      body: { type: 'string' },

      // Tree options
      root: { type: 'string' },
      depth: { type: 'string' },

      // Pagination
      limit: { type: 'string', short: 'l' },
      page: { type: 'string' },
      offset: { type: 'string' },

      // Config options
      set: { type: 'string' },
      get: { type: 'string' },

      // Comment options
      text: { type: 'string' },
      actor: { type: 'string' },

      // Job options
      type: { type: 'string' },
      task: { type: 'string' },

      // Auth options
      email: { type: 'string', short: 'e' },
      password: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  values._ = positionals;

  // Route to command handlers
  const commands = {
    // Session
    'login': cmdLogin,
    'dev-login': cmdDevLogin,
    'logout': cmdLogout,
    'use-key': cmdUseKey,
    'status': cmdStatus,
    'config': cmdConfig,

    // Tasks
    'tasks': cmdTasks,
    'task': cmdTask,
    'task:create': cmdTaskCreate,
    'task:update': cmdTaskUpdate,
    'task:delete': cmdTaskDelete,
    'task:tree': cmdTaskTree,

    // Workflows
    'workflows': cmdWorkflows,
    'workflow': cmdWorkflow,
    'run': cmdRun,
    'runs': cmdRuns,

    // Views
    'views': cmdViews,
    'view:tasks': cmdViewTasks,

    // Users
    'users': cmdUsers,
    'agents': cmdAgents,

    // API Keys
    'api-keys': cmdApiKeys,
    'api-key:create': cmdApiKeyCreate,

    // Batch jobs
    'batch-jobs': cmdBatchJobs,

    // External jobs
    'external-jobs': cmdExternalJobs,
    'external-jobs:pending': cmdExternalJobsPending,

    // Webhooks
    'webhooks': cmdWebhooks,

    // Activity
    'activity': cmdActivityLogs,
    'comment': cmdComment,

    // Generic request
    'request': cmdRequest,
    'req': cmdRequest,
  };

  const handler = commands[command];

  if (!handler) {
    error(`Unknown command: ${command}`);
    console.log('Run "matrix-cli help" for available commands');
    process.exit(1);
  }

  try {
    await handler(values);
  } catch (err) {
    error(`Command failed: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
