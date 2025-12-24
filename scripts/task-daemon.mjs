#!/usr/bin/env node
/**
 * Task Retrieval Daemon
 *
 * Polls a saved search (view), retrieves tasks, and executes them with Claude (or a custom command).
 * Assembles prompts from multiple sources: base prompt + agent prompt + workflow step prompt + task prompt.
 * Parses JSON responses and handles stage transitions.
 *
 * Usage:
 *   node scripts/task-daemon.mjs                   # Start all enabled jobs from config
 *   node scripts/task-daemon.mjs --job <name>      # Start a specific job
 *   node scripts/task-daemon.mjs --view <viewId>   # Start with a specific view (no config)
 *   node scripts/task-daemon.mjs --stop            # Stop all running daemon jobs
 *   node scripts/task-daemon.mjs --status          # Show status of running jobs
 *
 * Options:
 *   --config, -c <file>   Config file (default: scripts/daemon-jobs.yaml)
 *   --job, -j <name>      Run a specific job from config
 *   --view, -v <id>       View ID to poll (if not using config)
 *   --api-key, -k <key>   API key for authentication (or MATRIX_API_KEY env)
 *   --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
 *   --interval, -i <ms>   Polling interval in ms (default: 5000)
 *   --once, -o            Run once and exit (don't poll)
 *   --exec, -e <cmd>      Command to execute (default: "claude")
 *   --dry-run, -d         Don't execute, just show what would be done
 *   --no-update, -n       Don't update task status after execution
 *   --stop                Stop all running daemon jobs
 *   --status              Show status of running daemon jobs
 *   --list, -l            List available jobs from config
 *   --help, -h            Show help
 *
 * Environment Variables:
 *   MATRIX_API_KEY    API key for authentication
 *   MATRIX_API_URL    API base URL
 *   MATRIX_VIEW_ID    Default view ID to poll
 *   MATRIX_EXEC_CMD   Default command to execute (default: "claude")
 */

import { parseArgs } from 'node:util';
import { execSync, spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync, createWriteStream, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Get script directory for default config path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG_PATH = join(__dirname, 'daemon-jobs.yaml');
const PID_DIR = join(homedir(), '.matrix-daemon');

// ============================================================================
// Base Daemon Prompt - Ensures JSON responses
// ============================================================================

const BASE_DAEMON_PROMPT = `You are a task automation agent. You MUST respond with valid JSON only - no markdown, no explanation, just the JSON object.

Response schema:
{
  "status": "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED",
  "summary": "1-2 sentence summary of what was done",
  "output": { /* Structured result object - schema defined by task/workflow */ },
  "nextAction": "COMPLETE" | "CONTINUE" | "ESCALATE" | "HOLD",
  "nextActionReason": "Optional: reason for CONTINUE/ESCALATE/HOLD",
  "metadata": {
    "confidence": 0.0-1.0,
    "suggestedTags": [],
    "suggestedNextStage": null
  }
}

Rules:
- status: SUCCESS if task fully completed, PARTIAL if partially done, BLOCKED if cannot proceed, FAILED if error
- nextAction: COMPLETE to finish, CONTINUE to spawn follow-up, ESCALATE for human help, HOLD to pause
- output: A structured JSON object containing your work result. Follow the schema specified in the workflow/task instructions.
- Respond with ONLY the JSON object, nothing else`;

// ============================================================================
// PID File Management
// ============================================================================

function ensurePidDir() {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

function getPidFile(jobName) {
  return join(PID_DIR, `${jobName}.pid`);
}

function getLogFile(jobName) {
  return join(PID_DIR, `${jobName}.log`);
}

function savePid(jobName, pid) {
  ensurePidDir();
  writeFileSync(getPidFile(jobName), String(pid));
}

function readPid(jobName) {
  const pidFile = getPidFile(jobName);
  if (!existsSync(pidFile)) return null;
  try {
    return parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  } catch {
    return null;
  }
}

function removePid(jobName) {
  const pidFile = getPidFile(jobName);
  try { unlinkSync(pidFile); } catch {}
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningJobs() {
  ensurePidDir();
  const jobs = [];
  try {
    const files = readdirSync(PID_DIR);
    for (const file of files) {
      if (file.endsWith('.pid')) {
        const jobName = file.replace('.pid', '');
        const pid = readPid(jobName);
        if (pid && isProcessRunning(pid)) {
          jobs.push({ name: jobName, pid });
        } else if (pid) {
          // Stale PID file, clean up
          removePid(jobName);
        }
      }
    }
  } catch {}
  return jobs;
}

function stopAllJobs() {
  const running = getRunningJobs();
  if (running.length === 0) {
    console.log('No daemon jobs are running.');
    return;
  }

  console.log(`Stopping ${running.length} daemon job(s)...`);
  for (const { name, pid } of running) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`  ✓ Stopped ${name} (PID ${pid})`);
      removePid(name);
    } catch (e) {
      console.log(`  ✗ Failed to stop ${name} (PID ${pid}): ${e.message}`);
    }
  }
}

function showStatus() {
  const running = getRunningJobs();
  console.log('\nDaemon Job Status:');
  console.log('─'.repeat(50));

  if (running.length === 0) {
    console.log('  No daemon jobs are running.');
  } else {
    for (const { name, pid } of running) {
      console.log(`  ✓ ${name} (PID ${pid})`);
    }
  }
  console.log('');
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return null;
  }

  const content = readFileSync(configPath, 'utf8');

  // Parse as YAML (also handles JSON)
  try {
    return parseYaml(content);
  } catch (e) {
    console.error(`Error parsing config file: ${e.message}`);
    process.exit(1);
  }
}

function listJobs(configData) {
  console.log('\nAvailable jobs:');
  console.log('─'.repeat(60));

  if (!configData.jobs || Object.keys(configData.jobs).length === 0) {
    console.log('  (no jobs defined)');
    return;
  }

  for (const [name, job] of Object.entries(configData.jobs)) {
    const enabled = job.enabled !== false ? '✓' : '✗';
    const exec = job.exec || configData.defaults?.exec || 'claude';
    console.log(`  ${enabled} ${name}`);
    console.log(`      view: ${job.viewId || '(missing)'}`);
    console.log(`      exec: ${exec}`);
    if (job.description) {
      console.log(`      desc: ${job.description}`);
    }
  }
  console.log('');
}

function parseConfig() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      job: { type: 'string', short: 'j' },
      list: { type: 'boolean', short: 'l' },
      view: { type: 'string', short: 'v' },
      'api-key': { type: 'string', short: 'k' },
      'api-url': { type: 'string', short: 'u' },
      interval: { type: 'string', short: 'i' },
      once: { type: 'boolean', short: 'o' },
      exec: { type: 'string', short: 'e' },
      'dry-run': { type: 'boolean', short: 'd' },
      'no-update': { type: 'boolean', short: 'n' },
      stop: { type: 'boolean' },
      status: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  // Handle --stop command
  if (values.stop) {
    stopAllJobs();
    process.exit(0);
  }

  // Handle --status command
  if (values.status) {
    showStatus();
    process.exit(0);
  }

  if (values.help) {
    console.log(`
Task Retrieval Daemon

Polls saved views (task queues), retrieves tasks, and executes them with Claude.
Assembles prompts from: base + agent + workflow step + task context.
Parses JSON responses and handles workflow stage transitions.

Usage:
  node scripts/task-daemon.mjs                   # Start all enabled jobs as background processes
  node scripts/task-daemon.mjs --job <name>      # Start a specific job in foreground
  node scripts/task-daemon.mjs --view <viewId>   # Start with a specific view (no config)
  node scripts/task-daemon.mjs --stop            # Stop all running daemon jobs
  node scripts/task-daemon.mjs --status          # Show status of running jobs
  node scripts/task-daemon.mjs --list            # List available jobs from config

Options:
  --config, -c <file>   Config file (default: scripts/daemon-jobs.yaml)
  --job, -j <name>      Run a specific job from the config file (foreground)
  --list, -l            List available jobs from config file
  --view, -v <id>       The saved search/view ID to poll (no config needed)
  --api-key, -k <key>   API key for authentication (or MATRIX_API_KEY env)
  --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
  --interval, -i <ms>   Polling interval in ms (default: 5000)
  --once, -o            Run once and exit (don't poll)
  --exec, -e <cmd>      Command to execute (default: "claude")
  --dry-run, -d         Don't execute, just show what would be done
  --no-update, -n       Don't update task status after execution
  --stop                Stop all running daemon jobs
  --status              Show status of running daemon jobs
  --help, -h            Show this help message

Config File Format (YAML):
  # Default settings for all jobs
  defaults:
    apiUrl: https://api.example.com/api
    apiKey: cm_ak_live_xxxxx
    interval: 5000
    exec: claude

  # Define multiple jobs
  jobs:
    content-review:
      description: Review content tasks
      viewId: abc123def456
      exec: "claude --model claude-sonnet-4-20250514"

    triage:
      description: Auto-triage incoming tasks
      viewId: xyz789
      exec: "custom-triage-command"

Prompt Assembly (layered):
  1. Base daemon prompt (ensures JSON response)
  2. Agent prompt (from assignee user if isAgent=true)
  3. Workflow step prompt (from workflow step if task has workflowStage)
  4. Task prompt (extraPrompt + task context)

Response Handling:
  - Parses JSON response from AI
  - Updates task status based on nextAction:
    - COMPLETE: status -> "completed"
    - CONTINUE: status -> "completed", creates follow-up task
    - ESCALATE: status -> "on_hold"
    - HOLD: status -> "on_hold"
  - Stores response output in metadata.executionLog

Examples:
  # Process tasks using CLI args
  node scripts/task-daemon.mjs --view <viewId>

  # List jobs from config file
  node scripts/task-daemon.mjs --config daemon-jobs.yaml --list

  # Run a specific job from config
  node scripts/task-daemon.mjs --config daemon-jobs.yaml --job content-review

  # Run job once (override config)
  node scripts/task-daemon.mjs --config daemon-jobs.yaml --job triage --once

  # Dry run to see assembled prompts
  node scripts/task-daemon.mjs --config daemon-jobs.yaml --job triage --dry-run
`);
    process.exit(0);
  }

  // Load config file (use default if not specified)
  const configPath = values.config || DEFAULT_CONFIG_PATH;
  let configData = loadConfigFile(configPath);

  // Handle --list command
  if (values.list) {
    if (!configData) {
      console.error(`Error: Config file not found: ${configPath}`);
      process.exit(1);
    }
    listJobs(configData);
    process.exit(0);
  }

  // Build config from file + CLI overrides
  let viewId, apiKey, apiUrl, interval, execCmd;

  if (configData && values.job) {
    // Load from config file with job name
    const job = configData.jobs?.[values.job];
    if (!job) {
      console.error(`Error: Job "${values.job}" not found in config file`);
      console.log('\nAvailable jobs:');
      for (const name of Object.keys(configData.jobs || {})) {
        console.log(`  - ${name}`);
      }
      process.exit(1);
    }

    if (job.enabled === false) {
      console.error(`Error: Job "${values.job}" is disabled`);
      process.exit(1);
    }

    const defaults = configData.defaults || {};

    // Job settings override defaults, CLI overrides everything
    viewId = values.view || job.viewId || defaults.viewId;
    apiKey = values['api-key'] || job.apiKey || defaults.apiKey || process.env.MATRIX_API_KEY || '';
    apiUrl = values['api-url'] || job.apiUrl || defaults.apiUrl || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
    interval = parseInt(values.interval || job.interval || defaults.interval || '5000', 10);
    execCmd = values.exec || job.exec || defaults.exec || process.env.MATRIX_EXEC_CMD || 'claude';
  } else if (values.view) {
    // Use CLI args / env vars only (explicit --view provided)
    viewId = values.view;
    apiKey = values['api-key'] || process.env.MATRIX_API_KEY || '';
    apiUrl = values['api-url'] || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
    interval = parseInt(values.interval || '5000', 10);
    execCmd = values.exec || process.env.MATRIX_EXEC_CMD || 'claude';
  } else if (configData && !values.job) {
    // No job or view specified - start all enabled jobs as background processes
    return {
      mode: 'start-all',
      configData,
      configPath,
      once: values.once || false,
    };
  } else {
    // No config file and no view
    console.error('Error: No config file found and no --view specified');
    console.error(`  Config tried: ${configPath}`);
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/task-daemon.mjs                   # Start all jobs from config');
    console.error('  node scripts/task-daemon.mjs --view <viewId>   # Start with specific view');
    console.error('  node scripts/task-daemon.mjs --job <name>      # Start specific job');
    process.exit(1);
  }

  return {
    mode: 'single',
    jobName: values.job || null,
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

// ============================================================================
// API Helpers
// ============================================================================

function getHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  return headers;
}

async function fetchNextTask(config) {
  const url = `${config.apiUrl}/views/${config.viewId}/tasks?limit=1&resolveReferences=true`;
  console.log(`[DEBUG] Fetching next task from: ${url}`);

  try {
    const response = await fetch(url, { headers: getHeaders(config) });
    if (!response.ok) {
      const error = await response.text();
      console.error(`API Error (${response.status}): ${error}`);
      return null;
    }

    const result = await response.json();
    if (result.data && result.data.length > 0) {
      console.log(`[DEBUG] Next task: "${result.data[0].title}" (${result.data[0]._id})`);
      return result.data[0];
    }

    console.log(`[DEBUG] No tasks in queue`);
    return null;
  } catch (error) {
    console.error('Fetch error:', error.message || error);
    return null;
  }
}

async function fetchUser(config, userId) {
  if (!userId) return null;

  try {
    const response = await fetch(`${config.apiUrl}/users/${userId}`, {
      headers: getHeaders(config),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

async function fetchWorkflow(config, workflowId) {
  if (!workflowId) return null;

  try {
    const response = await fetch(`${config.apiUrl}/workflows/${workflowId}`, {
      headers: getHeaders(config),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

async function updateTask(config, taskId, updates) {
  if (config.noUpdate) {
    console.log(`[Skip update] Would update task ${taskId}:`, updates);
    return true;
  }

  // Truncate executionLog in metadata if too long (keep under 100KB)
  if (updates.metadata?.executionLog && updates.metadata.executionLog.length > 100000) {
    console.log(`[DEBUG] Truncating executionLog from ${updates.metadata.executionLog.length} to 100000 chars`);
    updates.metadata.executionLog = updates.metadata.executionLog.substring(0, 100000) + '\n\n[truncated]';
  }

  try {
    const response = await fetch(`${config.apiUrl}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: getHeaders(config),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update task (${response.status}): ${error}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Update error:', error.message || error);
    return false;
  }
}

async function createTask(config, taskData) {
  try {
    const response = await fetch(`${config.apiUrl}/tasks`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(taskData),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create task (${response.status}): ${error}`);
      return null;
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Create task error:', error.message || error);
    return null;
  }
}

async function addTaskComment(config, taskId, comment) {
  if (config.noUpdate) {
    console.log(`[Skip comment] Would add comment to task ${taskId}: ${comment}`);
    return true;
  }

  try {
    const response = await fetch(`${config.apiUrl}/activity-logs/task/${taskId}/comments`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        comment,
        actorType: 'daemon',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to add comment (${response.status}): ${error}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Add comment error:', error.message || error);
    return false;
  }
}

// ============================================================================
// Prompt Assembly
// ============================================================================

function assemblePrompt(task, agent, workflowStep) {
  const sections = [];

  // 1. Base daemon prompt (ensures JSON output)
  sections.push(BASE_DAEMON_PROMPT);

  // 2. Agent prompt (persona, capabilities)
  if (agent?.isAgent && agent?.agentPrompt) {
    sections.push(`## Agent Role\n${agent.agentPrompt}`);
  }

  // 3. Workflow step prompt (stage-specific instructions)
  // Note: UI saves to 'additionalInstructions', legacy code may use 'prompt'
  const stepPrompt = workflowStep?.prompt || workflowStep?.additionalInstructions;
  if (stepPrompt) {
    sections.push(`## Workflow Step: ${workflowStep.name}\n${stepPrompt}`);
  }

  // 4. Output schema (if specified by workflow step)
  if (workflowStep?.outputSchema) {
    const schemaStr = typeof workflowStep.outputSchema === 'string'
      ? workflowStep.outputSchema
      : JSON.stringify(workflowStep.outputSchema, null, 2);
    sections.push(`## Output Schema\nYour "output" field in the response MUST be a JSON object matching this schema:\n\`\`\`json\n${schemaStr}\n\`\`\``);
  }

  // 5. Task-specific prompt
  if (task.extraPrompt) {
    sections.push(`## Task Instructions\n${task.extraPrompt}`);
  }

  // 6. Task context as structured data
  // Note: inputPayload contains webhook/external input data (e.g., email content)
  const context = {
    title: task.title,
    summary: task.summary || null,
    tags: task.tags || [],
    executionLog: task.metadata?.executionLog || null,
    workflowStage: task.workflowStage || null,
    inputPayload: task.metadata?.inputPayload || null,
  };
  sections.push(`## Task Context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);

  return sections.join('\n\n---\n\n');
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseResponse(responseText) {
  // Try to parse as JSON
  try {
    // Sometimes the response might have markdown code blocks, try to extract JSON
    let jsonStr = responseText.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.status || !parsed.nextAction) {
      return {
        success: false,
        error: 'Missing required fields (status, nextAction)',
        raw: responseText,
      };
    }

    return {
      success: true,
      data: {
        status: parsed.status,
        summary: parsed.summary || '',
        output: parsed.output || '',
        nextAction: parsed.nextAction,
        nextActionReason: parsed.nextActionReason || '',
        metadata: parsed.metadata || {},
      },
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse JSON: ${e.message}`,
      raw: responseText,
    };
  }
}

// ============================================================================
// Command Execution
// ============================================================================

function executeCommand(cmd, prompt) {
  console.log(`[DEBUG] Executing command: ${cmd}`);
  console.log(`[DEBUG] Prompt preview: ${prompt.substring(0, 300)}${prompt.length > 300 ? '...' : ''}`);

  // Write prompt to a temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `task-daemon-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);

  // For claude, use: claude --print "$(cat tmpfile)"
  const fullCmd = cmd === 'claude'
    ? `claude --print "$(cat '${tmpFile}')"`
    : `${cmd} "$(cat '${tmpFile}')"`;

  console.log(`[DEBUG] Running (this may take a while)...`);

  try {
    const stdout = execSync(fullCmd, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try { unlinkSync(tmpFile); } catch {}

    return {
      exitCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    try { unlinkSync(tmpFile); } catch {}

    return {
      exitCode: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

// ============================================================================
// Stage Transition Logic
// ============================================================================

function getNextWorkflowStep(workflow, currentStageId) {
  if (!workflow?.steps || !currentStageId) return null;

  const currentIndex = workflow.steps.findIndex(s => s.id === currentStageId);
  if (currentIndex === -1 || currentIndex >= workflow.steps.length - 1) {
    return null;
  }

  return workflow.steps[currentIndex + 1];
}

async function handleStageTransition(config, task, workflow, parsedResponse) {
  const nextAction = parsedResponse.data.nextAction;
  const suggestedNextStage = parsedResponse.data.metadata?.suggestedNextStage;

  // If task is part of a workflow and completed, check for next step
  if (nextAction === 'COMPLETE' && workflow && task.workflowStage) {
    let nextStep = null;

    // Use suggested stage if provided, otherwise use sequential next
    if (suggestedNextStage) {
      nextStep = workflow.steps.find(s => s.id === suggestedNextStage);
    }
    if (!nextStep) {
      nextStep = getNextWorkflowStep(workflow, task.workflowStage);
    }

    if (nextStep) {
      console.log(`[WORKFLOW] Creating next task for step: ${nextStep.name}`);

      const newTask = await createTask(config, {
        title: `${workflow.name}: ${nextStep.name}`,
        workflowId: task.workflowId,
        workflowStage: nextStep.id,
        parentId: task._id,
        assigneeId: nextStep.defaultAssigneeId || task.assigneeId,
        extraPrompt: nextStep.prompt || '',
        status: 'pending',
        metadata: { previousOutput: parsedResponse.data.output },
        tags: task.tags || [],
      });

      if (newTask) {
        console.log(`[WORKFLOW] Created task: ${newTask._id}`);
      }
    } else {
      console.log(`[WORKFLOW] No more steps in workflow`);
    }
  }

  // If CONTINUE, create a follow-up task
  if (nextAction === 'CONTINUE' && parsedResponse.data.nextActionReason) {
    console.log(`[CONTINUE] Creating follow-up task`);

    const newTask = await createTask(config, {
      title: `Follow-up: ${task.title}`,
      workflowId: task.workflowId,
      workflowStage: task.workflowStage,
      parentId: task._id,
      assigneeId: task.assigneeId,
      extraPrompt: parsedResponse.data.nextActionReason,
      status: 'pending',
      metadata: { previousOutput: parsedResponse.data.output },
      tags: task.tags || [],
    });

    if (newTask) {
      console.log(`[CONTINUE] Created task: ${newTask._id}`);
    }
  }
}

// ============================================================================
// Task Processing
// ============================================================================

async function processTask(config, task) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing task: ${task.title}`);
  console.log(`  ID: ${task._id}`);
  console.log(`  Status: ${task.status}`);
  console.log(`  Workflow: ${task.workflowId || 'none'}`);
  console.log(`  Stage: ${task.workflowStage || 'none'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Fetch agent (assignee) if exists
  const agent = await fetchUser(config, task.assigneeId);
  if (agent?.isAgent) {
    console.log(`[DEBUG] Using agent: ${agent.displayName}`);
  }

  // Fetch workflow and step if exists
  let workflow = null;
  let workflowStep = null;
  if (task.workflowId) {
    workflow = await fetchWorkflow(config, task.workflowId);
    if (workflow && task.workflowStage) {
      workflowStep = workflow.steps?.find(s => s.id === task.workflowStage);
      if (workflowStep) {
        console.log(`[DEBUG] Using workflow step: ${workflowStep.name}`);
      }
    }
  }

  // Assemble the prompt
  const prompt = assemblePrompt(task, agent, workflowStep);

  if (config.dryRun) {
    console.log('[Dry Run] Assembled prompt:');
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
  const result = executeCommand(config.exec, prompt);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('-'.repeat(40));
  console.log(`\nCommand completed in ${duration}s with exit code: ${result.exitCode}`);

  const timestamp = new Date().toISOString();

  if (result.exitCode !== 0) {
    // Command failed - set to on_hold status for retry, unassign task
    console.log(`Setting task status to 'on_hold'...`);
    const errorInfo = result.stderr || `Exit code: ${result.exitCode}`;

    const output = {
      timestamp,
      status: 'FAILED',
      action: 'HOLD',
      error: {
        exitCode: result.exitCode,
        message: errorInfo.substring(0, 2000),
      },
    };

    await updateTask(config, task._id, {
      status: 'on_hold',
      assignee: null,
      metadata: {
        ...(task.metadata || {}),
        output,
      },
    });

    // Add comment to activity feed
    await addTaskComment(config, task._id, `Daemon processing failed (exit code ${result.exitCode}). Task placed on hold.`);
    return;
  }

  // Parse the response
  const parsedResponse = parseResponse(result.stdout);

  if (!parsedResponse.success) {
    console.log(`[WARN] Failed to parse JSON response: ${parsedResponse.error}`);
    console.log(`[WARN] Raw response saved to metadata.output`);

    const output = {
      timestamp,
      status: 'PARTIAL',
      action: 'COMPLETE',
      parseError: parsedResponse.error,
      rawOutput: parsedResponse.raw?.substring(0, 5000) || '',
    };

    // Still mark as completed but note the parsing failure
    await updateTask(config, task._id, {
      status: 'completed',
      metadata: {
        ...(task.metadata || {}),
        output,
      },
    });

    // Add comment to activity feed
    await addTaskComment(config, task._id, `Daemon completed but response parsing failed. Task marked as completed with partial output.`);
    return;
  }

  console.log(`[DEBUG] Parsed response:`);
  console.log(`  Status: ${parsedResponse.data.status}`);
  console.log(`  Next Action: ${parsedResponse.data.nextAction}`);
  console.log(`  Summary: ${parsedResponse.data.summary}`);

  // Determine task status based on nextAction
  let newStatus;
  switch (parsedResponse.data.nextAction) {
    case 'COMPLETE':
    case 'CONTINUE':
      newStatus = 'completed';
      break;
    case 'ESCALATE':
    case 'HOLD':
      newStatus = 'on_hold';
      break;
    default:
      newStatus = 'completed';
  }

  console.log(`Setting task status to '${newStatus}'...`);

  // Ensure result is always an object, not a string
  let resultData = parsedResponse.data.output;
  if (typeof resultData === 'string') {
    try {
      resultData = JSON.parse(resultData);
    } catch {
      // If it's not valid JSON, wrap it
      resultData = { text: resultData };
    }
  }

  // Build output for metadata
  const output = {
    timestamp,
    status: parsedResponse.data.status,
    action: parsedResponse.data.nextAction,
    reason: parsedResponse.data.nextActionReason || null,
    summary: parsedResponse.data.summary,
    result: resultData,
    confidence: parsedResponse.data.metadata?.confidence || null,
    suggestedTags: parsedResponse.data.metadata?.suggestedTags || [],
    suggestedNextStage: parsedResponse.data.metadata?.suggestedNextStage || null,
  };

  // Merge suggested tags if provided
  let tagsUpdate = undefined;
  if (parsedResponse.data.metadata?.suggestedTags?.length > 0) {
    const existingTags = new Set(task.tags || []);
    parsedResponse.data.metadata.suggestedTags.forEach(t => existingTags.add(t));
    tagsUpdate = Array.from(existingTags);
  }

  // Merge with existing metadata
  const updatedMetadata = {
    ...(task.metadata || {}),
    output,
  };

  // Only unassign on failures (ESCALATE/HOLD), otherwise keep current assignee
  const isFailure = newStatus === 'on_hold';
  const updatePayload = {
    status: newStatus,
    metadata: updatedMetadata,
    ...(tagsUpdate && { tags: tagsUpdate }),
    ...(isFailure && { assignee: null }),
  };

  await updateTask(config, task._id, updatePayload);

  // Add comment to activity feed with summary
  const action = parsedResponse.data.nextAction;
  const reason = parsedResponse.data.nextActionReason || parsedResponse.data.summary;
  const commentText = isFailure
    ? `Daemon: ${action} - ${reason}`
    : `Daemon completed: ${reason}`;
  await addTaskComment(config, task._id, commentText);

  // Handle stage transitions for workflows
  await handleStageTransition(config, task, workflow, parsedResponse);
}

// ============================================================================
// Main Daemon Loop
// ============================================================================

async function runDaemon(config) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Task Daemon${config.jobName ? ` - Job: ${config.jobName}` : ''}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  View ID:      ${config.viewId}`);
  console.log(`  API URL:      ${config.apiUrl}`);
  console.log(`  Command:      ${config.exec}`);
  console.log(`  Mode:         ${config.once ? 'once' : 'continuous'}`);
  console.log(`  Interval:     ${config.interval}ms`);
  console.log(`  Dry Run:      ${config.dryRun}`);
  console.log(`  Update Tasks: ${!config.noUpdate}`);
  console.log(`${'═'.repeat(60)}\n`);

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
      return true;
    }
    return false;
  };

  if (config.once) {
    const hadTask = await processNextTask();
    if (!hadTask) {
      console.log('No tasks found in queue.');
    }
  } else {
    while (!shuttingDown) {
      const hadTask = await processNextTask();

      if (!hadTask) {
        console.log(`[${new Date().toISOString()}] No tasks available, waiting ${config.interval}ms...`);
        await new Promise((resolve) => setTimeout(resolve, config.interval));
      }
    }
    console.log('Shutdown complete.');
  }
}

// ============================================================================
// Start All Jobs Mode
// ============================================================================

function startAllJobs(config) {
  const { configData, configPath } = config;

  // Get all enabled jobs
  const enabledJobs = Object.entries(configData.jobs || {})
    .filter(([_, job]) => job.enabled !== false)
    .map(([name, job]) => ({ name, ...job }));

  if (enabledJobs.length === 0) {
    console.error('No enabled jobs found in config file.');
    console.log(`\nConfig: ${configPath}`);
    process.exit(1);
  }

  // Check for already running jobs
  const running = getRunningJobs();
  const runningNames = new Set(running.map(j => j.name));

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Task Daemon - Starting All Jobs');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Config: ${configPath}`);
  console.log(`  Jobs:   ${enabledJobs.length} enabled`);
  console.log(`${'═'.repeat(60)}\n`);

  let started = 0;
  let skipped = 0;

  for (const job of enabledJobs) {
    if (runningNames.has(job.name)) {
      console.log(`  ⏭ ${job.name} - already running`);
      skipped++;
      continue;
    }

    // Spawn background process for this job
    const logFile = getLogFile(job.name);
    const args = ['--job', job.name];
    if (config.once) args.push('--once');

    const child = spawn('node', [__filename, '--config', configPath, ...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Save PID
    savePid(job.name, child.pid);

    // Pipe output to log file
    const logStream = createWriteStream(logFile, { flags: 'a' });
    logStream.write(`\n--- Started at ${new Date().toISOString()} ---\n`);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.unref();

    console.log(`  ✓ ${job.name} (PID ${child.pid})`);
    started++;
  }

  console.log('');
  console.log(`Started: ${started}, Skipped: ${skipped}`);
  console.log(`\nUse --status to check running jobs`);
  console.log(`Use --stop to stop all jobs`);
  console.log(`Logs: ${PID_DIR}/*.log`);
}

// Main entry point
const config = parseConfig();

if (config.mode === 'start-all') {
  startAllJobs(config);
} else {
  runDaemon(config);
}
