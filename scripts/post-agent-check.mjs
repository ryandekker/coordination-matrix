#!/usr/bin/env node
/**
 * Post-Agent Validation Check
 *
 * Runs a series of validation checks after agent work to catch regressions.
 * Designed to be run standalone, as a Claude Code hook, or from npm scripts.
 *
 * Usage:
 *   node scripts/post-agent-check.mjs [options]
 *   npm run check
 *   npm run check:all
 *
 * Steps:
 *   1. git     - Identify changed files and scope
 *   2. typecheck - TypeScript compilation (tsc --noEmit)
 *   3. lint    - ESLint for backend and frontend
 *   4. test    - Vitest unit tests
 *   5. build   - Full build verification (skipped by default)
 *   6. audit   - Cleanup audit (debug logs, TODOs, conflicts, secrets)
 */

import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ── CLI parsing ─────────────────────────────────────────────────────────────

const { values: opts } = parseArgs({
  options: {
    scope:      { type: 'string',  short: 's', default: 'changed' },
    steps:      { type: 'string',  short: 't' },
    skip:       { type: 'string' },
    fix:        { type: 'boolean', default: false },
    verbose:    { type: 'boolean', short: 'v', default: false },
    json:       { type: 'boolean', default: false },
    'no-color': { type: 'boolean', default: false },
    help:       { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
});

if (opts.help) {
  console.log(`
Post-Agent Validation Check

Usage: node scripts/post-agent-check.mjs [options]

Options:
  --scope, -s <scope>   Check scope: 'changed' (default), 'all', 'backend', 'frontend'
  --steps, -t <steps>   Comma-separated steps to run (default: git,typecheck,lint,test,audit)
                        Values: git, typecheck, lint, test, build, audit
  --skip <steps>        Comma-separated steps to skip
  --fix                 Auto-fix lint issues where possible
  --verbose, -v         Show full command output
  --json                Output results as JSON
  --no-color            Disable colored output
  --help, -h            Show this help

npm scripts:
  npm run check         Default (changed files, skip build)
  npm run check:all     All files, all steps except build
  npm run check:quick   Changed files, skip tests and build
  npm run check:fix     Auto-fix lint issues
  npm run check:full    All files, all steps including build
`);
  process.exit(0);
}

// ── Colors ──────────────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !opts['no-color'];
const c = {
  green:  (s) => useColor ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => useColor ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => useColor ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s) => useColor ? `\x1b[36m${s}\x1b[0m` : s,
  bold:   (s) => useColor ? `\x1b[1m${s}\x1b[0m` : s,
  dim:    (s) => useColor ? `\x1b[2m${s}\x1b[0m` : s,
};

const PASS = c.green('[PASS]');
const FAIL = c.red('[FAIL]');
const WARN = c.yellow('[WARN]');
const SKIP = c.dim('[SKIP]');
const INFO = c.cyan('[INFO]');

// ── Step configuration ──────────────────────────────────────────────────────

const ALL_STEPS = ['git', 'typecheck', 'lint', 'test', 'build', 'audit'];
const DEFAULT_STEPS = ['git', 'typecheck', 'lint', 'test', 'audit']; // build excluded by default

function resolveSteps() {
  let steps = opts.steps
    ? opts.steps.split(',').map(s => s.trim())
    : [...DEFAULT_STEPS];

  if (opts.skip) {
    const skipSet = new Set(opts.skip.split(',').map(s => s.trim()));
    steps = steps.filter(s => !skipSet.has(s));
  }

  // Validate step names
  for (const step of steps) {
    if (!ALL_STEPS.includes(step)) {
      console.error(`Unknown step: ${step}. Valid steps: ${ALL_STEPS.join(', ')}`);
      process.exit(2);
    }
  }

  return steps;
}

// ── Command runner ──────────────────────────────────────────────────────────

function runCommand(cmd, options = {}) {
  const cwd = options.cwd || ROOT_DIR;
  const timeout = options.timeout || 120_000;
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    return { success: true, output: output.trim(), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status || 1,
    };
  }
}

// ── Output helpers ──────────────────────────────────────────────────────────

const results = [];

function log(...args) {
  if (!opts.json) console.log(...args);
}

function logVerbose(...args) {
  if (opts.verbose && !opts.json) console.log(...args);
}

function recordResult(name, status, summary, details = []) {
  results.push({ name, status, summary, details });
}

// ── Step 1: Git Status ──────────────────────────────────────────────────────

function stepGitStatus() {
  log(`\n${c.bold('--- Step 1: Git Status ---')}`);

  // Get changed files (staged + unstaged vs HEAD)
  const diffResult = runCommand('git diff --name-only HEAD');
  const stagedResult = runCommand('git diff --name-only --cached');
  const untrackedResult = runCommand('git ls-files --others --exclude-standard');

  const changedFiles = [
    ...new Set([
      ...(diffResult.output ? diffResult.output.split('\n') : []),
      ...(stagedResult.output ? stagedResult.output.split('\n') : []),
      ...(untrackedResult.output ? untrackedResult.output.split('\n') : []),
    ]),
  ].filter(Boolean);

  const backendFiles  = changedFiles.filter(f => f.startsWith('backend/'));
  const frontendFiles = changedFiles.filter(f => f.startsWith('frontend/'));
  const scriptFiles   = changedFiles.filter(f => f.startsWith('scripts/'));
  const otherFiles    = changedFiles.filter(f =>
    !f.startsWith('backend/') && !f.startsWith('frontend/') && !f.startsWith('scripts/')
  );

  const summary = changedFiles.length === 0
    ? 'No changed files detected'
    : `${changedFiles.length} changed files`;

  const details = [];
  if (backendFiles.length)  details.push(`  backend/  ${backendFiles.length} files`);
  if (frontendFiles.length) details.push(`  frontend/ ${frontendFiles.length} files`);
  if (scriptFiles.length)   details.push(`  scripts/  ${scriptFiles.length} files`);
  if (otherFiles.length)    details.push(`  other/    ${otherFiles.length} files`);

  log(`  ${PASS} ${summary}`);
  details.forEach(d => log(c.dim(d)));

  if (opts.verbose && changedFiles.length > 0) {
    log(c.dim('  Files:'));
    changedFiles.forEach(f => log(c.dim(`    ${f}`)));
  }

  recordResult('git', 'pass', summary, details);

  return { changedFiles, backendFiles, frontendFiles, scriptFiles, otherFiles };
}

// ── Step 2: TypeScript ──────────────────────────────────────────────────────

function stepTypeCheck(scope, changedCtx) {
  log(`\n${c.bold('--- Step 2: TypeScript ---')}`);

  const runBackend  = ['all', 'backend'].includes(scope)  || (scope === 'changed' && changedCtx.backendFiles.some(f => /\.tsx?$/.test(f)));
  const runFrontend = ['all', 'frontend'].includes(scope) || (scope === 'changed' && changedCtx.frontendFiles.some(f => /\.tsx?$/.test(f)));

  // If scope is 'changed' but there are changes in EITHER package, run both
  // because cross-package type breakage is possible through shared interfaces
  const forceAll = scope === 'changed' && (changedCtx.backendFiles.length > 0 || changedCtx.frontendFiles.length > 0);

  const shouldRunBackend  = runBackend || forceAll;
  const shouldRunFrontend = runFrontend || forceAll;

  if (!shouldRunBackend && !shouldRunFrontend) {
    log(`  ${SKIP} No TypeScript files changed`);
    recordResult('typecheck', 'skip', 'No TypeScript files changed');
    return true;
  }

  let backendOk = true;
  let frontendOk = true;
  const details = [];

  if (shouldRunBackend) {
    const backendDir = join(ROOT_DIR, 'backend');
    if (existsSync(join(backendDir, 'tsconfig.json'))) {
      const res = runCommand('npx tsc --noEmit', { cwd: backendDir, timeout: 60_000 });
      backendOk = res.success;
      const label = res.success ? c.green('0 errors') : c.red('errors found');
      log(`  backend:  ${label}`);
      if (!res.success) {
        const lines = (res.output || res.stderr).split('\n').slice(0, 20);
        lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
        if ((res.output || res.stderr).split('\n').length > 20) {
          details.push('  ... (truncated, run with --verbose for full output)');
        }
      }
    }
  }

  if (shouldRunFrontend) {
    const frontendDir = join(ROOT_DIR, 'frontend');
    if (existsSync(join(frontendDir, 'tsconfig.json'))) {
      const res = runCommand('npx tsc --noEmit', { cwd: frontendDir, timeout: 90_000 });
      frontendOk = res.success;
      const label = res.success ? c.green('0 errors') : c.red('errors found');
      log(`  frontend: ${label}`);
      if (!res.success) {
        const lines = (res.output || res.stderr).split('\n').slice(0, 20);
        lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
      }
    }
  }

  const passed = backendOk && frontendOk;
  const status = passed ? 'pass' : 'fail';
  const summary = passed ? 'TypeScript: no errors' : 'TypeScript: errors found';
  log(`  ${passed ? PASS : FAIL} ${summary}`);
  recordResult('typecheck', status, summary, details);
  return passed;
}

// ── Step 3: Linting ─────────────────────────────────────────────────────────

function stepLint(scope, changedCtx) {
  log(`\n${c.bold('--- Step 3: Linting ---')}`);

  const runBackend  = ['all', 'backend'].includes(scope)  || (scope === 'changed' && changedCtx.backendFiles.some(f => /\.tsx?$/.test(f)));
  const runFrontend = ['all', 'frontend'].includes(scope) || (scope === 'changed' && changedCtx.frontendFiles.some(f => /\.tsx?$/.test(f)));

  if (!runBackend && !runFrontend) {
    log(`  ${SKIP} No lintable files changed`);
    recordResult('lint', 'skip', 'No lintable files changed');
    return true;
  }

  let backendOk = true;
  let frontendOk = true;
  const details = [];
  const fixFlag = opts.fix ? ' --fix' : '';

  if (runBackend) {
    const backendDir = join(ROOT_DIR, 'backend');
    const res = runCommand(`npx eslint src --ext .ts${fixFlag}`, { cwd: backendDir, timeout: 60_000 });
    backendOk = res.success;
    const label = res.success ? c.green('0 errors') : c.red('errors found');
    log(`  backend:  ${label}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').filter(Boolean).slice(0, 30);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  if (runFrontend) {
    const frontendDir = join(ROOT_DIR, 'frontend');
    const res = runCommand(`npx next lint${fixFlag ? ' --fix' : ''}`, { cwd: frontendDir, timeout: 60_000 });
    frontendOk = res.success;
    const label = res.success ? c.green('0 errors') : c.red('errors found');
    log(`  frontend: ${label}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').filter(Boolean).slice(0, 30);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  const passed = backendOk && frontendOk;
  const status = passed ? 'pass' : 'fail';
  const summary = passed ? 'Linting: no errors' : 'Linting: errors found';
  log(`  ${passed ? PASS : FAIL} ${summary}`);
  recordResult('lint', status, summary, details);
  return passed;
}

// ── Step 4: Tests ───────────────────────────────────────────────────────────

function stepTest(scope, changedCtx) {
  log(`\n${c.bold('--- Step 4: Tests ---')}`);

  const runBackend  = ['all', 'backend'].includes(scope)  || (scope === 'changed' && changedCtx.backendFiles.length > 0);
  const runFrontend = ['all', 'frontend'].includes(scope) || (scope === 'changed' && changedCtx.frontendFiles.length > 0);

  if (!runBackend && !runFrontend) {
    log(`  ${SKIP} No source files changed`);
    recordResult('test', 'skip', 'No source files changed');
    return true;
  }

  let backendOk = true;
  let frontendOk = true;
  const details = [];

  if (runBackend) {
    const backendDir = join(ROOT_DIR, 'backend');
    const res = runCommand('npx vitest run', { cwd: backendDir, timeout: 120_000 });
    backendOk = res.success;

    // Parse test summary from vitest output
    const summaryMatch = (res.output || '').match(/Tests\s+(.+)/);
    const summaryLine = summaryMatch ? summaryMatch[1] : (res.success ? 'passed' : 'failed');
    const label = res.success ? c.green(summaryLine) : c.red(summaryLine);
    log(`  backend:  ${label}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').slice(-20);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  if (runFrontend) {
    const frontendDir = join(ROOT_DIR, 'frontend');
    const res = runCommand('npx vitest run', { cwd: frontendDir, timeout: 120_000 });
    frontendOk = res.success;

    const summaryMatch = (res.output || '').match(/Tests\s+(.+)/);
    const summaryLine = summaryMatch ? summaryMatch[1] : (res.success ? 'passed' : 'failed');
    const label = res.success ? c.green(summaryLine) : c.red(summaryLine);
    log(`  frontend: ${label}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').slice(-20);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  const passed = backendOk && frontendOk;
  const status = passed ? 'pass' : 'fail';
  const summary = passed ? 'Tests: all passed' : 'Tests: failures detected';
  log(`  ${passed ? PASS : FAIL} ${summary}`);
  recordResult('test', status, summary, details);
  return passed;
}

// ── Step 5: Build ───────────────────────────────────────────────────────────

function stepBuild(scope) {
  log(`\n${c.bold('--- Step 5: Build ---')}`);

  const runBackend  = ['all', 'backend', 'changed'].includes(scope);
  const runFrontend = ['all', 'frontend', 'changed'].includes(scope);

  let backendOk = true;
  let frontendOk = true;
  const details = [];

  if (runBackend) {
    const backendDir = join(ROOT_DIR, 'backend');
    const res = runCommand('npx tsc', { cwd: backendDir, timeout: 60_000 });
    backendOk = res.success;
    log(`  backend:  ${res.success ? c.green('build ok') : c.red('build failed')}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').slice(0, 20);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  if (runFrontend) {
    const frontendDir = join(ROOT_DIR, 'frontend');
    const res = runCommand('npx next build', { cwd: frontendDir, timeout: 180_000 });
    frontendOk = res.success;
    log(`  frontend: ${res.success ? c.green('build ok') : c.red('build failed')}`);
    if (!res.success) {
      const lines = (res.output || res.stderr).split('\n').slice(-20);
      lines.forEach(l => { details.push(l); logVerbose(c.dim(`    ${l}`)); });
    }
  }

  const passed = backendOk && frontendOk;
  const status = passed ? 'pass' : 'fail';
  const summary = passed ? 'Build: success' : 'Build: failed';
  log(`  ${passed ? PASS : FAIL} ${summary}`);
  recordResult('build', status, summary, details);
  return passed;
}

// ── Step 6: Cleanup Audit ───────────────────────────────────────────────────

function stepAudit(changedCtx) {
  log(`\n${c.bold('--- Step 6: Cleanup Audit ---')}`);

  const errors = [];
  const warnings = [];

  // Get unified diff of added lines only
  const diffResult = runCommand('git diff -U0 HEAD');
  const addedLines = parseAddedLines(diffResult.output || '');

  // 6a: Debug console.log in added lines
  const excludeConsoleLog = /\.(test|spec)\.(ts|tsx)$|logger|daemon|cli|scripts\//;
  for (const { file, line, lineNum } of addedLines) {
    if (excludeConsoleLog.test(file)) continue;
    if (/console\.log\(/.test(line)) {
      warnings.push(`Debug console.log: ${file}:${lineNum}: ${line.trim()}`);
    }
  }

  // 6b: TODO/FIXME/HACK in added lines
  for (const { file, line, lineNum } of addedLines) {
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
      warnings.push(`New TODO/FIXME: ${file}:${lineNum}: ${line.trim()}`);
    }
  }

  // 6c: Merge conflict markers in all changed files
  for (const file of changedCtx.changedFiles) {
    const absPath = join(ROOT_DIR, file);
    if (!existsSync(absPath)) continue;
    try {
      const stat = statSync(absPath);
      if (stat.size > 1_000_000) continue; // skip very large files
      const content = readFileSync(absPath, 'utf-8');
      if (/^(<{7}|={7}|>{7})\s/m.test(content)) {
        errors.push(`Merge conflict markers: ${file}`);
      }
    } catch { /* skip unreadable files */ }
  }

  // 6d: Sensitive files staged
  const stagedResult = runCommand('git diff --name-only --cached');
  const stagedFiles = (stagedResult.output || '').split('\n').filter(Boolean);
  const sensitivePatterns = /\.(env|pem|key|cert|p12|pfx)$|credentials|secrets\.json|\.secret/i;
  for (const file of stagedFiles) {
    if (sensitivePatterns.test(file)) {
      errors.push(`Sensitive file staged: ${file}`);
    }
  }

  // 6e: Large files in changed set (>500KB)
  for (const file of changedCtx.changedFiles) {
    const absPath = join(ROOT_DIR, file);
    if (!existsSync(absPath)) continue;
    try {
      const stat = statSync(absPath);
      if (stat.size > 500 * 1024) {
        warnings.push(`Large file (${(stat.size / 1024).toFixed(0)}KB): ${file}`);
      }
    } catch { /* skip */ }
  }

  // 6f: --no-verify in staged/changed scripts or config
  // Exclude our own validation infrastructure which references these patterns to block them
  const noVerifyExcludes = /post-agent-check\.mjs$|block-lint-bypass\.sh$|CLAUDE\.md$/;
  for (const file of changedCtx.changedFiles) {
    if (!/\.(sh|mjs|js|ts|json|ya?ml)$/.test(file)) continue;
    if (noVerifyExcludes.test(file)) continue;
    const absPath = join(ROOT_DIR, file);
    if (!existsSync(absPath)) continue;
    try {
      const content = readFileSync(absPath, 'utf-8');
      if (/--no-verify/.test(content)) {
        warnings.push(`Contains --no-verify: ${file}`);
      }
    } catch { /* skip */ }
  }

  // Report
  if (errors.length === 0 && warnings.length === 0) {
    log(`  ${PASS} Cleanup audit: all clear`);
    recordResult('audit', 'pass', 'Cleanup audit: all clear');
    return true;
  }

  if (errors.length > 0) {
    log(`  ${FAIL} ${errors.length} error(s):`);
    errors.forEach(e => log(`    ${c.red('ERROR')}: ${e}`));
  }
  if (warnings.length > 0) {
    log(`  ${WARN} ${warnings.length} warning(s):`);
    warnings.forEach(w => log(`    ${c.yellow('WARN')}: ${w}`));
  }

  const status = errors.length > 0 ? 'fail' : 'warn';
  const summary = `Audit: ${errors.length} error(s), ${warnings.length} warning(s)`;
  recordResult('audit', status, summary, [...errors, ...warnings]);
  return errors.length === 0;
}

/**
 * Parse a unified diff to extract added lines with file and line number context.
 */
function parseAddedLines(diffOutput) {
  const lines = diffOutput.split('\n');
  const added = [];
  let currentFile = null;
  let currentLineNum = 0;

  for (const line of lines) {
    // Match diff file header: +++ b/path/to/file
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Match hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLineNum = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Added line (starts with + but not +++)
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (currentFile) {
        added.push({
          file: currentFile,
          line: line.slice(1), // remove leading +
          lineNum: currentLineNum,
        });
      }
      currentLineNum++;
      continue;
    }

    // Context line (starts with space) - advance line counter
    if (line.startsWith(' ')) {
      currentLineNum++;
      continue;
    }

    // Removed line (starts with -) - don't advance new-file line counter
  }

  return added;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const steps = resolveSteps();
  const scope = opts.scope || 'changed';

  if (!opts.json) {
    log(c.bold('\n======================================'));
    log(c.bold('  Post-Agent Validation Report'));
    log(c.bold('======================================'));
    log(c.dim(`  scope: ${scope} | steps: ${steps.join(', ')}`));
  }

  // Step 1: always runs to determine scope
  let changedCtx = { changedFiles: [], backendFiles: [], frontendFiles: [], scriptFiles: [], otherFiles: [] };
  if (steps.includes('git')) {
    changedCtx = stepGitStatus();
  }

  // If scope is 'changed' and nothing changed, short-circuit
  if (scope === 'changed' && changedCtx.changedFiles.length === 0) {
    log(`\n  ${INFO} No changes detected. Nothing to validate.`);
    if (opts.json) {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), scope, steps: results, result: 'pass', errorCount: 0, warningCount: 0 }, null, 2));
    } else {
      log(c.bold('\n======================================'));
      log(c.bold(`  Result: ${c.green('PASS')} (no changes)`));
      log(c.bold('======================================\n'));
    }
    process.exit(0);
  }

  // Run remaining steps
  let hasFailure = false;

  if (steps.includes('typecheck')) {
    if (!stepTypeCheck(scope, changedCtx)) hasFailure = true;
  }

  if (steps.includes('lint')) {
    if (!stepLint(scope, changedCtx)) hasFailure = true;
  }

  if (steps.includes('test')) {
    if (!stepTest(scope, changedCtx)) hasFailure = true;
  }

  if (steps.includes('build')) {
    if (!stepBuild(scope)) hasFailure = true;
  } else if (!opts.json) {
    log(`\n  ${SKIP} Step 5: Build (use --steps build or npm run check:full to include)`);
    recordResult('build', 'skip', 'Skipped (use --steps build to include)');
  }

  if (steps.includes('audit')) {
    if (!stepAudit(changedCtx)) hasFailure = true;
  }

  // Summary
  const errorCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;

  if (opts.json) {
    const output = {
      timestamp: new Date().toISOString(),
      scope,
      steps: results.reduce((acc, r) => { acc[r.name] = { status: r.status, summary: r.summary, details: r.details }; return acc; }, {}),
      result: hasFailure ? 'fail' : 'pass',
      errorCount,
      warningCount: warnCount,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    log(c.bold('\n======================================'));
    if (hasFailure) {
      log(c.bold(`  Result: ${c.red('FAIL')} (${errorCount} failed, ${warnCount} warnings)`));
    } else if (warnCount > 0) {
      log(c.bold(`  Result: ${c.green('PASS')} (${warnCount} warnings)`));
    } else {
      log(c.bold(`  Result: ${c.green('PASS')}`));
    }
    log(c.bold('======================================\n'));
  }

  process.exit(hasFailure ? 1 : 0);
}

main();
