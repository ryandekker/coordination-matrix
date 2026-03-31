/**
 * PM2 Ecosystem Configuration for Task Daemon
 *
 * Runs the consolidated daemon as a single PM2 process.
 * All enabled jobs from daemon-jobs.yaml are handled by one process
 * with batch polling (single API call per tick).
 *
 * Usage:
 *   pm2 start scripts/ecosystem.config.cjs       # Start consolidated daemon
 *   pm2 list                                      # Show running processes
 *   pm2 logs daemon                               # Tail logs
 *   pm2 restart daemon                            # Restart
 *   pm2 stop daemon                               # Stop
 *   pm2 delete daemon                             # Remove from pm2
 *   pm2 save                                      # Save process list for reboot
 *   pm2 startup                                   # Generate startup script
 *
 * Environment Variables:
 *   DAEMON_CONFIG_PATH  - Path to daemon-jobs.yaml (default: scripts/daemon-jobs.yaml)
 *   MATRIX_API_KEY      - API key (if not set in yaml)
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

// Try to load yaml parser
let parseYaml;
try {
  parseYaml = require('yaml').parse;
} catch (e) {
  console.error('Error: yaml package required. Run: npm install yaml');
  process.exit(1);
}

const scriptDir = __dirname;
const projectRoot = join(scriptDir, '..');

// Find config file
const configPath = process.env.DAEMON_CONFIG_PATH || join(scriptDir, 'daemon-jobs.yaml');

if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  console.error('Copy daemon-jobs.example.yaml to daemon-jobs.yaml and configure it.');
  process.exit(1);
}

// Parse config
const configContent = readFileSync(configPath, 'utf8');
const config = parseYaml(configContent);

if (!config.jobs || Object.keys(config.jobs).length === 0) {
  console.error('No jobs defined in config file');
  process.exit(1);
}

// Verify at least one enabled job exists
const enabledJobs = Object.entries(config.jobs).filter(
  ([, job]) => job.enabled !== false && job.viewId
);

if (enabledJobs.length === 0) {
  console.error('No enabled jobs with viewId found in config');
  process.exit(1);
}

// Single consolidated daemon process — handles all jobs internally
const apps = [
  {
    name: 'daemon',
    script: join(scriptDir, 'task-daemon.mjs'),
    args: `--config ${configPath}`,

    // Interpreter for ESM
    interpreter: 'node',
    interpreter_args: '--experimental-vm-modules',

    // Working directory
    cwd: projectRoot,

    // Restart policy
    autorestart: true,
    max_restarts: 50,
    min_uptime: '10s',
    restart_delay: 5000,

    // Exponential backoff on repeated restarts
    exp_backoff_restart_delay: 1000,

    // Resource limits
    max_memory_restart: '500M',

    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: join(projectRoot, 'logs', 'daemon-error.log'),
    out_file: join(projectRoot, 'logs', 'daemon-out.log'),
    merge_logs: true,

    // Environment
    env: {
      NODE_ENV: 'production',
      MATRIX_API_KEY: process.env.MATRIX_API_KEY || '',
    },

    // Watch mode disabled (daemon handles its own polling)
    watch: false,
  },
];

module.exports = { apps };
