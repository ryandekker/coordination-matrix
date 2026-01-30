#!/usr/bin/env node
/**
 * Test script for conversation capture functionality
 *
 * Usage:
 *   node scripts/test-conversation-capture.mjs
 *   node scripts/test-conversation-capture.mjs --model haiku
 *   node scripts/test-conversation-capture.mjs --prompt "What is 2+2?"
 */

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    model: { type: 'string', short: 'm', default: 'haiku' },
    prompt: { type: 'string', short: 'p', default: 'Respond with exactly: {"status":"SUCCESS","summary":"Test completed","output":{"message":"hello"},"nextAction":"COMPLETE"}' },
    timeout: { type: 'string', short: 't', default: '30000' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Test conversation capture for the task daemon.

Usage:
  node scripts/test-conversation-capture.mjs [options]

Options:
  --model, -m <model>    Model to use (default: haiku)
  --prompt, -p <text>    Prompt to send (default: simple JSON response test)
  --timeout, -t <ms>     Timeout in milliseconds (default: 30000)
  --help, -h             Show this help
`);
  process.exit(0);
}

const model = values.model;
const prompt = values.prompt;
const timeout = parseInt(values.timeout, 10);

console.log('='.repeat(60));
console.log('Conversation Capture Test');
console.log('='.repeat(60));
console.log(`Model: ${model}`);
console.log(`Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);
console.log(`Timeout: ${timeout}ms`);
console.log('='.repeat(60));

// Build the command exactly as the daemon does
const cmd = `claude --print --output-format stream-json --verbose --model ${model}`;
console.log(`\nCommand: ${cmd}\n`);

const startTime = Date.now();
const child = spawn('sh', ['-c', cmd], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

console.log(`[${elapsed()}] Child process spawned (PID: ${child.pid})`);

// Write prompt to stdin
console.log(`[${elapsed()}] Writing ${prompt.length} bytes to stdin...`);
child.stdin.write(prompt);
child.stdin.end();
console.log(`[${elapsed()}] Stdin closed, waiting for response...`);

let stdout = '';
let stderr = '';
let eventCount = 0;
let lastEventType = null;

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

// Set up timeout
const timeoutId = setTimeout(() => {
  console.log(`\n[${elapsed()}] TIMEOUT - killing process`);
  console.log(`Received so far: ${stdout.length} bytes stdout, ${stderr.length} bytes stderr`);
  if (stdout) {
    console.log('\nLast stdout:');
    console.log(stdout.slice(-500));
  }
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 2000);
}, timeout);

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  stdout += chunk;

  // Parse and log each JSON event
  const lines = chunk.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      eventCount++;
      lastEventType = event.type;

      // Log event summary
      if (event.type === 'system' && event.subtype === 'init') {
        console.log(`[${elapsed()}] EVENT #${eventCount}: system/init - session=${event.session_id}, model=${event.model}`);
      } else if (event.type === 'assistant') {
        const content = event.message?.content || [];
        const types = content.map(c => c.type).join(', ');
        console.log(`[${elapsed()}] EVENT #${eventCount}: assistant - content types: [${types}]`);
      } else if (event.type === 'user' && event.tool_use_result) {
        console.log(`[${elapsed()}] EVENT #${eventCount}: tool_result`);
      } else if (event.type === 'result') {
        console.log(`[${elapsed()}] EVENT #${eventCount}: result - turns=${event.num_turns}, cost=$${event.total_cost_usd?.toFixed(4) || '?'}`);
      } else {
        console.log(`[${elapsed()}] EVENT #${eventCount}: ${event.type}${event.subtype ? '/' + event.subtype : ''}`);
      }
    } catch (e) {
      // Not JSON, might be partial line
      if (line.trim()) {
        console.log(`[${elapsed()}] NON-JSON: ${line.substring(0, 100)}`);
      }
    }
  }
});

child.stderr.on('data', (data) => {
  const chunk = data.toString();
  stderr += chunk;
  console.log(`[${elapsed()}] STDERR: ${chunk.trim()}`);
});

child.on('close', (exitCode, signal) => {
  clearTimeout(timeoutId);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Process completed in ${elapsed()}`);
  console.log(`Exit code: ${exitCode}, Signal: ${signal}`);
  console.log(`Total events: ${eventCount}`);
  console.log(`Last event type: ${lastEventType}`);
  console.log(`Stdout: ${stdout.length} bytes, Stderr: ${stderr.length} bytes`);
  console.log('='.repeat(60));

  if (exitCode === 0 && lastEventType === 'result') {
    console.log('\n✅ SUCCESS - Conversation capture working correctly');

    // Try to extract the final result
    const lines = stdout.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result' && event.result) {
          console.log('\nFinal result:');
          console.log(event.result.substring(0, 500));
        }
      } catch {}
    }
  } else {
    console.log('\n❌ FAILED');
    if (stderr) {
      console.log('\nStderr:');
      console.log(stderr);
    }
    if (stdout && !lastEventType) {
      console.log('\nRaw stdout:');
      console.log(stdout.substring(0, 1000));
    }
  }

  process.exit(exitCode || 0);
});

child.on('error', (error) => {
  clearTimeout(timeoutId);
  console.log(`\n[${elapsed()}] ERROR: ${error.message}`);
  process.exit(1);
});
