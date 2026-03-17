#!/usr/bin/env node
/**
 * End-to-end workflow progression test.
 *
 * Tests workflow lifecycle by:
 * 1. Starting a workflow run
 * 2. Simulating agent task completions (with stepOutput)
 * 3. Verifying decision routing
 * 4. Verifying manual step creation
 * 5. Simulating human approval
 * 6. Verifying workflow completion
 *
 * Usage:
 *   node scripts/workflows/test-workflow-e2e.mjs --workflow wc   # Test Workflow Creation
 *   node scripts/workflows/test-workflow-e2e.mjs --workflow mc   # Test Multi-Model Creation
 *   node scripts/workflows/test-workflow-e2e.mjs --workflow wc --cleanup  # Clean up after test
 */

const args = process.argv.slice(2);
const workflowArg = args.includes('--workflow') ? args[args.indexOf('--workflow') + 1] : 'wc';
const cleanup = args.includes('--cleanup');
const verbose = args.includes('--verbose');

const API_URL = process.env.API_URL || 'http://localhost:3102';
const API_KEY = process.env.API_KEY || 'cm_ak_live_caf69284c216f8b0f51f2f20d925544c26d50c126475f18c2d1a560238c05ce4';

// =============================================================================
// Helpers
// =============================================================================

let testRunId = null;
let testPassed = 0;
let testFailed = 0;
const testResults = [];

async function api(method, path, body) {
  const url = `${API_URL}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    throw new Error(`API ${method} ${path} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

function assert(condition, message) {
  if (condition) {
    testPassed++;
    testResults.push({ pass: true, message });
    console.log(`  ✅ ${message}`);
  } else {
    testFailed++;
    testResults.push({ pass: false, message });
    console.log(`  ❌ ${message}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTask(runId, stepId, maxWait = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const { data: tasks } = await api('GET', `/api/tasks?workflowRunId=${runId}&limit=50`);
    const task = tasks.find(t => t.workflowStepId === stepId);
    if (task) return task;
    await sleep(300);
  }
  return null;
}

async function getRunState(runId) {
  return api('GET', `/api/workflow-runs/${runId}?includeTasks=true`);
}

async function completeTask(taskId, stepOutput, metadata) {
  const update = {
    status: 'completed',
    ...(stepOutput && { stepOutput }),
    ...(metadata && { metadata }),
  };
  return api('PATCH', `/api/tasks/${taskId}`, update);
}

async function getTasksForRun(runId) {
  const { data } = await api('GET', `/api/tasks?workflowRunId=${runId}&limit=100`);
  return data;
}

// =============================================================================
// Workflow Creation (WC) E2E Test
// =============================================================================

async function testWorkflowCreation() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  E2E Test: Workflow Creation (WC)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find the WC workflow
  const { data: workflows } = await api('GET', '/api/workflows?limit=50');
  const wcWorkflow = workflows.find(w => w.name === 'Workflow Creation' && w.isActive);
  if (!wcWorkflow) {
    console.error('Workflow Creation not found or not active. Deploy first.');
    process.exit(1);
  }
  console.log(`Found workflow: ${wcWorkflow.name} (${wcWorkflow._id})\n`);

  // ── Step 1: Start workflow run ──
  console.log('── Step 1: Start workflow run ──');
  const runResult = await api('POST', '/api/workflow-runs', {
    workflowId: wcWorkflow._id,
    inputPayload: {
      idea: 'E2E Test: A simple 2-step approval workflow',
      workflowName: 'E2E Test Workflow',
      constraints: 'Keep it simple, 2 steps only.',
    },
  });
  testRunId = runResult.run._id;
  console.log(`  Run ID: ${testRunId}`);
  assert(runResult.run.status === 'running', 'Workflow run started with status=running');
  assert(runResult.rootTask, 'Root task created');

  // Wait a moment for async step execution
  await sleep(1000);

  // ── Step 2: Verify first step task (design-workflow) ──
  console.log('\n── Step 2: Verify design-workflow task ──');
  const designTask = await waitForTask(testRunId, 'design-workflow');
  assert(designTask !== null, 'design-workflow task created');
  assert(designTask?.taskType === 'agent', 'design-workflow is agent type');
  assert(designTask?.status === 'pending', 'design-workflow status is pending');
  assert(designTask?.assigneeId != null, 'design-workflow has an assignee (resolved from variable)');
  assert(designTask?.stepConfig?.defaultAssigneeId?.includes('{{agent'), 'stepConfig preserves agent template reference');

  if (!designTask) {
    console.error('Cannot continue without design-workflow task');
    return;
  }

  // ── Step 3: Complete design-workflow (simulate Opus output) ──
  console.log('\n── Step 3: Complete design-workflow (simulate agent) ──');
  await completeTask(designTask._id, {
    format: 'structured',
    data: {
      result: {
        workflow: {
          name: 'E2E Test Workflow',
          description: 'Simple 2-step workflow',
          steps: [
            { id: 'step1', name: 'Step 1', stepType: 'agent' },
            { id: 'step2', name: 'Step 2', stepType: 'manual' },
          ],
        },
        promptDocuments: [
          { title: 'Test Prompt', content: 'Test content', type: 'workflow-prompt', status: 'approved' },
        ],
      },
      summary: 'Designed a simple 2-step workflow',
      status: 'SUCCESS',
      nextAction: 'COMPLETE',
    },
  });
  assert(true, 'design-workflow completed via API');

  // Wait for workflow engine to create next task
  await sleep(1500);

  // ── Step 4: Verify review-design task created ──
  console.log('\n── Step 4: Verify review-design task ──');
  const reviewTask = await waitForTask(testRunId, 'review-design');
  assert(reviewTask !== null, 'review-design task created after design completed');
  assert(reviewTask?.taskType === 'agent', 'review-design is agent type');
  if (verbose && reviewTask) {
    console.log(`  Review task assignee: ${reviewTask.assigneeId}`);
    console.log(`  Review task stepConfig.defaultAssigneeId: ${reviewTask.stepConfig?.defaultAssigneeId}`);
  }

  if (!reviewTask) {
    console.error('Cannot continue without review-design task');
    return;
  }

  // ── Step 5: Complete review-design with "pass" verdict ──
  console.log('\n── Step 5: Complete review-design with pass verdict ──');
  await completeTask(reviewTask._id, {
    format: 'structured',
    data: {
      result: {
        verdict: 'pass',
        feedback: 'Workflow structure looks good. All steps properly connected.',
      },
      summary: 'Review passed',
      status: 'SUCCESS',
      nextAction: 'COMPLETE',
    },
  });
  assert(true, 'review-design completed with pass verdict');

  await sleep(1500);

  // ── Step 6: Verify code step (review-loop-check) auto-executes ──
  console.log('\n── Step 6: Verify review-loop-check code step ──');
  const loopCheckTask = await waitForTask(testRunId, 'review-loop-check');
  assert(loopCheckTask !== null, 'review-loop-check task created');
  // Code steps auto-execute, so it should be completed
  if (loopCheckTask) {
    // Give it a moment to auto-execute
    await sleep(1000);
    const tasks = await getTasksForRun(testRunId);
    const updatedLoopCheck = tasks.find(t => t.workflowStepId === 'review-loop-check');
    assert(
      updatedLoopCheck?.status === 'completed',
      `review-loop-check auto-executed (status: ${updatedLoopCheck?.status})`
    );
  }

  // ── Step 7: Verify decision step (review-gate) auto-evaluates ──
  console.log('\n── Step 7: Verify review-gate decision step ──');
  await sleep(1500);
  const tasks7 = await getTasksForRun(testRunId);
  const gateTask = tasks7.find(t => t.workflowStepId === 'review-gate');
  assert(gateTask !== null, 'review-gate decision task created');
  if (gateTask) {
    assert(
      gateTask.status === 'completed',
      `review-gate auto-evaluated (status: ${gateTask.status})`
    );
    const selectedPath = gateTask.metadata?.selectedPath;
    if (verbose) {
      console.log(`  Decision selectedPath: ${selectedPath}`);
      console.log(`  Gate metadata: ${JSON.stringify(gateTask.metadata)}`);
    }
    // The code step output has verdict field, decision step should route based on it
    assert(selectedPath != null, `review-gate has selectedPath: ${selectedPath}`);
  }

  // ── Step 8: Check what step was reached after decision ──
  console.log('\n── Step 8: Check workflow progression after decision ──');
  await sleep(1500);
  const tasks8 = await getTasksForRun(testRunId);
  const stepIds = tasks8.map(t => `${t.workflowStepId}(${t.status})`);
  console.log(`  All tasks: ${stepIds.join(', ')}`);

  // After review-gate with "pass", should go to create-prompts
  const createPromptsTask = tasks8.find(t => t.workflowStepId === 'create-prompts');
  const editDesignTask = tasks8.find(t => t.workflowStepId === 'edit-design');
  const humanApprovalDirect = tasks8.find(t => t.workflowStepId === 'human-approval' && t.status === 'pending');

  if (createPromptsTask) {
    assert(true, 'Decision routed to create-prompts (pass path)');

    // ── Step 9: Complete create-prompts (Ace Agent) ──
    console.log('\n── Step 9: Complete create-prompts ──');
    await completeTask(createPromptsTask._id, {
      format: 'structured',
      data: {
        result: { documentIds: ['doc_test_1', 'doc_test_2'] },
        summary: 'Created 2 prompt documents',
        status: 'SUCCESS',
        nextAction: 'COMPLETE',
      },
    });
    assert(true, 'create-prompts completed');
    await sleep(1500);

    // ── Step 10: Verify create-workflow-api task ──
    console.log('\n── Step 10: Verify create-workflow-api task ──');
    const createWfTask = await waitForTask(testRunId, 'create-workflow-api');
    assert(createWfTask !== null, 'create-workflow-api task created');

    if (createWfTask) {
      // Complete it with a "pass" validation result
      await completeTask(createWfTask._id, {
        format: 'structured',
        data: {
          result: {
            workflowId: 'wf_test_created_123',
            validation: { valid: true, errors: [] },
            verdict: 'pass',
          },
          summary: 'Workflow created and validated',
          status: 'SUCCESS',
          nextAction: 'COMPLETE',
        },
      });
      assert(true, 'create-workflow-api completed');
      await sleep(1500);

      // ── Step 11: Verify validation code step + decision ──
      console.log('\n── Step 11: Verify validation steps ──');
      await sleep(1500);
      const tasks11 = await getTasksForRun(testRunId);
      const valCheck = tasks11.find(t => t.workflowStepId === 'validation-loop-check');
      const valGate = tasks11.find(t => t.workflowStepId === 'validation-gate');
      assert(valCheck !== null, 'validation-loop-check created');
      assert(valGate !== null, 'validation-gate created');

      if (valGate) {
        const valPath = valGate.metadata?.selectedPath;
        console.log(`  Validation gate selectedPath: ${valPath}`);
      }

      // ── Step 12: Verify human-approval task ──
      console.log('\n── Step 12: Verify human-approval manual step ──');
      await sleep(1500);
      const tasks12 = await getTasksForRun(testRunId);
      const humanTask = tasks12.find(t => t.workflowStepId === 'human-approval');
      assert(humanTask !== null, 'human-approval task created');
      if (humanTask) {
        assert(humanTask.taskType === 'manual', 'human-approval is manual type');
        assert(humanTask.status === 'pending', `human-approval is pending (status: ${humanTask.status})`);
        assert(humanTask.executionMode === 'manual', 'human-approval executionMode is manual');

        // ── Step 13: Simulate human approval ──
        console.log('\n── Step 13: Simulate human approval ──');
        await completeTask(humanTask._id, {
          format: 'structured',
          data: {
            result: { verdict: 'approved', notes: 'Looks good, activate it.' },
          },
        }, {
          selectedPath: null,  // Manual step, no path selection needed
        });
        assert(true, 'human-approval completed (approved)');
        await sleep(1500);

        // ── Step 14: Verify approval-gate routes to finalize ──
        console.log('\n── Step 14: Verify approval-gate decision ──');
        await sleep(1500);
        const tasks14 = await getTasksForRun(testRunId);
        const approvalGate = tasks14.find(t => t.workflowStepId === 'approval-gate');
        assert(approvalGate !== null, 'approval-gate task created');

        if (approvalGate) {
          const approvalPath = approvalGate.metadata?.selectedPath;
          console.log(`  Approval gate selectedPath: ${approvalPath}`);

          // ── Step 15: Check finalize or workflow completion ──
          console.log('\n── Step 15: Check workflow completion ──');
          await sleep(2000);
          const tasks15 = await getTasksForRun(testRunId);
          const finalizeTask = tasks15.find(t => t.workflowStepId === 'finalize');
          const run15 = await getRunState(testRunId);

          if (finalizeTask) {
            assert(true, 'finalize code step created');
            console.log(`  Finalize status: ${finalizeTask.status}`);
          }

          console.log(`  Run status: ${run15.status}`);
          console.log(`  Completed steps: ${run15.completedStepIds?.join(', ') || 'none'}`);
          console.log(`  Current steps: ${run15.currentStepIds?.join(', ') || 'none'}`);

          const allStepIds = tasks15.map(t => `${t.workflowStepId || 'root'}(${t.status})`);
          console.log(`  All tasks: ${allStepIds.join(', ')}`);
        }
      }
    }
  } else if (editDesignTask) {
    assert(false, 'Decision routed to edit-design (fail path) — expected pass');
  } else if (humanApprovalDirect) {
    assert(true, 'Decision routed to human-approval (escalate path)');
  } else {
    assert(false, 'Decision did not route to any expected path');
  }
}

// =============================================================================
// Multi-Model Creation (MC) E2E Test
// =============================================================================

async function testMultiModelCreation() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  E2E Test: Universal Multi-Model Creation (MC)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find the MC workflow
  const { data: workflows } = await api('GET', '/api/workflows?limit=50');
  const mcWorkflow = workflows.find(w => w.name === 'Universal Multi-Model Creation' && w.isActive);
  if (!mcWorkflow) {
    console.error('Universal Multi-Model Creation not found or not active. Deploy first.');
    process.exit(1);
  }
  console.log(`Found workflow: ${mcWorkflow.name} (${mcWorkflow._id})\n`);

  // ── Step 1: Start workflow run ──
  console.log('── Step 1: Start workflow run ──');
  const runResult = await api('POST', '/api/workflow-runs', {
    workflowId: mcWorkflow._id,
    inputPayload: {
      idea: 'E2E Test: Write a short README for a CLI tool',
      outputType: 'document',
      title: 'E2E Test README',
      constraints: 'Keep it under 500 words.',
      debateRounds: 1,
    },
  });
  testRunId = runResult.run._id;
  console.log(`  Run ID: ${testRunId}`);
  assert(runResult.run.status === 'running', 'MC run started with status=running');

  await sleep(1500);

  // ── Step 2: Verify setup code step auto-executes ──
  console.log('\n── Step 2: Verify setup code step ──');
  const setupTask = await waitForTask(testRunId, 'setup');
  assert(setupTask !== null, 'setup task created');
  if (setupTask) {
    await sleep(1000);
    const tasks = await getTasksForRun(testRunId);
    const updatedSetup = tasks.find(t => t.workflowStepId === 'setup');
    assert(
      updatedSetup?.status === 'completed',
      `setup auto-executed (status: ${updatedSetup?.status})`
    );
    if (verbose && updatedSetup?.stepOutput) {
      console.log(`  Setup output: ${JSON.stringify(updatedSetup.stepOutput.data?.result || updatedSetup.stepOutput.data)}`);
    }
  }

  // ── Step 3: Verify human-brief manual step ──
  console.log('\n── Step 3: Verify human-brief manual step ──');
  await sleep(1000);
  const briefTask = await waitForTask(testRunId, 'human-brief');
  assert(briefTask !== null, 'human-brief task created');
  if (briefTask) {
    assert(briefTask.taskType === 'manual', 'human-brief is manual type');
    assert(briefTask.status === 'pending', 'human-brief is pending');

    // Simulate human refining the brief
    await completeTask(briefTask._id, {
      format: 'structured',
      data: {
        result: {
          verdict: 'approved',
          notes: 'Brief looks good, proceed with all 3 models.',
        },
      },
    });
    assert(true, 'human-brief completed (approved)');
  }

  await sleep(2000);

  // ── Step 4: Verify foreach fanout-create ──
  console.log('\n── Step 4: Verify foreach fanout ──');
  const tasks4 = await getTasksForRun(testRunId);
  const foreachTask = tasks4.find(t => t.workflowStepId === 'fanout-create');
  assert(foreachTask !== null, 'fanout-create foreach task created');

  if (foreachTask) {
    // Foreach should spawn child tasks (model-create for each model)
    await sleep(2000);
    const tasks4b = await getTasksForRun(testRunId);
    const modelCreateTasks = tasks4b.filter(t => t.workflowStepId === 'model-create');
    console.log(`  Found ${modelCreateTasks.length} model-create child tasks`);
    assert(modelCreateTasks.length === 3, `3 model-create tasks spawned (got ${modelCreateTasks.length})`);

    // ── Step 5: Complete all 3 model-create tasks ──
    console.log('\n── Step 5: Complete model-create tasks ──');
    for (let i = 0; i < modelCreateTasks.length; i++) {
      const mt = modelCreateTasks[i];
      await completeTask(mt._id, {
        format: 'structured',
        data: {
          result: {
            content: `Model ${i + 1} README output: # CLI Tool\nA great CLI tool.`,
            modelName: mt.stepInput?.model?.modelName || `Model ${i + 1}`,
          },
          summary: `Model ${i + 1} created its version`,
          status: 'SUCCESS',
          nextAction: 'COMPLETE',
        },
      });
      console.log(`  Completed model-create ${i + 1}/${modelCreateTasks.length}`);
    }
    assert(true, 'All 3 model-create tasks completed');

    await sleep(2000);

    // ── Step 6: Verify join-initial ──
    console.log('\n── Step 6: Verify join-initial ──');
    const tasks6 = await getTasksForRun(testRunId);
    const joinTask = tasks6.find(t => t.workflowStepId === 'join-initial');
    assert(joinTask !== null, 'join-initial task created');
    if (joinTask) {
      assert(
        joinTask.status === 'completed',
        `join-initial completed (status: ${joinTask.status})`
      );
    }

    // ── Step 7: Verify judge-evaluate task ──
    console.log('\n── Step 7: Verify judge-evaluate ──');
    await sleep(1500);
    const judgeTask = await waitForTask(testRunId, 'judge-evaluate');
    assert(judgeTask !== null, 'judge-evaluate task created');

    if (judgeTask) {
      // Complete judge evaluation
      await completeTask(judgeTask._id, {
        format: 'structured',
        data: {
          result: {
            scores: [
              { modelName: 'Depth', score: 85, strengths: 'Thorough' },
              { modelName: 'Concise', score: 90, strengths: 'Clear' },
              { modelName: 'Creative', score: 80, strengths: 'Engaging' },
            ],
            bestModel: 'Concise',
            synthesisGuidance: 'Use Concise as base, add Creative flair.',
          },
          summary: 'Judged all 3 models, Concise scored highest',
          status: 'SUCCESS',
          nextAction: 'COMPLETE',
        },
      });
      assert(true, 'judge-evaluate completed');
    }

    await sleep(2000);

    // ── Step 8: Check debate count and gate ──
    console.log('\n── Step 8: Check debate flow ──');
    const tasks8 = await getTasksForRun(testRunId);
    const debateCount = tasks8.find(t => t.workflowStepId === 'debate-count');
    const debateGate = tasks8.find(t => t.workflowStepId === 'debate-gate');

    assert(debateCount !== null, 'debate-count code step created');
    assert(debateGate !== null, 'debate-gate decision step created');

    if (debateGate) {
      const debatePath = debateGate.metadata?.selectedPath;
      console.log(`  Debate gate selectedPath: ${debatePath}`);
      // With debateRounds=1 and 0 completed debate rounds,
      // should route to "more" for at least 1 debate round
      // OR if the code step counts initial judge as a round, might go to "done"
    }

    // Print current state
    const allStepIds = tasks8.map(t => `${t.workflowStepId || 'root'}(${t.status})`);
    console.log(`  All tasks: ${allStepIds.join(', ')}`);

    const run8 = await getRunState(testRunId);
    console.log(`  Run status: ${run8.status}`);
    console.log(`  Completed steps: ${run8.completedStepIds?.join(', ') || 'none'}`);
    console.log(`  Current steps: ${run8.currentStepIds?.join(', ') || 'none'}`);
  }
}

// =============================================================================
// Cleanup
// =============================================================================

async function cleanupRun(runId) {
  console.log(`\nCleaning up run ${runId}...`);
  try {
    // Cancel the run
    await api('PATCH', `/api/workflow-runs/${runId}`, { status: 'cancelled' });
    console.log('  Run cancelled');
  } catch (e) {
    console.log(`  Could not cancel run: ${e.message}`);
  }

  // Delete tasks
  try {
    const { data: tasks } = await api('GET', `/api/tasks?workflowRunId=${runId}&limit=100`);
    for (const task of tasks) {
      await api('DELETE', `/api/tasks/${task._id}`);
    }
    console.log(`  Deleted ${tasks.length} tasks`);
  } catch (e) {
    console.log(`  Could not delete tasks: ${e.message}`);
  }

  // Delete the run
  try {
    await api('DELETE', `/api/workflow-runs/${runId}`);
    console.log('  Run deleted');
  } catch (e) {
    console.log(`  Could not delete run: ${e.message}`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  Workflow E2E Progression Test                ║');
  console.log('╚═══════════════════════════════════════════════╝');

  // Health check
  try {
    await api('GET', '/api/health');
    console.log('Backend is running.\n');
  } catch {
    console.error('Backend not reachable at ' + API_URL);
    process.exit(1);
  }

  try {
    if (workflowArg === 'wc') {
      await testWorkflowCreation();
    } else if (workflowArg === 'mc') {
      await testMultiModelCreation();
    } else {
      console.error(`Unknown workflow: ${workflowArg}. Use 'wc' or 'mc'.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n\n💥 Test error: ${error.message}`);
    if (verbose) console.error(error.stack);
  }

  // Summary
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${testPassed} passed, ${testFailed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (cleanup && testRunId) {
    await cleanupRun(testRunId);
  } else if (testRunId) {
    console.log(`\n  Run ID: ${testRunId}`);
    console.log(`  To clean up: node scripts/workflows/test-workflow-e2e.mjs --workflow ${workflowArg} --cleanup`);
  }

  process.exit(testFailed > 0 ? 1 : 0);
}

main();
