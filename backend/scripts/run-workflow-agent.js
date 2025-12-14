#!/usr/bin/env node

/**
 * Workflow Agent Executor
 *
 * This script is called by the automation daemon to execute automated workflow tasks.
 * It fetches the task, runs the agent/AI system, and outputs results for the daemon
 * to update the task.
 *
 * Usage: node run-workflow-agent.js <taskId>
 *
 * Output: JSON with { status, metadata }
 */

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

async function main() {
  const taskId = process.argv[2];

  if (!taskId) {
    console.error('Usage: node run-workflow-agent.js <taskId>');
    process.exit(1);
  }

  try {
    // Fetch task details
    const taskResponse = await fetch(`${API_URL}/tasks/${taskId}`);
    if (!taskResponse.ok) {
      throw new Error(`Failed to fetch task: ${taskResponse.statusText}`);
    }
    const { data: task } = await taskResponse.json();

    // Extract agent instructions
    const prompt = task.extraPrompt || task.summary || task.title;
    const inputPayload = task.metadata?.inputPayload || {};

    console.error(`[Agent] Processing task: ${task.title}`);
    console.error(`[Agent] Prompt: ${prompt}`);
    console.error(`[Agent] Input: ${JSON.stringify(inputPayload)}`);

    // =========================================================================
    // TODO: Replace this section with your actual agent/AI implementation
    // =========================================================================

    // Example: Call Claude or another AI service
    // const result = await callClaude(prompt, inputPayload);

    // For now, simulate agent work
    const result = await simulateAgentWork(prompt, inputPayload);

    // =========================================================================
    // Output results for daemon to parse
    // =========================================================================

    console.log(JSON.stringify({
      status: 'completed',
      metadata: {
        ...task.metadata,
        agentOutput: result.output,
        processedAt: new Date().toISOString(),
        // Pass through for next step
        outputPayload: result.outputPayload,
      }
    }));

  } catch (error) {
    console.error(`[Agent] Error: ${error.message}`);

    // Output failure status
    console.log(JSON.stringify({
      status: 'failed',
      metadata: {
        error: error.message,
        failedAt: new Date().toISOString(),
      }
    }));

    process.exit(1);
  }
}

/**
 * Simulate agent work - replace with actual AI implementation
 */
async function simulateAgentWork(prompt, inputPayload) {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));

  return {
    output: `Processed: ${prompt}`,
    outputPayload: {
      ...inputPayload,
      result: 'success',
      processedBy: 'agent',
    }
  };
}

/**
 * Example: Call Claude API
 * Uncomment and customize for your setup
 */
// async function callClaude(prompt, context) {
//   const response = await fetch('https://api.anthropic.com/v1/messages', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//     body: JSON.stringify({
//       model: 'claude-3-haiku-20240307',
//       max_tokens: 1024,
//       messages: [{
//         role: 'user',
//         content: `${prompt}\n\nContext: ${JSON.stringify(context)}`
//       }]
//     })
//   });
//
//   const data = await response.json();
//   return {
//     output: data.content[0].text,
//     outputPayload: { aiResponse: data.content[0].text }
//   };
// }

main();
