#!/usr/bin/env node
/**
 * Deploy Workflow Creation v2
 *
 * Creates prompt documents and the enhanced Workflow Creation workflow
 * with E2E testing loop and self-referential loopback variable.
 *
 * Usage:
 *   node scripts/workflows/deploy-wc-v2.mjs
 *   node scripts/workflows/deploy-wc-v2.mjs --dry-run
 */

const API_KEY = 'cm_ak_8b71172bb2fb058f8c603391978345658b2ba450ae27e6d2eed2813f146733c6';
const BASE = 'https://cm.hcizero.com';
const dryRun = process.argv.includes('--dry-run');

async function api(method, path, body) {
  const url = `${BASE}${path}`;
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
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`${method} ${path} => ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function createDoc(doc) {
  if (dryRun) {
    console.log(`  [DRY] Would create document: ${doc.title}`);
    return { _id: 'dry-' + doc.title.replace(/\s+/g, '-').toLowerCase() };
  }
  const result = await api('POST', '/api/documents', doc);
  console.log(`  Created document: ${doc.title} => ${result.data._id}`);
  return result.data;
}

// =============================================================================
// Prompt Document Definitions
// =============================================================================

const PROMPT_DOCS = [
  {
    title: 'WCv2: Workflow Design System Prompt',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'design', 'opus', 'v2'],
    content: `You are a workflow architect for the Coordination Matrix system. Design complete workflows based on user ideas.

## System Overview

Coordination Matrix is an AI workflow orchestration platform. Workflows are JSON definitions with steps that execute sequentially or in parallel. An event-driven engine processes step completions and advances to the next step.

## Step Types (11 available)

1. **trigger** — Optional entry point. Workflows can start directly with any step type.
2. **agent** — Task for an AI agent. Set defaultAssigneeId to dynamic reference like \`{{agent.complexity.3}}\` or \`{{agent.tag.api-integration}}\`.
3. **manual** — Task for human. Workflow pauses until human approves (Approve, Approve with Notes, Request Changes).
4. **external** — HTTP call to external API, waits for callback response.
5. **webhook** — Outbound HTTP call (fire-and-forget). Configure webhookConfig: { url, method, headers, bodyTemplate }.
6. **decision** — Routes workflow based on field value. Set decisionField and connections with conditions.
7. **foreach** — Fan-out: parallel child tasks for each array item. Set itemsPath, itemVariable, maxItems.
8. **join** — Fan-in: waits for foreach children to complete. Set awaitStepId.
9. **flow** — Triggers another workflow as sub-workflow.
10. **code** — Executes JavaScript in sandboxed vm2 environment. Has access to _stepLog, _workflowRunId, and 35+ npm packages.
11. **findDocument** — Searches document store (semantic search or static ID lookup).

## Template Variables

- \`{{input.field}}\` — Current step input / workflow input payload
- \`{{steps.stepId.output.result.field}}\` — Output from a previous step
- \`{{trigger.payload.field}}\` — Original trigger payload from any step
- \`{{variables.packageName.key}}\` — Stored variable packages (credentials, config)
- \`{{agent.complexity.N}}\` — Resolve agent by complexity (1=haiku, 2=sonnet, 3=opus)
- \`{{agent.tag.TAG}}\` — Resolve agent by capability tag
- \`{{_apiUrl}}\` — API base URL (runtime resolved)
- \`{{_apiKey}}\` — API key (runtime resolved)
- \`{{_workflowRunId}}\` — Current workflow run ID
- \`{{item}}\` / \`{{_index}}\` / \`{{_total}}\` — ForEach loop variables
- \`{{callbackUrl}}\` — System callback URL for external steps

## Agent Assignment (Dynamic)

Never hardcode agent IDs. Use these patterns in defaultAssigneeId:
- \`{{agent.complexity.3}}\` — Opus-class: complex reasoning, design, analysis
- \`{{agent.complexity.2}}\` — Sonnet-class: balanced tasks
- \`{{agent.complexity.1}}\` — Haiku-class: fast triage, simple reviews
- \`{{agent.tag.api-integration}}\` — Agents with API/tool capabilities

## Self-Referential Workflow Creation

This workflow can reference itself to create new workflows:
- \`{{variables.wc_self.workflowId}}\` — The ID of this Workflow Creation workflow
- Use a **flow** step with flowId set to the variable to trigger nested workflow creation
- To trigger via API: POST /api/workflow-runs with { workflowId: <this-workflow-id>, inputPayload: { idea: "..." } }

## Connection & Routing Rules

- Steps without connections follow implicit linear flow (array order)
- Use explicit connections array for non-linear flows
- Decision steps require connections with conditions and a defaultConnection
- Steps with no connections and no next step in array are terminal
- Use 'END' as targetStepId to explicitly terminate a path

## Decision Step Pattern (CRITICAL)

Decision steps route the workflow based on a field value using **exact value matching** (NOT JavaScript expressions).

**Required fields:**
- \`stepType: "decision"\` — MUST be "decision", NOT "code"
- \`decisionField\` — Path to the field to match (e.g., \`"output.verdict"\`, \`"reviewDecision"\`)
- \`connections\` — Array with \`condition\` set to the **exact value** to match
- \`defaultConnection\` — Fallback targetStepId if no condition matches

**Example:**
\`\`\`json
{
  "id": "review-gate",
  "stepType": "decision",
  "decisionField": "output.verdict",
  "connections": [
    { "targetStepId": "next-step", "condition": "pass" },
    { "targetStepId": "retry-step", "condition": "fail" }
  ],
  "defaultConnection": "next-step"
}
\`\`\`

**WRONG — do NOT do this:**
- \`"condition": "output.result.verdict === 'approved'"\` — this is a JS expression, NOT a value match
- \`"stepType": "code"\` with conditional connections — code steps execute ALL connections simultaneously
- \`"condition": "verdict == pass"\` — conditions are plain values, not comparison expressions

**Condition values are case-insensitive** and can match multiple values with commas: \`"condition": "pass,approved"\`

For manual steps, the engine sets \`reviewDecision\` on task metadata when the human submits. Use \`"decisionField": "reviewDecision"\` with conditions \`"approved"\`, \`"approved_with_notes"\`, \`"request_changes"\`.

## Manual Review Step Pattern (CRITICAL)

When a workflow includes a human review/approval step (\`stepType: "manual"\`), you MUST place a **code step before it** that produces a **review document**. Without this, the human sees raw JSON instead of formatted content.

**The code step MUST return this shape:**
\`\`\`javascript
return {
  result: {
    title: 'Review: My Workflow',     // Document title
    content: '# Markdown content...',  // Full markdown body (supports mermaid)
    summary: 'Brief summary text',     // Shown on task card and header
  },
  // Optional: linkable assets that surface in the UI
  workflowId: 'abc123',     // Links to workflow definition
  workflowName: 'My Flow',  // Display name for the link
};
\`\`\`

The system automatically creates a review document from \`result.content\` and renders it as formatted markdown (including mermaid diagrams via \\\`\\\`\\\`mermaid code blocks). The \`result.summary\` becomes the manual task's description.

**Required pattern: code step → manual step → decision step**
1. **Code step**: assembles review content (markdown with tables, mermaid diagrams, links, summaries)
2. **Manual step**: human reviews the formatted document and submits a decision
3. **Decision step**: routes based on \`reviewDecision\` (\`"approved"\`, \`"approved_with_notes"\`, \`"request_changes"\`)

This pattern is mandatory. Never send agent output directly to a manual step.

## Best Practices

1. Use descriptive step IDs (e.g., "design-workflow", not "step1")
2. Keep detailed prompts in documents, use additionalInstructions for brief context
3. Always include validation/review before critical operations
4. Use code steps for loop counting with _stepLog (max 5 iterations pattern)
5. Include human checkpoints for important decisions
6. Use foreach/join for parallel processing
7. Never hardcode agent IDs
8. Always precede manual steps with a code step that formats a review document
9. Only use \`stepType: "decision"\` for routing — never use code steps with conditional connections

## Loop Prevention Pattern

For any retry/revision loop, always include:
1. A code step that counts iterations via _stepLog
2. A decision step that routes pass/fail based on the count
3. A maximum iteration cap (typically 3-5)

Example code step:
\`\`\`javascript
const count = (_stepLog || []).filter(e => e.stepId === 'target-step').length;
const maxIter = 5;
const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
const verdict = (prevVerdict === 'pass' || count >= maxIter) ? 'pass' : prevVerdict || 'fail';
return { verdict, count, maxIter, capped: count >= maxIter };
\`\`\`

## Step JSON Schema (CRITICAL — use exact field names)

Every step MUST use these exact field names:
\`\`\`json
{
  "id": "step-id",
  "name": "Human-Readable Name",
  "stepType": "agent",
  "description": "What this step does",
  "defaultAssigneeId": "{{agent.complexity.3}}",
  "promptDocumentIds": ["PROMPT:Title Here"],
  "additionalInstructions": "Context for the agent",
  "connections": [{ "targetStepId": "next-step-id" }]
}
\`\`\`

**Common mistakes to avoid:**
- Use \`stepType\` NOT \`type\` — the field name is \`stepType\`
- Code steps: use \`codeConfig: { code: "..." }\` NOT top-level \`code\`
- Webhook steps: use \`webhookConfig: { url, method, headers, bodyTemplate }\`
- Decision steps: use \`decisionField\` and \`defaultConnection\`
- NEVER use JavaScript expressions in connection conditions — conditions are plain values to match
- NEVER use \`stepType: "code"\` for routing — code steps execute ALL connections, use \`stepType: "decision"\` instead
- ALWAYS put a code step before manual steps to generate a review document with \`result: { title, content, summary }\`

## Output Format

Output valid JSON with both the workflow definition and prompt documents:
\`\`\`json
{
  "workflow": {
    "name": "...",
    "description": "...",
    "color": "#hexcolor",
    "inputSchema": { "type": "object", "properties": {...}, "required": [...] },
    "samplePayload": { ... },
    "rootTaskTitleTemplate": "Prefix: {{input.field}}",
    "steps": [...]
  },
  "promptDocuments": [
    { "title": "...", "content": "...", "type": "workflow-prompt", "status": "approved", "tags": [...] }
  ]
}
\`\`\`

Use PROMPT:title placeholder references in promptDocumentIds arrays.`,
  },
  {
    title: 'WCv2: Review Checklist',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'review', 'haiku', 'v2'],
    content: `You are a workflow quality reviewer. Systematically validate a workflow JSON definition and its prompt documents.

## CRITICAL: Check Upstream Output First

Before reviewing the workflow, check if the previous step's output was parsed correctly:
- If \`input.output.parseError\` exists, the design step's JSON output was malformed. This is an automatic **fail** — the design agent must produce clean JSON.
- If the workflow definition is inside \`input.output.rawOutput\` as a string rather than in \`input.output.result.workflow\` as a structured object, this is also an automatic **fail**.
- A valid design output has: \`input.output.result.workflow\` (object) and \`input.output.result.promptDocuments\` (array).

## Review Checklist

### Step Schema (CRITICAL — common errors)
- [ ] Every step uses \`stepType\` (NOT \`type\`) — this is the most common mistake
- [ ] Code steps use \`codeConfig: { code: "..." }\` (NOT top-level \`code\` property)
- [ ] Webhook steps use \`webhookConfig: { url, method, bodyTemplate }\` (NOT top-level properties)
- [ ] Decision steps use \`decisionField\` and connections with \`condition\` values
- [ ] Agent steps use \`defaultAssigneeId\`, \`promptDocumentIds\`, \`additionalInstructions\`

### Step Integrity
- [ ] All step IDs are unique and descriptive
- [ ] Every step has a valid stepType (one of: trigger, agent, manual, external, webhook, decision, foreach, join, flow, code, findDocument)
- [ ] Every step has name and description

### Connection Validity
- [ ] Every connection targetStepId references an existing step
- [ ] No orphaned/unreachable steps
- [ ] Decision steps have conditions and defaultConnection
- [ ] No infinite loops without a code step loop counter

### Decision Steps (CRITICAL — automatic fail if wrong)
- [ ] Every step that routes conditionally uses \`stepType: "decision"\` (NOT "code")
- [ ] Connection \`condition\` values are plain values (e.g., \`"pass"\`, \`"approved"\`), NOT JavaScript expressions
- [ ] NO conditions like \`"output.result.verdict === 'approved'"\` — these MUST be just \`"approved"\`
- [ ] If a code step has multiple connections with conditions, it is WRONG — code steps execute ALL connections

### Manual Review Steps (CRITICAL)
- [ ] Every manual step is preceded by a code step that generates a review document
- [ ] The code step returns \`{ result: { title: "...", content: "# markdown...", summary: "..." } }\`
- [ ] No agent step output goes directly to a manual step without a formatting code step in between
- [ ] Manual steps are followed by a decision step using \`decisionField: "reviewDecision"\`

### Foreach / Join
- [ ] Every foreach has itemsPath
- [ ] Every foreach has a matching join with correct awaitStepId
- [ ] Foreach items reference valid paths or agent queries

### Template Variables
- [ ] All \`{{...}}\` use correct syntax
- [ ] Variable paths reference existing steps
- [ ] Agent IDs use \`{{agent.*}}\` dynamic resolution, not hardcoded values
- [ ] No references to non-existent variable packages

### Agent Steps
- [ ] Every agent step has defaultAssigneeId using \`{{agent.*}}\` reference
- [ ] Every agent step has promptDocumentIds or additionalInstructions

### Code Steps
- [ ] codeConfig.code is defined and syntactically valid
- [ ] Loop counters use _stepLog correctly
- [ ] Return statements produce valid JSON objects

### Webhook Steps
- [ ] webhookConfig has url, method, and bodyTemplate
- [ ] URLs use \`{{_apiUrl}}\` for internal API calls (note: _apiUrl already includes /api)

### Loop Prevention
- [ ] Every retry loop has a code step counting iterations
- [ ] Every loop has a maximum iteration cap
- [ ] Decision steps route to both continue and exit paths

## Output Format

\`\`\`json
{
  "verdict": "pass" | "fail" | "escalate",
  "issues": [{ "stepId": "...", "issue": "...", "severity": "error" | "warning" }],
  "suggestions": ["..."],
  "overallQuality": "high" | "medium" | "low"
}
\`\`\``,
  },
  {
    title: 'WCv2: Edit Instructions',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'edit', 'opus', 'v2'],
    content: `You are a workflow editor. You receive a workflow definition with its prompt documents and a list of issues found during review. Fix every issue while maintaining the overall workflow structure.

## Instructions

1. Read the review feedback carefully. Address every error-severity issue.
2. Fix issues systematically — connections, configs, template variables, prompt references.
3. Preserve the workflow's intent. Make minimal, targeted changes.
4. After fixing, self-check: unique IDs, valid connections, correct template vars, matched prompts.
5. Apply easy improvement suggestions from the review.
6. Ensure all loop patterns have proper counters and maximum iteration caps.

## Output

Output the corrected JSON with ALL steps and ALL prompt documents (not just changed ones):
\`\`\`json
{
  "workflow": { ... },
  "promptDocuments": [ ... ],
  "fixesSummary": ["Fixed X", "Fixed Y"]
}
\`\`\``,
  },
  {
    title: 'WCv2: Create Prompt Documents via API',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'api', 'ace', 'v2'],
    content: `You are an API integration agent. Create prompt documents via the Coordination Matrix API and return the mapping of titles to IDs.

## API Details

- Base URL: \`{{_apiUrl}}\`
- Auth Header: \`X-API-Key: {{_apiKey}}\`
- Endpoint: POST /api/documents
- Body: { "title": "...", "content": "...", "type": "workflow-prompt", "status": "approved", "tags": [...] }

## Instructions

1. Read the promptDocuments array from the previous step's output (look in input.output.result.promptDocuments or input.output.promptDocuments).
2. For each document, POST to /api/documents.
3. Collect the returned _id for each document.
4. Return a mapping of "PROMPT:Title" => "actual-id" for all created documents.

## Important

- If a document creation fails, retry once. If it fails again, include it in the errors array.
- Verify each document was created by checking the response status.
- Strip any markdown code fences from document content before sending.

## Output Format

\`\`\`json
{
  "status": "SUCCESS",
  "promptIdMapping": {
    "PROMPT:Doc Title 1": "abc123",
    "PROMPT:Doc Title 2": "def456"
  },
  "documentsCreated": 7,
  "errors": []
}
\`\`\``,
  },
  {
    title: 'WCv2: Create & Validate Workflow via API',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'api', 'ace', 'v2'],
    content: `You are an API integration agent. Create a workflow via the Coordination Matrix API and verify it was created correctly.

## API Details

- Base URL: \`{{_apiUrl}}\`
- Auth Header: \`X-API-Key: {{_apiKey}}\`
- Create: POST /api/workflows (body: the workflow JSON object)
- Verify: GET /api/workflows/:id
- Validate: POST /api/workflows/validate (body: { steps: [...] })

## Instructions

1. Get the workflow definition from the design step's output.
2. Get the prompt ID mapping from the create-prompts step's output.
3. Replace all "PROMPT:Title" references in promptDocumentIds with actual document IDs from the mapping.
4. Set isActive: false (workflow will be activated after testing).
5. POST the workflow to /api/workflows.
6. GET the created workflow to verify all steps were saved correctly.
7. Check: step count matches, all connections valid, no validation errors.

## Important

- The workflow MUST be created with isActive: false initially.
- If the POST returns validation diagnostics, check if any are severity 'error'.
- Include the workflowId in your output so downstream steps can reference it.
- Do NOT set a groupId field — leave it null.

## Output Format

\`\`\`json
{
  "verdict": "pass" | "fail",
  "workflowId": "created-workflow-id",
  "stepCount": 15,
  "validationErrors": [],
  "validationWarnings": [],
  "summary": "Workflow created and verified successfully."
}
\`\`\``,
  },
  {
    title: 'WCv2: Fix Validation Issues',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'fix', 'opus', 'v2'],
    content: `You are a workflow debugging specialist. A workflow failed API validation or E2E testing. Fix the issues and return the corrected definition.

## Common Issues

- Invalid step types
- Missing required fields (codeConfig for code steps, webhookConfig for webhooks, etc.)
- Connection references to non-existent steps
- Template variable syntax errors (unclosed braces, wrong paths)
- Schema validation failures on inputSchema/samplePayload
- Code step syntax errors
- Decision steps without defaultConnection
- Foreach without matching join

## Instructions

1. Read the error details from the previous step's output.
2. Read the original workflow definition.
3. Fix each error systematically.
4. Return the complete corrected workflow JSON and updated promptDocuments.
5. Ensure all PROMPT: references are preserved for downstream replacement.

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
    title: 'WCv2: Apply Human Feedback',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'feedback', 'opus', 'v2'],
    content: `You are a workflow editor incorporating human reviewer feedback. A human has reviewed the designed workflow and provided comments/changes.

## Instructions

1. Read the human's review comments and specific change requests from the task notes/metadata.
2. Apply each requested change to the workflow definition and/or prompt documents.
3. Maintain consistency — if a step is renamed, update all references to it.
4. If the feedback is ambiguous, make the most reasonable interpretation.
5. Return the complete updated workflow and prompt documents.
6. Preserve all PROMPT: references for downstream replacement.

## Output

\`\`\`json
{
  "workflow": { ... updated ... },
  "promptDocuments": [ ... updated ... ],
  "changesSummary": ["Applied change X", "Applied change Y"]
}
\`\`\``,
  },
  {
    title: 'WCv2: E2E Test Workflow',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'e2e-test', 'ace', 'v2'],
    content: `You are an end-to-end testing agent. Your job is to verify that a newly created workflow is functional by running it through a complete test cycle.

## API Details

- Base URL: \`{{_apiUrl}}\`
- Auth Header: \`X-API-Key: {{_apiKey}}\`

## Test Process

1. **Get Workflow**: GET /api/workflows/:workflowId to fetch the full workflow definition.
2. **Validate Structure**: POST /api/workflows/validate with the workflow's steps to check for structural issues.
3. **Simulate Run**: POST /api/workflows/:workflowId/simulate with the workflow's samplePayload and mockOutputs to dry-run the workflow.
4. **Start Test Run**: POST /api/workflow-runs with { workflowId, inputPayload: <samplePayload> } to start an actual run.
5. **Monitor First Step**: GET /api/workflow-runs/:runId?includeTasks=true to verify the first step created a task correctly.
6. **Cancel Test Run**: POST /api/workflow-runs/:runId/cancel to clean up (we only need to verify the first step bootstraps correctly).

## What to Check

- Workflow has valid steps with no orphaned nodes
- All connections reference existing step IDs
- All agent steps have valid defaultAssigneeId patterns
- Code steps have syntactically valid JavaScript
- Decision steps have proper conditions and defaultConnection
- Foreach steps have matching join steps
- InputSchema validates correctly against samplePayload
- The simulation completes without fatal errors
- A real run can be started and produces a root task
- The first step task is created with correct assignee, instructions, and metadata

## Handling Failures

If validation or simulation reveals issues, report them clearly with:
- The specific step ID that failed
- The error message
- What needs to be fixed
- Whether it's a structural issue (workflow definition) or a runtime issue (prompt content)

## Output Format

\`\`\`json
{
  "verdict": "pass" | "fail",
  "workflowId": "tested-workflow-id",
  "testRunId": "test-run-id-if-created",
  "testsConducted": [
    { "test": "structure-validation", "result": "pass" | "fail", "details": "..." },
    { "test": "simulation", "result": "pass" | "fail", "details": "..." },
    { "test": "live-run-bootstrap", "result": "pass" | "fail", "details": "..." }
  ],
  "issues": [
    { "stepId": "...", "issue": "...", "severity": "error" | "warning", "fixSuggestion": "..." }
  ],
  "summary": "Overall test results summary"
}
\`\`\``,
  },
  {
    title: 'WCv2: Fix E2E Issues',
    type: 'workflow-prompt',
    status: 'approved',
    tags: ['workflow-creation', 'e2e-fix', 'opus', 'v2'],
    content: `You are a workflow repair specialist. An E2E test of a newly created workflow has failed. Your job is to analyze the test results, identify root causes, and fix the workflow definition and/or prompt documents.

## Context

The E2E test runs validation, simulation, and a live run bootstrap. The test results include:
- Which specific tests passed/failed
- Error messages and step IDs involved
- Fix suggestions from the testing agent

## Instructions

1. Read the E2E test results carefully from the previous step's output.
2. Read the original workflow definition (from the create-workflow-api step output or the steps context).
3. For each failed test, identify the root cause:
   - **Structure failures**: Fix step definitions, connections, configs
   - **Simulation failures**: Fix code steps, decision logic, data flow
   - **Bootstrap failures**: Fix inputSchema, first step config, assignee patterns
4. Apply all fixes to produce a corrected workflow definition.
5. If prompt documents need changes, include the updated versions.
6. Explain each fix clearly so the system can learn from it.

## Important

- The corrected workflow will be re-created via the API, so output the complete workflow JSON.
- All PROMPT: references should be preserved if they were working.
- If an issue is in prompt content rather than workflow structure, update the relevant promptDocuments.
- Focus on the specific failures — don't restructure working parts.

## Output Format

\`\`\`json
{
  "workflow": { ... corrected workflow ... },
  "promptDocuments": [ ... updated if needed ... ],
  "fixes": [
    { "issue": "description of problem", "fix": "what was changed", "stepId": "affected-step" }
  ],
  "fixesSummary": "Brief summary of all fixes applied"
}
\`\`\``,
  },
];

// =============================================================================
// Workflow Definition
// =============================================================================

function buildWorkflow(promptDocIds) {
  return {
    name: 'Workflow Creation',
    description: 'Receives an idea for a workflow, designs it with Opus, reviews with Haiku, creates via API with Ace Agent, runs E2E testing with Ace, gets human approval, and activates. Includes retry loops with max depth 5 for E2E failures. Self-referential — can create workflows that trigger this same workflow.',
    isActive: true,
    color: '#6366f1',
    groupId: '6976de9a24f7f6625819aca0',
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
      idea: 'Create a workflow that takes a blog post topic, generates 3 drafts with different styles, reviews them, and picks the best one.',
      workflowName: 'Blog Post Generator',
      constraints: 'Max 8 steps, use Opus for generation and Haiku for review.',
    },
    rootTaskTitleTemplate: 'WF Create: {{input.idea}}',
    steps: [
      // --- Phase 1: Design ---
      {
        id: 'design-workflow',
        name: 'Design Workflow',
        stepType: 'agent',
        description: 'Opus designs the complete workflow JSON and prompt documents based on the idea.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WCv2: Workflow Design System Prompt']],
        additionalInstructions: 'Design a complete workflow for this idea: {{input.idea}}\n\nDesired name: {{input.workflowName}}\nConstraints: {{input.constraints}}\n\nSelf-reference variable available: {{variables.wc_self.workflowId}} (the ID of this Workflow Creation workflow, for use in flow steps that need to create sub-workflows).',
        connections: [{ targetStepId: 'review-design' }],
      },
      // --- Phase 2: Review Loop ---
      {
        id: 'review-design',
        name: 'Review Design',
        stepType: 'agent',
        description: 'Haiku validates the workflow structure against the review checklist.',
        defaultAssigneeId: '{{agent.complexity.1}}',
        promptDocumentIds: [promptDocIds['WCv2: Review Checklist']],
        connections: [{ targetStepId: 'review-loop-check' }],
      },
      {
        id: 'review-loop-check',
        name: 'Check Review Loops',
        stepType: 'code',
        description: 'Count review iterations to prevent infinite loops (max 5).',
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
        promptDocumentIds: [promptDocIds['WCv2: Edit Instructions']],
        connections: [{ targetStepId: 'review-design' }],
      },
      // --- Phase 3: Create via API ---
      {
        id: 'create-prompts',
        name: 'Create Prompt Documents',
        stepType: 'agent',
        description: 'Ace Agent creates prompt documents via POST /api/documents.',
        defaultAssigneeId: '{{agent.tag.api-integration}}',
        promptDocumentIds: [promptDocIds['WCv2: Create Prompt Documents via API']],
        connections: [{ targetStepId: 'create-workflow-api' }],
      },
      {
        id: 'create-workflow-api',
        name: 'Create & Validate Workflow',
        stepType: 'agent',
        description: 'Ace Agent creates the workflow via POST /api/workflows and verifies it.',
        defaultAssigneeId: '{{agent.tag.api-integration}}',
        promptDocumentIds: [promptDocIds['WCv2: Create & Validate Workflow via API']],
        connections: [{ targetStepId: 'validation-loop-check' }],
      },
      {
        id: 'validation-loop-check',
        name: 'Check Validation Loops',
        stepType: 'code',
        description: 'Count validation retries to prevent infinite loops (max 3).',
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
          { targetStepId: 'e2e-test', condition: 'pass', label: 'Passed' },
          { targetStepId: 'fix-validation', condition: 'fail', label: 'Failed' },
        ],
        defaultConnection: 'e2e-test',
      },
      {
        id: 'fix-validation',
        name: 'Fix Validation Issues',
        stepType: 'agent',
        description: 'Opus fixes API validation errors and returns corrected workflow.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WCv2: Fix Validation Issues']],
        connections: [{ targetStepId: 'create-prompts' }],
      },
      // --- Phase 4: E2E Testing Loop (NEW) ---
      {
        id: 'e2e-test',
        name: 'E2E Test Workflow',
        stepType: 'agent',
        description: 'Ace Agent runs validation, simulation, and live bootstrap test on the created workflow.',
        defaultAssigneeId: '{{agent.tag.api-integration}}',
        promptDocumentIds: [promptDocIds['WCv2: E2E Test Workflow']],
        additionalInstructions: 'Test the workflow that was just created. The workflow ID is available from the create-workflow-api step output. Use the workflow\'s samplePayload for the test run.',
        connections: [{ targetStepId: 'e2e-loop-check' }],
      },
      {
        id: 'e2e-loop-check',
        name: 'Check E2E Loops',
        stepType: 'code',
        description: 'Count E2E test failures to prevent infinite loops (max 5).',
        codeConfig: {
          code: `
            const e2eCount = (_stepLog || []).filter(e => e.stepId === 'e2e-test').length;
            const maxRetries = 5;
            const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
            const verdict = (prevVerdict === 'pass' || e2eCount >= maxRetries) ? 'pass' : prevVerdict || 'fail';
            return { verdict, e2eCount, maxRetries, capped: e2eCount >= maxRetries };
          `,
        },
        connections: [{ targetStepId: 'e2e-gate' }],
      },
      {
        id: 'e2e-gate',
        name: 'E2E Test Passed?',
        stepType: 'decision',
        description: 'Route based on E2E test result.',
        decisionField: 'output.verdict',
        connections: [
          { targetStepId: 'prepare-review', condition: 'pass', label: 'Passed' },
          { targetStepId: 'fix-e2e-issues', condition: 'fail', label: 'Failed' },
        ],
        defaultConnection: 'prepare-review',
      },
      {
        id: 'fix-e2e-issues',
        name: 'Fix E2E Issues',
        stepType: 'agent',
        description: 'Opus analyzes E2E test failures and fixes the workflow definition.',
        defaultAssigneeId: '{{agent.complexity.3}}',
        promptDocumentIds: [promptDocIds['WCv2: Fix E2E Issues']],
        connections: [{ targetStepId: 'create-prompts' }],
      },
      // --- Phase 5: Human Approval ---
      {
        id: 'prepare-review',
        name: 'Prepare Review Summary',
        stepType: 'code',
        description: 'Assemble a rich markdown review document with mermaid diagram, links, and phase results.',
        codeConfig: {
          code: `
            const log = _stepLog || [];
            const workflowName = (trigger && trigger.workflowName) || 'Unknown';
            const originalIdea = (trigger && trigger.idea) || 'Unknown';
            const constraints = (trigger && trigger.constraints) || '';

            // Extract phase data from step log
            const phases = [];
            let createdWorkflowId = null;
            let createdWorkflowName = null;
            let testResults = null;

            for (const entry of log) {
              const out = entry.outputSummary || {};
              const result = out.result || {};
              if (entry.stepId === 'design-workflow') {
                phases.push({ step: 'Design Workflow', icon: '🎨', status: out.status || entry.status || 'unknown', summary: out.summary || 'Completed' });
              }
              if (entry.stepId === 'review-design') {
                phases.push({ step: 'Review Design', icon: '🔍', status: out.status || entry.status || 'unknown', summary: out.summary || 'Completed', confidence: out.confidence || result.confidence });
              }
              if (entry.stepId === 'edit-design') {
                phases.push({ step: 'Edit Design (revision)', icon: '✏️', status: out.status || entry.status || 'unknown', summary: out.summary || 'Revised' });
              }
              if (entry.stepId === 'create-prompts') {
                phases.push({ step: 'Create Prompt Documents', icon: '📝', status: out.status || entry.status || 'unknown', summary: out.summary || 'Completed' });
              }
              if (entry.stepId === 'create-workflow-api') {
                phases.push({ step: 'Create & Validate Workflow', icon: '⚙️', status: out.status || entry.status || 'unknown', summary: out.summary || 'Completed' });
                if (result.workflowId) createdWorkflowId = result.workflowId;
                if (result.workflowName) createdWorkflowName = result.workflowName;
              }
              if (entry.stepId === 'e2e-test') {
                testResults = { status: out.status || entry.status || 'unknown', summary: out.summary || 'Completed', confidence: out.confidence || result.confidence };
                phases.push({ step: 'E2E Testing', icon: '🧪', status: testResults.status, summary: testResults.summary });
              }
            }

            // Fetch the created workflow to build a mermaid diagram
            let mermaidDiagram = '';
            let workflowSteps = [];
            if (createdWorkflowId && typeof apiUrl === 'string' && typeof apiKey === 'string') {
              try {
                const res = await fetch(apiUrl + '/workflows/' + createdWorkflowId, {
                  headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                  const json = await res.json();
                  const wf = json.data || json;
                  workflowSteps = wf.steps || [];

                  if (workflowSteps.length > 0) {
                    // Build mermaid flowchart
                    const lines = ['flowchart TD'];
                    const typeShapes = { agent: ['([', '])'], manual: ['{{', '}}'], code: ['[/', '/]'], decision: ['{', '}'], external: ['>', ']'], foreach: ['[[', ']]'] };
                    for (const s of workflowSteps) {
                      const shape = typeShapes[s.stepType] || ['[', ']'];
                      const label = (s.name || s.id).replace(/"/g, "'");
                      lines.push('    ' + s.id + shape[0] + '"' + label + '"' + shape[1]);
                    }
                    // Add connections
                    for (const s of workflowSteps) {
                      for (const c of (s.connections || [])) {
                        const label = c.label || c.condition || '';
                        if (label) {
                          lines.push('    ' + s.id + ' -->|' + label + '| ' + c.targetStepId);
                        } else {
                          lines.push('    ' + s.id + ' --> ' + c.targetStepId);
                        }
                      }
                    }
                    mermaidDiagram = lines.join('\\n');
                  }
                }
              } catch (e) {
                console.warn('Failed to fetch workflow for diagram:', e.message);
              }
            }

            // Build the base URL for frontend links (strip /api suffix if present)
            const baseUrl = (typeof apiUrl === 'string' ? apiUrl : '').replace(/\\/api$/, '');

            // Assemble markdown document
            const md = [];
            md.push('# Review: ' + (createdWorkflowName || workflowName));
            md.push('');
            md.push('## Original Request');
            md.push('');
            md.push('> ' + originalIdea.split('\\n').join('\\n> '));
            if (constraints) {
              md.push('');
              md.push('**Constraints:** ' + constraints);
            }
            md.push('');

            // Links
            md.push('## Quick Links');
            md.push('');
            if (createdWorkflowId && baseUrl) {
              md.push('- **Workflow:** [' + (createdWorkflowName || workflowName) + '](' + baseUrl + '/workflows/' + createdWorkflowId + ')');
            }
            if (_workflowRunId && baseUrl) {
              md.push('- **This Run:** [Workflow Run](' + baseUrl + '/workflow-runs/' + _workflowRunId + ')');
            }
            md.push('');

            // Mermaid diagram
            if (mermaidDiagram) {
              md.push('## Workflow Diagram');
              md.push('');
              md.push('\`\`\`mermaid');
              md.push(mermaidDiagram);
              md.push('\`\`\`');
              md.push('');
            }

            // Step summary table
            if (workflowSteps.length > 0) {
              md.push('## Workflow Steps (' + workflowSteps.length + ')');
              md.push('');
              md.push('| # | Step | Type | Agent |');
              md.push('|---|------|------|-------|');
              workflowSteps.forEach((s, i) => {
                const agent = s.defaultAssigneeId || '—';
                md.push('| ' + (i + 1) + ' | ' + (s.name || s.id) + ' | ' + s.stepType + ' | ' + agent + ' |');
              });
              md.push('');
            }

            // Creation phases
            md.push('## Creation Process');
            md.push('');
            for (const p of phases) {
              const statusIcon = (p.status === 'completed' || p.status === 'SUCCESS') ? '✅' : (p.status === 'failed' || p.status === 'FAILED') ? '❌' : '⏳';
              md.push('### ' + p.icon + ' ' + p.step + ' ' + statusIcon);
              md.push('');
              md.push(p.summary);
              if (p.confidence !== undefined && p.confidence !== null) {
                md.push('');
                md.push('*Confidence: ' + (typeof p.confidence === 'number' ? (p.confidence * 100).toFixed(0) + '%' : p.confidence) + '*');
              }
              md.push('');
            }

            // E2E test results
            if (testResults) {
              md.push('## E2E Test Results');
              md.push('');
              const testIcon = (testResults.status === 'completed' || testResults.status === 'SUCCESS') ? '✅ Passed' : '❌ Failed';
              md.push('**Status:** ' + testIcon);
              if (testResults.confidence !== undefined && testResults.confidence !== null) {
                md.push('  ');
                md.push('**Confidence:** ' + (typeof testResults.confidence === 'number' ? (testResults.confidence * 100).toFixed(0) + '%' : testResults.confidence));
              }
              md.push('');
            }

            // Approval actions
            md.push('---');
            md.push('');
            md.push('**Actions:** Approve to activate the workflow, add notes for adjustments, or request changes for revision.');

            const content = md.join('\\n');
            const summaryText = 'Review ' + (createdWorkflowName || workflowName) + ': ' + phases.length + ' phases completed' + (testResults ? ', E2E ' + testResults.status : '');

            return {
              result: {
                title: 'Review: ' + (createdWorkflowName || workflowName),
                content: content,
                summary: summaryText,
              },
              workflowId: createdWorkflowId,
              workflowName: createdWorkflowName,
            };
          `,
          packages: ['node-fetch'],
          variables: [
            { name: 'apiUrl', path: '_apiUrl' },
            { name: 'apiKey', path: '_apiKey' },
          ],
        },
        connections: [{ targetStepId: 'human-approval' }],
      },
      {
        id: 'human-approval',
        name: 'Human Approval',
        stepType: 'manual',
        description: 'Human reviews the designed and tested workflow before activation.',
        additionalInstructions: 'Review the workflow creation summary below.\n\nThe output section shows:\n- Original idea and workflow name\n- Results from each phase (design, review, prompt creation, workflow creation, E2E testing)\n- Created artifact IDs\n\nApprove to activate the workflow, add notes for minor adjustments, or request changes for substantial revisions.',
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
        promptDocumentIds: [promptDocIds['WCv2: Apply Human Feedback']],
        connections: [{ targetStepId: 'create-prompts' }],
      },
      // --- Phase 6: Finalize ---
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
              const apiUrl = '{{_apiUrl}}';
              const apiKey = '{{_apiKey}}';
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

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n=== Deploying Workflow Creation v2 ===\n');
  if (dryRun) console.log('  DRY RUN mode\n');

  // Health check
  try {
    await api('GET', '/api/health');
    console.log('  API is healthy.\n');
  } catch (err) {
    console.error(`  API unreachable: ${err.message}`);
    process.exit(1);
  }

  // Create prompt documents
  console.log('Creating prompt documents...');
  const docIds = {};
  for (const doc of PROMPT_DOCS) {
    const created = await createDoc(doc);
    docIds[doc.title] = created._id;
  }
  console.log(`  Created ${Object.keys(docIds).length} documents.\n`);

  // Create workflow
  console.log('Creating workflow...');
  const workflow = buildWorkflow(docIds);

  if (dryRun) {
    console.log(`  [DRY] Would create workflow: ${workflow.name} (${workflow.steps.length} steps)`);
    console.log('\n  Step flow:');
    for (const s of workflow.steps) {
      const conns = (s.connections || []).map(c => c.condition ? `${c.targetStepId}(${c.condition})` : c.targetStepId).join(', ');
      console.log(`    ${s.id.padEnd(25)} | ${s.stepType.padEnd(10)} | -> ${conns || '(terminal)'}`);
    }
  } else {
    const result = await api('POST', '/api/workflows', workflow);
    const wfId = result.data._id;
    console.log(`  Created workflow: ${workflow.name} => ${wfId}`);
    console.log(`  Steps: ${result.data.steps.length}`);

    // Update the loopback variable with the new workflow ID
    console.log('\nUpdating loopback variable (wc_self)...');
    const varUpdate = await api('PATCH', '/api/variable-packages/69badd608cd5a7895251f24e', {
      value: JSON.stringify({
        workflowId: wfId,
        workflowName: 'Workflow Creation v2',
        apiUrl: 'https://cm.hcizero.com'
      })
    });
    console.log(`  Updated wc_self.workflowId => ${wfId}`);

    console.log('\n=== Deployment Complete ===');
    console.log(`  Workflow ID: ${wfId}`);
    console.log(`  Steps: ${workflow.steps.length}`);
    console.log(`  Prompts: ${Object.keys(docIds).length}`);
    console.log(`  Loopback variable: wc_self.workflowId = ${wfId}`);
    console.log(`  Old WC (69ba27268cd5a7895251f233) has been deactivated.`);
  }
}

main().catch(err => {
  console.error('\nDeployment failed:', err.message);
  process.exit(1);
});
