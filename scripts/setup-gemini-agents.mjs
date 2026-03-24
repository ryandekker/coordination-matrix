#!/usr/bin/env node
/**
 * Setup script to create Gemini agent users and add them to a group.
 *
 * Usage:
 *   node scripts/setup-gemini-agents.mjs [--env local|production] [--dry-run]
 *
 * Requires an API key with agent management permissions.
 * Set MATRIX_API_KEY env var or uses the key from daemon-jobs.yaml.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────

const ENVS = {
  local: { apiUrl: 'http://localhost:3100/api' },
  production: { apiUrl: 'https://cm.hcizero.com/api' },
};

const RYANS_WORKSPACE_GROUP_ID = '6976de9a24f7f6625819aca0';

const GEMINI_AGENTS = [
  {
    displayName: 'Gemini Flash Lite',
    agentComplexity: 1,
    agentTags: ['gemini', 'fast-triage'],
    botColor: '#4285F4', // Google Blue
    agentPrompt:
      'You are Gemini Flash Lite, a fast and efficient AI agent optimized for quick triage, ' +
      'classification, and simple task processing. You excel at rapid responses and straightforward analysis.',
  },
  {
    displayName: 'Gemini Flash',
    agentComplexity: 2,
    agentTags: ['gemini', 'general-purpose'],
    botColor: '#34A853', // Google Green
    agentPrompt:
      'You are Gemini Flash, a balanced AI agent capable of handling most general-purpose tasks. ' +
      'You provide a good mix of speed and intelligence for content review, analysis, and moderate complexity work.',
  },
  {
    displayName: 'Gemini Pro',
    agentComplexity: 3,
    agentTags: ['gemini', 'deep-reasoning', 'api-integration'],
    botColor: '#EA4335', // Google Red
    agentPrompt:
      'You are Gemini Pro, an advanced AI agent designed for complex reasoning, deep analysis, ' +
      'strategy, and sophisticated tasks. You handle the most demanding work requiring thorough ' +
      'research, multi-step reasoning, and nuanced judgment.',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'local';
  const dryRun = args.includes('--dry-run');
  const help = args.includes('--help') || args.includes('-h');
  return { env, dryRun, help };
}

function getApiKey() {
  if (process.env.MATRIX_API_KEY) return process.env.MATRIX_API_KEY;

  // Try loading from daemon-jobs.yaml
  try {
    const yamlPath = resolve(__dirname, 'daemon-jobs.yaml');
    const content = readFileSync(yamlPath, 'utf-8');
    const match = content.match(/apiKey:\s*(.+)/);
    if (match) return match[1].trim();
  } catch {
    // ignore
  }

  return null;
}

async function apiRequest(apiUrl, path, options = {}) {
  const url = `${apiUrl}${path}`;
  const apiKey = getApiKey();

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
  };

  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { env, dryRun, help } = parseArgs();

  if (help) {
    console.log(`
Usage: node scripts/setup-gemini-agents.mjs [options]

Options:
  --env <local|production>   Target environment (default: local)
  --dry-run                  Show what would be done without making changes
  --help, -h                 Show this help message

Environment variables:
  MATRIX_API_KEY             API key for authentication (or read from daemon-jobs.yaml)
`);
    process.exit(0);
  }

  const config = ENVS[env];
  if (!config) {
    console.error(`Unknown environment: ${env}. Use: ${Object.keys(ENVS).join(', ')}`);
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('No API key found. Set MATRIX_API_KEY or create scripts/daemon-jobs.yaml');
    process.exit(1);
  }

  console.log(`\n🔧 Setting up Gemini agents [${env}] ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`   API: ${config.apiUrl}\n`);

  // Verify connectivity
  try {
    await apiRequest(config.apiUrl, '/health');
    console.log('✓ API is healthy\n');
  } catch (err) {
    console.error(`✗ Cannot reach API: ${err.message}`);
    process.exit(1);
  }

  const createdAgents = [];

  for (const agent of GEMINI_AGENTS) {
    console.log(`── ${agent.displayName} (complexity ${agent.agentComplexity}) ──`);

    if (dryRun) {
      console.log(`  [dry-run] Would create agent: ${JSON.stringify(agent, null, 2)}`);
      createdAgents.push({ _id: '<dry-run>', displayName: agent.displayName });
      continue;
    }

    try {
      // Create the agent via POST /api/users
      const result = await apiRequest(config.apiUrl, '/users', {
        method: 'POST',
        body: JSON.stringify({
          ...agent,
          isAgent: true,
        }),
      });

      const created = result.data;
      createdAgents.push(created);
      console.log(`  ✓ Created: ${created._id}`);
      console.log(`    Color: ${created.botColor}`);
      console.log(`    Tags: ${(created.agentTags || []).join(', ')}`);
    } catch (err) {
      // If already exists, try to find and update
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        console.log(`  ⓘ Agent may already exist, attempting lookup...`);
        try {
          const agents = await apiRequest(config.apiUrl, '/users/agents');
          const existing = agents.data.find(
            (a) => a.displayName === agent.displayName
          );
          if (existing) {
            console.log(`  ✓ Found existing: ${existing._id}`);
            // Update with latest config
            const updated = await apiRequest(config.apiUrl, `/users/${existing._id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                agentComplexity: agent.agentComplexity,
                agentTags: agent.agentTags,
                botColor: agent.botColor,
                agentPrompt: agent.agentPrompt,
              }),
            });
            createdAgents.push(updated.data);
            console.log(`  ✓ Updated with latest config`);
          }
        } catch (findErr) {
          console.error(`  ✗ Failed to find/update: ${findErr.message}`);
        }
      } else {
        console.error(`  ✗ Failed: ${err.message}`);
      }
    }
    console.log('');
  }

  // Add agents to Ryan's workspace group
  if (createdAgents.length > 0 && !dryRun) {
    console.log(`── Adding agents to Ryan's Workspace ──`);
    for (const agent of createdAgents) {
      if (!agent._id || agent._id === '<dry-run>') continue;
      try {
        await apiRequest(config.apiUrl, `/groups/${RYANS_WORKSPACE_GROUP_ID}/members`, {
          method: 'POST',
          body: JSON.stringify({ userId: agent._id, role: 'member' }),
        });
        console.log(`  ✓ Added ${agent.displayName} to group`);
      } catch (err) {
        if (err.message.includes('already a member')) {
          console.log(`  ⓘ ${agent.displayName} already in group`);
        } else {
          console.error(`  ✗ Failed to add ${agent.displayName}: ${err.message}`);
        }
      }
    }
  }

  // Summary
  console.log('\n── Summary ──');
  console.log(`Agents created/found: ${createdAgents.length}`);
  for (const a of createdAgents) {
    console.log(`  ${a.displayName}: ${a._id}`);
  }

  if (createdAgents.length > 0) {
    console.log('\nAgent IDs for daemon-jobs.yaml:');
    const names = ['gemini-flash-lite', 'gemini-flash', 'gemini-pro'];
    createdAgents.forEach((a, i) => {
      console.log(`  # ${a.displayName}`);
      console.log(`  ${names[i]}:`);
      console.log(`    agentId: ${a._id}`);
    });
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
