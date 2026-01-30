#!/usr/bin/env node
/**
 * Task Retrieval Daemon
 *
 * Polls a saved search (view), retrieves tasks, and executes them with Claude (or a custom command).
 * Assembles prompts from multiple sources: base prompt + agent prompt + workflow step prompt + task prompt.
 * Parses JSON responses and handles stage transitions.
 *
 * Usage:
 *   node scripts/task-daemon.mjs                   # Start all enabled jobs from config
 *   node scripts/task-daemon.mjs --job <name>      # Start a specific job
 *   node scripts/task-daemon.mjs --view <viewId>   # Start with a specific view (no config)
 *   node scripts/task-daemon.mjs --stop            # Stop all running daemon jobs
 *   node scripts/task-daemon.mjs --status          # Show status of running jobs
 *
 * Options:
 *   --config, -c <file>   Config file (default: scripts/daemon-jobs.yaml)
 *   --job, -j <name>      Run a specific job from config
 *   --view, -v <id>       View ID to poll (if not using config)
 *   --api-key, -k <key>   API key for authentication (or MATRIX_API_KEY env)
 *   --api-url, -u <url>   API base URL (default: http://localhost:3001/api)
 *   --interval, -i <ms>   Polling interval in ms (default: 5000)
 *   --once, -o            Run once and exit (don't poll)
 *   --exec, -e <cmd>      Command to execute (default: "claude")
 *   --dry-run, -d         Don't execute, just show what would be done
 *   --no-update, -n       Don't update task status after execution
 *   --stop                Stop all running daemon jobs
 *   --status              Show status of running daemon jobs
 *   --list, -l            List available jobs from config
 *   --help, -h            Show help
 *
 * Environment Variables:
 *   MATRIX_API_KEY    API key for authentication
 *   MATRIX_API_URL    API base URL
 *   MATRIX_VIEW_ID    Default view ID to poll
 *   MATRIX_EXEC_CMD   Default command to execute (default: "claude")
 */

import { parseArgs } from 'node:util';
import { execSync, spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync, createWriteStream, readdirSync, statSync, openSync, closeSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Get script directory for default config path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG_PATH = join(__dirname, 'daemon-jobs.yaml');
const PID_DIR = join(homedir(), '.matrix-daemon');

// Track active child process for graceful shutdown
let activeChildProcess = null;
let shuttingDown = false;

// ============================================================================
// Logger - Structured logging with levels and colors
// ============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

class Logger {
  constructor(options = {}) {
    this.level = LOG_LEVELS[options.level || 'info'];
    this.prefix = options.prefix || '';
    this.useColors = options.colors !== false && process.stdout.isTTY;
  }

  _color(color, text) {
    return this.useColors ? `${COLORS[color]}${text}${COLORS.reset}` : text;
  }

  _timestamp() {
    return new Date().toISOString();
  }

  _format(level, msg, data) {
    const ts = this._color('dim', this._timestamp());
    const prefix = this.prefix ? this._color('cyan', `[${this.prefix}]`) : '';
    let levelStr;
    switch (level) {
      case 'debug': levelStr = this._color('gray', 'DBG'); break;
      case 'info': levelStr = this._color('blue', 'INF'); break;
      case 'warn': levelStr = this._color('yellow', 'WRN'); break;
      case 'error': levelStr = this._color('red', 'ERR'); break;
      default: levelStr = level.toUpperCase();
    }
    const parts = [ts, levelStr];
    if (prefix) parts.push(prefix);
    parts.push(msg);
    if (data !== undefined) {
      if (typeof data === 'object') {
        parts.push(this._color('dim', JSON.stringify(data)));
      } else {
        parts.push(this._color('dim', String(data)));
      }
    }
    return parts.join(' ');
  }

  debug(msg, data) {
    if (this.level <= LOG_LEVELS.debug) console.log(this._format('debug', msg, data));
  }

  info(msg, data) {
    if (this.level <= LOG_LEVELS.info) console.log(this._format('info', msg, data));
  }

  warn(msg, data) {
    if (this.level <= LOG_LEVELS.warn) console.warn(this._format('warn', msg, data));
  }

  error(msg, data) {
    if (this.level <= LOG_LEVELS.error) console.error(this._format('error', msg, data));
  }

  // Special logging for task processing
  task(taskId, title, msg) {
    const taskStr = this._color('cyan', `[${taskId.slice(-8)}]`);
    const titleStr = this._color('bold', title.slice(0, 40));
    console.log(`${this._color('dim', this._timestamp())} ${taskStr} ${titleStr} ${msg}`);
  }

  // Separator for visual clarity
  separator(char = '─', length = 60) {
    console.log(this._color('dim', char.repeat(length)));
  }

  // Header box
  header(lines) {
    const width = 60;
    console.log(this._color('cyan', '╔' + '═'.repeat(width - 2) + '╗'));
    for (const line of lines) {
      const padding = Math.max(0, width - 4 - line.length);
      console.log(this._color('cyan', '║ ') + line + ' '.repeat(padding) + this._color('cyan', ' ║'));
    }
    console.log(this._color('cyan', '╚' + '═'.repeat(width - 2) + '╝'));
  }
}

// Global logger instance (will be configured based on CLI args)
let log = new Logger({ level: 'info' });

// ============================================================================
// Base Daemon Prompt - Ensures JSON responses
// ============================================================================

const BASE_DAEMON_PROMPT = `You are a task automation agent. You MUST respond with valid JSON only - no markdown, no explanation, just the JSON object.

Response schema:
{
  "status": "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED",
  "summary": "1-2 sentence summary of what was done",
  "output": { /* Structured result object - schema defined by task/workflow */ },
  "nextAction": "COMPLETE" | "CONTINUE" | "ESCALATE" | "HOLD" | "ASK",
  "nextActionReason": "Optional: reason for CONTINUE/ESCALATE/HOLD/ASK",
  "questions": [ /* Only for nextAction: ASK - questions for human to answer */ ],
  "metadata": {
    "confidence": 0.0-1.0,
    "suggestedTags": [],
    "suggestedNextStage": null
  }
}

## Asking Questions (nextAction: ASK)

When you need human input to proceed, use nextAction: "ASK" and include a "questions" array.
The task will be placed on hold and the human can answer questions through the UI.

Questions schema:
{
  "questions": [
    {
      "id": "unique-question-id",
      "type": "text" | "choice" | "multiselect" | "confirm" | "number",
      "question": "The question to ask",
      "description": "Optional longer explanation",
      "required": true | false,
      "options": [ /* For choice/multiselect types */
        { "value": "opt1", "label": "Option 1", "description": "Optional description" }
      ],
      "placeholder": "Optional placeholder text",
      "defaultValue": "Optional default",
      "validation": { /* Optional */
        "min": 0, "max": 100,           /* For number type */
        "minLength": 1, "maxLength": 500 /* For text type */
      }
    }
  ],
  "context": "Optional explanation of why you need this information"
}

Example - asking for clarification:
{
  "status": "BLOCKED",
  "summary": "Need clarification on deployment target",
  "output": { "partialWork": "Prepared deployment configs" },
  "nextAction": "ASK",
  "nextActionReason": "Cannot proceed without knowing the deployment environment",
  "questions": [
    {
      "id": "deploy-env",
      "type": "choice",
      "question": "Which environment should this be deployed to?",
      "required": true,
      "options": [
        { "value": "staging", "label": "Staging", "description": "Test environment" },
        { "value": "production", "label": "Production", "description": "Live environment" }
      ]
    },
    {
      "id": "notify-team",
      "type": "confirm",
      "question": "Should I notify the team after deployment?",
      "defaultValue": true
    }
  ],
  "context": "The task mentions deployment but doesn't specify the target environment."
}

Rules:
- status: SUCCESS if task fully completed, PARTIAL if partially done, BLOCKED if cannot proceed, FAILED if error
- nextAction: COMPLETE to finish, CONTINUE to spawn follow-up, ESCALATE for human help, HOLD to pause, ASK to request human input
- output: A structured JSON object containing your work result. Follow the schema specified in the workflow/task instructions.
- questions: Only include when nextAction is ASK. Task will resume after human answers.
- Respond with ONLY the JSON object, nothing else`;

// ============================================================================
// PID File Management
// ============================================================================

function ensurePidDir() {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

function getPidFile(jobName) {
  return join(PID_DIR, `${jobName}.pid`);
}

function getLogFile(jobName) {
  return join(PID_DIR, `${jobName}.log`);
}

function getStatusFile(jobName) {
  return join(PID_DIR, `${jobName}.status.json`);
}

function savePid(jobName, pid) {
  ensurePidDir();
  writeFileSync(getPidFile(jobName), String(pid));
}

// Runtime stats for daemon status
const stats = {
  startedAt: null,
  tasksProcessed: 0,
  tasksSucceeded: 0,
  tasksFailed: 0,
  lastTaskAt: null,
  lastTaskId: null,
  lastTaskTitle: null,
  lastError: null,
  currentTask: null,
};

function saveStatus(jobName, extraData = {}) {
  ensurePidDir();
  const status = {
    ...stats,
    ...extraData,
    updatedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(getStatusFile(jobName), JSON.stringify(status, null, 2));
  } catch {}
}

function readStatus(jobName) {
  const statusFile = getStatusFile(jobName);
  if (!existsSync(statusFile)) return null;
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    return null;
  }
}

function removeStatus(jobName) {
  const statusFile = getStatusFile(jobName);
  try { unlinkSync(statusFile); } catch {}
}

function readPid(jobName) {
  const pidFile = getPidFile(jobName);
  if (!existsSync(pidFile)) return null;
  try {
    return parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  } catch {
    return null;
  }
}

function removePid(jobName) {
  const pidFile = getPidFile(jobName);
  try { unlinkSync(pidFile); } catch {}
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningJobs() {
  ensurePidDir();
  const jobs = [];
  try {
    const files = readdirSync(PID_DIR);
    for (const file of files) {
      if (file.endsWith('.pid')) {
        const jobName = file.replace('.pid', '');
        const pid = readPid(jobName);
        if (pid && isProcessRunning(pid)) {
          jobs.push({ name: jobName, pid });
        } else if (pid) {
          // Stale PID file, clean up
          removePid(jobName);
        }
      }
    }
  } catch {}
  return jobs;
}

function stopAllJobs(jobFilter = null) {
  const running = getRunningJobs();
  const toStop = jobFilter
    ? running.filter(j => j.name === jobFilter)
    : running;

  if (toStop.length === 0) {
    if (jobFilter) {
      console.log(`Job "${jobFilter}" is not running.`);
    } else {
      console.log('No daemon jobs are running.');
    }
    return;
  }

  console.log(`Stopping ${toStop.length} daemon job(s)...`);
  for (const { name, pid } of toStop) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`  ✓ Stopped ${name} (PID ${pid})`);
      removePid(name);
      removeStatus(name);
    } catch (e) {
      console.log(`  ✗ Failed to stop ${name} (PID ${pid}): ${e.message}`);
    }
  }
}

function formatDuration(ms) {
  if (!ms) return 'N/A';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'never';
  const ms = Date.now() - new Date(isoString).getTime();
  return formatDuration(ms) + ' ago';
}

function showStatus(verbose = false) {
  const running = getRunningJobs();

  console.log('\n' + COLORS.cyan + '╔' + '═'.repeat(68) + '╗' + COLORS.reset);
  console.log(COLORS.cyan + '║' + COLORS.reset + '  Daemon Job Status' + ' '.repeat(49) + COLORS.cyan + '║' + COLORS.reset);
  console.log(COLORS.cyan + '╚' + '═'.repeat(68) + '╝' + COLORS.reset);

  if (running.length === 0) {
    console.log('\n  No daemon jobs are running.\n');
    console.log(`  ${COLORS.dim}Start jobs:     node scripts/task-daemon.mjs${COLORS.reset}`);
    console.log(`  ${COLORS.dim}Start one job:  node scripts/task-daemon.mjs --job <name>${COLORS.reset}`);
    console.log(`  ${COLORS.dim}Logs directory: ${PID_DIR}${COLORS.reset}\n`);
    return;
  }

  // Show PID summary table first
  console.log('');
  console.log(`  ${COLORS.bold}Running Jobs (${running.length})${COLORS.reset}`);
  console.log(`  ${'─'.repeat(50)}`);
  for (const { name, pid } of running) {
    const status = readStatus(name);
    const indicator = status?.currentTask ? COLORS.yellow + '⟳' : COLORS.green + '●';
    console.log(`  ${indicator}${COLORS.reset}  ${COLORS.bold}PID ${String(pid).padEnd(6)}${COLORS.reset}  ${name}`);
  }
  console.log(`  ${'─'.repeat(50)}`);

  // Show detailed info for each job
  for (const { name, pid } of running) {
    const status = readStatus(name);
    const logFile = getLogFile(name);
    const logExists = existsSync(logFile);
    const logSize = logExists ? statSync(logFile).size : 0;

    console.log('');
    console.log(`  ${COLORS.cyan}▸${COLORS.reset} ${COLORS.bold}${name}${COLORS.reset}  ${COLORS.yellow}PID ${pid}${COLORS.reset}`);

    if (status) {
      const uptime = status.startedAt ? Date.now() - new Date(status.startedAt).getTime() : 0;
      const successRate = status.tasksProcessed > 0
        ? ((status.tasksSucceeded / status.tasksProcessed) * 100).toFixed(0) + '%'
        : 'N/A';

      console.log(`    Uptime:     ${formatDuration(uptime)}`);
      console.log(`    Tasks:      ${status.tasksProcessed} processed (${COLORS.green}${status.tasksSucceeded} ok${COLORS.reset}, ${COLORS.red}${status.tasksFailed} failed${COLORS.reset}) - ${successRate}`);
      console.log(`    Last task:  ${status.lastTaskAt ? formatTimeAgo(status.lastTaskAt) : 'never'}`);

      if (status.currentTask) {
        console.log(`    ${COLORS.yellow}Processing:${COLORS.reset} ${status.currentTask.slice(0, 40)}...`);
      }

      if (status.lastError && verbose) {
        console.log(`    ${COLORS.red}Last error:${COLORS.reset} ${status.lastError.slice(0, 60)}...`);
      }
    } else {
      console.log(`    ${COLORS.dim}(no status data available)${COLORS.reset}`);
    }

    if (logExists) {
      const sizeStr = logSize > 1024*1024
        ? `${(logSize / (1024*1024)).toFixed(1)}MB`
        : `${(logSize / 1024).toFixed(0)}KB`;
      console.log(`    Log:        ${logFile} (${sizeStr})`);
    }
  }

  console.log('');
  console.log(`  ${COLORS.bold}Quick Commands${COLORS.reset}`);
  console.log(`    kill <PID>               Kill a specific job by PID`);
  console.log(`    --logs <job>             Tail logs for a job`);
  console.log(`    --stop                   Stop all jobs`);
  console.log(`    --stop --job <name>      Stop a specific job`);
  console.log(`    --restart                Restart all jobs`);
  console.log('');
}

function tailLogs(jobName, lines = 50) {
  const logFile = getLogFile(jobName);

  if (!existsSync(logFile)) {
    console.error(`No log file found for job "${jobName}"`);
    console.error(`Expected: ${logFile}`);
    return;
  }

  console.log(`${COLORS.dim}Tailing ${logFile}...${COLORS.reset}\n`);

  // Use tail -f to follow the log
  const tail = spawn('tail', ['-f', '-n', String(lines), logFile], {
    stdio: 'inherit'
  });

  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}

function restartJob(jobName, configPath) {
  // Stop the job first
  stopAllJobs(jobName);

  // Wait a moment then restart
  console.log(`\nRestarting ${jobName || 'all jobs'}...`);

  setTimeout(() => {
    const args = ['--config', configPath];
    if (jobName) {
      args.push('--job', jobName);
    }

    const child = spawn('node', [__filename, ...args], {
      stdio: 'inherit',
      detached: false,
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });
  }, 1000);
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return null;
  }

  const content = readFileSync(configPath, 'utf8');

  // Parse as YAML (also handles JSON)
  try {
    return parseYaml(content);
  } catch (e) {
    console.error(`Error parsing config file: ${e.message}`);
    process.exit(1);
  }
}

function listJobs(configData) {
  console.log('\nAvailable jobs:');
  console.log('─'.repeat(60));

  if (!configData.jobs || Object.keys(configData.jobs).length === 0) {
    console.log('  (no jobs defined)');
    return;
  }

  for (const [name, job] of Object.entries(configData.jobs)) {
    const enabled = job.enabled !== false ? '✓' : '✗';
    const exec = job.exec || configData.defaults?.exec || 'claude';
    console.log(`  ${enabled} ${name}`);
    console.log(`      view: ${job.viewId || '(missing)'}`);
    console.log(`      exec: ${exec}`);
    if (job.description) {
      console.log(`      desc: ${job.description}`);
    }
  }
  console.log('');
}

function parseConfig() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      job: { type: 'string', short: 'j' },
      list: { type: 'boolean', short: 'l' },
      view: { type: 'string', short: 'v' },
      'api-key': { type: 'string', short: 'k' },
      'api-url': { type: 'string', short: 'u' },
      interval: { type: 'string', short: 'i' },
      timeout: { type: 'string', short: 't' },
      once: { type: 'boolean', short: 'o' },
      exec: { type: 'string', short: 'e' },
      'dry-run': { type: 'boolean', short: 'd' },
      'no-update': { type: 'boolean', short: 'n' },
      foreground: { type: 'boolean', short: 'f' },
      stop: { type: 'boolean' },
      status: { type: 'boolean' },
      verbose: { type: 'boolean', short: 'V' },
      logs: { type: 'string' },
      restart: { type: 'boolean' },
      'log-level': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  // Configure logger based on verbosity
  const logLevel = values['log-level'] || (values.verbose ? 'debug' : 'info');
  log = new Logger({ level: logLevel });

  // Handle --logs command
  if (values.logs) {
    tailLogs(values.logs);
    return { mode: 'exit' };
  }

  // Handle --stop command
  if (values.stop) {
    stopAllJobs(values.job || null);
    process.exit(0);
  }

  // Handle --restart command
  if (values.restart) {
    const configPath = values.config || DEFAULT_CONFIG_PATH;
    restartJob(values.job || null, configPath);
    return { mode: 'exit' };
  }

  // Handle --status command
  if (values.status) {
    showStatus(values.verbose);
    process.exit(0);
  }

  if (values.help) {
    console.log(`
${COLORS.cyan}╔════════════════════════════════════════════════════════════════════╗
║  Task Daemon - AI-powered task processor                           ║
╚════════════════════════════════════════════════════════════════════╝${COLORS.reset}

${COLORS.bold}QUICK REFERENCE${COLORS.reset}
  ${COLORS.green}Start all jobs:${COLORS.reset}    npm run daemon
  ${COLORS.green}Start one job:${COLORS.reset}     npm run daemon -- --job <name>
  ${COLORS.green}Check status:${COLORS.reset}      npm run daemon:status
  ${COLORS.green}View logs:${COLORS.reset}         npm run daemon -- --logs <job>
  ${COLORS.green}Stop all:${COLORS.reset}          npm run daemon:stop
  ${COLORS.green}List jobs:${COLORS.reset}         npm run daemon -- --list

${COLORS.bold}STARTING JOBS${COLORS.reset}
  (no args)                      Start all enabled jobs from config (background)
  --job, -j <name>               Start a specific job (background by default)
  --job <name> --foreground, -f  Start a job in foreground (attached)
  --view, -v <id>                Start with view ID only (foreground, no config)
  --once, -o                     Run once and exit (don't poll continuously)
  --dry-run, -d                  Show prompts without executing

${COLORS.bold}MANAGING JOBS${COLORS.reset}
  --status                       Show all running jobs with PIDs and stats
  --status --verbose, -V         Show verbose status with error details
  --logs <job>                   Tail logs for a job (Ctrl+C to exit)
  --stop                         Stop all running daemon jobs
  --stop --job <name>            Stop a specific job
  --restart                      Restart all running jobs
  --restart --job <name>         Restart a specific job
  --list, -l                     List available jobs from config file

${COLORS.bold}CONFIGURATION${COLORS.reset}
  --config, -c <file>            Config file (default: scripts/daemon-jobs.yaml)
  --api-key, -k <key>            API key (or MATRIX_API_KEY env)
  --api-url, -u <url>            API URL (default: http://localhost:3001/api)
  --interval, -i <ms>            Polling interval (default: 5000)
  --timeout, -t <ms>             Command execution timeout (default: 600000 = 10min)
  --exec, -e <cmd>               Command to run (default: "claude")
  --no-update, -n                Don't update task status after execution
  --log-level <level>            Log level: debug, info, warn, error

${COLORS.bold}CONFIG FILE FORMAT${COLORS.reset} (YAML)
  defaults:
    apiUrl: https://api.example.com/api
    apiKey: cm_ak_live_xxxxx
    interval: 5000
    timeout: 600000    # 10 min command timeout
    exec: claude

  jobs:
    content-review:
      description: Review content tasks
      viewId: abc123def456
      exec: "claude --model claude-sonnet-4-20250514"

    triage:
      enabled: false  # disable a job
      viewId: xyz789

${COLORS.bold}HOW IT WORKS${COLORS.reset}
  1. Daemon polls a saved view for pending tasks
  2. Assembles prompt: base + agent + workflow step + task context
  3. Executes command (claude by default) with assembled prompt
  4. Parses JSON response and updates task status:
     - COMPLETE → completed    - ESCALATE → on_hold
     - CONTINUE → completed + follow-up task
  5. Stores output in task metadata

${COLORS.bold}EXAMPLES${COLORS.reset}
  npm run daemon                              # Start all jobs
  npm run daemon -- --job content-review      # Start one job
  npm run daemon -- --job triage --once       # Run once and exit
  npm run daemon -- --view abc123 --dry-run   # Test without executing
  npm run daemon -- --logs content-review     # Tail job logs
`);
    process.exit(0);
  }

  // Load config file (use default if not specified)
  const configPath = values.config || DEFAULT_CONFIG_PATH;
  let configData = loadConfigFile(configPath);

  // Handle --list command
  if (values.list) {
    if (!configData) {
      console.error(`Error: Config file not found: ${configPath}`);
      process.exit(1);
    }
    listJobs(configData);
    process.exit(0);
  }

  // Build config from file + CLI overrides
  let viewId, apiKey, apiUrl, interval, execCmd, maxPayloadSize, timeout;

  if (configData && values.job) {
    // Load from config file with job name
    const job = configData.jobs?.[values.job];
    if (!job) {
      console.error(`Error: Job "${values.job}" not found in config file`);
      console.log('\nAvailable jobs:');
      for (const name of Object.keys(configData.jobs || {})) {
        console.log(`  - ${name}`);
      }
      process.exit(1);
    }

    if (job.enabled === false) {
      console.error(`Error: Job "${values.job}" is disabled`);
      process.exit(1);
    }

    // If not foreground mode, start job in background
    if (!values.foreground && !values['dry-run'] && !values.once) {
      return {
        mode: 'start-job',
        jobName: values.job,
        configData,
        configPath,
        once: values.once || false,
      };
    }

    const defaults = configData.defaults || {};

    // Job settings override defaults, CLI overrides everything
    viewId = values.view || job.viewId || defaults.viewId;
    apiKey = values['api-key'] || job.apiKey || defaults.apiKey || process.env.MATRIX_API_KEY || '';
    apiUrl = values['api-url'] || job.apiUrl || defaults.apiUrl || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
    interval = parseInt(values.interval || job.interval || defaults.interval || '5000', 10);
    execCmd = values.exec || job.exec || defaults.exec || process.env.MATRIX_EXEC_CMD || 'claude';
    maxPayloadSize = parseInt(values['max-payload-size'] || job.maxPayloadSize || defaults.maxPayloadSize || '200000', 10);
    timeout = parseInt(values.timeout || job.timeout || defaults.timeout || '600000', 10);
  } else if (values.view) {
    // Use CLI args / env vars only (explicit --view provided)
    viewId = values.view;
    apiKey = values['api-key'] || process.env.MATRIX_API_KEY || '';
    apiUrl = values['api-url'] || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
    interval = parseInt(values.interval || '5000', 10);
    execCmd = values.exec || process.env.MATRIX_EXEC_CMD || 'claude';
    maxPayloadSize = parseInt(values['max-payload-size'] || '200000', 10);
    timeout = parseInt(values.timeout || '600000', 10);
  } else if (configData && !values.job) {
    // No job or view specified - start all enabled jobs as background processes
    return {
      mode: 'start-all',
      configData,
      configPath,
      once: values.once || false,
    };
  } else {
    // No config file and no view
    console.error('Error: No config file found and no --view specified');
    console.error(`  Config tried: ${configPath}`);
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/task-daemon.mjs                   # Start all jobs from config');
    console.error('  node scripts/task-daemon.mjs --view <viewId>   # Start with specific view');
    console.error('  node scripts/task-daemon.mjs --job <name>      # Start specific job');
    process.exit(1);
  }

  return {
    mode: 'single',
    jobName: values.job || null,
    viewId,
    apiKey,
    apiUrl,
    interval,
    once: values.once || false,
    exec: execCmd,
    dryRun: values['dry-run'] || false,
    noUpdate: values['no-update'] || false,
    maxPayloadSize,
    timeout,
  };
}

// ============================================================================
// API Helpers
// ============================================================================

// Default API request timeout (30 seconds)
const API_TIMEOUT = 30000;

function getHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    'Connection': 'close',  // Force new connection to avoid stale connection issues
  };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  return headers;
}

/**
 * Fetch with timeout support to prevent hanging on unresponsive APIs
 */
async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchNextTask(config) {
  const url = `${config.apiUrl}/views/${config.viewId}/tasks?limit=1&resolveReferences=true`;
  log.debug(`Fetching next task from view`);

  try {
    const response = await fetchWithTimeout(url, { headers: getHeaders(config) });
    if (!response.ok) {
      const error = await response.text();
      log.error(`API Error (${response.status}): ${error}`);
      return null;
    }

    const result = await response.json();
    if (result.data && result.data.length > 0) {
      log.debug(`Found task: "${result.data[0].title}" (${result.data[0]._id})`);
      return result.data[0];
    }

    log.debug(`No tasks in queue`);
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      log.error('API request timed out');
    } else {
      log.error('Fetch error:', error.message || error);
    }
    return null;
  }
}

async function fetchUser(config, userId) {
  if (!userId) return null;

  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/users/${userId}`, {
      headers: getHeaders(config),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

async function fetchWorkflow(config, workflowId) {
  if (!workflowId) return null;

  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/workflows/${workflowId}`, {
      headers: getHeaders(config),
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.data;
  } catch {
    return null;
  }
}

async function updateTask(config, taskId, updates) {
  if (config.noUpdate) {
    console.log(`[Skip update] Would update task ${taskId}:`, updates);
    return true;
  }

  // Truncate executionLog in metadata if too long (keep under 100KB)
  if (updates.metadata?.executionLog && updates.metadata.executionLog.length > 100000) {
    console.log(`[DEBUG] Truncating executionLog from ${updates.metadata.executionLog.length} to 100000 chars`);
    updates.metadata.executionLog = updates.metadata.executionLog.substring(0, 100000) + '\n\n[truncated]';
  }

  try {
    const bodyStr = JSON.stringify(updates);
    console.log(`[DEBUG] Update payload size: ${Math.round(bodyStr.length / 1024)}KB`);
    const response = await fetchWithTimeout(`${config.apiUrl}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: getHeaders(config),
      body: bodyStr,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update task (${response.status}): ${error}`);
      return false;
    }
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Update task request timed out');
    } else {
      console.error('Update error:', error.message || error);
      // Log additional error details for debugging
      if (error.cause) console.error('  Cause:', error.cause);
      if (error.code) console.error('  Code:', error.code);
      if (error.stack) console.error('  Stack:', error.stack.split('\n').slice(0, 3).join('\n'));
    }
    return false;
  }
}

async function createTask(config, taskData) {
  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/tasks`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(taskData),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create task (${response.status}): ${error}`);
      return null;
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Create task request timed out');
    } else {
      console.error('Create task error:', error.message || error);
    }
    return null;
  }
}

async function addTaskComment(config, taskId, comment) {
  if (config.noUpdate) {
    console.log(`[Skip comment] Would add comment to task ${taskId}: ${comment}`);
    return true;
  }

  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/activity-logs/task/${taskId}/comments`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        comment,
        actorType: 'daemon',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to add comment (${response.status}): ${error}`);
      return false;
    }
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Add comment request timed out');
    } else {
      console.error('Add comment error:', error.message || error);
    }
    return false;
  }
}

// ============================================================================
// Document Operations
// ============================================================================

async function searchDocuments(config, query) {
  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/documents/search`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to search documents (${response.status}): ${error}`);
      return [];
    }
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Document search request timed out');
    } else {
      console.error('Document search error:', error.message || error);
    }
    return [];
  }
}

async function createDocument(config, documentData) {
  if (config.noUpdate) {
    console.log(`[Skip create] Would create document:`, documentData.title);
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/documents`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(documentData),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create document (${response.status}): ${error}`);
      return null;
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Create document request timed out');
    } else {
      console.error('Create document error:', error.message || error);
    }
    return null;
  }
}

async function updateDocument(config, documentId, updates) {
  if (config.noUpdate) {
    console.log(`[Skip update] Would update document ${documentId}:`, updates);
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/documents/${documentId}`, {
      method: 'PATCH',
      headers: getHeaders(config),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update document (${response.status}): ${error}`);
      return null;
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Update document request timed out');
    } else {
      console.error('Update document error:', error.message || error);
    }
    return null;
  }
}

async function processDocumentOperations(config, taskId, documentOperations) {
  const results = [];

  for (const op of documentOperations) {
    switch (op.action) {
      case 'create': {
        console.log(`[Document] Creating document: ${op.document?.title}`);
        const doc = await createDocument(config, {
          title: op.document?.title || 'Untitled',
          content: op.document?.content || '',
          summary: op.document?.summary,
          type: op.document?.type || 'output',
          status: op.document?.status || 'draft',
          tags: op.document?.tags,
        });
        if (doc) {
          results.push({ action: 'create', success: true, documentId: doc._id, title: doc.title });
          // Link to task
          try {
            await fetchWithTimeout(`${config.apiUrl}/documents/${doc._id}/link-task`, {
              method: 'POST',
              headers: getHeaders(config),
              body: JSON.stringify({ taskId }),
            });
          } catch (linkErr) {
            console.warn(`[Document] Failed to link document to task: ${linkErr.message}`);
          }
        } else {
          results.push({ action: 'create', success: false, error: 'Failed to create document' });
        }
        break;
      }
      case 'update': {
        console.log(`[Document] Updating document: ${op.documentId}`);
        const updated = await updateDocument(config, op.documentId, op.changes);
        if (updated) {
          results.push({ action: 'update', success: true, documentId: op.documentId });
        } else {
          results.push({ action: 'update', success: false, documentId: op.documentId, error: 'Failed to update document' });
        }
        break;
      }
      case 'search': {
        console.log(`[Document] Searching: ${op.prompt}`);
        const searchResults = await searchDocuments(config, {
          prompt: op.prompt,
          type: op.type,
          status: op.status,
          tags: op.tags,
          limit: op.limit || 5,
        });
        results.push({
          action: 'search',
          success: true,
          query: op.prompt,
          resultsCount: searchResults.length,
          storeAs: op.storeResultsAs,
          results: searchResults.map(r => ({
            documentId: r.document._id,
            title: r.document.title,
            score: r.score,
          })),
        });
        break;
      }
      default:
        console.warn(`[Document] Unknown operation: ${op.action}`);
        results.push({ action: op.action, success: false, error: 'Unknown operation' });
    }
  }

  return results;
}

// ============================================================================
// Prompt Assembly
// ============================================================================

function assemblePrompt(task, agent, workflowStep) {
  const sections = [];

  // 1. Base daemon prompt (ensures JSON output)
  sections.push(BASE_DAEMON_PROMPT);

  // 2. Agent prompt (persona, capabilities)
  if (agent?.isAgent && agent?.agentPrompt) {
    sections.push(`## Agent Role\n${agent.agentPrompt}`);
  }

  // 3. Workflow step prompt (stage-specific instructions)
  // Note: UI saves to 'additionalInstructions', legacy code may use 'prompt'
  const stepPrompt = workflowStep?.prompt || workflowStep?.additionalInstructions;
  if (stepPrompt) {
    sections.push(`## Workflow Step: ${workflowStep.name}\n${stepPrompt}`);
  }

  // 4. Output schema (if specified by workflow step)
  if (workflowStep?.outputSchema) {
    const schemaStr = typeof workflowStep.outputSchema === 'string'
      ? workflowStep.outputSchema
      : JSON.stringify(workflowStep.outputSchema, null, 2);
    sections.push(`## Output Schema\nYour "output" field in the response MUST be a JSON object matching this schema:\n\`\`\`json\n${schemaStr}\n\`\`\``);
  }

  // 5. Task-specific prompt
  if (task.extraPrompt) {
    sections.push(`## Task Instructions\n${task.extraPrompt}`);
  }

  // 6. Task context as structured data
  // Note: inputPayload contains webhook/external input data (e.g., email content)
  const context = {
    title: task.title,
    summary: task.summary || null,
    tags: task.tags || [],
    executionLog: task.metadata?.executionLog || null,
    workflowStage: task.workflowStage || null,
    inputPayload: task.metadata?.inputPayload || null,
  };
  sections.push(`## Task Context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);

  // 7. Referenced documents (from findDocument step or task links)
  // Check for documents stored by findDocument step
  const foundDocsKeys = Object.keys(task.metadata || {}).filter(k =>
    k === 'foundDocuments' || k.endsWith('Documents') || k.endsWith('Doc') || k.endsWith('Docs')
  );
  for (const key of foundDocsKeys) {
    const docs = task.metadata[key];
    if (Array.isArray(docs) && docs.length > 0) {
      sections.push(`## Referenced Documents (${key})\nThe following documents were found and are available for reference:\n\`\`\`json\n${JSON.stringify(docs, null, 2)}\n\`\`\``);
    }
  }

  // 7.5. Include answered questions from previous ASK action
  // When a task was put on hold with ASK and questions were answered, include those answers
  const previousOutput = task.metadata?.output;
  if (previousOutput?.action === 'ASK' && previousOutput?.questions?.answers) {
    const questionsData = previousOutput.questions;
    const answeredSection = {
      context: questionsData.context || 'You previously asked questions and received these answers:',
      questions: questionsData.questions,
      answers: questionsData.answers,
      answeredAt: questionsData.answeredAt,
    };
    sections.push(`## Previous Questions Answered\nYou previously asked questions and the human has provided answers. Use these answers to continue the task.\n\`\`\`json\n${JSON.stringify(answeredSection, null, 2)}\n\`\`\`\n\n**IMPORTANT:** Do NOT ask the same questions again. Use the provided answers to complete the task.`);
  }

  // 8. Response format reminder (placed last to override any conflicting instructions in extraPrompt)
  sections.push(`## IMPORTANT: Response Format
Your response MUST be a JSON object with this exact structure:
{
  "status": "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED",
  "summary": "Brief summary of what was done",
  "output": { /* Your task-specific result goes here */ },
  "nextAction": "COMPLETE" | "CONTINUE" | "ESCALATE" | "HOLD"
}

If the task instructions specify an output format, that format goes INSIDE the "output" field.
Respond with ONLY this JSON object, no markdown code blocks, no explanation.`);

  return sections.join('\n\n---\n\n');
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseResponse(responseText) {
  // Try to parse as JSON
  try {
    // Sometimes the response might have markdown code blocks, try to extract JSON
    let jsonStr = responseText.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.status || !parsed.nextAction) {
      return {
        success: false,
        error: 'Missing required fields (status, nextAction)',
        raw: responseText,
      };
    }

    return {
      success: true,
      data: {
        status: parsed.status,
        summary: parsed.summary || '',
        output: parsed.output || '',
        nextAction: parsed.nextAction,
        nextActionReason: parsed.nextActionReason || '',
        metadata: parsed.metadata || {},
        documentOperations: parsed.documentOperations || [],
        questions: parsed.questions || null,
        questionsContext: parsed.context || null,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse JSON: ${e.message}`,
      raw: responseText,
    };
  }
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute command without conversation capture (simpler, faster)
 * @param {string} cmd - Command to execute
 * @param {string} prompt - Prompt to pass to the command
 * @param {number} [timeout=600000] - Timeout in ms (default 10 minutes)
 */
async function executeCommand(cmd, prompt, timeout = 600000) {
  console.log(`[DEBUG] Executing command: ${cmd}`);
  console.log(`[DEBUG] Prompt preview: ${prompt.substring(0, 300)}${prompt.length > 300 ? '...' : ''}`);
  console.log(`[DEBUG] Command timeout: ${Math.round(timeout / 1000)}s`);

  // Write prompt to a temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `task-daemon-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);

  // For claude, insert --print after the claude binary (handles paths like /path/to/claude --model haiku)
  // Match "claude" at start or after a path separator, followed by space or end
  const claudeMatch = cmd.match(/^(.*\/)?claude(\s|$)/);
  let fullCmd;
  if (claudeMatch) {
    // Insert --print right after "claude"
    const claudeEndIdx = claudeMatch[0].length;
    const beforeArgs = cmd.substring(0, claudeEndIdx).trimEnd();
    const afterArgs = cmd.substring(claudeEndIdx);
    fullCmd = `${beforeArgs} --print ${afterArgs}`.trim() + ` "$(cat '${tmpFile}')"`;
  } else {
    fullCmd = `${cmd} "$(cat '${tmpFile}')"`;
  }

  console.log(`[DEBUG] Running (this may take a while)...`);

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', fullCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Track the child process for graceful shutdown
    activeChildProcess = child;

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      activeChildProcess = null;
      try { unlinkSync(tmpFile); } catch {}
    };

    const resolveOnce = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      console.log(`[WARN] Command timed out after ${Math.round(timeout / 1000)}s, terminating...`);
      stderr += `\nCommand timed out after ${Math.round(timeout / 1000)} seconds`;

      // Kill the child process
      try {
        child.kill('SIGTERM');
        // Give it 5 seconds to terminate gracefully, then SIGKILL
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 5000);
      } catch {}

      resolveOnce({
        exitCode: 124, // Standard timeout exit code
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      // Prevent memory exhaustion from very large outputs
      if (stdout.length > 50 * 1024 * 1024) { // 50MB limit
        console.log(`[WARN] stdout exceeded 50MB, truncating...`);
        stdout = stdout.slice(-10 * 1024 * 1024); // Keep last 10MB
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // Limit stderr size too
      if (stderr.length > 5 * 1024 * 1024) { // 5MB limit
        stderr = stderr.slice(-1 * 1024 * 1024); // Keep last 1MB
      }
    });

    child.on('close', (exitCode, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolveOnce({
          exitCode: 143, // Standard exit code for SIGTERM
          stdout,
          stderr: stderr || `Process terminated by ${signal}`,
          terminated: true,
        });
      } else {
        resolveOnce({
          exitCode: exitCode || 0,
          stdout,
          stderr,
        });
      }
    });

    child.on('error', (error) => {
      resolveOnce({
        exitCode: 1,
        stdout: '',
        stderr: error.message,
      });
    });
  });
}

/**
 * Parse NDJSON stream output into conversation object
 */
function parseConversationOutput(stdout, conversation) {
  const lines = stdout.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      if (event.type === 'system' && event.subtype === 'init') {
        conversation.sessionId = event.session_id;
        conversation.model = event.model;
      } else if (event.type === 'assistant') {
        // Claude's response - may contain tool_use blocks
        const msg = event.message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'tool_use') {
              conversation.messages.push({
                type: 'tool_use',
                timestamp: new Date(),
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
              });
            } else if (block.type === 'text') {
              conversation.messages.push({
                type: 'assistant',
                timestamp: new Date(),
                content: block.text,
              });
            }
          }
        }
      } else if (event.type === 'user' && event.tool_use_result) {
        // Tool result
        conversation.messages.push({
          type: 'tool_result',
          timestamp: new Date(),
          toolUseId: event.message?.content?.[0]?.tool_use_id,
          toolResult: event.tool_use_result,
          isError: false,
        });
      } else if (event.type === 'result') {
        // Final result with metadata
        conversation.result = event.result;
        conversation.numTurns = event.num_turns || 0;
        conversation.durationMs = event.duration_ms || 0;
        conversation.durationApiMs = event.duration_api_ms || 0;
        conversation.permissionDenials = event.permission_denials || [];

        if (event.usage) {
          conversation.usage = {
            inputTokens: event.usage.input_tokens || 0,
            outputTokens: event.usage.output_tokens || 0,
            cacheCreationInputTokens: event.usage.cache_creation_input_tokens || 0,
            cacheReadInputTokens: event.usage.cache_read_input_tokens || 0,
            totalCostUsd: event.total_cost_usd || 0,
          };
        }
      }
    } catch (parseErr) {
      // Skip lines that aren't valid JSON
      console.log(`[DEBUG] Skipping non-JSON line: ${line.substring(0, 100)}`);
    }
  }
}

/**
 * Execute command with stream-json output to capture full conversation thread
 * Returns conversation data including tool calls and results
 * @param {string} cmd - Command to execute
 * @param {string} prompt - Prompt to pass to the command
 * @param {number} [timeout=600000] - Timeout in ms (default 10 minutes)
 */
async function executeCommandWithConversation(cmd, prompt, timeout = 600000) {
  console.log(`[DEBUG] Executing command with conversation capture: ${cmd}`);
  console.log(`[DEBUG] Prompt preview: ${prompt.substring(0, 300)}${prompt.length > 300 ? '...' : ''}`);
  console.log(`[DEBUG] Command timeout: ${Math.round(timeout / 1000)}s`);

  // For claude, insert --print --output-format stream-json
  // Note: --verbose is intentionally omitted as it can cause issues with streaming output
  const claudeMatch = cmd.match(/^(.*\/)?claude(\s|$)/);
  let fullCmd;
  let tmpFile = null;
  let useStdinPipe = false;

  if (claudeMatch) {
    const claudeEndIdx = claudeMatch[0].length;
    const beforeArgs = cmd.substring(0, claudeEndIdx).trimEnd();
    const afterArgs = cmd.substring(claudeEndIdx);
    // Use stdin piping for claude - more reliable than $(cat ...) for large prompts
    fullCmd = `${beforeArgs} --print --output-format stream-json ${afterArgs}`.trim();
    useStdinPipe = true;
  } else {
    // Non-claude command, use temp file approach
    tmpFile = join(tmpdir(), `task-daemon-${Date.now()}.txt`);
    writeFileSync(tmpFile, prompt);
    fullCmd = `${cmd} "$(cat '${tmpFile}')"`;
  }

  console.log(`[DEBUG] Full command: ${fullCmd}`);
  console.log(`[DEBUG] Running with conversation capture...`);

  const conversation = {
    sessionId: null,
    model: null,
    messages: [],
    result: null,
    usage: null,
    permissionDenials: [],
    numTurns: 0,
    durationMs: 0,
    durationApiMs: 0,
  };

  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = spawn('sh', ['-c', fullCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    console.log(`[DEBUG] Child process spawned (PID: ${child.pid})`);

    // Pipe prompt to stdin for claude commands (more reliable than $(cat ...))
    if (useStdinPipe) {
      console.log(`[DEBUG] Writing ${prompt.length} bytes to stdin...`);
      child.stdin.write(prompt);
      child.stdin.end();
      console.log(`[DEBUG] Stdin closed, waiting for response...`);
    }

    // Track the child process for graceful shutdown
    activeChildProcess = child;

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timeoutId = null;
    let heartbeatId = null;
    let lastActivityTime = Date.now();
    let lastStdoutLength = 0;
    let eventCount = 0;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
        heartbeatId = null;
      }
      activeChildProcess = null;
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch {}
      }
    };

    const resolveOnce = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Heartbeat logging - shows progress every 10 seconds
    heartbeatId = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const sinceLast = Math.round((Date.now() - lastActivityTime) / 1000);
      const newBytes = stdout.length - lastStdoutLength;
      lastStdoutLength = stdout.length;

      console.log(`[HEARTBEAT] ${elapsed}s elapsed | ${eventCount} events parsed | ${stdout.length} bytes received | ${sinceLast}s since last activity | +${newBytes} bytes`);

      // Log last few chars of stdout for debugging (might show where it's stuck)
      if (stdout.length > 0 && sinceLast > 30) {
        const lastChunk = stdout.slice(-200).replace(/\n/g, '\\n');
        console.log(`[HEARTBEAT] Last output: ...${lastChunk}`);
      }
    }, 10000);

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[WARN] Command timed out after ${elapsed}s (limit: ${Math.round(timeout / 1000)}s)`);
      console.log(`[WARN] State at timeout: ${eventCount} events, ${stdout.length} bytes stdout, ${stderr.length} bytes stderr`);

      // Log what we received so far
      if (stdout.length > 0) {
        const lastLines = stdout.split('\n').slice(-5).join('\n');
        console.log(`[WARN] Last stdout lines:\n${lastLines}`);
      }
      if (stderr.length > 0) {
        console.log(`[WARN] Stderr: ${stderr.slice(-500)}`);
      }

      stderr += `\nCommand timed out after ${elapsed} seconds`;

      // Try to parse any conversation data we have so far
      parseConversationOutput(stdout, conversation);

      // Kill the child process
      try {
        child.kill('SIGTERM');
        // Give it 5 seconds to terminate gracefully, then SIGKILL
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 5000);
      } catch {}

      resolveOnce({
        exitCode: 124, // Standard timeout exit code
        stdout: conversation.result || stdout,
        stderr,
        conversation,
        timedOut: true,
      });
    }, timeout);

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lastActivityTime = Date.now();

      // Count JSON events for progress tracking
      const newEvents = (chunk.match(/^\{/gm) || []).length;
      eventCount += newEvents;

      // Prevent memory exhaustion from very large outputs
      if (stdout.length > 50 * 1024 * 1024) { // 50MB limit
        console.log(`[WARN] stdout exceeded 50MB, truncating...`);
        stdout = stdout.slice(-10 * 1024 * 1024); // Keep last 10MB
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      lastActivityTime = Date.now();

      // Log stderr in real-time for debugging (first 500 chars of each chunk)
      if (chunk.trim()) {
        console.log(`[STDERR] ${chunk.slice(0, 500).replace(/\n/g, '\\n')}${chunk.length > 500 ? '...' : ''}`);
      }

      // Limit stderr size too
      if (stderr.length > 5 * 1024 * 1024) { // 5MB limit
        stderr = stderr.slice(-1 * 1024 * 1024); // Keep last 1MB
      }
    });

    child.on('close', (exitCode, signal) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[DEBUG] Process closed after ${elapsed}s - exitCode: ${exitCode}, signal: ${signal}`);
      console.log(`[DEBUG] Final stats: ${eventCount} events, ${stdout.length} bytes stdout, ${stderr.length} bytes stderr`);

      // Parse conversation data from stdout
      parseConversationOutput(stdout, conversation);

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolveOnce({
          exitCode: 143,
          stdout: conversation.result || stdout,
          stderr: stderr || `Process terminated by ${signal}`,
          conversation,
          terminated: true,
        });
      } else {
        resolveOnce({
          exitCode: exitCode || 0,
          stdout: conversation.result || stdout,
          stderr,
          conversation,
        });
      }
    });

    child.on('error', (error) => {
      console.log(`[ERROR] Child process error: ${error.message}`);

      // Try to parse any conversation data from stdout even on failure
      parseConversationOutput(stdout, conversation);

      resolveOnce({
        exitCode: 1,
        stdout: stdout || '',
        stderr: error.message,
        conversation,
      });
    });
  });
}

// ============================================================================
// Async Conversation Upload Queue
// ============================================================================

// Queue for background conversation uploads - doesn't block main task loop
const conversationQueue = [];
let conversationUploadRunning = false;
const MAX_QUEUE_SIZE = 100;
const UPLOAD_RETRY_DELAY = 5000;
const MAX_UPLOAD_RETRIES = 3;

/**
 * Queue a conversation record for async upload (non-blocking)
 */
function queueConversationUpload(config, taskId, jobName, execCommand, conversationData, startedAt) {
  if (conversationQueue.length >= MAX_QUEUE_SIZE) {
    log.warn(`Conversation queue full (${MAX_QUEUE_SIZE}), dropping oldest`);
    conversationQueue.shift();
  }

  const record = {
    taskId,
    sessionId: conversationData.sessionId || `daemon-${Date.now()}`,
    jobName,
    model: conversationData.model,
    execCommand,
    status: conversationData.exitCode === 0 ? 'completed' : 'failed',
    messages: conversationData.messages || [],
    result: conversationData.result,
    usage: conversationData.usage,
    permissionDenials: conversationData.permissionDenials || [],
    exitCode: conversationData.exitCode,
    stderr: conversationData.stderr,
    numTurns: conversationData.numTurns,
    durationMs: conversationData.durationMs,
    durationApiMs: conversationData.durationApiMs,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  };

  conversationQueue.push({ config, record, retries: 0 });
  log.debug(`Queued conversation upload (queue size: ${conversationQueue.length})`);

  // Start background processor if not running
  if (!conversationUploadRunning) {
    processConversationQueue();
  }

  // Return a placeholder ID synchronously
  return { _id: `pending-${record.sessionId}`, queued: true };
}

/**
 * Background processor for conversation uploads
 */
async function processConversationQueue() {
  if (conversationUploadRunning) return;
  conversationUploadRunning = true;

  while (conversationQueue.length > 0) {
    const item = conversationQueue.shift();
    const { config, record, retries } = item;

    try {
      const url = `${config.apiUrl}/conversation-records`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: getHeaders(config),
        body: JSON.stringify(record),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      log.debug(`Uploaded conversation record: ${data.data?._id}`);
    } catch (err) {
      const errMsg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      log.warn(`Failed to upload conversation (attempt ${retries + 1}): ${errMsg}`);

      // Retry with exponential backoff
      if (retries < MAX_UPLOAD_RETRIES) {
        item.retries = retries + 1;
        conversationQueue.push(item); // Re-queue at end
        await new Promise(r => setTimeout(r, UPLOAD_RETRY_DELAY * (retries + 1)));
      } else {
        log.error(`Giving up on conversation upload after ${MAX_UPLOAD_RETRIES} retries`);
      }
    }
  }

  conversationUploadRunning = false;
}

/**
 * Create a conversation record in the database (synchronous for backwards compat)
 * @deprecated Use queueConversationUpload for non-blocking uploads
 */
async function createConversationRecord(config, taskId, jobName, execCommand, conversationData, startedAt) {
  const url = `${config.apiUrl}/conversation-records`;

  const record = {
    taskId,
    sessionId: conversationData.sessionId || `daemon-${Date.now()}`,
    jobName,
    model: conversationData.model,
    execCommand,
    status: conversationData.exitCode === 0 ? 'completed' : 'failed',
    messages: conversationData.messages || [],
    result: conversationData.result,
    usage: conversationData.usage,
    permissionDenials: conversationData.permissionDenials || [],
    exitCode: conversationData.exitCode,
    stderr: conversationData.stderr,
    numTurns: conversationData.numTurns,
    durationMs: conversationData.durationMs,
    durationApiMs: conversationData.durationApiMs,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  };

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      const text = await response.text();
      console.log(`[WARN] Failed to create conversation record: ${response.status} - ${text}`);
      return null;
    }

    const data = await response.json();
    console.log(`[DEBUG] Created conversation record: ${data.data?._id}`);
    return data.data;
  } catch (err) {
    console.log(`[WARN] Error creating conversation record: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Stage Transition Logic
// ============================================================================

function getNextWorkflowStep(workflow, currentStageId) {
  if (!workflow?.steps || !currentStageId) return null;

  const currentIndex = workflow.steps.findIndex(s => s.id === currentStageId);
  if (currentIndex === -1 || currentIndex >= workflow.steps.length - 1) {
    return null;
  }

  return workflow.steps[currentIndex + 1];
}

async function handleStageTransition(config, task, workflow, parsedResponse) {
  const nextAction = parsedResponse.data.nextAction;
  const suggestedNextStage = parsedResponse.data.metadata?.suggestedNextStage;

  // If task is part of a workflow and completed, check for next step
  if (nextAction === 'COMPLETE' && workflow && task.workflowStage) {
    let nextStep = null;

    // Use suggested stage if provided, otherwise use sequential next
    if (suggestedNextStage) {
      nextStep = workflow.steps.find(s => s.id === suggestedNextStage);
    }
    if (!nextStep) {
      nextStep = getNextWorkflowStep(workflow, task.workflowStage);
    }

    if (nextStep) {
      console.log(`[WORKFLOW] Creating next task for step: ${nextStep.name}`);

      const newTask = await createTask(config, {
        title: `${workflow.name}: ${nextStep.name}`,
        workflowId: task.workflowId,
        workflowStage: nextStep.id,
        parentId: task._id,
        assigneeId: nextStep.defaultAssigneeId || task.assigneeId,
        extraPrompt: nextStep.prompt || '',
        status: 'pending',
        metadata: { previousOutput: parsedResponse.data.output },
        tags: task.tags || [],
      });

      if (newTask) {
        console.log(`[WORKFLOW] Created task: ${newTask._id}`);
      }
    } else {
      console.log(`[WORKFLOW] No more steps in workflow`);
    }
  }

  // If CONTINUE, create a follow-up task
  if (nextAction === 'CONTINUE' && parsedResponse.data.nextActionReason) {
    console.log(`[CONTINUE] Creating follow-up task`);

    const newTask = await createTask(config, {
      title: `Follow-up: ${task.title}`,
      workflowId: task.workflowId,
      workflowStage: task.workflowStage,
      parentId: task._id,
      assigneeId: task.assigneeId,
      extraPrompt: parsedResponse.data.nextActionReason,
      status: 'pending',
      metadata: { previousOutput: parsedResponse.data.output },
      tags: task.tags || [],
    });

    if (newTask) {
      console.log(`[CONTINUE] Created task: ${newTask._id}`);
    }
  }
}

// ============================================================================
// Task Processing
// ============================================================================

async function processTask(config, task) {
  // Update stats for status tracking
  stats.currentTask = task.title;
  stats.lastTaskId = task._id;
  stats.lastTaskTitle = task.title;
  if (config.jobName) saveStatus(config.jobName);

  log.separator('═');
  log.info(`Processing: ${task.title}`);
  log.debug(`Task ID: ${task._id}`, { status: task.status, workflow: task.workflowId || 'none', stage: task.workflowStage || 'none' });

  // Fetch agent (assignee) if exists
  const agent = await fetchUser(config, task.assigneeId);
  if (agent?.isAgent) {
    log.debug(`Using agent: ${agent.displayName}`);
  }

  // Fetch workflow and step if exists
  let workflow = null;
  let workflowStep = null;
  if (task.workflowId) {
    workflow = await fetchWorkflow(config, task.workflowId);
    if (workflow && task.workflowStage) {
      workflowStep = workflow.steps?.find(s => s.id === task.workflowStage);
      if (workflowStep) {
        log.debug(`Using workflow step: ${workflowStep.name}`);
      }
    }
  }

  // Handle findDocument step type - search for documents and inject into context
  if (workflowStep?.stepType === 'findDocument' && workflowStep.findDocumentConfig) {
    log.info('Processing findDocument step...');
    const findConfig = workflowStep.findDocumentConfig;

    // Resolve search prompt with task context
    let searchPrompt = findConfig.searchPrompt || '';
    if (searchPrompt && task.metadata?.inputPayload) {
      // Simple template variable replacement for {{input.variable}}
      searchPrompt = searchPrompt.replace(/\{\{input\.(\w+)\}\}/g, (match, key) => {
        return task.metadata.inputPayload[key] || match;
      });
    }

    try {
      const searchResults = await searchDocuments(config, {
        prompt: searchPrompt,
        type: findConfig.documentTypes,
        status: findConfig.documentStatus,
        tags: findConfig.tags,
        limit: findConfig.limit || 5,
        minScore: findConfig.minScore || 0.5,
      });

      if (searchResults.length === 0 && findConfig.failIfNotFound) {
        log.error('findDocument: No documents found and failIfNotFound is true');
        await updateTask(config, task._id, {
          status: 'on_hold',
          assignee: null,
          metadata: {
            ...(task.metadata || {}),
            output: {
              timestamp: new Date().toISOString(),
              status: 'FAILED',
              action: 'HOLD',
              error: {
                code: 'DOCUMENT_NOT_FOUND',
                searchPrompt,
                message: `No documents found matching search criteria`,
              },
            },
          },
        });
        await addTaskComment(config, task._id, `Daemon: findDocument failed - no documents matched "${searchPrompt}"`);
        return;
      }

      // Store results in task metadata for context
      const storeAs = findConfig.storeAs || 'foundDocuments';
      task.metadata = task.metadata || {};
      task.metadata[storeAs] = searchResults.map(r => ({
        id: r.document._id,
        title: r.document.title,
        content: r.document.content,
        summary: r.document.summary,
        type: r.document.type,
        score: r.score,
      }));

      log.info(`findDocument: Found ${searchResults.length} documents, stored as ${storeAs}`);
    } catch (err) {
      log.error('findDocument search failed:', err.message);
      if (findConfig.failIfNotFound) {
        await updateTask(config, task._id, {
          status: 'on_hold',
          assignee: null,
          metadata: {
            ...(task.metadata || {}),
            output: {
              timestamp: new Date().toISOString(),
              status: 'FAILED',
              action: 'HOLD',
              error: {
                code: 'DOCUMENT_SEARCH_ERROR',
                message: err.message,
              },
            },
          },
        });
        await addTaskComment(config, task._id, `Daemon: findDocument error - ${err.message}`);
        return;
      }
    }
  }

  // Check payload size before proceeding
  const inputPayload = task.metadata?.inputPayload;
  if (inputPayload && config.maxPayloadSize) {
    const payloadSize = JSON.stringify(inputPayload).length;
    if (payloadSize > config.maxPayloadSize) {
      const errorMsg = `PAYLOAD_SIZE_EXCEEDED: Task inputPayload is ${Math.round(payloadSize / 1024)}KB, which exceeds the maxPayloadSize limit of ${Math.round(config.maxPayloadSize / 1024)}KB. ` +
        `Configure your workflow to send a smaller payload, or increase maxPayloadSize in daemon config.`;
      console.error(`\n[ERROR] ${errorMsg}\n`);

      // Update task with clear error message
      const timestamp = new Date().toISOString();
      await updateTask(config, task._id, {
        status: 'on_hold',
        assignee: null,
        metadata: {
          ...(task.metadata || {}),
          output: {
            timestamp,
            status: 'FAILED',
            action: 'HOLD',
            error: {
              code: 'PAYLOAD_SIZE_EXCEEDED',
              payloadSize,
              maxPayloadSize: config.maxPayloadSize,
              message: errorMsg,
            },
          },
        },
      });
      await addTaskComment(config, task._id, `Daemon rejected task: payload size (${Math.round(payloadSize / 1024)}KB) exceeds limit (${Math.round(config.maxPayloadSize / 1024)}KB). Reduce workflow payload or increase maxPayloadSize.`);
      return;
    }
    console.log(`[DEBUG] Payload size: ${Math.round(payloadSize / 1024)}KB (limit: ${Math.round(config.maxPayloadSize / 1024)}KB)`);
  }

  // Assemble the prompt
  const prompt = assemblePrompt(task, agent, workflowStep);

  if (config.dryRun) {
    console.log('[Dry Run] Assembled prompt:');
    console.log('-'.repeat(40));
    console.log(prompt);
    console.log('-'.repeat(40));
    console.log(`[Dry Run] Command: ${config.exec}`);
    return;
  }

  // Claim the task (set to in_progress)
  console.log(`Setting task status to 'in_progress'...`);
  const claimed = await updateTask(config, task._id, { status: 'in_progress' });
  if (!claimed) {
    console.error('Failed to claim task, skipping...');
    return;
  }

  // Execute the command - use conversation capture for claude commands
  const commandTimeout = config.timeout || 600000; // Default 10 minutes
  console.log(`\nExecuting: ${config.exec} (timeout: ${Math.round(commandTimeout / 1000)}s)\n`);
  console.log('-'.repeat(40));

  const startTime = new Date();
  const isClaudeCommand = /^(.*\/)?claude(\s|$)/.test(config.exec);

  // Use conversation capture for claude commands to get full tool call traces
  const result = isClaudeCommand
    ? await executeCommandWithConversation(config.exec, prompt, commandTimeout)
    : await executeCommand(config.exec, prompt, commandTimeout);

  const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);

  // Check if command was terminated due to shutdown
  if (result.terminated) {
    console.log(`\nCommand terminated due to shutdown after ${duration}s`);
    // Don't update task status when terminated - let the next daemon run pick it up
    return;
  }

  // Handle timeout - task should be retried, so we reset to pending and add comment
  if (result.timedOut) {
    console.log(`\nCommand timed out after ${duration}s`);
    log.warn('Task timed out - will be retried');

    // Reset task to pending so it can be picked up again
    await updateTask(config, task._id, {
      status: 'pending',
      metadata: {
        ...(task.metadata || {}),
        lastTimeoutAt: new Date().toISOString(),
        timeoutCount: (task.metadata?.timeoutCount || 0) + 1,
      },
    });
    await addTaskComment(config, task._id, `Daemon: Task timed out after ${Math.round(commandTimeout / 1000)}s. Will be retried.`);
    return;
  }

  console.log('-'.repeat(40));
  console.log(`\nCommand completed in ${duration}s with exit code: ${result.exitCode}`);

  // Log conversation stats if available
  if (result.conversation) {
    const conv = result.conversation;
    const toolCalls = conv.messages?.filter(m => m.type === 'tool_use').length || 0;
    console.log(`[DEBUG] Conversation: ${conv.numTurns} turns, ${toolCalls} tool calls`);
    if (conv.usage?.totalCostUsd) {
      console.log(`[DEBUG] Cost: $${conv.usage.totalCostUsd.toFixed(4)}`);
    }
    if (conv.permissionDenials?.length > 0) {
      console.log(`[WARN] ${conv.permissionDenials.length} permission denial(s)`);
    }

    // Queue conversation upload in background (non-blocking)
    // This allows the main loop to continue processing tasks while uploads happen async
    const queuedRecord = queueConversationUpload(
      config,
      task._id,
      config.jobName,
      config.exec,
      { ...conv, exitCode: result.exitCode, stderr: result.stderr },
      startTime
    );

    // Store queued record reference in task metadata
    if (queuedRecord) {
      task.metadata = task.metadata || {};
      task.metadata.lastConversationRecordId = queuedRecord._id;
    }
  }

  // Log stderr if present (useful for debugging failures)
  if (result.stderr) {
    console.log(`[STDERR] ${result.stderr.substring(0, 1000)}${result.stderr.length > 1000 ? '...(truncated)' : ''}`);
  }

  const timestamp = new Date().toISOString();

  if (result.exitCode !== 0) {
    // Command failed - set to on_hold status for retry, unassign task
    console.log(`Setting task status to 'on_hold'...`);
    const errorInfo = result.stderr || `Exit code: ${result.exitCode}`;

    const output = {
      timestamp,
      status: 'FAILED',
      action: 'HOLD',
      error: {
        exitCode: result.exitCode,
        message: errorInfo.substring(0, 2000),
      },
      conversationRecordId: task.metadata?.lastConversationRecordId,
    };

    await updateTask(config, task._id, {
      status: 'on_hold',
      assignee: null,
      metadata: {
        ...(task.metadata || {}),
        output,
      },
    });

    // Add comment to activity feed
    await addTaskComment(config, task._id, `Daemon processing failed (exit code ${result.exitCode}). Task placed on hold.`);
    return;
  }

  // Parse the response
  const parsedResponse = parseResponse(result.stdout);

  if (!parsedResponse.success) {
    console.log(`[WARN] Failed to parse JSON response: ${parsedResponse.error}`);
    console.log(`[WARN] Raw response saved to metadata.output`);

    const output = {
      timestamp,
      status: 'PARTIAL',
      action: 'COMPLETE',
      parseError: parsedResponse.error,
      rawOutput: parsedResponse.raw?.substring(0, 5000) || '',
    };

    // Still mark as completed but note the parsing failure
    await updateTask(config, task._id, {
      status: 'completed',
      metadata: {
        ...(task.metadata || {}),
        output,
      },
    });

    // Add comment to activity feed
    await addTaskComment(config, task._id, `Daemon completed but response parsing failed. Task marked as completed with partial output.`);
    return;
  }

  console.log(`[DEBUG] Parsed response:`);
  console.log(`  Status: ${parsedResponse.data.status}`);
  console.log(`  Next Action: ${parsedResponse.data.nextAction}`);
  console.log(`  Summary: ${parsedResponse.data.summary}`);

  // Determine task status based on nextAction
  let newStatus;
  switch (parsedResponse.data.nextAction) {
    case 'COMPLETE':
    case 'CONTINUE':
      newStatus = 'completed';
      break;
    case 'ESCALATE':
    case 'HOLD':
    case 'ASK':
      newStatus = 'on_hold';
      break;
    default:
      newStatus = 'completed';
  }

  console.log(`Setting task status to '${newStatus}'...`);

  // Ensure result is always an object, not a string
  let resultData = parsedResponse.data.output;
  if (typeof resultData === 'string') {
    try {
      resultData = JSON.parse(resultData);
    } catch {
      // If it's not valid JSON, wrap it
      resultData = { text: resultData };
    }
  }

  // Build output for metadata
  // Extract suggested tags from multiple locations with priority:
  // 1. output.result.suggestedTags (workflow prompt-specified location)
  // 2. output.suggestedTags (alternate workflow location)
  // 3. metadata.suggestedTags (standard daemon location)
  const suggestedTags =
    (Array.isArray(parsedResponse.data.output?.result?.suggestedTags) && parsedResponse.data.output.result.suggestedTags.length > 0
      ? parsedResponse.data.output.result.suggestedTags
      : null) ||
    (Array.isArray(parsedResponse.data.output?.suggestedTags) && parsedResponse.data.output.suggestedTags.length > 0
      ? parsedResponse.data.output.suggestedTags
      : null) ||
    parsedResponse.data.metadata?.suggestedTags ||
    [];

  const output = {
    timestamp,
    status: parsedResponse.data.status,
    action: parsedResponse.data.nextAction,
    reason: parsedResponse.data.nextActionReason || null,
    summary: parsedResponse.data.summary,
    result: resultData,
    confidence: parsedResponse.data.metadata?.confidence || null,
    suggestedTags,
    suggestedNextStage: parsedResponse.data.metadata?.suggestedNextStage || null,
    conversationRecordId: task.metadata?.lastConversationRecordId || null,
    // Agent questions (for ASK action)
    ...(parsedResponse.data.questions && {
      questions: {
        questions: parsedResponse.data.questions,
        context: parsedResponse.data.questionsContext || null,
      },
    }),
  };

  // Merge suggested tags if provided
  let tagsUpdate = undefined;
  if (suggestedTags.length > 0) {
    const existingTags = new Set(task.tags || []);
    suggestedTags.forEach(t => existingTags.add(t));
    tagsUpdate = Array.from(existingTags);
  }

  // Process document operations if any
  if (parsedResponse.data.documentOperations?.length > 0) {
    log.info(`Processing ${parsedResponse.data.documentOperations.length} document operations...`);
    const docResults = await processDocumentOperations(config, task._id, parsedResponse.data.documentOperations);
    output.documentOperations = docResults;
    log.info('Document operations completed', { results: docResults.length });
  }

  // Merge with existing metadata
  const updatedMetadata = {
    ...(task.metadata || {}),
    output,
  };

  // Only unassign on failures (ESCALATE/HOLD), otherwise keep current assignee
  const isFailure = newStatus === 'on_hold';
  const updatePayload = {
    status: newStatus,
    metadata: updatedMetadata,
    ...(tagsUpdate && { tags: tagsUpdate }),
    ...(isFailure && { assignee: null }),
  };

  await updateTask(config, task._id, updatePayload);

  // Add comment to activity feed with summary
  const action = parsedResponse.data.nextAction;
  const reason = parsedResponse.data.nextActionReason || parsedResponse.data.summary;
  const commentText = isFailure
    ? `Daemon: ${action} - ${reason}`
    : `Daemon completed: ${reason}`;
  await addTaskComment(config, task._id, commentText);

  // Handle stage transitions for workflows
  await handleStageTransition(config, task, workflow, parsedResponse);
}

// ============================================================================
// Main Daemon Loop
// ============================================================================

async function runDaemon(config) {
  // Initialize stats
  stats.startedAt = new Date().toISOString();
  if (config.jobName) {
    log = new Logger({ level: log.level <= 0 ? 'debug' : 'info', prefix: config.jobName });
    saveStatus(config.jobName);
  }

  log.header([
    `Task Daemon${config.jobName ? ` - ${config.jobName}` : ''}`,
    `View: ${config.viewId}`,
    `Mode: ${config.once ? 'once' : 'continuous'} | Interval: ${config.interval}ms`,
  ]);

  log.debug('Configuration', {
    apiUrl: config.apiUrl,
    exec: config.exec,
    dryRun: config.dryRun,
    noUpdate: config.noUpdate,
  });

  // Handle graceful shutdown
  const handleShutdown = () => {
    if (shuttingDown) {
      // Second signal - force kill child process
      log.warn('Force shutdown requested...');
      if (activeChildProcess) {
        try {
          activeChildProcess.kill('SIGKILL');
        } catch {}
      }
      process.exit(1);
    }
    log.warn('Shutting down after current task... (press Ctrl+C again to force)');
    shuttingDown = true;
    // Kill active child process to stop the current task immediately
    if (activeChildProcess) {
      log.warn('Terminating active command...');
      try {
        activeChildProcess.kill('SIGTERM');
      } catch {}
    }
    if (config.jobName) {
      stats.currentTask = null;
      saveStatus(config.jobName);
    }
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  const processNextTask = async () => {
    const task = await fetchNextTask(config);

    if (task) {
      try {
        await processTask(config, task);
        // Update stats on success
        stats.tasksProcessed++;
        stats.tasksSucceeded++;
        stats.lastTaskAt = new Date().toISOString();
        stats.currentTask = null;
        if (config.jobName) saveStatus(config.jobName);
      } catch (err) {
        // Update stats on failure
        stats.tasksProcessed++;
        stats.tasksFailed++;
        stats.lastTaskAt = new Date().toISOString();
        stats.lastError = err.message || String(err);
        stats.currentTask = null;
        if (config.jobName) saveStatus(config.jobName);
        log.error(`Task processing error: ${err.message}`);
      }
      return true;
    }
    return false;
  };

  if (config.once) {
    const hadTask = await processNextTask();
    if (!hadTask) {
      log.info('No tasks found in queue.');
    }
  } else {
    while (!shuttingDown) {
      const hadTask = await processNextTask();

      if (!hadTask) {
        log.debug(`No tasks available, waiting ${config.interval}ms...`);
      } else {
        // After processing a task, wait before checking for the next one
        // This gives time for workflow transitions to complete and new tasks to appear
        log.debug(`Task processed, waiting ${config.interval}ms before next check...`);
      }

      // Always wait between iterations to avoid tight loops and give the system time
      await new Promise((resolve) => setTimeout(resolve, config.interval));
    }

    // Wait for pending conversation uploads before exiting
    if (conversationQueue.length > 0) {
      log.info(`Waiting for ${conversationQueue.length} pending conversation upload(s)...`);
      const uploadTimeout = 30000; // 30 seconds max wait
      const startWait = Date.now();
      while (conversationQueue.length > 0 && Date.now() - startWait < uploadTimeout) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (conversationQueue.length > 0) {
        log.warn(`Exiting with ${conversationQueue.length} pending uploads (timeout)`);
      }
    }

    log.info('Shutdown complete.');
  }
}

// ============================================================================
// Start Single Job in Background
// ============================================================================

function startSingleJob(config) {
  const { jobName, configPath } = config;

  // Check if already running
  const pid = readPid(jobName);
  if (pid && isProcessRunning(pid)) {
    console.log(`Job "${jobName}" is already running (PID ${pid})`);
    console.log(`\nUse --stop --job ${jobName} to stop it first`);
    console.log(`Use --logs ${jobName} to tail the log`);
    process.exit(1);
  }

  // Spawn background process with output redirected to log file
  const logFile = getLogFile(jobName);
  const args = ['--config', configPath, '--job', jobName, '--foreground'];
  if (config.once) args.push('--once');

  // Open log file for appending - use file descriptors for proper detachment
  const logFd = openSync(logFile, 'a');
  writeFileSync(logFd, `\n--- Started at ${new Date().toISOString()} ---\n`);

  const child = spawn('node', [__filename, ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd],  // Redirect stdout/stderr directly to file descriptor
  });

  // Save PID
  savePid(jobName, child.pid);

  // Close our copy of the file descriptor and unref the child
  closeSync(logFd);
  child.unref();

  console.log(`\n  ✓ Started ${jobName} (PID ${child.pid})`);
  console.log(`\n  Log: ${logFile}`);
  console.log(`\n  Use --status to check status`);
  console.log(`  Use --logs ${jobName} to tail the log`);
  console.log(`  Use --stop --job ${jobName} to stop\n`);
}

// ============================================================================
// Start All Jobs Mode
// ============================================================================

function startAllJobs(config) {
  const { configData, configPath } = config;

  // Get all enabled jobs
  const enabledJobs = Object.entries(configData.jobs || {})
    .filter(([_, job]) => job.enabled !== false)
    .map(([name, job]) => ({ name, ...job }));

  if (enabledJobs.length === 0) {
    console.error('No enabled jobs found in config file.');
    console.log(`\nConfig: ${configPath}`);
    process.exit(1);
  }

  // Check for already running jobs
  const running = getRunningJobs();
  const runningNames = new Set(running.map(j => j.name));

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Task Daemon - Starting All Jobs');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Config: ${configPath}`);
  console.log(`  Jobs:   ${enabledJobs.length} enabled`);
  console.log(`${'═'.repeat(60)}\n`);

  let started = 0;
  let skipped = 0;

  for (const job of enabledJobs) {
    if (runningNames.has(job.name)) {
      console.log(`  ⏭ ${job.name} - already running`);
      skipped++;
      continue;
    }

    // Spawn background process for this job with output redirected to log file
    const logFile = getLogFile(job.name);
    const args = ['--job', job.name, '--foreground'];
    if (config.once) args.push('--once');

    // Open log file for appending - use file descriptors for proper detachment
    const logFd = openSync(logFile, 'a');
    writeFileSync(logFd, `\n--- Started at ${new Date().toISOString()} ---\n`);

    const child = spawn('node', [__filename, '--config', configPath, ...args], {
      detached: true,
      stdio: ['ignore', logFd, logFd],  // Redirect stdout/stderr directly to file descriptor
    });

    // Save PID
    savePid(job.name, child.pid);

    // Close our copy of the file descriptor and unref the child
    closeSync(logFd);
    child.unref();

    console.log(`  ✓ ${job.name} (PID ${child.pid})`);
    started++;
  }

  console.log('');
  console.log(`Started: ${started}, Skipped: ${skipped}`);
  console.log(`\nUse --status to check running jobs`);
  console.log(`Use --stop to stop all jobs`);
  console.log(`Logs: ${PID_DIR}/*.log`);
}

// ============================================================================
// Global Error Handlers - Prevent daemon from crashing on unhandled errors
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
  console.error(`${COLORS.red}[FATAL] Unhandled Promise Rejection:${COLORS.reset}`, reason);
  console.error('Promise:', promise);
  // Don't exit - let the daemon continue running
});

process.on('uncaughtException', (error) => {
  console.error(`${COLORS.red}[FATAL] Uncaught Exception:${COLORS.reset}`, error);
  // For uncaught exceptions, we should exit as the process state may be corrupted
  // But give a moment to log the error
  setTimeout(() => process.exit(1), 100);
});

// Main entry point
const config = parseConfig();

if (config.mode === 'exit') {
  // Already handled in parseConfig (--logs, --restart)
  // Just wait - tail -f runs until SIGINT, restart spawns new process
} else if (config.mode === 'start-job') {
  startSingleJob(config);
} else if (config.mode === 'start-all') {
  startAllJobs(config);
} else {
  runDaemon(config);
}
