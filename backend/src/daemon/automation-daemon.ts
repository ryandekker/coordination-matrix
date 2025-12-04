import { spawn, ChildProcess } from 'child_process';
import { ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { connectToDatabase, getDb, closeDatabase } from '../db/connection.js';
import { eventBus } from '../services/event-bus.js';
import {
  Task,
  TaskEvent,
  TaskEventType,
  DaemonConfig,
  DaemonRule,
  DaemonExecution,
} from '../types/index.js';

/**
 * Automation Daemon
 *
 * Watches for task events and executes shell commands based on configured rules.
 * Runs as a background process, reading configuration from a YAML file.
 */
class AutomationDaemon {
  private config: DaemonConfig;
  private running = false;
  private activeExecutions = 0;
  private executionQueue: Array<{
    rule: DaemonRule;
    event: TaskEvent;
  }> = [];
  private processing = false;

  constructor(config: DaemonConfig) {
    this.config = {
      concurrency: config.concurrency ?? 1,
      rules: config.rules.filter(r => r.enabled !== false),
    };
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Daemon is already running');
      return;
    }

    await connectToDatabase();

    // Subscribe to all task events
    eventBus.subscribe('*', async (event: TaskEvent) => {
      await this.handleEvent(event);
    });

    this.running = true;
    console.log(`AutomationDaemon: Started with ${this.config.rules.length} rules`);
    console.log(`AutomationDaemon: Concurrency limit: ${this.config.concurrency}`);

    // Keep process alive
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('AutomationDaemon: Shutting down...');
    this.running = false;

    // Wait for active executions to complete (with timeout)
    const timeout = 30000;
    const start = Date.now();
    while (this.activeExecutions > 0 && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await closeDatabase();
    console.log('AutomationDaemon: Shutdown complete');
    process.exit(0);
  }

  /**
   * Handle an incoming event
   */
  private async handleEvent(event: TaskEvent): Promise<void> {
    for (const rule of this.config.rules) {
      if (this.ruleMatches(rule, event)) {
        console.log(`AutomationDaemon: Rule "${rule.name}" matched event ${event.type}`);
        this.executionQueue.push({ rule, event });
      }
    }

    this.processQueue();
  }

  /**
   * Check if a rule matches an event
   */
  private ruleMatches(rule: DaemonRule, event: TaskEvent): boolean {
    // Check event type
    if (rule.trigger.event !== event.type) {
      return false;
    }

    // Check filter if specified
    if (rule.trigger.filter) {
      if (!this.taskMatchesFilter(event.task, rule.trigger.filter)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple filter matching for task
   * Supports: status:value, priority:value, label:value, AND
   */
  private taskMatchesFilter(task: Task, filterQuery: string): boolean {
    const conditions = filterQuery.split(/\s+AND\s+/i);

    for (const condition of conditions) {
      const match = condition.trim().match(/^(\w+):(.+)$/);
      if (!match) continue;

      const [, field, value] = match;

      if (field === 'status' && task.status !== value) return false;
      if (field === 'priority' && task.priority !== value) return false;
      if (field === 'label' || field === 'tag') {
        if (!task.tags || !task.tags.includes(value)) return false;
      }
    }

    return true;
  }

  /**
   * Process the execution queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.executionQueue.length > 0 && this.activeExecutions < this.config.concurrency) {
      const item = this.executionQueue.shift();
      if (item) {
        this.activeExecutions++;
        this.executeRule(item.rule, item.event)
          .catch(error => console.error('Execution error:', error))
          .finally(() => {
            this.activeExecutions--;
            this.processQueue();
          });
      }
    }

    this.processing = false;
  }

  /**
   * Execute a rule
   */
  private async executeRule(rule: DaemonRule, event: TaskEvent): Promise<void> {
    const db = getDb();

    // Interpolate variables in command
    const command = this.interpolateTemplate(rule.action.command, event);

    // Create execution record
    const execution: Omit<DaemonExecution, '_id'> = {
      ruleName: rule.name,
      taskId: event.taskId,
      eventId: event.id,
      command,
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await db.collection('daemon_executions').insertOne(execution);
    const executionId = result.insertedId;

    try {
      // Update status to running
      await db.collection('daemon_executions').updateOne(
        { _id: executionId },
        { $set: { status: 'running', startedAt: new Date() } }
      );

      console.log(`AutomationDaemon: Executing rule "${rule.name}": ${command}`);

      // Execute the command
      const output = await this.runCommand(command, rule.action.timeout ?? 300000);

      // Parse output and update task if configured
      let updatedFields: Record<string, unknown> = {};
      if (rule.action.update_fields) {
        updatedFields = this.processUpdateFields(rule.action.update_fields, output, event.task);

        if (Object.keys(updatedFields).length > 0) {
          await this.updateTask(event.taskId, updatedFields);
        }
      }

      // Update execution record
      await db.collection('daemon_executions').updateOne(
        { _id: executionId },
        {
          $set: {
            status: 'completed',
            output: output.slice(0, 10000), // Truncate large outputs
            updatedFields,
            completedAt: new Date(),
          },
        }
      );

      console.log(`AutomationDaemon: Rule "${rule.name}" completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await db.collection('daemon_executions').updateOne(
        { _id: executionId },
        {
          $set: {
            status: 'failed',
            error: errorMessage,
            completedAt: new Date(),
          },
        }
      );

      console.error(`AutomationDaemon: Rule "${rule.name}" failed: ${errorMessage}`);
    }
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, event: TaskEvent): string {
    let result = template;

    // Replace {{task.*}} variables
    const taskVarRegex = /\{\{task\.(\w+)\}\}/g;
    result = result.replace(taskVarRegex, (_, field) => {
      const value = (event.task as Record<string, unknown>)[field];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });

    // Replace {{event.*}} variables
    const eventVarRegex = /\{\{event\.(\w+)\}\}/g;
    result = result.replace(eventVarRegex, (_, field) => {
      const value = (event as Record<string, unknown>)[field];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });

    return result;
  }

  /**
   * Run a shell command
   */
  private runCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command exited with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Process update_fields configuration
   */
  private processUpdateFields(
    updateFields: Record<string, string>,
    output: string,
    task: Task
  ): Record<string, unknown> {
    const updates: Record<string, unknown> = {};

    // Try to parse output as JSON
    let parsedOutput: Record<string, unknown> = {};
    try {
      parsedOutput = JSON.parse(output.trim());
    } catch {
      // Not JSON, use raw output
      parsedOutput = { raw: output.trim() };
    }

    for (const [field, template] of Object.entries(updateFields)) {
      let value: unknown;

      // Handle special syntax
      if (template.startsWith('+')) {
        // Append to array (e.g., "+triaged" adds "triaged" to tags)
        const valueToAdd = template.slice(1);
        const existingArray = (task as Record<string, unknown>)[field];
        if (Array.isArray(existingArray)) {
          if (!existingArray.includes(valueToAdd)) {
            value = [...existingArray, valueToAdd];
          }
        } else {
          value = [valueToAdd];
        }
      } else if (template.startsWith('-')) {
        // Remove from array
        const valueToRemove = template.slice(1);
        const existingArray = (task as Record<string, unknown>)[field];
        if (Array.isArray(existingArray)) {
          value = existingArray.filter(v => v !== valueToRemove);
        }
      } else if (template.startsWith('{{result.')) {
        // Extract from command output
        const resultField = template.match(/\{\{result\.(\w+)\}\}/)?.[1];
        if (resultField && parsedOutput[resultField] !== undefined) {
          value = parsedOutput[resultField];
        }
      } else {
        // Direct value
        value = template;
      }

      if (value !== undefined) {
        updates[field] = value;
      }
    }

    return updates;
  }

  /**
   * Update a task with new field values
   */
  private async updateTask(taskId: ObjectId, updates: Record<string, unknown>): Promise<void> {
    const db = getDb();

    // Add actorType to indicate this is from the daemon
    const response = await fetch(`${process.env.API_URL || 'http://localhost:3001/api'}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...updates,
        actorType: 'daemon',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update task: ${response.statusText}`);
    }

    console.log(`AutomationDaemon: Updated task ${taskId} with fields:`, Object.keys(updates));
  }
}

/**
 * Load configuration from YAML file
 */
function loadConfig(configPath: string): DaemonConfig {
  if (!fs.existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.parse(content) as DaemonConfig;

  // Validate config
  if (!config.rules || !Array.isArray(config.rules)) {
    console.error('Configuration must contain a "rules" array');
    process.exit(1);
  }

  for (const rule of config.rules) {
    if (!rule.name) {
      console.error('Each rule must have a "name"');
      process.exit(1);
    }
    if (!rule.trigger?.event) {
      console.error(`Rule "${rule.name}" must have a trigger.event`);
      process.exit(1);
    }
    if (!rule.action?.command) {
      console.error(`Rule "${rule.name}" must have an action.command`);
      process.exit(1);
    }
  }

  return config;
}

// Main entry point
const configPath = process.argv[2] || './daemon-config.yaml';

console.log(`AutomationDaemon: Loading configuration from ${configPath}`);
const config = loadConfig(configPath);

const daemon = new AutomationDaemon(config);
daemon.start().catch((error) => {
  console.error('Failed to start daemon:', error);
  process.exit(1);
});

export { AutomationDaemon, loadConfig };
