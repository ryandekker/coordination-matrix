/**
 * PM2 Ecosystem Configuration for Task Daemon
 *
 * This config reads daemon-jobs.yaml and creates PM2 app definitions
 * for each enabled job, providing automatic restart on failure.
 *
 * Usage:
 *   pm2 start scripts/ecosystem.config.cjs           # Start all enabled jobs
 *   pm2 start scripts/ecosystem.config.cjs --only daemon-haiku  # Start one job
 *   pm2 list                                         # Show running processes
 *   pm2 logs                                         # Tail all logs
 *   pm2 logs daemon-haiku                            # Tail specific job logs
 *   pm2 restart all                                  # Restart all
 *   pm2 stop all                                     # Stop all
 *   pm2 delete all                                   # Remove from pm2
 *   pm2 save                                         # Save process list for reboot
 *   pm2 startup                                      # Generate startup script
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

// Build PM2 apps array
const apps = [];

for (const [jobName, job] of Object.entries(config.jobs)) {
  // Skip disabled jobs
  if (job.enabled === false) {
    continue;
  }

  // Skip jobs without viewId
  if (!job.viewId) {
    console.warn(`Warning: Job "${jobName}" has no viewId, skipping`);
    continue;
  }

  apps.push({
    name: `daemon-${jobName}`,
    script: join(scriptDir, 'task-daemon.mjs'),
    args: `--config ${configPath} --job ${jobName} --foreground`,

    // Interpreter for ESM
    interpreter: 'node',
    interpreter_args: '--experimental-vm-modules',

    // Working directory
    cwd: projectRoot,

    // Restart policy
    autorestart: true,
    max_restarts: 50,           // Max restarts before stopping
    min_uptime: '10s',          // Consider started after 10s
    restart_delay: 5000,        // Wait 5s between restarts

    // Exponential backoff on repeated restarts
    exp_backoff_restart_delay: 1000,  // Start with 1s, doubles each time

    // Resource limits
    max_memory_restart: '500M', // Restart if memory exceeds 500MB

    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: join(projectRoot, 'logs', `daemon-${jobName}-error.log`),
    out_file: join(projectRoot, 'logs', `daemon-${jobName}-out.log`),
    merge_logs: true,

    // Environment
    env: {
      NODE_ENV: 'production',
      // Pass through API key from environment if set
      MATRIX_API_KEY: process.env.MATRIX_API_KEY || '',
    },

    // Watch mode disabled (daemon handles its own polling)
    watch: false,
  });
}

if (apps.length === 0) {
  console.error('No enabled jobs with viewId found in config');
  process.exit(1);
}

module.exports = { apps };
