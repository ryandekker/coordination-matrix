#!/usr/bin/env node
/**
 * Test script for workflow task auto-creation
 *
 * This script:
 * 1. Creates a test workflow with 3 steps
 * 2. Starts a workflow run
 * 3. Provides commands to complete tasks and verify progression
 *
 * Usage:
 *   npm run test:workflow           # Run all tests
 *   npm run test:workflow create    # Just create the workflow
 *   npm run test:workflow start     # Start a workflow run
 *   npm run test:workflow complete <taskId>  # Complete a task
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'coordination_matrix';

const TEST_WORKFLOW_NAME = 'Test Workflow Progression';

async function getDb() {
  const client = await MongoClient.connect(MONGO_URI);
  return { client, db: client.db(DB_NAME) };
}

async function createTestWorkflow(db) {
  console.log('\n📋 Creating test workflow...\n');

  // Check if test workflow already exists
  const existing = await db.collection('workflows').findOne({ name: TEST_WORKFLOW_NAME });
  if (existing) {
    console.log(`  Workflow "${TEST_WORKFLOW_NAME}" already exists (ID: ${existing._id})`);
    return existing;
  }

  const now = new Date();
  const step1Id = new ObjectId().toString();
  const step2Id = new ObjectId().toString();
  const step3Id = new ObjectId().toString();

  const workflow = {
    name: TEST_WORKFLOW_NAME,
    description: 'A test workflow to verify task auto-creation on step completion',
    isActive: true,
    steps: [
      {
        id: step1Id,
        name: 'Step 1: Initial Processing',
        description: 'First step in the workflow',
        stepType: 'agent',
        connections: [{ targetStepId: step2Id }],
      },
      {
        id: step2Id,
        name: 'Step 2: Review',
        description: 'Second step - should be auto-created when Step 1 completes',
        stepType: 'manual',
        connections: [{ targetStepId: step3Id }],
      },
      {
        id: step3Id,
        name: 'Step 3: Finalize',
        description: 'Final step - should be auto-created when Step 2 completes',
        stepType: 'agent',
        // No connections - this is the last step
      },
    ],
    mermaidDiagram: `flowchart TD
    ${step1Id}["Step 1: Initial Processing"]
    ${step2Id}("Step 2: Review")
    ${step3Id}["Step 3: Finalize"]

    ${step1Id} --> ${step2Id}
    ${step2Id} --> ${step3Id}

    classDef agent fill:#3B82F6,color:#fff
    classDef manual fill:#8B5CF6,color:#fff
    class ${step1Id},${step3Id} agent
    class ${step2Id} manual`,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection('workflows').insertOne(workflow);
  workflow._id = result.insertedId;

  console.log(`  ✅ Created workflow "${TEST_WORKFLOW_NAME}"`);
  console.log(`     ID: ${workflow._id}`);
  console.log(`     Steps: ${workflow.steps.map(s => s.name).join(' → ')}`);

  return workflow;
}

async function startWorkflowRun(db, workflowId) {
  console.log('\n🚀 Starting workflow run...\n');

  const workflow = await db.collection('workflows').findOne({ _id: new ObjectId(workflowId) });
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const now = new Date();

  // Create workflow run
  const run = {
    workflowId: workflow._id,
    status: 'running',
    currentStepIds: [],
    completedStepIds: [],
    inputPayload: { test: true, startedAt: now.toISOString() },
    createdAt: now,
    startedAt: now,
  };

  const runResult = await db.collection('workflow_runs').insertOne(run);
  run._id = runResult.insertedId;

  // Create root task
  const rootTask = {
    title: `Workflow: ${workflow.name}`,
    summary: workflow.description,
    status: 'in_progress',
    parentId: null,
    workflowId: workflow._id,
    workflowRunId: run._id,
    taskType: 'standard',
    executionMode: 'automated',
    createdAt: now,
    updatedAt: now,
    metadata: {
      workflowRunId: run._id.toString(),
      inputPayload: run.inputPayload,
    },
  };

  const rootResult = await db.collection('tasks').insertOne(rootTask);
  rootTask._id = rootResult.insertedId;

  // Update run with root task ID
  await db.collection('workflow_runs').updateOne(
    { _id: run._id },
    { $set: { rootTaskId: rootTask._id } }
  );

  // Create first step task
  const firstStep = workflow.steps[0];
  const firstStepTask = {
    title: firstStep.name,
    summary: firstStep.description,
    status: 'pending',
    parentId: rootTask._id,
    workflowId: workflow._id,
    workflowRunId: run._id,
    workflowStepId: firstStep.id,
    workflowStage: firstStep.name,
    taskType: 'standard',
    executionMode: firstStep.stepType === 'manual' ? 'manual' : 'automated',
    createdAt: now,
    updatedAt: now,
    metadata: {
      stepId: firstStep.id,
      stepType: firstStep.stepType,
    },
  };

  const firstStepResult = await db.collection('tasks').insertOne(firstStepTask);
  firstStepTask._id = firstStepResult.insertedId;

  // Update run with current step
  await db.collection('workflow_runs').updateOne(
    { _id: run._id },
    { $addToSet: { currentStepIds: firstStep.id } }
  );

  console.log(`  ✅ Workflow run started`);
  console.log(`     Run ID: ${run._id}`);
  console.log(`     Root Task ID: ${rootTask._id}`);
  console.log(`     First Step Task ID: ${firstStepTask._id}`);
  console.log(`\n  📝 To test, complete the first step task:`);
  console.log(`     npm run test:workflow complete ${firstStepTask._id}`);

  return { run, rootTask, firstStepTask };
}

async function completeTask(db, taskId) {
  console.log(`\n✅ Completing task ${taskId}...\n`);

  const task = await db.collection('tasks').findOne({ _id: new ObjectId(taskId) });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  console.log(`  Task: "${task.title}"`);
  console.log(`  Current status: ${task.status}`);

  if (task.status === 'completed') {
    console.log(`  ⚠️  Task is already completed`);
    return task;
  }

  // Update task status
  const now = new Date();
  await db.collection('tasks').updateOne(
    { _id: task._id },
    {
      $set: {
        status: 'completed',
        updatedAt: now,
      }
    }
  );

  console.log(`  ✅ Task marked as completed`);
  console.log(`\n  ⏳ The workflow service should now create the next task...`);
  console.log(`     (This happens automatically via event handlers when the server is running)`);
  console.log(`\n  💡 If running with the server, check the server logs for:`);
  console.log(`     [WorkflowExecutionService] onTaskStatusChanged: task=${taskId}...`);
  console.log(`     [WorkflowExecutionService] Creating task for next step...`);

  return task;
}

async function showWorkflowStatus(db, workflowName = TEST_WORKFLOW_NAME) {
  console.log(`\n📊 Workflow Status: "${workflowName}"\n`);

  const workflow = await db.collection('workflows').findOne({ name: workflowName });
  if (!workflow) {
    console.log(`  ❌ Workflow not found`);
    return;
  }

  console.log(`  Workflow ID: ${workflow._id}`);
  console.log(`  Steps: ${workflow.steps?.length || 0}`);

  const runs = await db.collection('workflow_runs')
    .find({ workflowId: workflow._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  if (runs.length === 0) {
    console.log(`\n  No workflow runs found. Start one with:`);
    console.log(`  npm run test:workflow start ${workflow._id}`);
    return;
  }

  console.log(`\n  Recent Runs:`);
  for (const run of runs) {
    console.log(`\n  Run: ${run._id}`);
    console.log(`    Status: ${run.status}`);
    console.log(`    Started: ${run.startedAt?.toISOString() || 'N/A'}`);
    console.log(`    Completed Steps: ${run.completedStepIds?.length || 0}/${workflow.steps?.length || 0}`);

    // Get tasks for this run
    const tasks = await db.collection('tasks')
      .find({ workflowRunId: run._id })
      .sort({ createdAt: 1 })
      .toArray();

    console.log(`    Tasks:`);
    for (const task of tasks) {
      const isRoot = !task.workflowStepId;
      const prefix = isRoot ? '    📁' : '      📄';
      const statusEmoji = {
        pending: '⏳',
        in_progress: '🔄',
        completed: '✅',
        failed: '❌',
        waiting: '⏸️',
      }[task.status] || '❓';

      console.log(`${prefix} ${statusEmoji} ${task.title} (${task.status})`);
      if (!isRoot) {
        console.log(`         ID: ${task._id}`);
      }
    }

    // Show next action
    const pendingTask = tasks.find(t => t.workflowStepId && t.status === 'pending');
    if (pendingTask) {
      console.log(`\n    📝 Next action: Complete task "${pendingTask.title}"`);
      console.log(`       npm run test:workflow complete ${pendingTask._id}`);
    }
  }
}

async function runFullTest(db) {
  console.log('\n🧪 Running Full Workflow Progression Test\n');
  console.log('=' .repeat(50));

  // Step 1: Create workflow
  const workflow = await createTestWorkflow(db);

  // Step 2: Show status
  await showWorkflowStatus(db);

  console.log('\n' + '=' .repeat(50));
  console.log('\n📋 Test Instructions:\n');
  console.log('1. Make sure the backend server is running:');
  console.log('   npm run dev:backend\n');
  console.log('2. Start a workflow run:');
  console.log(`   npm run test:workflow start ${workflow._id}\n`);
  console.log('3. Complete the first task (ID will be shown after starting)');
  console.log('4. Check if the next task was auto-created:');
  console.log('   npm run test:workflow status\n');
  console.log('5. Repeat step 3-4 for each step to verify progression\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'test';

  const { client, db } = await getDb();

  try {
    switch (command) {
      case 'create':
        await createTestWorkflow(db);
        break;

      case 'start': {
        const workflowId = args[1];
        if (!workflowId) {
          // Find test workflow
          const workflow = await db.collection('workflows').findOne({ name: TEST_WORKFLOW_NAME });
          if (!workflow) {
            console.log('No test workflow found. Creating one first...');
            const newWorkflow = await createTestWorkflow(db);
            await startWorkflowRun(db, newWorkflow._id.toString());
          } else {
            await startWorkflowRun(db, workflow._id.toString());
          }
        } else {
          await startWorkflowRun(db, workflowId);
        }
        break;
      }

      case 'complete': {
        const taskId = args[1];
        if (!taskId) {
          console.error('Usage: npm run test:workflow complete <taskId>');
          process.exit(1);
        }
        await completeTask(db, taskId);
        console.log('\n  📊 Current status:');
        await showWorkflowStatus(db);
        break;
      }

      case 'status':
        await showWorkflowStatus(db, args[1] || TEST_WORKFLOW_NAME);
        break;

      case 'test':
      default:
        await runFullTest(db);
        break;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
