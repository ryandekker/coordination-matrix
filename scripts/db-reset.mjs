#!/usr/bin/env node
/**
 * Safe database reset wrapper
 *
 * Prevents accidental database resets by requiring explicit human confirmation.
 * AI agents and non-interactive environments are blocked with guidance to use
 * db:migrate instead.
 *
 * Usage:
 *   npm run db:reset          # Interactive prompt required
 *   npm run db:reset -- -y    # Skip prompt (human override)
 */

import { execSync } from 'child_process';
import { createInterface } from 'readline';

const RESET_CMD = 'docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d';

function isNonInteractive() {
  // stdin is not a TTY (piped input, CI, agent subprocesses)
  if (!process.stdin.isTTY) return true;
  // Common CI/agent environment variables
  if (process.env.CI) return true;
  if (process.env.CLAUDE_CODE) return true;
  if (process.env.CURSOR_SESSION) return true;
  if (process.env.CODEX) return true;
  if (process.env.AMP_SESSION) return true;
  if (process.env.VIBE_KANBAN_DAEMON) return true;
  return false;
}

function hasForceFlag() {
  return process.argv.includes('-y') || process.argv.includes('--yes');
}

function printAgentError() {
  console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  ❌  DATABASE RESET BLOCKED — Non-interactive environment       ║
╚══════════════════════════════════════════════════════════════════╝

  db:reset destroys ALL data and re-seeds from scratch.
  It requires explicit human confirmation and cannot be run by agents.

  ┌─────────────────────────────────────────────────────────────┐
  │  INSTEAD, use the migration system for schema changes:      │
  │                                                             │
  │    npm run db:migrate          # Run pending migrations     │
  │    npm run db:migrate:status   # Check migration status     │
  │                                                             │
  │  For data fixes, write a migration in:                      │
  │    backend/src/migrations/                                  │
  │                                                             │
  │  Migrations are non-destructive, reversible, and required   │
  │  for production anyway.                                     │
  └─────────────────────────────────────────────────────────────┘

  If you truly need a full reset, ask the human operator to run:
    npm run db:reset
`);
}

async function confirm(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  // Block non-interactive environments entirely
  if (isNonInteractive() && !hasForceFlag()) {
    printAgentError();
    process.exit(1);
  }

  // If -y flag provided, skip confirmation
  if (hasForceFlag()) {
    console.log('⚠️  Resetting database (--yes flag provided)...\n');
    execSync(RESET_CMD, { cwd: process.env.INIT_CWD || process.cwd(), stdio: 'inherit' });
    console.log('\n✅ Database reset complete. Fresh seed data loaded.');
    return;
  }

  // Interactive confirmation
  console.log('');
  console.log('⚠️  DATABASE RESET');
  console.log('   This will destroy ALL data and re-seed from scratch.');
  console.log('   Any test data you have been working with will be lost.');
  console.log('');

  const answer = await confirm('   Type "reset" to confirm: ');

  if (answer !== 'reset') {
    console.log('\n   Cancelled. No changes made.');
    console.log('   Tip: Use "npm run db:migrate" for non-destructive schema changes.\n');
    process.exit(0);
  }

  console.log('\n   Resetting database...\n');
  execSync(RESET_CMD, { cwd: process.env.INIT_CWD || process.cwd(), stdio: 'inherit' });
  console.log('\n✅ Database reset complete. Fresh seed data loaded.');
}

main().catch((err) => {
  console.error('Database reset failed:', err.message);
  process.exit(1);
});
