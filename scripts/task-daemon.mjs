#!/usr/bin/env node
/**
 * Task Retrieval Daemon
 *
 * Polls a saved search (view), retrieves tasks, and executes them with Claude (or a custom command).
 * Updates task status based on the command result.
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
 *   --exec <cmd>      Command to execute (default: "claude")
 *   --dry-run         Don't execute, just show what would be done
 *   --no-update       Don't update task status after execution
 *
 * Environment Variables:
 *   MATRIX_API_KEY    API key for authentication
 *   MATRIX_API_URL    API base URL
 *   MATRIX_VIEW_ID    Default view ID to poll
 *   MATRIX_EXEC_CMD   Default command to execute (default: "claude")
 */

import { parseArgs } from 'node:util';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function parseConfig() {
  const { values } = parseArgs({
    options: {
      view: { type: 'string', short: 'v' },
      'api-key': { type: 'string', short: 'k' },
      'api-url': { type: 'string', short: 'u' },
      interval: { type: 'string', short: 'i' },
      once: { type: 'boolean', short: 'o' },
      exec: { type: 'string', short: 'e' },
      'dry-run': { type: 'boolean', short: 'd' },
      'no-update': { type: 'boolean', short: 'n' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Task Retrieval Daemon

Polls a saved search (view), retrieves tasks, and executes them with Claude.
Updates task status based on the command result.

Usage:
  node scripts/task-daemon.mjs --view <viewId> [options]

Options:
  --view, -v <id>       Required. The saved search/view ID to poll
  --api-key, -k <key>   API key for authentication (or MATRIX_API_KEY env)
  --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
  --interval, -i <ms>   Polling interval in ms (default: 5000)
  --once, -o            Run once and exit (don't poll)
  --exec, -e <cmd>      Command to execute (default: "claude")
  --dry-run, -d         Don't execute, just show what would be done
  --no-update, -n       Don't update task status after execution
  --help, -h            Show this help message

Task Status Updates:
  - Before execution: status -> "in_progress"
  - On success (exit 0): status -> "completed"
  - On failure (exit non-0): status -> "on_hold", additionalInfo updated with error

Prompt Format:
  The task is passed to the command as a prompt combining:
  - Title
  - Summary
  - Extra prompt instructions (if any)
  - Additional info (if any)

Examples:
  # Process tasks continuously with Claude (default)
  node scripts/task-daemon.mjs --view <viewId>

  # Process just one task and exit
  node scripts/task-daemon.mjs --view <viewId> --once

  # Use a custom command
  node scripts/task-daemon.mjs --view <viewId> --exec "my-agent"

  # Dry run to see what would happen
  node scripts/task-daemon.mjs --view <viewId> --once --dry-run

  # Wait 30 seconds between checks when queue is empty
  node scripts/task-daemon.mjs --view <viewId> --interval 30000
`);
    process.exit(0);
  }

  const viewId = values.view || process.env.MATRIX_VIEW_ID;
  const apiKey = values['api-key'] || process.env.MATRIX_API_KEY || '';
  const apiUrl = values['api-url'] || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
  const interval = parseInt(values.interval || '5000', 10);
  const execCmd = values.exec || process.env.MATRIX_EXEC_CMD || 'claude';

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
    exec: execCmd,
    dryRun: values['dry-run'] || false,
    noUpdate: values['no-update'] || false,
  };
}

async function fetchNextTask(config) {
  const url = `${config.apiUrl}/views/${config.viewId}/tasks?limit=1&resolveReferences=true`;
  console.log(`[DEBUG] Fetching next task from: ${url}`);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  try {
    console.log(`[DEBUG] Making API request...`);
    const response = await fetch(url, { headers });
    console.log(`[DEBUG] Response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`API Error (${response.status}): ${error}`);
      return null;
    }

    const result = await response.json();
    console.log(`[DEBUG] Got ${result.data?.length || 0} tasks from API`);

    if (result.data && result.data.length > 0) {
      console.log(`[DEBUG] Next task: "${result.data[0].title}" (${result.data[0]._id})`);
      return result.data[0];
    }

    console.log(`[DEBUG] No tasks in queue`);
    return null;
  } catch (error) {
    console.error('Fetch error:', error.message || error);
    console.error('[DEBUG] Full error:', error);
    return null;
  }
}

async function updateTask(config, taskId, updates) {
  if (config.noUpdate) {
    console.log(`[Skip update] Would update task ${taskId}:`, updates);
    return true;
  }

  const url = `${config.apiUrl}/tasks/${taskId}`;
  console.log(`[DEBUG] Updating task ${taskId} at ${url}`);

  // Truncate additionalInfo if too long (keep under 100KB)
  if (updates.additionalInfo && updates.additionalInfo.length > 100000) {
    console.log(`[DEBUG] Truncating additionalInfo from ${updates.additionalInfo.length} to 100000 chars`);
    updates.additionalInfo = updates.additionalInfo.substring(0, 100000) + '\n\n[truncated]';
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  const body = JSON.stringify(updates);
  console.log(`[DEBUG] Update body size: ${body.length} bytes`);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body,
    });

    console.log(`[DEBUG] Update response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update task (${response.status}): ${error}`);
      return false;
    }

    console.log(`[DEBUG] Task updated successfully`);
    return true;
  } catch (error) {
    console.error('Update error:', error.message || error);
    console.error('[DEBUG] Full error:', error);
    return false;
  }
}

function buildPrompt(task) {
  // If extraPrompt exists, use it as the main prompt with task context
  if (task.extraPrompt) {
    const parts = [];
    parts.push(task.extraPrompt);
    parts.push('');
    parts.push('---');
    parts.push('## Task Context');
    parts.push(`**Title:** ${task.title}`);
    if (task.summary) {
      parts.push(`**Summary:** ${task.summary}`);
    }
    if (task.tags && task.tags.length > 0) {
      parts.push(`**Tags:** ${task.tags.join(', ')}`);
    }
    if (task.additionalInfo) {
      parts.push('');
      parts.push('**Additional Info:**');
      parts.push(task.additionalInfo);
    }
    return parts.join('\n');
  }

  // Fallback: build prompt from title and summary
  const parts = [];
  parts.push(`# ${task.title}`);
  parts.push('');
  if (task.summary) {
    parts.push(task.summary);
    parts.push('');
  }
  if (task.tags && task.tags.length > 0) {
    parts.push(`Tags: ${task.tags.join(', ')}`);
  }
  if (task.additionalInfo) {
    parts.push('');
    parts.push('Additional context:');
    parts.push(task.additionalInfo);
  }
  return parts.join('\n');
}

function executeCommand(cmd, prompt) {
  console.log(`[DEBUG] Executing command: ${cmd}`);
  console.log(`[DEBUG] Prompt preview: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`);

  // Write prompt to a temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `task-daemon-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);

  console.log(`[DEBUG] Wrote prompt to: ${tmpFile}`);

  // For claude, use: claude --print "$(cat tmpfile)"
  const fullCmd = cmd === 'claude'
    ? `claude --print "$(cat '${tmpFile}')"`
    : `${cmd} "$(cat '${tmpFile}')"`;

  console.log(`[DEBUG] Full command: ${fullCmd}`);
  console.log(`[DEBUG] Running (this may take a while)...`);

  try {
    // Use execSync to run and capture output
    const stdout = execSync(fullCmd, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Clean up temp file
    try { unlinkSync(tmpFile); } catch {}

    // Print output to terminal
    console.log(stdout);

    return {
      exitCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    // Clean up temp file
    try { unlinkSync(tmpFile); } catch {}

    console.error('[DEBUG] Command failed:', error.message);

    return {
      exitCode: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

async function processTask(config, task) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing task: ${task.title}`);
  console.log(`  ID: ${task._id}`);
  console.log(`  Status: ${task.status}`);
  console.log(`  Urgency: ${task.urgency}`);
  console.log(`${'='.repeat(60)}\n`);

  const prompt = buildPrompt(task);

  if (config.dryRun) {
    console.log('[Dry Run] Would execute with prompt:');
    console.log('-'.repeat(40));
    console.log(prompt);
    console.log('-'.repeat(40));
    console.log(`[Dry Run] Command: ${config.exec}`);
    return;
  }

  // Claim the task (set to in_progress)
  console.log(`Setting task status to 'in_progress'...`);
  const claimed = await updateTask(config, task._id, { status: 'in_progress' });
  if (!claimed) {
    console.error('Failed to claim task, skipping...');
    return;
  }

  // Execute the command
  console.log(`\nExecuting: ${config.exec}\n`);
  console.log('-'.repeat(40));

  const startTime = Date.now();
  const result = await executeCommand(config.exec, prompt);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('-'.repeat(40));
  console.log(`\nCommand completed in ${duration}s with exit code: ${result.exitCode}`);

  // Update task status based on result
  // Valid statuses: pending, in_progress, on_hold, completed, cancelled
  const timestamp = new Date().toISOString();

  if (result.exitCode === 0) {
    console.log(`Setting task status to 'completed'...`);

    // Save Claude's response to additionalInfo
    const response = result.stdout.trim();
    const newInfo = [
      task.additionalInfo || '',
      '',
      '---',
      `## Response (${timestamp})`,
      `Processed in ${duration}s`,
      '',
      response,
    ].filter(Boolean).join('\n');

    await updateTask(config, task._id, {
      status: 'completed',
      additionalInfo: newInfo,
    });
  } else {
    // Use 'on_hold' for failures since there's no 'failed' status
    console.log(`Setting task status to 'on_hold' (command failed)...`);
    const errorInfo = result.stderr || `Exit code: ${result.exitCode}`;

    const newInfo = [
      task.additionalInfo || '',
      '',
      '---',
      `## Failed (${timestamp})`,
      `Exit code: ${result.exitCode}`,
      '',
      errorInfo.substring(0, 1000),
    ].filter(Boolean).join('\n');

    await updateTask(config, task._id, {
      status: 'on_hold',
      additionalInfo: newInfo,
    });
  }
}

async function runDaemon(config) {
  console.log(`Task Daemon started`);
  console.log(`  View ID: ${config.viewId}`);
  console.log(`  API URL: ${config.apiUrl}`);
  console.log(`  Command: ${config.exec}`);
  console.log(`  Mode: ${config.once ? 'once' : 'continuous'}`);
  console.log(`  Idle Interval: ${config.interval}ms`);
  console.log(`  Dry Run: ${config.dryRun}`);
  console.log(`  Update Status: ${!config.noUpdate}`);
  console.log('');

  // Handle graceful shutdown
  let shuttingDown = false;
  process.on('SIGINT', () => {
    console.log('\nShutting down after current task...');
    shuttingDown = true;
  });
  process.on('SIGTERM', () => {
    console.log('\nShutting down after current task...');
    shuttingDown = true;
  });

  const processNextTask = async () => {
    const task = await fetchNextTask(config);

    if (task) {
      await processTask(config, task);
      return true; // Processed a task
    }
    return false; // No task available
  };

  if (config.once) {
    // Run once mode - process one task and exit
    const hadTask = await processNextTask();
    if (!hadTask) {
      console.log('No tasks found in queue.');
    }
  } else {
    // Continuous mode - keep processing tasks until queue is empty, then wait
    while (!shuttingDown) {
      const hadTask = await processNextTask();

      if (!hadTask) {
        // No tasks available, wait before checking again
        console.log(`[${new Date().toISOString()}] No tasks available, waiting ${config.interval}ms...`);
        await new Promise((resolve) => setTimeout(resolve, config.interval));
      }
      // If we processed a task, immediately check for next one (no delay)
    }
    console.log('Shutdown complete.');
  }
}

// Main entry point
const config = parseConfig();
runDaemon(config);
