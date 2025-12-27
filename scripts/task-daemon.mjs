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
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync, createWriteStream, readdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Get script directory for default config path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG_PATH = join(__dirname, 'daemon-jobs.yaml');
const PID_DIR = join(homedir(), '.matrix-daemon');

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
  "nextAction": "COMPLETE" | "CONTINUE" | "ESCALATE" | "HOLD",
  "nextActionReason": "Optional: reason for CONTINUE/ESCALATE/HOLD",
  "metadata": {
    "confidence": 0.0-1.0,
    "suggestedTags": [],
    "suggestedNextStage": null
  }
}

Rules:
- status: SUCCESS if task fully completed, PARTIAL if partially done, BLOCKED if cannot proceed, FAILED if error
- nextAction: COMPLETE to finish, CONTINUE to spawn follow-up, ESCALATE for human help, HOLD to pause
- output: A structured JSON object containing your work result. Follow the schema specified in the workflow/task instructions.
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
  --exec, -e <cmd>               Command to run (default: "claude")
  --no-update, -n                Don't update task status after execution
  --log-level <level>            Log level: debug, info, warn, error

${COLORS.bold}CONFIG FILE FORMAT${COLORS.reset} (YAML)
  defaults:
    apiUrl: https://api.example.com/api
    apiKey: cm_ak_live_xxxxx
    interval: 5000
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
  let viewId, apiKey, apiUrl, interval, execCmd, maxPayloadSize;

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
  } else if (values.view) {
    // Use CLI args / env vars only (explicit --view provided)
    viewId = values.view;
    apiKey = values['api-key'] || process.env.MATRIX_API_KEY || '';
    apiUrl = values['api-url'] || process.env.MATRIX_API_URL || 'http://localhost:3001/api';
    interval = parseInt(values.interval || '5000', 10);
    execCmd = values.exec || process.env.MATRIX_EXEC_CMD || 'claude';
    maxPayloadSize = parseInt(values['max-payload-size'] || '200000', 10);
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
  };
}

// ============================================================================
// API Helpers
// ============================================================================

function getHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  return headers;
}

async function fetchNextTask(config) {
  const url = `${config.apiUrl}/views/${config.viewId}/tasks?limit=1&resolveReferences=true`;
  log.debug(`Fetching next task from view`);

  try {
    const response = await fetch(url, { headers: getHeaders(config) });
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
    log.error('Fetch error:', error.message || error);
    return null;
  }
}

async function fetchUser(config, userId) {
  if (!userId) return null;

  try {
    const response = await fetch(`${config.apiUrl}/users/${userId}`, {
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
    const response = await fetch(`${config.apiUrl}/workflows/${workflowId}`, {
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
    const response = await fetch(`${config.apiUrl}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: getHeaders(config),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update task (${response.status}): ${error}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Update error:', error.message || error);
    return false;
  }
}

async function createTask(config, taskData) {
  try {
    const response = await fetch(`${config.apiUrl}/tasks`, {
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
    console.error('Create task error:', error.message || error);
    return null;
  }
}

async function addTaskComment(config, taskId, comment) {
  if (config.noUpdate) {
    console.log(`[Skip comment] Would add comment to task ${taskId}: ${comment}`);
    return true;
  }

  try {
    const response = await fetch(`${config.apiUrl}/activity-logs/task/${taskId}/comments`, {
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
    console.error('Add comment error:', error.message || error);
    return false;
  }
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

function executeCommand(cmd, prompt) {
  console.log(`[DEBUG] Executing command: ${cmd}`);
  console.log(`[DEBUG] Prompt preview: ${prompt.substring(0, 300)}${prompt.length > 300 ? '...' : ''}`);

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

  try {
    const stdout = execSync(fullCmd, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try { unlinkSync(tmpFile); } catch {}

    return {
      exitCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    try { unlinkSync(tmpFile); } catch {}

    return {
      exitCode: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
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

  // Execute the command
  console.log(`\nExecuting: ${config.exec}\n`);
  console.log('-'.repeat(40));

  const startTime = Date.now();
  const result = executeCommand(config.exec, prompt);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('-'.repeat(40));
  console.log(`\nCommand completed in ${duration}s with exit code: ${result.exitCode}`);

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
  const output = {
    timestamp,
    status: parsedResponse.data.status,
    action: parsedResponse.data.nextAction,
    reason: parsedResponse.data.nextActionReason || null,
    summary: parsedResponse.data.summary,
    result: resultData,
    confidence: parsedResponse.data.metadata?.confidence || null,
    suggestedTags: parsedResponse.data.metadata?.suggestedTags || [],
    suggestedNextStage: parsedResponse.data.metadata?.suggestedNextStage || null,
  };

  // Merge suggested tags if provided
  let tagsUpdate = undefined;
  if (parsedResponse.data.metadata?.suggestedTags?.length > 0) {
    const existingTags = new Set(task.tags || []);
    parsedResponse.data.metadata.suggestedTags.forEach(t => existingTags.add(t));
    tagsUpdate = Array.from(existingTags);
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
  let shuttingDown = false;
  const handleShutdown = () => {
    log.warn('Shutting down after current task...');
    shuttingDown = true;
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
        await new Promise((resolve) => setTimeout(resolve, config.interval));
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

  // Spawn background process
  const logFile = getLogFile(jobName);
  const args = ['--config', configPath, '--job', jobName, '--foreground'];
  if (config.once) args.push('--once');

  const child = spawn('node', [__filename, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Save PID
  savePid(jobName, child.pid);

  // Pipe output to log file
  const logStream = createWriteStream(logFile, { flags: 'a' });
  logStream.write(`\n--- Started at ${new Date().toISOString()} ---\n`);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

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

    // Spawn background process for this job
    const logFile = getLogFile(job.name);
    const args = ['--job', job.name, '--foreground'];
    if (config.once) args.push('--once');

    const child = spawn('node', [__filename, '--config', configPath, ...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Save PID
    savePid(job.name, child.pid);

    // Pipe output to log file
    const logStream = createWriteStream(logFile, { flags: 'a' });
    logStream.write(`\n--- Started at ${new Date().toISOString()} ---\n`);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

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
