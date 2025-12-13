#!/usr/bin/env node
/**
 * Task Retrieval Daemon
 *
 * Polls a saved search (view) and retrieves the next task from the stack.
 * Can execute a command with task data or output to stdout.
 *
 * Usage:
 *   node scripts/task-daemon.mjs --view <viewId> [options]
 *
 * Options:
 *   --view <id>       Required. The saved search/view ID to poll
 *   --api-key <key>   API key for authentication (or use MATRIX_API_KEY env var)
 *   --api-url <url>   API base URL (default: http://localhost:3001/api)
 *   --interval <ms>   Polling interval in ms (default: 5000)
 *   --once            Run once and exit (don't poll)
 *   --exec <cmd>      Execute command with task JSON as argument
 *   --json            Output task as JSON to stdout
 *   --claim           Claim the task (set status to 'in_progress')
 *
 * Environment Variables:
 *   MATRIX_API_KEY    API key for authentication
 *   MATRIX_API_URL    API base URL
 *   MATRIX_VIEW_ID    Default view ID to poll
 */

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

function parseConfig() {
  const { values } = parseArgs({
    options: {
      view: { type: 'string', short: 'v' },
      'api-key': { type: 'string', short: 'k' },
      'api-url': { type: 'string', short: 'u' },
      interval: { type: 'string', short: 'i' },
      once: { type: 'boolean', short: 'o' },
      exec: { type: 'string', short: 'e' },
      json: { type: 'boolean', short: 'j' },
      claim: { type: 'boolean', short: 'c' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Task Retrieval Daemon

Polls a saved search (view) and retrieves the next task from the stack.

Usage:
  node scripts/task-daemon.mjs --view <viewId> [options]

Options:
  --view, -v <id>       Required. The saved search/view ID to poll
  --api-key, -k <key>   API key for authentication (or MATRIX_API_KEY env)
  --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
  --interval, -i <ms>   Polling interval in ms (default: 5000)
  --once, -o            Run once and exit (don't poll)
  --exec, -e <cmd>      Execute command with task JSON as argument
  --json, -j            Output task as JSON to stdout
  --claim, -c           Claim the task (set status to 'in_progress')
  --help, -h            Show this help message

Examples:
  # Poll every 5 seconds and print tasks as JSON
  node scripts/task-daemon.mjs --view 507f1f77bcf86cd799439011 --json

  # Run once, claim task, and execute a command
  node scripts/task-daemon.mjs --view 507f1f77bcf86cd799439011 --once --claim --exec "node process-task.js"

  # Use environment variables
  MATRIX_API_KEY=your-key MATRIX_VIEW_ID=your-view node scripts/task-daemon.mjs
`);
    process.exit(0);
  }

  const viewId = values.view || process.env.MATRIX_VIEW_ID;
  const apiKey = values['api-key'] || process.env.MATRIX_API_KEY || '';
  const apiUrl = values['api-url'] || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
  const interval = parseInt(values.interval || '5000', 10);

  if (!viewId) {
    console.error('Error: --view is required (or set MATRIX_VIEW_ID env var)');
    process.exit(1);
  }

  return {
    viewId,
    apiKey,
    apiUrl,
    interval,
    once: values.once || false,
    exec: values.exec,
    json: values.json || false,
    claim: values.claim || false,
  };
}

async function fetchNextTask(config) {
  const url = `${config.apiUrl}/views/${config.viewId}/tasks?limit=1&resolveReferences=true`;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.text();
      console.error(`API Error (${response.status}): ${error}`);
      return null;
    }

    const result = await response.json();

    if (result.data && result.data.length > 0) {
      return result.data[0];
    }

    return null;
  } catch (error) {
    console.error('Fetch error:', error.message || error);
    return null;
  }
}

async function claimTask(config, taskId) {
  const url = `${config.apiUrl}/tasks/${taskId}`;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'in_progress' }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to claim task (${response.status}): ${error}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Claim error:', error.message || error);
    return false;
  }
}

function executeCommand(cmd, task) {
  return new Promise((resolve) => {
    const taskJson = JSON.stringify(task);
    const child = spawn(cmd, [taskJson], {
      shell: true,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve(code || 0);
    });

    child.on('error', (error) => {
      console.error('Exec error:', error.message);
      resolve(1);
    });
  });
}

async function processTask(config, task) {
  // Claim the task if requested
  if (config.claim) {
    const claimed = await claimTask(config, task._id);
    if (!claimed) {
      console.error('Failed to claim task, skipping...');
      return;
    }
    console.log(`Claimed task: ${task._id}`);
  }

  // Output JSON if requested
  if (config.json) {
    console.log(JSON.stringify(task, null, 2));
  }

  // Execute command if provided
  if (config.exec) {
    console.log(`Executing: ${config.exec}`);
    const exitCode = await executeCommand(config.exec, task);
    if (exitCode !== 0) {
      console.error(`Command exited with code ${exitCode}`);
    }
  }

  // If no output mode specified, print a summary
  if (!config.json && !config.exec) {
    console.log(`Task: ${task.title}`);
    console.log(`  ID: ${task._id}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Urgency: ${task.urgency}`);
    if (task.summary) {
      console.log(`  Summary: ${task.summary.substring(0, 100)}...`);
    }
  }
}

async function runDaemon(config) {
  console.log(`Task Daemon started`);
  console.log(`  View ID: ${config.viewId}`);
  console.log(`  API URL: ${config.apiUrl}`);
  console.log(`  Interval: ${config.interval}ms`);
  console.log(`  Mode: ${config.once ? 'once' : 'polling'}`);
  console.log('');

  const poll = async () => {
    const task = await fetchNextTask(config);

    if (task) {
      await processTask(config, task);
    } else if (!config.once) {
      // Only log "no tasks" in polling mode
      console.log(`[${new Date().toISOString()}] No tasks available`);
    }
  };

  if (config.once) {
    await poll();
  } else {
    // Initial poll
    await poll();

    // Set up interval
    setInterval(poll, config.interval);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down...');
      process.exit(0);
    });
  }
}

// Main entry point
const config = parseConfig();
runDaemon(config);
