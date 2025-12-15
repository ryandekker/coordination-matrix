#!/usr/bin/env node
/**
 * Test script for workflow task auto-creation
 *
 * Uses the API endpoints to test workflow progression.
 *
 * Usage:
 *   npm run test:workflow           # Run full test
 *   npm run test:workflow create    # Just create the workflow
 *   npm run test:workflow start     # Start a workflow run
 *   npm run test:workflow complete <taskId>  # Complete a task
 *   npm run test:workflow status    # Show current status
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.API_URL || 'http://localhost:3001';
// Use the same config file as matrix-cli.mjs
const CLI_CONFIG_FILE = path.join(os.homedir(), '.matrix-cli.json');
const TEST_WORKFLOW_NAME = 'Test Workflow Progression';

// Load stored credentials from CLI config
function loadCredentials() {
  try {
    if (fs.existsSync(CLI_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CLI_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

// Make authenticated API request
async function apiRequest(endpoint, options = {}) {
  const creds = loadCredentials();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (creds?.token) {
    headers['Authorization'] = `Bearer ${creds.token}`;
  } else if (creds?.apiKey) {
    headers['X-API-Key'] = creds.apiKey;
  }

  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function createTestWorkflow() {
  console.log('\n📋 Creating test workflow...\n');

  // Check if workflow already exists
  const { data: workflows } = await apiRequest('/api/workflows');
  const existing = workflows.find(w => w.name === TEST_WORKFLOW_NAME);

  if (existing) {
    console.log(`  Workflow "${TEST_WORKFLOW_NAME}" already exists`);
    console.log(`  ID: ${existing._id}`);
    return existing;
  }

  // Create workflow with 3 connected steps
  const workflow = await apiRequest('/api/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: TEST_WORKFLOW_NAME,
      description: 'Test workflow to verify task auto-creation on step completion',
      isActive: true,
      steps: [
        {
          id: 'step-1',
          name: 'Step 1: Initial Processing',
          description: 'First step in the workflow',
          stepType: 'agent',
          connections: [{ targetStepId: 'step-2' }],
        },
        {
          id: 'step-2',
          name: 'Step 2: Review',
          description: 'Second step - should auto-create when Step 1 completes',
          stepType: 'manual',
          connections: [{ targetStepId: 'step-3' }],
        },
        {
          id: 'step-3',
          name: 'Step 3: Finalize',
          description: 'Final step - should auto-create when Step 2 completes',
          stepType: 'agent',
        },
      ],
    }),
  });

  console.log(`  ✅ Created workflow "${TEST_WORKFLOW_NAME}"`);
  console.log(`     ID: ${workflow.data._id}`);
  console.log(`     Steps: Step 1 → Step 2 → Step 3`);

  return workflow.data;
}

async function startWorkflowRun(workflowId) {
  console.log('\n🚀 Starting workflow run...\n');

  // If no workflowId provided, find the test workflow
  if (!workflowId) {
    const { data: workflows } = await apiRequest('/api/workflows');
    const workflow = workflows.find(w => w.name === TEST_WORKFLOW_NAME);
    if (!workflow) {
      console.log('  Test workflow not found. Creating it first...');
      const created = await createTestWorkflow();
      workflowId = created._id;
    } else {
      workflowId = workflow._id;
    }
  }

  const result = await apiRequest('/api/workflow-runs', {
    method: 'POST',
    body: JSON.stringify({
      workflowId,
      inputPayload: { test: true, startedAt: new Date().toISOString() },
    }),
  });

  console.log(`  ✅ Workflow run started`);
  console.log(`     Run ID: ${result.run._id}`);
  console.log(`     Root Task ID: ${result.rootTask._id}`);

  // Find the first step task
  const { data: tasks } = await apiRequest(`/api/tasks?filters[workflowRunId]=${result.run._id}`);
  const firstStepTask = tasks.find(t => t.workflowStepId === 'step-1');

  if (firstStepTask) {
    console.log(`     First Step Task ID: ${firstStepTask._id}`);
    console.log(`\n  📝 To test workflow progression, complete the first task:`);
    console.log(`     npm run test:workflow complete ${firstStepTask._id}`);
  }

  return result;
}

async function completeTask(taskId) {
  console.log(`\n✅ Completing task ${taskId}...\n`);

  // Get current task
  const { data: task } = await apiRequest(`/api/tasks/${taskId}`);
  console.log(`  Task: "${task.title}"`);
  console.log(`  Current status: ${task.status}`);

  if (task.status === 'completed') {
    console.log(`  ⚠️  Task is already completed`);
    return task;
  }

  // Update task status to completed
  const { data: updated } = await apiRequest(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  });

  console.log(`  ✅ Task marked as completed`);
  console.log(`\n  ⏳ The workflow service should now create the next task...`);

  // Wait a moment for the event to process
  await new Promise(resolve => setTimeout(resolve, 500));

  // Check for new tasks
  if (task.workflowRunId) {
    console.log(`\n  📊 Checking for new tasks...`);
    await showWorkflowStatus(task.workflowRunId);
  }

  return updated;
}

async function showWorkflowStatus(workflowRunId) {
  // If no run ID provided, find the most recent run for the test workflow
  if (!workflowRunId) {
    const { data: workflows } = await apiRequest('/api/workflows');
    const workflow = workflows.find(w => w.name === TEST_WORKFLOW_NAME);

    if (!workflow) {
      console.log('\n  ❌ Test workflow not found. Create it with:');
      console.log('     npm run test:workflow create');
      return;
    }

    const { data: runs } = await apiRequest(`/api/workflow-runs?workflowId=${workflow._id}&limit=1`);
    if (!runs || runs.length === 0) {
      console.log('\n  No workflow runs found. Start one with:');
      console.log('     npm run test:workflow start');
      return;
    }
    workflowRunId = runs[0]._id;
  }

  console.log(`\n📊 Workflow Run Status\n`);

  // Get run details
  const run = await apiRequest(`/api/workflow-runs/${workflowRunId}?includeTasks=true`);

  console.log(`  Run ID: ${run.run._id}`);
  console.log(`  Status: ${run.run.status}`);
  console.log(`  Completed Steps: ${run.run.completedStepIds?.length || 0}/3`);

  console.log(`\n  Tasks:`);

  const statusEmoji = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
    waiting: '⏸️',
  };

  // Sort tasks: root first, then by creation time
  const sortedTasks = run.tasks.sort((a, b) => {
    if (!a.workflowStepId) return -1;
    if (!b.workflowStepId) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  for (const task of sortedTasks) {
    const isRoot = !task.workflowStepId;
    const prefix = isRoot ? '  📁' : '    📄';
    const emoji = statusEmoji[task.status] || '❓';

    console.log(`${prefix} ${emoji} ${task.title} (${task.status})`);
    if (!isRoot) {
      console.log(`       ID: ${task._id}`);
      console.log(`       Step: ${task.workflowStepId}`);
    }
  }

  // Find next action
  const pendingTask = sortedTasks.find(t => t.workflowStepId && t.status === 'pending');
  const inProgressTask = sortedTasks.find(t => t.workflowStepId && t.status === 'in_progress');
  const nextTask = pendingTask || inProgressTask;

  if (nextTask) {
    console.log(`\n  📝 Next action: Complete task "${nextTask.title}"`);
    console.log(`     npm run test:workflow complete ${nextTask._id}`);
  } else if (run.run.status === 'completed') {
    console.log(`\n  🎉 Workflow completed successfully!`);
  } else if (run.run.status === 'running') {
    console.log(`\n  ⚠️  No pending tasks found but workflow is still running.`);
    console.log(`     This might indicate an issue with task auto-creation.`);
  }
}

async function runFullTest() {
  console.log('\n🧪 Workflow Progression Test\n');
  console.log('='.repeat(50));

  // Step 1: Create workflow
  const workflow = await createTestWorkflow();

  // Step 2: Start a run
  await startWorkflowRun(workflow._id);

  console.log('\n' + '='.repeat(50));
  console.log('\n📋 What to do next:\n');
  console.log('1. Complete the first task using the command shown above');
  console.log('2. Check if Step 2 task was auto-created:');
  console.log('   npm run test:workflow status\n');
  console.log('3. Repeat for each step to verify full progression\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'test';

  // Check if API is reachable
  try {
    await fetch(`${API_BASE}/health`);
  } catch (e) {
    console.error(`\n❌ Cannot connect to API at ${API_BASE}`);
    console.error('   Make sure the backend is running: npm run dev:backend\n');
    process.exit(1);
  }

  // Check credentials
  const creds = loadCredentials();
  if (!creds?.token && !creds?.apiKey) {
    console.log('\n⚠️  No credentials found. Login first:');
    console.log('   npm run cli login\n');
  }

  try {
    switch (command) {
      case 'create':
        await createTestWorkflow();
        break;

      case 'start':
        await startWorkflowRun(args[1]);
        break;

      case 'complete':
        if (!args[1]) {
          console.error('Usage: npm run test:workflow complete <taskId>');
          process.exit(1);
        }
        await completeTask(args[1]);
        break;

      case 'status':
        await showWorkflowStatus(args[1]);
        break;

      case 'test':
      default:
        await runFullTest();
        break;
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
