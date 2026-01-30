#!/usr/bin/env node
/**
 * Test script to verify flow step inputConfig.mapping resolution
 * with trigger.payload.* references.
 *
 * This simulates the exact scenario from production:
 * 1. Parent workflow with a decision step routing to a flow step
 * 2. Flow step has inputConfig.mapping with trigger.payload.* references
 * 3. The mapping should resolve to actual values from the parent workflow's inputPayload
 */

const API_URL = process.env.MATRIX_API_URL || 'http://localhost:3104';
let AUTH_TOKEN = null;

async function login() {
  const response = await fetch(`${API_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com' }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`);
  }
  AUTH_TOKEN = data.token;
  console.log('Logged in successfully\n');
}

async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_URL}${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log('=== Testing Flow Step Input Resolution ===\n');
  console.log(`API URL: ${API_URL}\n`);

  // Login first
  await login();

  // Step 1: Create a sub-workflow (the "Label Email" equivalent)
  console.log('1. Creating sub-workflow (Label Email equivalent)...');
  const subWorkflow = await apiCall('POST', '/api/workflows', {
    name: 'Test Sub-Workflow',
    description: 'Sub-workflow for testing input resolution',
    isActive: true,
    steps: [
      {
        id: 'step-trigger',
        name: 'Trigger',
        stepType: 'trigger',
        connections: [{ targetStepId: 'step-external' }],
      },
      {
        id: 'step-external',
        name: 'External Step',
        stepType: 'external',
        description: 'Simulates external API call with resolved values',
        externalConfig: {
          endpoint: 'https://httpbin.org/post',
          method: 'POST',
          payloadTemplate: '{"threadId": "{{trigger.payload.threadId}}", "email": "{{trigger.payload.email}}"}',
        },
        connections: [],
      },
    ],
  });
  const subWorkflowId = subWorkflow._id || subWorkflow.data?._id;
  console.log(`   Created sub-workflow: ${subWorkflowId}\n`);

  // Step 2: Create the parent workflow with a decision -> flow step
  console.log('2. Creating parent workflow with decision -> flow step...');
  const parentWorkflow = await apiCall('POST', '/api/workflows', {
    name: 'Test Parent Workflow',
    description: 'Parent workflow with flow step that uses inputConfig.mapping',
    isActive: true,
    steps: [
      {
        id: 'step-trigger',
        name: 'Trigger',
        stepType: 'trigger',
        connections: [{ targetStepId: 'step-agent' }],
      },
      {
        id: 'step-agent',
        name: 'Classify',
        stepType: 'agent',
        defaultAssigneeId: '000000000000000000000001', // System user
        connections: [{ targetStepId: 'step-decision' }],
      },
      {
        id: 'step-decision',
        name: 'Route',
        stepType: 'decision',
        decisionField: 'output.result.category',
        connections: [
          { targetStepId: 'step-flow', condition: 'Noise', label: 'Noise' },
        ],
      },
      {
        id: 'step-flow',
        name: 'Label Email Flow',
        stepType: 'flow',
        flowId: subWorkflowId,
        titleTemplate: 'Label: {{trigger.payload.data.subject}}',
        inputConfig: {
          source: 'previous',
          mapping: {
            threadId: '{{trigger.payload.data.body.threadId}}',
            email: '{{trigger.payload.data}}',
            label: 'AI/Noise',
            account: 'test@example.com',
          },
        },
        connections: [],
      },
    ],
  });
  const parentWorkflowId = parentWorkflow._id || parentWorkflow.data?._id;
  console.log(`   Created parent workflow: ${parentWorkflowId}\n`);

  // Step 3: Start the parent workflow with trigger data
  console.log('3. Starting parent workflow with trigger payload...');
  const triggerPayload = {
    email: 'test@example.com',
    data: {
      subject: 'Test Email Subject',
      body: {
        threadId: 'thread-123-abc',
        content: 'This is the email body content',
      },
    },
  };
  console.log('   Trigger payload:');
  console.log(JSON.stringify(triggerPayload, null, 4));
  console.log('');

  const startResult = await apiCall('POST', '/api/workflow-runs', {
    workflowId: parentWorkflowId,
    inputPayload: triggerPayload,
  });
  const workflowRunId = startResult.run._id;
  console.log(`   Started workflow run: ${workflowRunId}\n`);

  // Step 4: Wait a moment and check the workflow run
  console.log('4. Waiting for workflow to process...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 5: Find the agent task and complete it with a "Noise" decision
  console.log('5. Finding and completing agent task...');
  const tasks = await apiCall('GET', `/api/tasks?workflowRunId=${workflowRunId}`);
  const agentTask = tasks.data.find(t => t.workflowStepId === 'step-agent');

  if (!agentTask) {
    console.log('   No agent task found yet. Tasks:', tasks.data.map(t => ({ id: t._id, step: t.workflowStepId, status: t.status })));
    return;
  }

  console.log(`   Found agent task: ${agentTask._id}, status: ${agentTask.status}`);

  // Complete the agent task with output that triggers "Noise" route
  await apiCall('PATCH', `/api/tasks/${agentTask._id}`, {
    status: 'completed',
    metadata: {
      ...agentTask.metadata,
      output: {
        result: {
          category: 'Noise',
          confidence: 0.95,
        },
      },
    },
  });
  console.log('   Agent task completed with category: Noise\n');

  // Step 6: Wait for the flow step to be created
  console.log('6. Waiting for flow step task to be created...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 7: Check the flow task and its inputPayload
  console.log('7. Checking flow task inputPayload...');
  const updatedTasks = await apiCall('GET', `/api/tasks?workflowRunId=${workflowRunId}`);
  const flowTask = updatedTasks.data.find(t => t.workflowStepId === 'step-flow');

  if (!flowTask) {
    console.log('   No flow task found. Current tasks:');
    console.log(updatedTasks.data.map(t => ({ id: t._id, step: t.workflowStepId, status: t.status, type: t.taskType })));
    return;
  }

  console.log(`   Flow task: ${flowTask._id}`);
  console.log(`   Status: ${flowTask.status}`);
  console.log(`   metadata.inputPayload:`);
  console.log(JSON.stringify(flowTask.metadata?.inputPayload, null, 4));
  console.log('');

  // Step 8: Check if there's a spawned sub-workflow run
  if (flowTask.spawnedWorkflowRunId) {
    console.log('8. Checking spawned sub-workflow run...');
    const subRun = await apiCall('GET', `/api/workflow-runs/${flowTask.spawnedWorkflowRunId}`);
    console.log(`   Sub-workflow run: ${subRun._id}`);
    console.log(`   Status: ${subRun.status}`);
    console.log(`   inputPayload:`);
    console.log(JSON.stringify(subRun.inputPayload, null, 4));
    console.log('');

    // This is the key test!
    console.log('=== VERIFICATION ===');
    const expectedThreadId = 'thread-123-abc';
    const actualThreadId = subRun.inputPayload?.threadId;

    if (actualThreadId === expectedThreadId) {
      console.log('✅ SUCCESS: threadId was correctly resolved!');
      console.log(`   Expected: "${expectedThreadId}"`);
      console.log(`   Actual:   "${actualThreadId}"`);
    } else if (actualThreadId === '{{trigger.payload.data.body.threadId}}') {
      console.log('❌ FAILURE: threadId was NOT resolved - still contains template!');
      console.log(`   Expected: "${expectedThreadId}"`);
      console.log(`   Actual:   "${actualThreadId}"`);
    } else {
      console.log('❓ UNEXPECTED: threadId has unexpected value');
      console.log(`   Expected: "${expectedThreadId}"`);
      console.log(`   Actual:   "${actualThreadId}"`);
    }
  } else {
    console.log('8. No spawned sub-workflow run yet (flow task not executed)');
  }

  // Cleanup (optional)
  console.log('\n=== Cleanup ===');
  console.log(`To clean up, delete:`);
  console.log(`  - Workflow run: ${workflowRunId}`);
  console.log(`  - Parent workflow: ${parentWorkflowId}`);
  console.log(`  - Sub-workflow: ${subWorkflowId}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
