#!/usr/bin/env node
/**
 * Integration Test: Token Passing in Workflows
 *
 * This script tests that tokens (data payloads) are correctly passed
 * between workflow steps, especially from triggers to subsequent steps.
 *
 * Usage:
 *   npm run test:workflow:tokens
 *
 * Prerequisites:
 *   - Backend running on localhost:3100 (npm run dev:backend)
 *   - CLI authenticated (npm run cli login)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const API_BASE = process.env.MATRIX_API_URL || 'http://localhost:3100';
const CLI_CONFIG_FILE = path.join(os.homedir(), '.matrix-cli.json');

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

// Test case definitions
const TEST_WORKFLOW_NAME = 'Token Passing Test Workflow';

async function createTokenTestWorkflow() {
  console.log('\n[1/5] Creating test workflow with inputConfig...\n');

  // Check if workflow already exists
  const { data: workflows } = await apiRequest('/api/workflows');
  const existing = workflows.find(w => w.name === TEST_WORKFLOW_NAME);

  if (existing) {
    console.log(`  Deleting existing workflow: ${existing._id}`);
    await apiRequest(`/api/workflows/${existing._id}`, { method: 'DELETE' });
  }

  // Create workflow with steps that use inputConfig
  const workflow = await apiRequest('/api/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: TEST_WORKFLOW_NAME,
      description: 'Tests token passing from trigger to subsequent steps',
      isActive: true,
      steps: [
        {
          id: 'step-1',
          name: 'Step 1: Code Transform',
          description: 'Transforms the trigger payload',
          stepType: 'code',
          codeConfig: {
            code: `
              // Access trigger payload via input
              const message = input.message || 'no message';
              const userId = input.userId || 'unknown';

              // Return transformed data
              return {
                transformedMessage: message.toUpperCase(),
                originalUserId: userId,
                processedAt: new Date().toISOString(),
                source: 'step-1',
              };
            `,
          },
          connections: [{ targetStepId: 'step-2' }],
        },
        {
          id: 'step-2',
          name: 'Step 2: Receive Previous Output',
          description: 'Should receive step 1 output via inputConfig source=previous',
          stepType: 'code',
          inputConfig: {
            source: 'previous',
          },
          codeConfig: {
            code: `
              // input should contain step-1's output
              const hasTransformedMessage = input.output?.transformedMessage !== undefined;
              const hasSource = input.output?.source === 'step-1';

              return {
                receivedFromStep1: hasTransformedMessage && hasSource,
                step1Output: input.output,
                source: 'step-2',
              };
            `,
          },
          connections: [{ targetStepId: 'step-3' }],
        },
        {
          id: 'step-3',
          name: 'Step 3: Receive Trigger Directly',
          description: 'Should receive trigger payload via inputConfig source=trigger',
          stepType: 'code',
          inputConfig: {
            source: 'trigger',
          },
          codeConfig: {
            code: `
              // input should be the original trigger payload
              const hasMessage = input.message !== undefined;
              const hasUserId = input.userId !== undefined;

              return {
                receivedTriggerPayload: hasMessage && hasUserId,
                triggerData: { message: input.message, userId: input.userId },
                source: 'step-3',
              };
            `,
          },
        },
      ],
    }),
  });

  console.log(`  Created workflow: ${workflow.data._id}`);
  console.log('  Steps: Step 1 (code) -> Step 2 (previous) -> Step 3 (trigger)');
  return workflow.data;
}

async function startWorkflowWithPayload(workflowId) {
  console.log('\n[2/5] Starting workflow with test payload...\n');

  const testPayload = {
    message: 'Hello Token Test',
    userId: 'test-user-123',
    timestamp: new Date().toISOString(),
    nested: {
      field1: 'value1',
      field2: 42,
    },
  };

  console.log('  Trigger payload:', JSON.stringify(testPayload, null, 2));

  const result = await apiRequest('/api/workflow-runs', {
    method: 'POST',
    body: JSON.stringify({
      workflowId,
      inputPayload: testPayload,
    }),
  });

  console.log(`\n  Workflow run started: ${result.run._id}`);
  return result.run;
}

async function waitForWorkflowCompletion(runId, maxWaitMs = 30000) {
  console.log('\n[3/5] Waiting for workflow to complete...\n');

  const startTime = Date.now();
  let lastStatus = '';

  while (Date.now() - startTime < maxWaitMs) {
    // The single workflow run endpoint returns the run directly (not wrapped in { run: ... })
    const run = await apiRequest(`/api/workflow-runs/${runId}`);

    if (run.status !== lastStatus) {
      console.log(`  Status: ${run.status}`);
      lastStatus = run.status;
    }

    if (run.status === 'completed' || run.status === 'failed') {
      return { run }; // Wrap for consistency with other code
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error('Workflow did not complete within timeout');
}

async function verifyTokenPassing(runId) {
  console.log('\n[4/5] Verifying token passing...\n');

  const { data: tasks } = await apiRequest(`/api/tasks?filters[workflowRunId]=${runId}`);

  const results = {
    step1: null,
    step2: null,
    step3: null,
    errors: [],
  };

  // Check each step's output
  for (const task of tasks) {
    if (task.workflowStepId === 'step-1') {
      results.step1 = task;

      // Verify stepOutput is set
      if (!task.stepOutput?.data) {
        results.errors.push('Step 1: stepOutput.data not set');
      } else {
        console.log('  Step 1 (code): stepOutput.data set');
        if (task.stepOutput.data.source === 'step-1') {
          console.log('    Output contains expected source marker');
        } else {
          results.errors.push('Step 1: Output missing source marker');
        }
      }
    }

    if (task.workflowStepId === 'step-2') {
      results.step2 = task;

      if (!task.stepOutput?.data) {
        results.errors.push('Step 2: stepOutput.data not set');
      } else {
        console.log('  Step 2 (previous): stepOutput.data set');

        // Verify it received step 1's output
        const output = task.stepOutput.data;
        if (output.receivedFromStep1) {
          console.log('    Correctly received Step 1 output via previous');
        } else {
          results.errors.push('Step 2: Did not correctly receive Step 1 output');
          console.log('    ERROR: step1Output =', JSON.stringify(output.step1Output));
        }
      }
    }

    if (task.workflowStepId === 'step-3') {
      results.step3 = task;

      if (!task.stepOutput?.data) {
        results.errors.push('Step 3: stepOutput.data not set');
      } else {
        console.log('  Step 3 (trigger): stepOutput.data set');

        // Verify it received trigger payload
        const output = task.stepOutput.data;
        if (output.receivedTriggerPayload) {
          console.log('    Correctly received trigger payload via inputConfig.source=trigger');
        } else {
          results.errors.push('Step 3: Did not correctly receive trigger payload');
          console.log('    ERROR: triggerData =', JSON.stringify(output.triggerData));
        }
      }
    }
  }

  return results;
}

async function printSummary(results) {
  console.log('\n[5/5] Test Summary\n');
  console.log('=' .repeat(50));

  if (results.errors.length === 0) {
    console.log('\n  ALL TESTS PASSED\n');
    console.log('  Token passing is working correctly:');
    console.log('    - stepOutput.data is set on code steps');
    console.log('    - inputConfig.source=previous correctly passes previous output');
    console.log('    - inputConfig.source=trigger correctly passes trigger payload');
  } else {
    console.log('\n  SOME TESTS FAILED\n');
    console.log('  Errors:');
    for (const error of results.errors) {
      console.log(`    - ${error}`);
    }
  }

  console.log('\n' + '=' .repeat(50));

  // Print detailed output for debugging
  console.log('\nDetailed task outputs:\n');

  if (results.step1?.stepOutput?.data) {
    console.log('Step 1 output:', JSON.stringify(results.step1.stepOutput.data, null, 2));
  }

  if (results.step2?.stepOutput?.data) {
    console.log('\nStep 2 output:', JSON.stringify(results.step2.stepOutput.data, null, 2));
  }

  if (results.step3?.stepOutput?.data) {
    console.log('\nStep 3 output:', JSON.stringify(results.step3.stepOutput.data, null, 2));
  }

  return results.errors.length === 0;
}

async function cleanup(workflowId) {
  console.log('\nCleaning up test workflow...');
  try {
    await apiRequest(`/api/workflows/${workflowId}`, { method: 'DELETE' });
    console.log('  Workflow deleted');
  } catch (e) {
    console.log('  Could not delete workflow:', e.message);
  }
}

async function main() {
  console.log('\n Token Passing Integration Test\n');
  console.log('='.repeat(50));

  // Check if API is reachable
  try {
    await fetch(`${API_BASE}/health`);
  } catch (e) {
    console.error(`\nCannot connect to API at ${API_BASE}`);
    console.error('Make sure the backend is running: npm run dev:backend\n');
    process.exit(1);
  }

  // Check credentials
  const creds = loadCredentials();
  if (!creds?.token && !creds?.apiKey) {
    console.log('\nNo credentials found. Login first: npm run cli login\n');
    process.exit(1);
  }

  let workflowId = null;
  let success = false;

  try {
    // Create test workflow
    const workflow = await createTokenTestWorkflow();
    workflowId = workflow._id;

    // Start workflow with test payload
    const run = await startWorkflowWithPayload(workflowId);

    // Wait for completion
    await waitForWorkflowCompletion(run._id);

    // Verify token passing
    const results = await verifyTokenPassing(run._id);

    // Print summary
    success = await printSummary(results);
  } catch (error) {
    console.error('\nTest failed with error:', error.message);
    success = false;
  } finally {
    // Cleanup
    if (workflowId && process.env.KEEP_WORKFLOW !== 'true') {
      await cleanup(workflowId);
    }
  }

  process.exit(success ? 0 : 1);
}

main();
