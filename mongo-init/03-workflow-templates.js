// MongoDB Workflow Templates
// Agent-executable workflow definitions

db = db.getSiblingDB('coordination_matrix');

// ============================================================================
// WORKFLOW 1: Document Creation
// A simple linear workflow for creating documents with agent assistance
// ============================================================================

const documentCreationWorkflow = {
  name: 'Document Creation',
  description: 'Create a document with AI assistance. Gathers requirements, creates a draft, reviews, and finalizes.',
  isActive: true,
  rootTaskTitleTemplate: 'Create Document: {{input.documentTitle}}',
  steps: [
    {
      id: 'start',
      name: 'Start',
      description: 'Workflow entry point',
      stepType: 'trigger',
      connections: [
        { targetStepId: 'gather-requirements' }
      ]
    },
    {
      id: 'gather-requirements',
      name: 'Gather Requirements',
      description: 'Analyze the request and gather document requirements',
      stepType: 'agent',
      additionalInstructions: `You are gathering requirements for a document creation task.

Analyze the input and extract:
1. Document type (report, proposal, memo, guide, etc.)
2. Target audience
3. Key topics to cover
4. Tone and style preferences
5. Any specific sections or structure required
6. Length/depth expectations

Return a structured requirements object with these fields.`,
      connections: [
        { targetStepId: 'create-draft' }
      ]
    },
    {
      id: 'create-draft',
      name: 'Create Draft',
      description: 'Generate the initial document draft based on requirements',
      stepType: 'agent',
      additionalInstructions: `You are creating a document draft based on the gathered requirements.

Using the requirements from the previous step:
1. Create a well-structured document
2. Include all required sections
3. Match the specified tone and style
4. Ensure appropriate depth and length
5. Use clear headings and formatting (markdown)

Return the complete document draft in markdown format.`,
      connections: [
        { targetStepId: 'review-draft' }
      ]
    },
    {
      id: 'review-draft',
      name: 'Review Draft',
      description: 'Human review of the generated draft',
      stepType: 'manual',
      additionalInstructions: `Please review the generated document draft.

Check for:
- Accuracy of information
- Appropriate tone and style
- Completeness of required sections
- Any necessary corrections or additions

Add your feedback in the task notes before completing.`,
      connections: [
        { targetStepId: 'finalize-document' }
      ]
    },
    {
      id: 'finalize-document',
      name: 'Finalize Document',
      description: 'Incorporate feedback and produce final version',
      stepType: 'agent',
      additionalInstructions: `You are finalizing the document based on review feedback.

1. Read the review feedback from the previous step
2. Incorporate all suggested changes
3. Polish the language and formatting
4. Ensure consistency throughout
5. Add any final touches

Return the finalized document in markdown format with a brief summary of changes made.`
    }
  ],
  mermaidDiagram: `graph TD
    A[trigger: Start] --> B[agent: Gather Requirements]
    B --> C[agent: Create Draft]
    C --> D[manual: Review Draft]
    D --> E[agent: Finalize Document]
`,
  createdAt: new Date(),
  updatedAt: new Date()
};

// ============================================================================
// WORKFLOW 2: Text Generation Competition
// Generate 3 versions of text, audit each, then select the best one
// ============================================================================

const textGenerationCompetitionWorkflow = {
  name: 'Text Generation Competition',
  description: 'Generate 3 different versions of text with different styles, audit each for quality, then select the best one.',
  isActive: true,
  rootTaskTitleTemplate: 'Text Competition: {{input.topic}}',
  steps: [
    {
      id: 'start',
      name: 'Start',
      description: 'Workflow entry point - receives the prompt/topic',
      stepType: 'trigger',
      connections: [
        { targetStepId: 'fan-out-versions' }
      ]
    },
    {
      id: 'fan-out-versions',
      name: 'Create Version Tasks',
      description: 'Fan out to 3 parallel version generation tasks',
      stepType: 'foreach',
      itemsPath: 'versions',
      itemVariable: 'version',
      maxItems: 3,
      connections: [
        { targetStepId: 'generate-text' }
      ]
    },
    {
      id: 'generate-text',
      name: 'Generate Text Version',
      description: 'Generate text in a specific style',
      stepType: 'agent',
      additionalInstructions: `You are generating text for a competition between different writing styles.

Your assigned style: {{version.style}}
Style description: {{version.description}}

Topic/Prompt: {{input.prompt}}

Guidelines:
1. Write in the specified style consistently
2. Be creative and engaging
3. Keep the content focused on the topic
4. Aim for approximately {{input.targetLength}} words (or reasonable length if not specified)

Return your generated text along with a brief note about your stylistic choices.`,
      connections: [
        { targetStepId: 'audit-text' }
      ]
    },
    {
      id: 'audit-text',
      name: 'Audit Text Quality',
      description: 'Evaluate the generated text for quality',
      stepType: 'agent',
      additionalInstructions: `You are auditing a generated text for quality.

Evaluate the text on these criteria (score 1-10 for each):
1. **Clarity**: Is the writing clear and easy to understand?
2. **Engagement**: Does it capture and hold attention?
3. **Style Consistency**: Does it maintain its stated style throughout?
4. **Creativity**: Is it original and interesting?
5. **Relevance**: Does it address the topic effectively?
6. **Grammar & Flow**: Is it well-written technically?

Provide:
- Individual scores for each criterion
- Overall score (average)
- Brief strengths (2-3 bullet points)
- Brief weaknesses (2-3 bullet points)
- One-sentence summary

Return a structured audit report.`
    },
    {
      id: 'collect-results',
      name: 'Collect All Versions',
      description: 'Wait for all versions to be generated and audited',
      stepType: 'join',
      awaitStepId: 'fan-out-versions',
      joinBoundary: {
        minPercent: 100,
        maxWaitMs: 600000,
        failOnTimeout: false
      },
      connections: [
        { targetStepId: 'select-best' }
      ]
    },
    {
      id: 'select-best',
      name: 'Select Best Version',
      description: 'Compare all versions and select the winner',
      stepType: 'agent',
      additionalInstructions: `You are the final judge in a text generation competition.

You have received 3 versions of text, each with its own audit report.

Your task:
1. Review all 3 versions and their audit scores
2. Consider the original prompt/topic requirements
3. Weigh the audit criteria appropriately for this use case
4. Select the best overall version

Provide:
- **Winner**: Which version (1, 2, or 3) is best
- **Reasoning**: Why this version won (3-5 sentences)
- **Runner-up**: Second place and brief note on why
- **Comparison Summary**: Key differentiators between versions
- **Recommended Improvements**: If the winner could be even better, how?

Return a structured selection report with the winning text included.`
    }
  ],
  mermaidDiagram: `graph TD
    A[trigger: Start] --> B[[foreach: Create Version Tasks]]
    B --> C[agent: Generate Text Version]
    C --> D[agent: Audit Text Quality]
    D --> E[[join: Collect All Versions]]
    E --> F[agent: Select Best Version]
`,
  createdAt: new Date(),
  updatedAt: new Date()
};

// Insert workflows
db.workflows.insertMany([
  documentCreationWorkflow,
  textGenerationCompetitionWorkflow
]);

print('Workflow templates inserted successfully!');

// ============================================================================
// HELPER: Print workflow IDs for reference
// ============================================================================

const insertedWorkflows = db.workflows.find({
  name: { $in: ['Document Creation', 'Text Generation Competition'] }
}).toArray();

print('\nInserted Workflow IDs:');
insertedWorkflows.forEach(w => {
  print(`  ${w.name}: ${w._id}`);
});

print('\nTo start these workflows via API:');
print('');
print('Document Creation:');
print(`  POST /api/workflow-runs`);
print(`  {`);
print(`    "workflowId": "<workflow-id>",`);
print(`    "inputPayload": {`);
print(`      "documentTitle": "My Document",`);
print(`      "topic": "The topic to write about",`);
print(`      "requirements": "Any specific requirements"`);
print(`    }`);
print(`  }`);
print('');
print('Text Generation Competition:');
print(`  POST /api/workflow-runs`);
print(`  {`);
print(`    "workflowId": "<workflow-id>",`);
print(`    "inputPayload": {`);
print(`      "prompt": "Write about...",`);
print(`      "topic": "Topic name",`);
print(`      "targetLength": 500,`);
print(`      "versions": [`);
print(`        { "style": "formal", "description": "Professional, business-like tone" },`);
print(`        { "style": "casual", "description": "Friendly, conversational tone" },`);
print(`        { "style": "creative", "description": "Imaginative, literary style" }`);
print(`      ]`);
print(`    }`);
print(`  }`);
