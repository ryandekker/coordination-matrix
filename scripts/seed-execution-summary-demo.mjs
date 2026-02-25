#!/usr/bin/env node
/**
 * Seed script to create demo tasks showcasing the executionSummary UI.
 *
 * Creates three tasks:
 *   1. A successful workflow root task with step trace
 *   2. A failed workflow root task with error chain
 *   3. A foreach parent task with batch stats
 *
 * Usage:
 *   node scripts/seed-execution-summary-demo.mjs
 *
 * Requires: Backend running on localhost:3100, CLI authenticated.
 * Uses the same auth as the CLI (reads ~/.matrix-cli.json).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read CLI config for auth
const configPath = path.join(process.env.HOME, '.matrix-cli.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
  console.error('Could not read ~/.matrix-cli.json — run `npm run cli login` first.');
  process.exit(1);
}

const API_URL = config.apiUrl || 'http://localhost:3100';
const headers = {
  'Content-Type': 'application/json',
  ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
  ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
};

async function createTask(body) {
  const res = await fetch(`${API_URL}/api/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create task: ${res.status} ${err}`);
  }
  return res.json();
}

async function patchTask(id, body) {
  const res = await fetch(`${API_URL}/api/tasks/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to patch task ${id}: ${res.status} ${err}`);
  }
  return res.json();
}

async function main() {
  console.log('Creating demo tasks for executionSummary UI...\n');

  // 1. Successful workflow root task
  const successTask = await createTask({
    title: '[Demo] Onboarding Flow — Completed Successfully',
    summary: 'Demo task showing a successful workflow execution summary',
    status: 'completed',
    taskType: 'flow',
    tags: ['demo', 'execution-summary'],
  });
  const successId = successTask._id || successTask.data?._id;
  await patchTask(successId, {
    executionSummary: {
      outcome: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 47_320,
      trigger: {
        source: 'workflow: Onboarding Flow',
        inputSummary: 'email, name, role',
      },
      steps: [
        {
          stepName: 'Validate Input',
          stepType: 'code',
          outcome: 'success',
          summary: 'All required fields present and valid',
          durationMs: 120,
        },
        {
          stepName: 'Fetch User Profile',
          stepType: 'external',
          outcome: 'success',
          summary: 'Retrieved profile from identity service',
          durationMs: 1_850,
        },
        {
          stepName: 'Generate Welcome Email',
          stepType: 'agent',
          outcome: 'success',
          summary: 'Drafted personalized welcome email with 3 resource links',
          durationMs: 12_400,
        },
        {
          stepName: 'Send Notifications',
          stepType: 'webhook',
          outcome: 'success',
          summary: 'Sent email and Slack notification',
          durationMs: 2_100,
        },
        {
          stepName: 'Create Workspace',
          stepType: 'agent',
          outcome: 'success',
          summary: 'Provisioned workspace with default settings and 5 starter docs',
          durationMs: 30_850,
        },
      ],
    },
  });
  console.log(`  Created: ${successTask.title || successId}`);

  // 2. Failed workflow root task with error chain
  const failedTask = await createTask({
    title: '[Demo] Data Import Pipeline — Failed',
    summary: 'Demo task showing a failed workflow with error chain',
    status: 'failed',
    taskType: 'flow',
    tags: ['demo', 'execution-summary'],
  });
  const failedId = failedTask._id || failedTask.data?._id;
  await patchTask(failedId, {
    executionSummary: {
      outcome: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 95_200,
      trigger: {
        source: 'workflow: Data Import Pipeline',
        inputSummary: 'sourceUrl, format, targetCollection',
      },
      steps: [
        {
          stepName: 'Download Source Data',
          stepType: 'external',
          outcome: 'success',
          summary: 'Downloaded 2.4MB CSV from source',
          durationMs: 3_200,
        },
        {
          stepName: 'Validate Schema',
          stepType: 'code',
          outcome: 'success',
          summary: 'Schema matches expected format (12 columns)',
          durationMs: 450,
        },
        {
          stepName: 'Transform Records',
          stepType: 'agent',
          outcome: 'success',
          summary: 'Transformed 1,847 records, mapped 3 custom fields',
          durationMs: 28_600,
        },
        {
          stepName: 'Run Enrichment Subflow',
          stepType: 'flow',
          outcome: 'failed',
          error: 'Subflow failed: Geocoding API returned 429 Too Many Requests',
          durationMs: 62_950,
        },
      ],
      childFlowSummaries: [
        {
          taskId: 'demo-child-1',
          title: 'Enrichment Subflow',
          workflowName: 'Record Enrichment Pipeline',
          outcome: 'failed',
          summary: '2/4 steps succeeded, 1 failed',
          error: 'Geocoding API returned 429 Too Many Requests after 847 calls',
        },
      ],
      errorChain: [
        {
          stepName: 'Geocode Addresses',
          error: 'Geocoding API returned 429 Too Many Requests after 847 of 1847 records',
          taskId: 'demo-geocode-task',
        },
        {
          stepName: 'Run Enrichment Subflow',
          error: 'Subflow "Record Enrichment Pipeline" failed at step "Geocode Addresses"',
          taskId: 'demo-enrichment-flow',
        },
      ],
    },
  });
  console.log(`  Created: ${failedTask.title || failedId}`);

  // 3. Foreach parent task with batch stats
  const foreachTask = await createTask({
    title: '[Demo] Process Invoice Batch — Partial Success',
    summary: 'Demo task showing foreach batch processing stats',
    status: 'completed',
    taskType: 'foreach',
    tags: ['demo', 'execution-summary'],
  });
  const foreachId = foreachTask._id || foreachTask.data?._id;
  await patchTask(foreachId, {
    executionSummary: {
      outcome: 'partial',
      completedAt: new Date().toISOString(),
      durationMs: 184_500,
      stats: {
        total: 25,
        succeeded: 22,
        failed: 2,
        skipped: 1,
      },
      errorChain: [
        {
          stepName: 'Invoice #INV-2024-0847',
          error: 'PDF parsing failed: corrupt file header',
          taskId: 'demo-invoice-847',
        },
        {
          stepName: 'Invoice #INV-2024-0913',
          error: 'Vendor lookup failed: no matching vendor for code "VND-UNKNOWN"',
          taskId: 'demo-invoice-913',
        },
      ],
    },
  });
  console.log(`  Created: ${foreachTask.title || foreachId}`);

  // 4. Successful task with child subflow summaries
  const multiFlowTask = await createTask({
    title: '[Demo] Multi-Region Deploy — All Regions OK',
    summary: 'Demo task showing nested subflow summaries',
    status: 'completed',
    taskType: 'flow',
    tags: ['demo', 'execution-summary'],
  });
  const multiFlowId = multiFlowTask._id || multiFlowTask.data?._id;
  await patchTask(multiFlowId, {
    executionSummary: {
      outcome: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 312_000,
      trigger: {
        source: 'workflow: Multi-Region Deploy',
        inputSummary: 'version, regions, rollbackOnFailure',
      },
      steps: [
        {
          stepName: 'Build Artifacts',
          stepType: 'agent',
          outcome: 'success',
          summary: 'Built v2.4.1 artifacts (Docker image + helm chart)',
          durationMs: 45_000,
        },
        {
          stepName: 'Deploy US-East',
          stepType: 'flow',
          outcome: 'success',
          summary: '3/3 steps succeeded',
          durationMs: 89_000,
        },
        {
          stepName: 'Deploy EU-West',
          stepType: 'flow',
          outcome: 'success',
          summary: '3/3 steps succeeded',
          durationMs: 92_000,
        },
        {
          stepName: 'Deploy AP-Southeast',
          stepType: 'flow',
          outcome: 'success',
          summary: '3/3 steps succeeded',
          durationMs: 86_000,
        },
      ],
      childFlowSummaries: [
        {
          taskId: 'demo-us-east',
          title: 'Deploy US-East',
          workflowName: 'Region Deploy',
          outcome: 'success',
          summary: '3/3 steps succeeded',
        },
        {
          taskId: 'demo-eu-west',
          title: 'Deploy EU-West',
          workflowName: 'Region Deploy',
          outcome: 'success',
          summary: '3/3 steps succeeded',
        },
        {
          taskId: 'demo-ap-southeast',
          title: 'Deploy AP-Southeast',
          workflowName: 'Region Deploy',
          outcome: 'success',
          summary: '3/3 steps succeeded',
        },
      ],
    },
  });
  console.log(`  Created: ${multiFlowTask.title || multiFlowId}`);

  console.log('\nDone! Search for tag "demo" or "execution-summary" in the UI to find these tasks.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
