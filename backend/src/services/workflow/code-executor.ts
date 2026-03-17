/**
 * Code Executor Service
 *
 * Executes JavaScript code in a sandboxed vm2 environment.
 * Provides controlled access to a curated set of npm packages.
 */

import { VM } from 'vm2';
import type { CodeStepConfig, CodeSandboxPackage, CodeVariableMapping } from '../../types/index.js';
import { getBaseUrl, loadPackageContext, getValueByPathWithBrackets } from './template-utils.js';

// === HTTP & Networking ===
import fetch from 'node-fetch';
import axios from 'axios';
import qs from 'qs';

// === Data Manipulation ===
import lodash from 'lodash';
import * as ramda from 'ramda';
import { produce as immerProduce, enableMapSet as immerEnableMapSet } from 'immer';
import deepmerge from 'deepmerge';

// === String & Text ===
import validator from 'validator';
import slugify from 'slugify';
import * as changeCase from 'change-case';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// === Numbers & Math ===
import BigNumber from 'bignumber.js';
import Decimal from 'decimal.js';
import * as mathjs from 'mathjs';
import currency from 'currency.js';

// === Date & Time ===
import * as dateFns from 'date-fns';
import dayjs from 'dayjs';
import { DateTime as LuxonDateTime, Duration as LuxonDuration, Interval as LuxonInterval } from 'luxon';
import ms from 'ms';

// === JSON & Data Formats ===
import { JSONPath } from 'jsonpath-plus';
import JSON5 from 'json5';
import YAML from 'yaml';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import Papa from 'papaparse';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// === Validation & Schema ===
import { z } from 'zod';
import * as yup from 'yup';
import Ajv from 'ajv';

// === UUID & IDs ===
import { v4 as uuidv4, v5 as uuidv5, v1 as uuidv1 } from 'uuid';
import { nanoid, customAlphabet as nanoidCustomAlphabet } from 'nanoid';
import { ulid } from 'ulid';
import Hashids from 'hashids';

// === Crypto & Security ===
import CryptoJS from 'crypto-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Base64 as JsBase64 } from 'js-base64';

// === Async & Flow Control ===
import pLimit from 'p-limit';
import pMap from 'p-map';
import pRetry from 'p-retry';
import delay from 'delay';

// === Templating ===
import Handlebars from 'handlebars';
import Mustache from 'mustache';
import ejs from 'ejs';

// === Comparison & Diff ===
import * as fastJsonPatch from 'fast-json-patch';
import * as Diff from 'diff';

// === Encoding & Compression ===
import pako from 'pako';
import LZString from 'lz-string';

// === Random & Fake Data ===
import { faker } from '@faker-js/faker';

// Enable immer Map/Set support
immerEnableMapSet();

// Result of code execution
export interface CodeExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  logs: string[];
  executionTimeMs: number;
}

// Extended input context for code execution
export interface CodeExecutionContext {
  input?: unknown;        // Output from previous step
  trigger?: unknown;      // Original workflow trigger payload
  steps?: Record<string, unknown>;  // Outputs from all previous steps (keyed by step ID)
  // Allow additional properties to be passed as direct variables
  [key: string]: unknown;
}

// Package registry - maps package names to their implementations
// The `name` is how it appears in the sandbox, `value` is what gets injected
const PACKAGE_REGISTRY: Record<CodeSandboxPackage, { name: string; value: unknown; category: string; description: string }> = {
  // === HTTP & Networking ===
  'node-fetch': { name: 'fetch', value: fetch, category: 'HTTP & Networking', description: 'HTTP fetch API' },
  'axios': { name: 'axios', value: axios, category: 'HTTP & Networking', description: 'Full-featured HTTP client' },
  'qs': { name: 'qs', value: qs, category: 'HTTP & Networking', description: 'Query string parsing/stringify' },

  // === Data Manipulation ===
  'lodash': { name: '_', value: lodash, category: 'Data Manipulation', description: 'Utility functions' },
  'ramda': { name: 'R', value: ramda, category: 'Data Manipulation', description: 'Functional programming' },
  'immer': { name: 'immer', value: { produce: immerProduce }, category: 'Data Manipulation', description: 'Immutable state updates' },
  'deepmerge': { name: 'deepmerge', value: deepmerge, category: 'Data Manipulation', description: 'Deep object merging' },

  // === String & Text ===
  'validator': { name: 'validator', value: validator, category: 'String & Text', description: 'String validation (email, URL, etc.)' },
  'slugify': { name: 'slugify', value: slugify, category: 'String & Text', description: 'URL-safe strings' },
  'change-case': { name: 'changeCase', value: changeCase, category: 'String & Text', description: 'Case conversion' },
  'marked': { name: 'marked', value: marked, category: 'String & Text', description: 'Markdown to HTML' },
  'sanitize-html': { name: 'sanitizeHtml', value: sanitizeHtml, category: 'String & Text', description: 'HTML sanitization' },

  // === Numbers & Math ===
  'bignumber.js': { name: 'BigNumber', value: BigNumber, category: 'Numbers & Math', description: 'Arbitrary precision math' },
  'decimal.js': { name: 'Decimal', value: Decimal, category: 'Numbers & Math', description: 'Decimal arithmetic' },
  'mathjs': { name: 'math', value: mathjs, category: 'Numbers & Math', description: 'Math library' },
  'currency.js': { name: 'currency', value: currency, category: 'Numbers & Math', description: 'Currency handling' },

  // === Date & Time ===
  'date-fns': { name: 'dateFns', value: dateFns, category: 'Date & Time', description: 'Date manipulation' },
  'dayjs': { name: 'dayjs', value: dayjs, category: 'Date & Time', description: 'Lightweight date library' },
  'luxon': { name: 'luxon', value: { DateTime: LuxonDateTime, Duration: LuxonDuration, Interval: LuxonInterval }, category: 'Date & Time', description: 'Modern date library' },
  'ms': { name: 'ms', value: ms, category: 'Date & Time', description: 'Millisecond conversion' },

  // === JSON & Data Formats ===
  'jsonpath-plus': { name: 'JSONPath', value: JSONPath, category: 'JSON & Data Formats', description: 'JSONPath querying' },
  'json5': { name: 'JSON5', value: JSON5, category: 'JSON & Data Formats', description: 'Extended JSON (comments, trailing commas)' },
  'yaml': { name: 'YAML', value: YAML, category: 'JSON & Data Formats', description: 'YAML parsing' },
  'csv-parse': { name: 'csvParse', value: csvParse, category: 'JSON & Data Formats', description: 'CSV parsing (sync)' },
  'csv-stringify': { name: 'csvStringify', value: csvStringify, category: 'JSON & Data Formats', description: 'CSV generation (sync)' },
  'papaparse': { name: 'Papa', value: Papa, category: 'JSON & Data Formats', description: 'Full-featured CSV parsing' },
  'fast-xml-parser': { name: 'XMLParser', value: { XMLParser, XMLBuilder }, category: 'JSON & Data Formats', description: 'Fast XML parsing' },

  // === Validation & Schema ===
  'zod': { name: 'z', value: z, category: 'Validation & Schema', description: 'TypeScript-first schema validation' },
  'yup': { name: 'yup', value: yup, category: 'Validation & Schema', description: 'Schema validation' },
  'ajv': { name: 'Ajv', value: Ajv, category: 'Validation & Schema', description: 'JSON Schema validation' },

  // === UUID & IDs ===
  'uuid': { name: 'uuid', value: { v4: uuidv4, v5: uuidv5, v1: uuidv1 }, category: 'UUID & IDs', description: 'UUID generation' },
  'nanoid': { name: 'nanoid', value: { nanoid, customAlphabet: nanoidCustomAlphabet }, category: 'UUID & IDs', description: 'Tiny unique ID generator' },
  'ulid': { name: 'ulid', value: ulid, category: 'UUID & IDs', description: 'Sortable unique IDs' },
  'hashids': { name: 'Hashids', value: Hashids, category: 'UUID & IDs', description: 'Obfuscated IDs from numbers' },

  // === Crypto & Security ===
  'crypto-js': { name: 'CryptoJS', value: CryptoJS, category: 'Crypto & Security', description: 'Crypto functions (MD5, SHA, AES, etc.)' },
  'bcryptjs': { name: 'bcrypt', value: bcrypt, category: 'Crypto & Security', description: 'Password hashing' },
  'jsonwebtoken': { name: 'jwt', value: jwt, category: 'Crypto & Security', description: 'JWT signing/verification' },
  'js-base64': { name: 'Base64', value: JsBase64, category: 'Crypto & Security', description: 'Base64 encode/decode' },

  // === Async & Flow Control ===
  'p-limit': { name: 'pLimit', value: pLimit, category: 'Async & Flow Control', description: 'Limit concurrent promises' },
  'p-map': { name: 'pMap', value: pMap, category: 'Async & Flow Control', description: 'Concurrent map with limit' },
  'p-retry': { name: 'pRetry', value: pRetry, category: 'Async & Flow Control', description: 'Retry failed promises' },
  'delay': { name: 'delay', value: delay, category: 'Async & Flow Control', description: 'Simple delay/sleep' },

  // === Templating ===
  'handlebars': { name: 'Handlebars', value: Handlebars, category: 'Templating', description: 'Handlebars templates' },
  'mustache': { name: 'Mustache', value: Mustache, category: 'Templating', description: 'Mustache templates' },
  'ejs': { name: 'ejs', value: ejs, category: 'Templating', description: 'EJS templates' },

  // === Comparison & Diff ===
  'fast-json-patch': { name: 'jsonPatch', value: fastJsonPatch, category: 'Comparison & Diff', description: 'JSON Patch (RFC 6902)' },
  'diff': { name: 'Diff', value: Diff, category: 'Comparison & Diff', description: 'Text diff' },

  // === Encoding & Compression ===
  'pako': { name: 'pako', value: pako, category: 'Encoding & Compression', description: 'zlib compression' },
  'lz-string': { name: 'LZString', value: LZString, category: 'Encoding & Compression', description: 'LZ compression for strings' },

  // === Random & Fake Data ===
  '@faker-js/faker': { name: 'faker', value: faker, category: 'Random & Fake Data', description: 'Generate fake data' },
};

// Default packages to include when creating a new code step (frontend only uses this as a suggestion)
const DEFAULT_PACKAGES: CodeSandboxPackage[] = ['lodash', 'date-fns'];

// Default execution limits
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Create a safe console that captures logs
 */
function createSafeConsole(logs: string[]): Record<string, (...args: unknown[]) => void> {
  const formatArgs = (args: unknown[]): string => {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  };

  return {
    log: (...args: unknown[]) => logs.push(`[LOG] ${formatArgs(args)}`),
    info: (...args: unknown[]) => logs.push(`[INFO] ${formatArgs(args)}`),
    warn: (...args: unknown[]) => logs.push(`[WARN] ${formatArgs(args)}`),
    error: (...args: unknown[]) => logs.push(`[ERROR] ${formatArgs(args)}`),
    debug: (...args: unknown[]) => logs.push(`[DEBUG] ${formatArgs(args)}`),
  };
}

/**
 * Get a value from an object by dot-notation path
 */
function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * System variables that are always available (don't require context path)
 * These match the token browser's system variables
 */
function getSystemVariableValue(path: string): unknown {
  // Handle both with and without underscore prefix
  const normalizedPath = path.startsWith('_') ? path : `_${path}`;

  switch (normalizedPath.toLowerCase()) {
    case '_apiurl':
      return getBaseUrl();
    case '_apikey':
      return process.env.MATRIX_API_KEY || process.env.API_KEY || '';
    default:
      return undefined;
  }
}

/**
 * Resolve variable mappings from context and variable packages
 * Maps variable names to their resolved values from:
 * 1. System variables (e.g., _apiUrl, _apiKey)
 * 2. Variable packages from database (e.g., variables.myPackage.someKey)
 * 3. Context paths (e.g., trigger.someValue, input.data)
 */
async function resolveVariables(
  variables: CodeVariableMapping[],
  context: CodeExecutionContext
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  // Load variable packages from database
  const packageContext = await loadPackageContext();

  // Build a combined context object for path resolution
  const fullContext: Record<string, unknown> = {
    input: context.input,
    trigger: context.trigger,
    steps: context.steps || {},
    // Include variable packages in the resolution context
    variables: packageContext.variables,
  };

  for (const variable of variables) {
    // 1. Check if it's a system variable (no dot path, starts with _ or is a known system var)
    if (!variable.path.includes('.')) {
      const systemValue = getSystemVariableValue(variable.path);
      if (systemValue !== undefined) {
        resolved[variable.name] = systemValue;
        continue;
      }
    }

    // 2. Check if it's a variable package reference (e.g., "variables.packageName.key")
    if (variable.path.startsWith('variables.')) {
      // Use bracket-aware path resolution to support both dot and bracket notation
      const value = getValueByPathWithBrackets(fullContext, variable.path);
      if (value !== undefined) {
        resolved[variable.name] = value;
        continue;
      }
    }

    // 3. Otherwise, resolve from context path (trigger.*, input.*, steps.*)
    const value = getValueByPath(fullContext, variable.path);
    if (value !== undefined) {
      resolved[variable.name] = value;
    }
  }

  return resolved;
}

/**
 * Build the sandbox object with injected packages and resolved variables
 */
async function buildSandbox(
  context: CodeExecutionContext,
  packages: CodeSandboxPackage[],
  variables: CodeVariableMapping[],
  logs: string[]
): Promise<Record<string, unknown>> {
  // Resolve variable mappings from context paths and variable packages
  const resolvedVariables = await resolveVariables(variables, context);

  const sandbox: Record<string, unknown> = {
    // Input data - previous step output
    input: context.input,
    // Workflow trigger payload (original input to the workflow)
    trigger: context.trigger,
    // Outputs from all previous steps (keyed by step ID)
    steps: context.steps || {},
    // Workflow run metadata (injected by execution service)
    _workflowRunId: context._workflowRunId || null,
    _stepLog: context._stepLog || [],
    console: createSafeConsole(logs),
    // Built-in JS globals that are safe
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    // Node.js globals that are useful
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // Inject resolved variables from config
    ...resolvedVariables,
  };

  // Inject requested packages
  for (const pkg of packages) {
    const registration = PACKAGE_REGISTRY[pkg];
    if (registration && registration.value !== null) {
      sandbox[registration.name] = registration.value;
    }
  }

  return sandbox;
}

/**
 * Wrap user code to capture return value
 */
function wrapCode(code: string): string {
  return `
    (async () => {
      ${code}
    })()
  `;
}

/**
 * Validate output against JSON schema if provided
 */
function validateOutput(output: unknown, _schema: object): { valid: boolean; error?: string } {
  try {
    JSON.stringify(output);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Output validation failed: ${err}` };
  }
}

/**
 * Execute JavaScript code in a sandboxed environment
 */
export async function executeCode(
  code: string,
  input: unknown | CodeExecutionContext,
  config: Partial<CodeStepConfig> = {}
): Promise<CodeExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  // Support both simple input and full context object
  // If the input has 'input', 'trigger', or 'steps' keys, treat it as a full context object
  const context: CodeExecutionContext = (
    input && typeof input === 'object' && ('input' in input || 'trigger' in input || 'steps' in input)
  ) ? input as CodeExecutionContext : { input };

  const packages = (config.packages || []) as CodeSandboxPackage[];
  const variables = config.variables || [];
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const sandbox = await buildSandbox(context, packages, variables, logs);

    const vm = new VM({
      timeout,
      sandbox,
      eval: false,
      wasm: false,
    });

    const wrappedCode = wrapCode(code);
    const result = await vm.run(wrappedCode);

    if (config.outputSchema) {
      const validation = validateOutput(result, config.outputSchema);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          logs,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    return {
      success: true,
      output: result,
      logs,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (errorMessage.includes('Script execution timed out')) {
      return {
        success: false,
        error: `Code execution timed out after ${timeout}ms`,
        logs,
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: false,
      error: errorMessage,
      logs,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Get list of available packages and their sandbox names
 */
export function getAvailablePackages(): Array<{ package: CodeSandboxPackage; sandboxName: string; category: string; description: string }> {
  return Object.entries(PACKAGE_REGISTRY)
    .filter(([, reg]) => reg.value !== null)
    .map(([pkg, reg]) => ({
      package: pkg as CodeSandboxPackage,
      sandboxName: reg.name,
      category: reg.category,
      description: reg.description,
    }));
}

/**
 * Get default packages that are suggested for new code steps
 */
export function getDefaultPackages(): CodeSandboxPackage[] {
  return [...DEFAULT_PACKAGES];
}

/**
 * Get packages grouped by category
 */
export function getPackagesByCategory(): Record<string, Array<{ package: CodeSandboxPackage; sandboxName: string; description: string }>> {
  const result: Record<string, Array<{ package: CodeSandboxPackage; sandboxName: string; description: string }>> = {};

  for (const [pkg, reg] of Object.entries(PACKAGE_REGISTRY)) {
    if (reg.value === null) continue;

    if (!result[reg.category]) {
      result[reg.category] = [];
    }
    result[reg.category].push({
      package: pkg as CodeSandboxPackage,
      sandboxName: reg.name,
      description: reg.description,
    });
  }

  return result;
}
