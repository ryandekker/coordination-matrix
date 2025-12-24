#!/usr/bin/env node
/**
 * Task Retrieval Daemon
 *
 * Polls a saved search (view), retrieves tasks, and executes them with Claude (or a custom command).
 * Assembles prompts from multiple sources: base prompt + agent prompt + workflow step prompt + task prompt.
 * Parses JSON responses and handles stage transitions.
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
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ============================================================================
// Base Daemon Prompt - Ensures JSON responses
// ============================================================================

const BASE_DAEMON_PROMPT = `You are a task automation agent. You MUST respond with valid JSON only - no markdown, no explanation, just the JSON object.

Response schema:
{
  "status": "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED",
  "summary": "1-2 sentence summary",
  "output": "The actual work product (string, can contain newlines)",
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
- output: Put your actual work here (code, analysis, etc.) - escape newlines as \\n in JSON string
- Respond with ONLY the JSON object, nothing else`;

// ============================================================================
// Configuration
// ============================================================================

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
Assembles prompts from: base + agent + workflow step + task context.
Parses JSON responses and handles workflow stage transitions.

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
  # Process tasks continuously with Claude (default)
  node scripts/task-daemon.mjs --view <viewId>

  # Process just one task and exit
  node scripts/task-daemon.mjs --view <viewId> --once

  # Dry run to see assembled prompts
  node scripts/task-daemon.mjs --view <viewId> --once --dry-run
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
  if (workflowStep?.prompt) {
    sections.push(`## Workflow Step: ${workflowStep.name}\n${workflowStep.prompt}`);
  }

  // 4. Task-specific prompt
  if (task.extraPrompt) {
    sections.push(`## Task Instructions\n${task.extraPrompt}`);
  }

  // 5. Task context as structured data
  const context = {
    title: task.title,
    summary: task.summary || null,
    tags: task.tags || [],
    executionLog: task.metadata?.executionLog || null,
    workflowStage: task.workflowStage || null,
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
    // Command failed - set to failed status
    console.log(`Setting task status to 'failed'...`);
    const errorInfo = result.stderr || `Exit code: ${result.exitCode}`;

    await updateTask(config, task._id, {
      status: 'failed',
      metadata: {
        ...(task.metadata || {}),
        executionLog: [
          task.metadata?.executionLog || '',
          '',
          '---',
          `## Execution Failed (${timestamp})`,
          `Exit code: ${result.exitCode}`,
          '',
          errorInfo.substring(0, 1000),
        ].filter(Boolean).join('\n'),
      },
    });
    return;
  }

  // Parse the response
  const parsedResponse = parseResponse(result.stdout);

  if (!parsedResponse.success) {
    console.log(`[WARN] Failed to parse JSON response: ${parsedResponse.error}`);
    console.log(`[WARN] Raw response saved to metadata.executionLog`);

    // Still mark as completed but note the parsing failure
    await updateTask(config, task._id, {
      status: 'completed',
      metadata: {
        ...(task.metadata || {}),
        executionLog: [
          task.metadata?.executionLog || '',
          '',
          '---',
          `## Response (${timestamp}) - Parse Error`,
          `Error: ${parsedResponse.error}`,
          '',
          'Raw output:',
          parsedResponse.raw?.substring(0, 5000) || '',
        ].filter(Boolean).join('\n'),
      },
    });
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

  // Update task with response
  const newExecutionLog = [
    task.metadata?.executionLog || '',
    '',
    '---',
    `## Response (${timestamp})`,
    `Status: ${parsedResponse.data.status}`,
    `Action: ${parsedResponse.data.nextAction}`,
    parsedResponse.data.nextActionReason ? `Reason: ${parsedResponse.data.nextActionReason}` : '',
    '',
    `Summary: ${parsedResponse.data.summary}`,
    '',
    'Output:',
    parsedResponse.data.output,
  ].filter(Boolean).join('\n');

  // Merge suggested tags if provided
  let tagsUpdate = undefined;
  if (parsedResponse.data.metadata?.suggestedTags?.length > 0) {
    const existingTags = new Set(task.tags || []);
    parsedResponse.data.metadata.suggestedTags.forEach(t => existingTags.add(t));
    tagsUpdate = Array.from(existingTags);
  }

  await updateTask(config, task._id, {
    status: newStatus,
    metadata: {
      ...(task.metadata || {}),
      executionLog: newExecutionLog,
    },
    ...(tagsUpdate && { tags: tagsUpdate }),
  });

  // Handle stage transitions for workflows
  await handleStageTransition(config, task, workflow, parsedResponse);
}

// ============================================================================
// Main Daemon Loop
// ============================================================================

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

// Main entry point
const config = parseConfig();
runDaemon(config);
