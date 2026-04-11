#!/usr/bin/env node
/**
 * Deploy Workflows Script
 *
 * Creates prompt documents and workflows via API.
 * Supports both local dev and production environments.
 *
 * Usage:
 *   node scripts/workflows/deploy-workflows.mjs --env local
 *   node scripts/workflows/deploy-workflows.mjs --env production
 *   node scripts/workflows/deploy-workflows.mjs --env local --dry-run
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow wc  # Only Workflow Creation
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow mc  # Only Multi-Model Creation
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow dc  # Only Document Creation
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow tc  # Only Text Competition
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow mr  # Only Message Refinement
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow da  # Only AI Document Assistant
 *   node scripts/workflows/deploy-workflows.mjs --env local --workflow wa  # Only AI Workflow Assistant
 */

const args = process.argv.slice(2);
const envArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'local';
const dryRun = args.includes('--dry-run');
const workflowFilter = args.includes('--workflow') ? args[args.indexOf('--workflow') + 1] : null;

const ENV_CONFIG = {
  local: {
    apiUrl: process.env.API_URL || 'http://localhost:3102',
    apiKey: 'cm_ak_live_caf69284c216f8b0f51f2f20d925544c26d50c126475f18c2d1a560238c05ce4',
  },
  production: {
    apiUrl: 'https://cm.hcizero.com',
    apiKey: 'cm_ak_8b71172bb2fb058f8c603391978345658b2ba450ae27e6d2eed2813f146733c6',
  },
};

const config = ENV_CONFIG[envArg];
if (!config) {
  console.error(`Unknown env: ${envArg}. Use 'local' or 'production'.`);
  process.exit(1);
}

console.log(`\n🔧 Deploying workflows to ${envArg} (${config.apiUrl})`);
if (dryRun) console.log('  DRY RUN - no changes will be made\n');

// =============================================================================
// API helpers
// =============================================================================

async function api(method, path, body) {
  const url = `${config.apiUrl}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`${method} ${path} => ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function createDocument(doc) {
  if (dryRun) {
    console.log(`  [DRY] Would create document: ${doc.title}`);
    return { _id: 'dry-run-id-' + doc.title.replace(/\s+/g, '-').toLowerCase() };
  }
  const result = await api('POST', '/api/documents', doc);
  console.log(`  Created document: ${doc.title} => ${result.data._id}`);
  return result.data;
}

async function createWorkflow(workflow) {
  if (dryRun) {
    console.log(`  [DRY] Would create workflow: ${workflow.name} (${workflow.steps.length} steps)`);
    return { _id: 'dry-run-workflow-id' };
  }
  const result = await api('POST', '/api/workflows', workflow);
  console.log(`  Created workflow: ${workflow.name} => ${result.data._id}`);
  return result.data;
}

async function deactivateWorkflow(id) {
  if (dryRun) {
    console.log(`  [DRY] Would deactivate workflow: ${id}`);
    return;
  }
  await api('PATCH', `/api/workflows/${id}`, { isActive: false });
  console.log(`  Deactivated workflow: ${id}`);
}

// =============================================================================
// Prompt Document Definitions
// =============================================================================

// NOTE: These prompts use {{agent.*}} dynamic resolution instead of hardcoded IDs.
// Agents are resolved at runtime by querying active agents by complexity or tag.

const WC_PROMPT_DOCS = [
  {
    title: 'WC: Workflow Design System Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'design', 'opus'],
    content: `You are a workflow architect. Your job is to design workflows for the Coordination Matrix system based on a user's description of what they want automated.

## Step Types

There are 11 step types you can use:

1. **trigger** — Optional entry point. Workflows can start directly with any step type.
2. **agent** — Executes a task assigned to an AI agent. Set defaultAssigneeId to a dynamic reference like {{agent.complexity.3}} or {{agent.tag.api-integration}}.
3. **manual** — Creates a task for a human to complete. The workflow pauses until the human marks it done (Approve, Approve with Notes, or Request Changes).
4. **external** — Calls an external HTTP API and waits for a callback response.
5. **webhook** — Outbound HTTP call (fire-and-forget or await response, no callback required). Configure with webhookConfig: { url, method, headers, bodyTemplate }.
6. **decision** — Routes the workflow based on a field value. Set decisionField and connections array with conditions.
7. **foreach** — Fan-out: creates parallel child tasks for each item in an array. Set itemsPath, itemVariable, maxItems.
8. **join** — Fan-in: waits for all parallel tasks from a foreach to complete. Set awaitStepId to the foreach step's ID.
9. **flow** — Triggers another workflow as a sub-workflow.
10. **code** — Executes JavaScript code in a sandboxed environment. Has access to _stepLog, _workflowRunId, and 35+ npm packages.
11. **findDocument** — Searches the document store using semantic search or static ID lookup.

## Template Variable Syntax

- **{{input.field}}** — Access the current step's input / workflow input payload
- **{{steps.stepId.output.result.field}}** — Access output from a previous step
- **{{trigger.payload.field}}** — Access original trigger payload
- **{{variables.packageName.key}}** — Access stored variable packages
- **{{agent.complexity.N}}** — Dynamically resolve agent by complexity level (1/2/3)
- **{{agent.tag.TAG}}** — Dynamically resolve agent by capability tag
- **{{agent.name.NAME}}** — Dynamically resolve agent by display name
- **{{_apiUrl}}** — The API base URL (resolved at runtime)
- **{{_apiKey}}** — The API key (resolved at runtime)
- **{{_workflowRunId}}** — The current workflow run ID
- **{{item}}** / **{{customVar}}** — Current item in a foreach iteration
- **{{_index}}** — Current iteration index (0-based)
- **{{_total}}** — Total number of items

## Agent Assignment

Agent IDs are resolved dynamically at runtime — no hardcoded IDs or variable packages needed:
- **{{agent.complexity.3}}** — Advanced agents (opus-class): complex reasoning, design, writing, analysis
- **{{agent.complexity.2}}** — Intermediate agents (sonnet-class): balanced tasks
- **{{agent.complexity.1}}** — Basic agents (haiku-class): fast triage, simple reviews, classification
- **{{agent.tag.api-integration}}** — Agents tagged for API calls, code execution, tool use
- **{{agent.tag.code-review}}** — Agents tagged for code review
- **{{agent.name.Agent Name}}** — Specific agent by display name (case-insensitive)

When agents are added or removed, workflows automatically pick up the right agent. Never hardcode agent ObjectIds.

## Connection & Routing Rules

- Steps without connections follow implicit linear flow (array order).
- Use explicit connections array for non-linear flows.
- Decision steps require connections with conditions and a defaultConnection for fallback.
- Steps with no connections and no next step in array are terminal.

## Best Practices

1. Use descriptive step IDs (e.g., "design-workflow", not "step1")
2. Keep detailed prompts in documents, use additionalInstructions for brief context
3. Use decision steps for conditional routing
4. Include review/validation before critical operations
5. Use foreach/join for parallel processing
6. Never hardcode agent IDs — use {{agent.complexity.N}} or {{agent.tag.TAG}} for dynamic resolution

## Output Format

Output valid JSON:
\`\`\`json
{
  "workflow": { "name": "...", "description": "...", "steps": [...] },
  "promptDocuments": [{ "title": "...", "content": "...", "type": "workflow-prompt", "status": "approved" }]
}
\`\`\`

Use PROMPT:title placeholder references in promptDocumentIds.`,
  },
  {
    title: 'WC: Review Checklist',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'review', 'haiku'],
    content: `You are a workflow quality reviewer. Systematically validate a workflow JSON definition and its prompt documents.

## Review Checklist

### Step Integrity
- [ ] All step IDs are unique
- [ ] Every step has a valid stepType
- [ ] Every step has name and description

### Connection Validity
- [ ] Every connection targetStepId references an existing step
- [ ] No orphaned/unreachable steps
- [ ] Decision steps have conditions and defaultConnection

### Foreach / Join
- [ ] Every foreach has itemsPath
- [ ] Every foreach has a matching join with correct awaitStepId
- [ ] Foreach children have explicit connections when needed for visual clarity

### Template Variables
- [ ] All {{...}} use correct syntax
- [ ] Variable paths reference existing steps
- [ ] Agent IDs use {{agent.*}} dynamic resolution, not hardcoded values

### Agent Steps
- [ ] Every agent step has defaultAssigneeId using a variable reference
- [ ] Every agent step has promptDocumentIds or additionalInstructions

### Code Steps
- [ ] codeConfig.code is defined and syntactically valid

### Webhook Steps
- [ ] webhookConfig has url, method, and bodyTemplate

## Output Format

\`\`\`json
{
  "verdict": "pass" | "fail",
  "issues": [{ "stepId": "...", "issue": "...", "severity": "error" | "warning" }],
  "suggestions": ["..."]
}
\`\`\``,
  },
  {
    title: 'WC: Edit Instructions',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'edit', 'opus'],
    content: `You are a workflow editor. You receive a workflow definition with its prompt documents and a list of issues found during review. Fix every issue while maintaining the overall workflow structure.

## Instructions

1. Read the review feedback carefully. Address every error-severity issue.
2. Fix issues systematically — connections, configs, template variables, prompt references.
3. Preserve the workflow's intent. Make minimal, targeted changes.
4. After fixing, self-check: unique IDs, valid connections, correct template vars, matched prompts.
5. Apply easy improvement suggestions from the review.

## Output

Output the corrected JSON with ALL steps and ALL prompt documents (not just changed ones):
\`\`\`json
{
  "workflow": { ... },
  "promptDocuments": [ ... ]
}
\`\`\``,
  },
  {
    title: 'WC: Create Prompt Documents via API',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'api', 'ace'],
    content: `You are an API integration agent. Create prompt documents via the Coordination Matrix API and return the mapping of titles to IDs.

## API Details

- Base URL: {{_apiUrl}}
- Auth: X-API-Key: {{_apiKey}}
- Endpoint: POST /api/documents
- Body: { "title": "...", "content": "...", "type": "workflow-prompt", "status": "approved", "tags": [...] }

## Instructions

1. Read the promptDocuments array from the previous step's output.
2. For each document, POST to /api/documents.
3. Collect the returned _id for each document.
4. Return a mapping: { "PROMPT:Title": "actual-id", ... }

## Output Format

\`\`\`json
{
  "status": "SUCCESS",
  "promptIdMapping": {
    "PROMPT:Doc Title 1": "abc123",
    "PROMPT:Doc Title 2": "def456"
  },
  "documentsCreated": 7
}
\`\`\``,
  },
  {
    title: 'WC: Create & Validate Workflow via API',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'api', 'ace'],
    content: `You are an API integration agent. Create a workflow via the Coordination Matrix API and verify it was created correctly.

## API Details

- Base URL: {{_apiUrl}}
- Auth: X-API-Key: {{_apiKey}}
- Create: POST /api/workflows (body: the workflow JSON object)
- Verify: GET /api/workflows/:id

## Instructions

1. Get the workflow definition from the design step's output.
2. Get the prompt ID mapping from the create-prompts step's output.
3. Replace all PROMPT: references in promptDocumentIds with actual document IDs.
4. POST the workflow to /api/workflows.
5. GET the created workflow to verify all steps were saved.
6. Check: step count matches, all connections valid, no validation errors.

## Output Format

\`\`\`json
{
  "verdict": "pass" | "fail",
  "workflowId": "created-workflow-id",
  "stepCount": 15,
  "validationErrors": [],
  "summary": "Workflow created and verified successfully."
}
\`\`\``,
  },
  {
    title: 'WC: Fix Validation Issues',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'fix', 'opus'],
    content: `You are a workflow debugging specialist. A workflow failed API validation. Fix the issues and return the corrected definition.

## Common Issues

- Invalid step types
- Missing required fields (codeConfig for code steps, etc.)
- Connection references to non-existent steps
- Template variable syntax errors
- Schema validation failures on inputSchema/samplePayload

## Instructions

1. Read the validation errors from the create step's output.
2. Read the original workflow definition.
3. Fix each validation error.
4. Return the complete corrected workflow JSON.
5. Also return the updated promptDocuments if any prompt references changed.

## Output Format

\`\`\`json
{
  "workflow": { ... corrected ... },
  "promptDocuments": [ ... if changed ... ],
  "fixesSummary": ["Fixed X", "Fixed Y"]
}
\`\`\``,
  },
  {
    title: 'WC: Apply Human Feedback',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'feedback', 'opus'],
    content: `You are a workflow editor incorporating human reviewer feedback. A human has reviewed the designed workflow and provided comments/changes.

## Instructions

1. Read the human's review comments and specific change requests.
2. Apply each requested change to the workflow definition and/or prompt documents.
3. Maintain consistency — if a step is renamed, update all references.
4. If the feedback is ambiguous, make the most reasonable interpretation.
5. Return the complete updated workflow and prompt documents.

## Output

\`\`\`json
{
  "workflow": { ... updated ... },
  "promptDocuments": [ ... updated ... ],
  "changesSummary": ["Applied change X", "Applied change Y"]
}
\`\`\``,
  },
];

const MC_PROMPT_DOCS = [
  {
    title: 'MC: Model Creation Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'creation'],
    content: `# Model Creation Prompt

You are one of 3 models working independently on the same creative brief. Each model has a distinct role and style.

**Your Role:** {{model.role}}
**Your Style:** {{model.style}}
**Model Name:** {{model.modelName}}

## Brief

{{input.idea}}

**Output Type:** {{input.outputType}}
**Title:** {{input.title}}
**Constraints:** {{input.constraints}}

## Instructions

1. Create your version independently — do NOT try to guess what other models will produce.
2. Stay true to your assigned style throughout.
3. Produce a complete, high-quality artifact.
4. Include a brief note about your approach and stylistic choices.

## Output Format

\`\`\`json
{
  "modelName": "your-model-name",
  "version": "your complete artifact text here",
  "approach": "Brief description of your approach and stylistic choices",
  "confidence": 0.0-1.0
}
\`\`\``,
  },
  {
    title: 'MC: Judge Evaluation Criteria',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'judge'],
    content: `# Judge Evaluation Criteria

You are the judge evaluating multiple independently-created versions of an artifact.

## Scoring Criteria (1-10 each)

1. **Relevance** — Does it address the brief?
2. **Quality** — Is it well-crafted?
3. **Creativity** — Is it original and engaging?
4. **Completeness** — Is it thorough?
5. **Style Adherence** — Does it maintain its stated style?
6. **Usability** — Is it practical and actionable?

## Instructions

1. Evaluate each version against all criteria.
2. Note specific strengths and weaknesses.
3. Identify areas where models could learn from each other.
4. Provide synthesis guidance — what elements from each should be combined.

## Output Format

\`\`\`json
{
  "evaluations": [
    {
      "modelName": "...",
      "scores": { "relevance": 8, "quality": 7, ... },
      "overallScore": 7.5,
      "strengths": ["..."],
      "weaknesses": ["..."],
      "elementsToKeep": ["..."]
    }
  ],
  "ranking": ["best-model", "second", "third"],
  "synthesisGuidance": "How to combine the best elements...",
  "moreDebateNeeded": true | false,
  "debateReason": "Why more rounds would help (if applicable)"
}
\`\`\``,
  },
  {
    title: 'MC: Model Debate/Revision Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'debate'],
    content: `# Model Debate/Revision Prompt

You are revising your version based on the judge's feedback. This is a debate round where you improve while maintaining your unique voice.

**Your Role:** {{model.role}}
**Your Style:** {{model.style}}
**Model Name:** {{model.modelName}}

## Judge's Feedback for You

Review the judge's evaluation of your version and the synthesis guidance.

## Other Models' Work

You can see what the other models produced. Learn from their strengths without copying their style.

## Instructions

1. Address the judge's specific criticisms of your version.
2. Incorporate elements from other models' work that would strengthen yours.
3. Maintain your distinct style and voice.
4. Explain what you changed and why.

## Output Format

\`\`\`json
{
  "modelName": "your-model-name",
  "revisedVersion": "your improved artifact text here",
  "changesFromPrevious": ["Changed X because...", "Incorporated Y from model Z"],
  "confidence": 0.0-1.0
}
\`\`\``,
  },
  {
    title: 'MC: Debate Round Judge Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'judge', 'debate'],
    content: `# Debate Round Judge Prompt

You are evaluating the revised versions from a debate round. Each model has revised its work based on your previous feedback.

## Instructions

1. Re-evaluate each version using the same criteria (relevance, quality, creativity, completeness, style, usability).
2. Track improvement from the previous round.
3. Assess convergence — are the versions becoming more similar or maintaining diversity?
4. Determine if another debate round would be productive or if we've reached diminishing returns.

## Output Format

\`\`\`json
{
  "evaluations": [
    {
      "modelName": "...",
      "scores": { "relevance": 9, "quality": 8, ... },
      "overallScore": 8.5,
      "improvementFromPrevious": "+1.0",
      "strengths": ["..."],
      "remainingWeaknesses": ["..."]
    }
  ],
  "ranking": ["best-model", "second", "third"],
  "convergenceAnalysis": "How the versions evolved...",
  "synthesisGuidance": "Updated guidance for combining the best elements...",
  "moreDebateNeeded": true | false,
  "debateReason": "Why another round would/wouldn't help"
}
\`\`\``,
  },
  {
    title: 'MC: Synthesis Instructions',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'synthesis'],
    content: `# Synthesis Instructions

You are creating the definitive final version by combining the best elements from all models.

## Available Context

- All model versions (initial and revised)
- All judge evaluations
- Synthesis guidance from the judge

## Instructions

1. Select the strongest base version (typically the top-ranked one).
2. Merge in the best elements from other versions as identified by the judge.
3. Polish the combined result for consistency and flow.
4. Ensure the final version exceeds any individual version in quality.
5. Note what was taken from each model.

## Output Format

\`\`\`json
{
  "finalVersion": "The complete synthesized artifact text",
  "baseModel": "which model's version was used as the base",
  "incorporatedElements": [
    { "from": "model-name", "element": "what was taken", "where": "where it was integrated" }
  ],
  "qualityAssessment": "Brief self-assessment of the final version",
  "confidence": 0.0-1.0
}
\`\`\``,
  },
  {
    title: 'MC: Targeted Edit Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['multi-model', 'edit'],
    content: `# Targeted Edit Prompt

You are applying specific human feedback to the synthesized version of an artifact.

## Instructions

1. Read the human's specific change requests carefully.
2. Apply ONLY the requested changes — do not restructure or rewrite unrelated sections.
3. Maintain the overall quality and consistency of the artifact.
4. Explain what was changed.

## Output Format

\`\`\`json
{
  "editedVersion": "The updated artifact text with changes applied",
  "changesApplied": ["Changed X as requested", "Updated Y per feedback"],
  "confidence": 0.0-1.0
}
\`\`\``,
  },
];

// =============================================================================
// Workflow Definitions
// =============================================================================

function buildWorkflowCreation(promptDocIds) {
  return {
    name: 'Workflow Creation',
    description: 'Receives an idea for a workflow, designs it with Opus, reviews with Haiku, creates via API with Ace Agent, gets human approval, and activates.',
    isActive: true,
    color: '#6366f1',
    inputSchema: {
      type: 'object',
      properties: {
        idea: { type: 'string', description: 'What the workflow should do' },
        workflowName: { type: 'string', description: 'Desired name for the workflow' },
        constraints: { type: 'string', description: 'Any constraints or requirements' },
      },
      required: ['idea'],
    },
    samplePayload: {
      idea: 'Create a workflow that takes a blog post topic, generates 3 drafts, reviews them, and picks the best one.',
      workflowName: 'Blog Post Generator',
      constraints: 'Max 5 steps, use Opus for generation and Haiku for review.',
    },
    rootTaskTitleTemplate: 'WF Create: {{input.idea}}',
    steps: [
      {
        id: 'design-workflow',
        name: 'Design Workflow',
        stepType: 'agent',
        description: 'Opus designs the workflow JSON and prompt documents based on the idea.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WC: Workflow Design System Prompt']],
        additionalInstructions: 'Design a complete workflow for this idea: {{input.idea}}\n\nDesired name: {{input.workflowName}}\nConstraints: {{input.constraints}}',
        connections: [{ targetStepId: 'review-design' }],
      },
      {
        id: 'review-design',
        name: 'Review Design',
        stepType: 'agent',
        description: 'Haiku validates the workflow structure against the review checklist.',
        defaultAssigneeId: '{{agent.complexity.1}}',
        promptDocumentIds: [promptDocIds['WC: Review Checklist']],
        connections: [{ targetStepId: 'review-loop-check' }],
      },
      {
        id: 'review-loop-check',
        name: 'Check Review Loops',
        stepType: 'code',
        description: 'Count review iterations to prevent infinite loops.',
        codeConfig: {
          code: `
            const reviewCount = (_stepLog || []).filter(e => e.stepId === 'review-design').length;
            const maxReviews = 5;
            const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
            const verdict = (prevVerdict === 'pass' || reviewCount >= maxReviews) ? 'pass' : prevVerdict || 'fail';
            return { verdict, reviewCount, maxReviews, capped: reviewCount >= maxReviews };
          `,
        },
        connections: [{ targetStepId: 'review-gate' }],
      },
      {
        id: 'review-gate',
        name: 'Review Passed?',
        stepType: 'decision',
        description: 'Route based on review verdict.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'create-prompts', condition: 'pass', label: 'Passed' },
          { targetStepId: 'edit-design', condition: 'fail', label: 'Failed' },
          { targetStepId: 'human-approval', condition: 'escalate', label: 'Escalate' },
        ],
        defaultConnection: 'human-approval',
      },
      {
        id: 'edit-design',
        name: 'Edit Design',
        stepType: 'agent',
        description: 'Opus fixes issues found during review.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WC: Edit Instructions']],
        connections: [{ targetStepId: 'review-design' }],
      },
      {
        id: 'create-prompts',
        name: 'Create Prompt Documents',
        stepType: 'agent',
        description: 'Ace Agent creates prompt documents via API.',
        defaultAssigneeId: '{{agent.tag.api-integration}}',
        promptDocumentIds: [promptDocIds['WC: Create Prompt Documents via API']],
        connections: [{ targetStepId: 'create-workflow-api' }],
      },
      {
        id: 'create-workflow-api',
        name: 'Create & Validate Workflow',
        stepType: 'agent',
        description: 'Ace Agent creates the workflow via API and verifies it.',
        defaultAssigneeId: '{{agent.tag.api-integration}}',
        promptDocumentIds: [promptDocIds['WC: Create & Validate Workflow via API']],
        connections: [{ targetStepId: 'validation-loop-check' }],
      },
      {
        id: 'validation-loop-check',
        name: 'Check Validation Loops',
        stepType: 'code',
        description: 'Count validation retries to prevent infinite loops.',
        codeConfig: {
          code: `
            const validationCount = (_stepLog || []).filter(e => e.stepId === 'create-workflow-api').length;
            const maxRetries = 3;
            const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
            const verdict = (prevVerdict === 'pass' || validationCount >= maxRetries) ? 'pass' : prevVerdict || 'fail';
            return { verdict, validationCount, maxRetries, capped: validationCount >= maxRetries };
          `,
        },
        connections: [{ targetStepId: 'validation-gate' }],
      },
      {
        id: 'validation-gate',
        name: 'Validation Passed?',
        stepType: 'decision',
        description: 'Route based on API validation result.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'human-approval', condition: 'pass', label: 'Passed' },
          { targetStepId: 'fix-validation', condition: 'fail', label: 'Failed' },
        ],
        defaultConnection: 'human-approval',
      },
      {
        id: 'fix-validation',
        name: 'Fix Validation Issues',
        stepType: 'agent',
        description: 'Opus fixes API validation errors.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WC: Fix Validation Issues']],
        connections: [{ targetStepId: 'create-prompts' }],
      },
      {
        id: 'human-approval',
        name: 'Human Approval',
        stepType: 'manual',
        description: 'Human reviews the designed workflow before activation.',
        additionalInstructions: 'Review the workflow that was designed and created. Check the step structure, prompt content, and overall flow. Approve to activate, request changes for modifications, or reject to discard.',
        connections: [{ targetStepId: 'approval-gate' }],
      },
      {
        id: 'approval-gate',
        name: 'Approved?',
        stepType: 'decision',
        description: 'Route based on human approval decision.',
        decisionField: 'reviewDecision',
        connections: [
          { targetStepId: 'finalize', condition: 'approved', label: 'Approved' },
          { targetStepId: 'finalize', condition: 'approved_with_notes', label: 'Approved' },
          { targetStepId: 'apply-feedback', condition: 'request_changes', label: 'Changes' },
        ],
        defaultConnection: 'finalize',
      },
      {
        id: 'apply-feedback',
        name: 'Apply Human Feedback',
        stepType: 'agent',
        description: 'Opus applies human feedback to the workflow.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WC: Apply Human Feedback']],
        connections: [{ targetStepId: 'create-prompts' }],
      },
      {
        id: 'finalize',
        name: 'Activate Workflow',
        stepType: 'code',
        description: 'Activate the created workflow via PATCH API call.',
        codeConfig: {
          code: `
            const workflowId = input.workflowId || (steps && steps['create-workflow-api'] && steps['create-workflow-api'].output && steps['create-workflow-api'].output.result && steps['create-workflow-api'].output.result.workflowId);
            if (!workflowId) return { status: 'SKIPPED', reason: 'No workflow ID found to activate' };
            try {
              const apiUrl = input._apiUrl || '{{_apiUrl}}';
              const apiKey = input._apiKey || '{{_apiKey}}';
              const res = await fetch(apiUrl + '/api/workflows/' + workflowId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                body: JSON.stringify({ isActive: true })
              });
              const data = await res.json();
              return { status: 'SUCCESS', workflowId, activated: true, response: data };
            } catch (err) {
              return { status: 'FAILED', error: err.message };
            }
          `,
          packages: ['node-fetch'],
        },
      },
    ],
  };
}

function buildMultiModelCreation(promptDocIds) {
  return {
    name: 'Universal Multi-Model Creation',
    description: 'Creates any artifact using 3 parallel models with debate rounds, judge evaluation, synthesis, and human checkpoints.',
    isActive: true,
    color: '#8b5cf6',
    inputSchema: {
      type: 'object',
      properties: {
        idea: { type: 'string', description: 'What to create' },
        outputType: { type: 'string', description: 'Type of artifact: code, document, plan, design, analysis, blog, proposal, social, ad' },
        title: { type: 'string', description: 'Title for the artifact' },
        constraints: { type: 'string', description: 'Any constraints or requirements' },
        debateRounds: { type: 'number', description: 'Number of debate iterations (default: 2)' },
      },
      required: ['idea', 'outputType'],
    },
    samplePayload: {
      idea: 'Write a compelling blog post about the future of AI-assisted software development',
      outputType: 'blog',
      title: 'The AI Pair Programming Revolution',
      constraints: '1500-2000 words, engaging tone, include code examples',
      debateRounds: 2,
    },
    rootTaskTitleTemplate: 'MC: {{input.title}}',
    steps: [
      // Step 1: Setup — build the models config from variables
      {
        id: 'setup',
        name: 'Setup Models & Config',
        stepType: 'code',
        description: 'Build model configurations from variable packages.',
        codeConfig: {
          code: `
            const models = input.models || [
              { modelName: 'Depth', role: 'Comprehensive analytical model', style: 'thorough, detailed, structured' },
              { modelName: 'Concise', role: 'Practical efficient model', style: 'direct, actionable, minimal' },
              { modelName: 'Creative', role: 'Multi-perspective creative model', style: 'innovative, exploratory, varied' }
            ];
            const debateRounds = input.debateRounds || 2;
            return { models, debateRounds, modelCount: models.length };
          `,
        },
        connections: [{ targetStepId: 'human-brief' }],
      },
      // Step 2: Human refines the brief
      {
        id: 'human-brief',
        name: 'Refine Brief',
        stepType: 'manual',
        description: 'Human reviews and refines the creative brief before models start.',
        additionalInstructions: 'Review the creative brief before it goes to the models.\n\nIdea: {{input.idea}}\nOutput Type: {{input.outputType}}\nTitle: {{input.title}}\nConstraints: {{input.constraints}}\n\nApprove to proceed, or add notes to refine the brief.',
        connections: [{ targetStepId: 'fanout-create' }],
      },
      // Step 3: Fan out to 3 models
      {
        id: 'fanout-create',
        name: 'Fan Out to Models',
        stepType: 'foreach',
        description: 'Create parallel tasks for each model.',
        inputConfig: { source: 'setup' },
        itemsPath: 'output.models',
        itemVariable: 'model',
        maxItems: 10,
        connections: [{ targetStepId: 'model-create' }],
      },
      // Step 4: Each model creates its version
      {
        id: 'model-create',
        name: 'Create Version',
        stepType: 'agent',
        description: 'Each model independently creates its version of the artifact.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Model Creation Prompt']],
        connections: [{ targetStepId: 'join-initial' }],
      },
      // Step 5: Join initial versions
      {
        id: 'join-initial',
        name: 'Collect Initial Versions',
        stepType: 'join',
        description: 'Wait for all models to complete their initial versions.',
        awaitStepId: 'fanout-create',
        joinBoundary: { minPercent: 100, maxWaitMs: 600000, failOnTimeout: false },
        connections: [{ targetStepId: 'judge-evaluate' }],
      },
      // Step 6: Judge evaluates all versions
      {
        id: 'judge-evaluate',
        name: 'Judge: Evaluate Versions',
        stepType: 'agent',
        description: 'Judge evaluates and scores all initial versions.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Judge Evaluation Criteria']],
        connections: [{ targetStepId: 'debate-count' }],
      },
      // Step 7: Count debate rounds
      {
        id: 'debate-count',
        name: 'Count Debate Rounds',
        stepType: 'code',
        description: 'Check if more debate rounds are needed.',
        codeConfig: {
          code: `
            const debatesDone = (_stepLog || []).filter(e => e.stepId === 'judge-debate').length;
            const maxRounds = (trigger && trigger.debateRounds) || 2;
            const moreDebate = debatesDone < maxRounds;
            return { verdict: moreDebate ? 'more' : 'done', debatesDone, maxRounds };
          `,
        },
        connections: [{ targetStepId: 'debate-gate' }],
      },
      // Step 8: Decision — more debate or synthesize
      {
        id: 'debate-gate',
        name: 'More Debate?',
        stepType: 'decision',
        description: 'Route to more debate rounds or synthesis.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'fanout-debate', condition: 'more', label: 'More Debate' },
          { targetStepId: 'synthesize', condition: 'done', label: 'Synthesize' },
        ],
        defaultConnection: 'synthesize',
      },
      // Step 9: Fan out debate round
      {
        id: 'fanout-debate',
        name: 'Fan Out Debate Round',
        stepType: 'foreach',
        description: 'Each model revises based on judge feedback.',
        inputConfig: { source: 'setup' },
        itemsPath: 'output.models',
        itemVariable: 'model',
        maxItems: 10,
        connections: [{ targetStepId: 'model-revise' }],
      },
      // Step 10: Each model revises
      {
        id: 'model-revise',
        name: 'Revise Version',
        stepType: 'agent',
        description: 'Each model revises its version based on judge feedback and other models\' work.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Model Debate/Revision Prompt']],
        connections: [{ targetStepId: 'join-debate' }],
      },
      // Step 11: Join debate round
      {
        id: 'join-debate',
        name: 'Collect Revised Versions',
        stepType: 'join',
        description: 'Wait for all models to complete revisions.',
        awaitStepId: 'fanout-debate',
        joinBoundary: { minPercent: 100, maxWaitMs: 600000, failOnTimeout: false },
        connections: [{ targetStepId: 'judge-debate' }],
      },
      // Step 12: Judge evaluates debate round
      {
        id: 'judge-debate',
        name: 'Judge: Debate Round',
        stepType: 'agent',
        description: 'Judge evaluates the revised versions and tracks improvement.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Debate Round Judge Prompt']],
        connections: [{ targetStepId: 'debate-loop-count' }],
      },
      // Step 13: Count debate loop
      {
        id: 'debate-loop-count',
        name: 'Check Debate Loop',
        stepType: 'code',
        description: 'Check debate round count for looping.',
        codeConfig: {
          code: `
            const debatesDone = (_stepLog || []).filter(e => e.stepId === 'judge-debate').length;
            const maxRounds = (trigger && trigger.debateRounds) || 2;
            const moreDebate = debatesDone < maxRounds;
            return { verdict: moreDebate ? 'more' : 'done', debatesDone, maxRounds };
          `,
        },
        connections: [{ targetStepId: 'debate-loop-gate' }],
      },
      // Step 14: Decision — continue debate or synthesize
      {
        id: 'debate-loop-gate',
        name: 'Continue Debate?',
        stepType: 'decision',
        description: 'Route to more debate or synthesis.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'fanout-debate', condition: 'more', label: 'Another Round' },
          { targetStepId: 'synthesize', condition: 'done', label: 'Synthesize' },
        ],
        defaultConnection: 'synthesize',
      },
      // Step 15: Synthesize
      {
        id: 'synthesize',
        name: 'Synthesize Final',
        stepType: 'agent',
        description: 'Combine the best elements from all models into a final version.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Synthesis Instructions']],
        connections: [{ targetStepId: 'save-draft' }],
      },
      // Step 16: Save as draft document via webhook
      {
        id: 'save-draft',
        name: 'Save as Draft Document',
        stepType: 'webhook',
        description: 'Save the synthesized output as a draft document via API.',
        webhookConfig: {
          url: '{{_apiUrl}}/api/documents',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': '{{_apiKey}}',
          },
          bodyTemplate: JSON.stringify({
            title: '{{input.title}}',
            content: '{{steps.synthesize.output.result.finalVersion}}',
            type: 'reference',
            status: 'draft',
            tags: ['multi-model', '{{input.outputType}}'],
          }),
        },
        connections: [{ targetStepId: 'human-review' }],
      },
      // Step 17: Human review
      {
        id: 'human-review',
        name: 'Human Review',
        stepType: 'manual',
        description: 'Human reviews the synthesized final version.',
        additionalInstructions: 'Review the synthesized artifact.\n\nOriginal Brief: {{input.idea}}\nOutput Type: {{input.outputType}}\n\nApprove to promote the document, add notes for minor adjustments, or request changes for substantial revisions.',
        connections: [{ targetStepId: 'review-gate' }],
      },
      // Step 18: Human verdict
      {
        id: 'review-gate',
        name: 'Human Verdict?',
        stepType: 'decision',
        description: 'Route based on human review decision.',
        decisionField: 'reviewDecision',
        connections: [
          { targetStepId: 'promote-document', condition: 'approved', label: 'Approved' },
          { targetStepId: 'promote-document', condition: 'approved_with_notes', label: 'Approved' },
          { targetStepId: 'targeted-edit', condition: 'request_changes', label: 'Changes' },
        ],
        defaultConnection: 'promote-document',
      },
      // Step 19: Targeted edit
      {
        id: 'targeted-edit',
        name: 'Targeted Edit',
        stepType: 'agent',
        description: 'Apply specific human feedback to the synthesized version.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['MC: Targeted Edit Prompt']],
        connections: [{ targetStepId: 'edit-count' }],
      },
      // Step 20: Check edit loops
      {
        id: 'edit-count',
        name: 'Check Edit Loops',
        stepType: 'code',
        description: 'Count edit iterations to prevent infinite loops.',
        codeConfig: {
          code: `
            const editCount = (_stepLog || []).filter(e => e.stepId === 'targeted-edit').length;
            const maxEdits = 5;
            return { verdict: editCount >= maxEdits ? 'maxed' : 'review', editCount, maxEdits };
          `,
        },
        connections: [{ targetStepId: 'edit-gate' }],
      },
      // Step 21: Decision — more edits or force save
      {
        id: 'edit-gate',
        name: 'More Edits?',
        stepType: 'decision',
        description: 'Route to human review or force save.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'human-review', condition: 'review', label: 'Re-review' },
          { targetStepId: 'promote-document', condition: 'maxed', label: 'Max Edits' },
        ],
        defaultConnection: 'promote-document',
      },
      // Step 22: Promote document
      {
        id: 'promote-document',
        name: 'Promote Document',
        stepType: 'code',
        description: 'Promote the draft document to approved status.',
        codeConfig: {
          code: `
            // Find the document ID from the save-draft step output
            const saveOutput = steps && steps['save-draft'] && steps['save-draft'].output;
            const docId = saveOutput && saveOutput.result && saveOutput.result._id;
            if (!docId) return { status: 'SKIPPED', reason: 'No document ID found' };
            try {
              const res = await fetch('{{_apiUrl}}/api/documents/' + docId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': '{{_apiKey}}' },
                body: JSON.stringify({ status: 'approved' })
              });
              const data = await res.json();
              return { status: 'SUCCESS', documentId: docId, promoted: true };
            } catch (err) {
              return { status: 'FAILED', error: err.message };
            }
          `,
          packages: ['node-fetch'],
        },
      },
    ],
  };
}

// =============================================================================
// JSON-based Workflow Definitions (loaded from files)
// =============================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJsonWorkflow(filename) {
  const filePath = join(__dirname, filename);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// =============================================================================
// Main Deployment
// =============================================================================

async function main() {
  // Health check
  try {
    await api('GET', '/api/health');
    console.log('  API is healthy.\n');
  } catch (err) {
    console.error(`  API unreachable: ${err.message}`);
    process.exit(1);
  }

  const shouldDeployWC = !workflowFilter || workflowFilter === 'wc';
  const shouldDeployMC = !workflowFilter || workflowFilter === 'mc';
  const shouldDeployDC = !workflowFilter || workflowFilter === 'dc';
  const shouldDeployTC = !workflowFilter || workflowFilter === 'tc';
  const shouldDeployMR = !workflowFilter || workflowFilter === 'mr';
  const shouldDeployDA = !workflowFilter || workflowFilter === 'da';
  const shouldDeployWA = !workflowFilter || workflowFilter === 'wa';

  // ==========================================================================
  // Workflow 1: Workflow Creation
  // ==========================================================================
  if (shouldDeployWC) {
    console.log('=== Deploying Workflow 1: Workflow Creation ===\n');

    // Create prompt documents
    console.log('Creating WC prompt documents...');
    const wcDocIds = {};
    for (const doc of WC_PROMPT_DOCS) {
      const created = await createDocument(doc);
      wcDocIds[doc.title] = created._id;
    }
    console.log(`  Created ${Object.keys(wcDocIds).length} documents.\n`);

    // Create workflow
    console.log('Creating WC workflow...');
    const wf1 = buildWorkflowCreation(wcDocIds);
    const created1 = await createWorkflow(wf1);
    console.log(`  WC Workflow ID: ${created1._id}\n`);
  }

  // ==========================================================================
  // Workflow 2: Universal Multi-Model Creation
  // ==========================================================================
  if (shouldDeployMC) {
    console.log('=== Deploying Workflow 2: Universal Multi-Model Creation ===\n');

    // Create prompt documents
    console.log('Creating MC prompt documents...');
    const mcDocIds = {};
    for (const doc of MC_PROMPT_DOCS) {
      const created = await createDocument(doc);
      mcDocIds[doc.title] = created._id;
    }
    console.log(`  Created ${Object.keys(mcDocIds).length} documents.\n`);

    // Create workflow
    console.log('Creating MC workflow...');
    const wf2 = buildMultiModelCreation(mcDocIds);
    const created2 = await createWorkflow(wf2);
    console.log(`  MC Workflow ID: ${created2._id}\n`);
  }

  // ==========================================================================
  // Workflow 3: Document Creation (JSON-based)
  // ==========================================================================
  if (shouldDeployDC) {
    console.log('=== Deploying Workflow 3: Document Creation ===\n');
    const dc = loadJsonWorkflow('document-creation.json');
    const createdDC = await createWorkflow(dc);
    console.log(`  DC Workflow ID: ${createdDC._id}\n`);
  }

  // ==========================================================================
  // Workflow 4: Text Generation Competition (JSON-based)
  // ==========================================================================
  if (shouldDeployTC) {
    console.log('=== Deploying Workflow 4: Text Generation Competition ===\n');
    const tc = loadJsonWorkflow('text-competition.json');
    const createdTC = await createWorkflow(tc);
    console.log(`  TC Workflow ID: ${createdTC._id}\n`);
  }

  // ==========================================================================
  // Workflow 5: Iterative Message Refinement (JSON-based)
  // ==========================================================================
  if (shouldDeployMR) {
    console.log('=== Deploying Workflow 5: Iterative Message Refinement ===\n');
    const mr = loadJsonWorkflow('message-refinement.json');
    const createdMR = await createWorkflow(mr);
    console.log(`  MR Workflow ID: ${createdMR._id}\n`);
  }

  // ==========================================================================
  // Workflow 6: AI Document Assistant (JSON-based)
  // ==========================================================================
  if (shouldDeployDA) {
    console.log('=== Deploying Workflow 6: AI Document Assistant ===\n');
    const da = loadJsonWorkflow('ai-document-assistant.json');
    const createdDA = await createWorkflow(da);
    console.log(`  DA Workflow ID: ${createdDA._id}\n`);
  }

  // ==========================================================================
  // Workflow 7: AI Workflow Assistant (JSON-based)
  // ==========================================================================
  if (shouldDeployWA) {
    console.log('=== Deploying Workflow 7: AI Workflow Assistant ===\n');
    const wa = loadJsonWorkflow('ai-workflow-assistant.json');
    const createdWA = await createWorkflow(wa);
    console.log(`  WA Workflow ID: ${createdWA._id}\n`);
  }

  console.log('=== Deployment Complete ===\n');
}

main().catch(err => {
  console.error('Deployment failed:', err.message);
  process.exit(1);
});
