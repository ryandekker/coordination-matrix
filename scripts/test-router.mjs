#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the config for auth
const configPath = path.join(process.env.HOME, '.matrix-cli.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error('No auth config found. Run: npm run cli login');
  process.exit(1);
}

const API_URL = process.env.MATRIX_API_URL || 'http://localhost:3100';

async function makeRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  } else if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  return res.json();
}

// Test 1: Parse the mermaid diagram
console.log('\n=== Test 1: Parse Mermaid Diagram ===\n');
const mermaidContent = fs.readFileSync(path.join(__dirname, 'workflows/email-router-test.mermaid'), 'utf-8');
const parseResult = await makeRequest('/api/workflows/parse-mermaid', {
  method: 'POST',
  body: JSON.stringify({ mermaidDiagram: mermaidContent }),
});

if (parseResult.error) {
  console.error('Parse error:', parseResult.error);
  process.exit(1);
}

console.log('Steps parsed:', parseResult.data.steps.length);
const decisionStep = parseResult.data.steps.find(s => s.stepType === 'decision');
if (decisionStep) {
  console.log('\nDecision step:');
  console.log('  - Name:', decisionStep.name);
  console.log('  - ID:', decisionStep.id);
  console.log('  - inputPath:', decisionStep.inputPath);
  console.log('  - decisionField:', decisionStep.decisionField);
  console.log('  - Connections:', decisionStep.connections?.length || 0);
  if (decisionStep.connections) {
    for (const conn of decisionStep.connections) {
      console.log(`    - "${conn.condition || conn.label}" -> ${conn.targetStepId}`);
    }
  }
}

// Test 2: Create a simplified test workflow directly
console.log('\n\n=== Test 2: Create Test Workflow ===\n');

const testWorkflow = {
  name: 'Router Test Workflow',
  description: 'Testing decision/router step routing',
  isActive: true,
  steps: [
    {
      id: 'trigger',
      name: 'Start',
      stepType: 'trigger',
      connections: [{ targetStepId: 'classifier' }]
    },
    {
      id: 'classifier',
      name: 'Classify Input',
      stepType: 'code',
      codeConfig: {
        code: `
// Simulate classification based on input
// Input structure: { output: { testCategory: "..." }, ...metadata }
// Also available: trigger.testCategory (original trigger payload)
const category = input.output?.testCategory || trigger.testCategory || 'Unknown';
console.log('Input:', JSON.stringify(input));
console.log('Trigger:', JSON.stringify(trigger));
console.log('Category:', category);
// Return just the result - it will be wrapped in output by advanceToNextStep
return {
  result: {
    category: category
  }
};
`,
        timeout: 5000
      },
      connections: [{ targetStepId: 'router' }]
    },
    {
      id: 'router',
      name: 'Route by Category',
      stepType: 'decision',
      inputPath: 'output.result.category',  // The field to compare
      connections: [
        { targetStepId: 'handle-noise', condition: 'Noise', label: 'Noise' },
        { targetStepId: 'handle-digest', condition: 'Digest', label: 'Digest' },
        { targetStepId: 'handle-response', condition: 'Response Required', label: 'Response Required' },
        { targetStepId: 'handle-action', condition: 'Actionable', label: 'Actionable' },
      ],
      defaultConnection: 'handle-unknown'
    },
    {
      id: 'handle-noise',
      name: 'Handle Noise',
      stepType: 'agent',
      additionalInstructions: 'This is the Noise branch'
    },
    {
      id: 'handle-digest',
      name: 'Handle Digest',
      stepType: 'agent',
      additionalInstructions: 'This is the Digest branch'
    },
    {
      id: 'handle-response',
      name: 'Handle Response',
      stepType: 'agent',
      additionalInstructions: 'This is the Response Required branch'
    },
    {
      id: 'handle-action',
      name: 'Handle Action',
      stepType: 'agent',
      additionalInstructions: 'This is the Actionable branch'
    },
    {
      id: 'handle-unknown',
      name: 'Handle Unknown',
      stepType: 'agent',
      additionalInstructions: 'This is the default/unknown branch'
    }
  ]
};

// Check if workflow exists already
const existingWorkflows = await makeRequest('/api/workflows');
const existing = existingWorkflows.data?.find(w => w.name === testWorkflow.name);

let workflowId;
if (existing) {
  console.log('Workflow already exists, deleting and recreating...');
  await makeRequest(`/api/workflows/${existing._id}`, { method: 'DELETE' });
  console.log('Deleted old workflow');
}

console.log('Creating new workflow...');
const createResult = await makeRequest('/api/workflows', {
  method: 'POST',
  body: JSON.stringify(testWorkflow),
});
if (createResult.error) {
  console.error('Create error:', createResult.error);
  process.exit(1);
}
workflowId = createResult.data._id;
console.log('Created:', createResult.data.name, 'ID:', workflowId);

// Test 3: Trigger the workflow with different categories
console.log('\n\n=== Test 3: Trigger Workflow Runs ===\n');

const testCases = [
  { testCategory: 'Noise', expected: 'handle-noise' },
  { testCategory: 'Digest', expected: 'handle-digest' },
  { testCategory: 'Response Required', expected: 'handle-response' },
  { testCategory: 'Actionable', expected: 'handle-action' },
  { testCategory: 'SomethingElse', expected: 'handle-unknown (default)' },
];

for (const testCase of testCases) {
  console.log(`\nTriggering with category: "${testCase.testCategory}" (expecting: ${testCase.expected})`);

  // Use POST /api/workflow-runs to start the workflow
  const triggerResult = await makeRequest('/api/workflow-runs', {
    method: 'POST',
    body: JSON.stringify({
      workflowId: workflowId,
      inputPayload: testCase,
      title: `Router Test: ${testCase.testCategory}`,
    }),
  });

  if (triggerResult.error) {
    console.error('  Trigger error:', triggerResult.error);
    continue;
  }

  // Response format: { run: { _id, ... }, rootTaskId: "..." }
  const runId = triggerResult.run?._id;
  const rootTaskId = triggerResult.rootTaskId;

  console.log('  Run ID:', runId);
  console.log('  Root Task ID:', rootTaskId);

  // Wait a moment for the workflow to process
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check the workflow run status
  // Response format: { run: {...}, tasks: [...] }
  const runResult = await makeRequest(`/api/workflow-runs/${runId}?includeTasks=true`);
  if (runResult.run) {
    console.log('  Status:', runResult.run.status);
    console.log('  Current Steps:', runResult.run.currentStepIds?.join(', ') || '(none)');
    console.log('  Completed Steps:', runResult.run.completedStepIds?.join(', ') || '(none)');

    // Find the router task
    const routerTask = runResult.tasks?.find(t => t.workflowStepId === 'router');
    if (routerTask) {
      console.log('  Router task status:', routerTask.status);
      console.log('  Router selectedPath:', routerTask.metadata?.selectedPath || '(none)');
      console.log('  Router matchedValue:', routerTask.metadata?.matchedValue || '(none)');
      console.log('  Router decisionField:', routerTask.metadata?.decisionField || '(none)');
      if (routerTask.metadata?.error) {
        console.log('  Router error:', routerTask.metadata.error);
      }
      if (routerTask.stepOutput?.data?._decision) {
        console.log('  Decision output:', JSON.stringify(routerTask.stepOutput.data._decision, null, 2));
      }
    } else {
      console.log('  Router task not found yet');
    }

    // Find the classifier task to see its output
    const classifierTask = runResult.tasks?.find(t => t.workflowStepId === 'classifier');
    if (classifierTask) {
      console.log('  Classifier status:', classifierTask.status);
      if (classifierTask.stepOutput?.data) {
        console.log('  Classifier output:', JSON.stringify(classifierTask.stepOutput.data, null, 2));
      }
    }

    // List all tasks
    console.log('  Tasks:');
    for (const task of runResult.tasks || []) {
      console.log(`    - ${task.workflowStepId || task.title}: ${task.status}`);
    }
  }
}

console.log('\n\n=== Tests Complete ===\n');
