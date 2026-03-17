import { ObjectId } from 'mongodb';
import { getDb } from '../../db/connection.js';
import { User, VariablePackage } from '../../types/index.js';
import { isEncryptionConfigured } from '../encryption.js';
import YAML from 'yaml';

// Environment config for webhook URLs
// Set BASE_URL in .env for your environment (see .env.example)
// Note: Using a getter function because ES modules load before dotenv.config() runs
export function getBaseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3001';
}

/**
 * Static version of getValueByPath for use outside the class
 */
export function getValueByPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj || !path) return undefined;

  // Remove leading $. or . if present
  const cleanPath = path.replace(/^\$?\.?/, '');
  const parts = cleanPath.split('.');

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Get a value from a path that may include array bracket notation
 * Supports: "field", "nested.field", "array[0].field", "packages.name[branch].field"
 */
export function getValueByPathWithBrackets(
  obj: Record<string, unknown> | undefined,
  path: string
): unknown {
  if (!obj || !path) return undefined;

  // Parse path with bracket notation
  // e.g., "packages.email[personal].username" -> ["packages", "email", "[personal]", "username"]
  const parts: string[] = [];
  let current = '';
  let inBracket = false;

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === '[' && !inBracket) {
      if (current) {
        parts.push(current);
        current = '';
      }
      inBracket = true;
      current = '[';
    } else if (char === ']' && inBracket) {
      current += ']';
      parts.push(current);
      current = '';
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  // Traverse the path
  let value: unknown = obj;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;

    if (part.startsWith('[') && part.endsWith(']')) {
      // Bracket notation - extract the key (remove brackets)
      const key = part.slice(1, -1);
      value = (value as Record<string, unknown>)[key];
    } else {
      // Regular property access
      value = (value as Record<string, unknown>)[part];
    }
  }

  return value;
}

export interface TemplateContext {
  workflowRunId: ObjectId;
  stepId: string;
  taskId?: ObjectId;
  callbackSecret?: string;
  inputPayload?: Record<string, unknown>;
  nextForeachStepId?: string;
  apiKey?: string; // For external API calls
}

// ============================================================================
// CORE PATH RESOLUTION - Single source of truth for all template path handling
// ============================================================================

/**
 * Context for resolving template paths.
 * All template resolution functions should use this unified context.
 */
export interface PathResolutionContext {
  /** Input payload data (workflow trigger data, step input, etc.) */
  inputPayload?: Record<string, unknown>;
  /** Trigger data (alias for inputPayload, used in some contexts) */
  triggerPayload?: Record<string, unknown>;
  /** Variable packages loaded from database */
  packageContext?: PackageContext;
}

/**
 * Result of path resolution
 */
export interface PathResolutionResult {
  /** Whether the path was successfully resolved */
  found: boolean;
  /** The resolved value (undefined if not found) */
  value: unknown;
}

/**
 * Options for formatting resolved values
 */
export interface FormatOptions {
  /** If true, try to extract meaningful identifier from objects (name, title, id) */
  extractIdentifier?: boolean;
  /** If true, return empty string for undefined/null; if false, return 'null' or leave unchanged */
  emptyForMissing?: boolean;
  /** If true and value not found, return the original match unchanged */
  preserveUnresolved?: boolean;
}

/**
 * CORE FUNCTION: Resolve a template path to its value.
 *
 * This is the SINGLE SOURCE OF TRUTH for all path resolution.
 * All template functions should use this function.
 *
 * Supported path prefixes (in order of precedence):
 *   - variables.*        -> Look up in packageContext.variables
 *   - trigger.payload.*  -> Look up in inputPayload (or triggerPayload)
 *   - trigger.*          -> Look up in inputPayload (or triggerPayload), stripping 'trigger.'
 *   - input.*            -> Look up in inputPayload
 *   - (direct path)      -> Look up directly in inputPayload
 *
 * @param path - The path to resolve (e.g., "trigger.payload.email.subject", "input.item", "label")
 * @param context - The resolution context containing data sources
 * @returns PathResolutionResult with found status and value
 */
export function resolvePathToValue(
  path: string,
  context: PathResolutionContext
): PathResolutionResult {
  const trimmedPath = path.trim();
  // inputPayload is typically the "current" data (step input, source data)
  // triggerPayload is the original workflow trigger data
  const inputData = context.inputPayload;
  const triggerData = context.triggerPayload;
  // For backward compatibility, use inputPayload as fallback for trigger if triggerPayload not set
  const effectiveTriggerData = triggerData || inputData;
  // Default payload for input.* and direct lookups
  const payload = inputData || triggerData;

  // 1. Variables prefix (highest priority - explicit variable lookup)
  if (trimmedPath.startsWith('variables.') && context.packageContext) {
    const value = getValueByPathWithBrackets(
      context.packageContext as unknown as Record<string, unknown>,
      trimmedPath
    );
    if (value !== undefined) {
      return { found: true, value };
    }
    // Variables not found - return not found (caller decides whether to preserve)
    return { found: false, value: undefined };
  }

  // 2. trigger.payload.* prefix (explicit trigger payload reference)
  //    MUST use triggerPayload specifically (the original workflow trigger data)
  if (trimmedPath.startsWith('trigger.payload.') && effectiveTriggerData) {
    const subPath = trimmedPath.substring(16); // Remove 'trigger.payload.'
    const value = getValueByPath(effectiveTriggerData, subPath);
    if (value !== undefined) {
      return { found: true, value };
    }
    return { found: false, value: undefined };
  }

  // 3. trigger.* prefix (for backward compatibility, maps to trigger payload)
  //    MUST use triggerPayload specifically
  if (trimmedPath.startsWith('trigger.') && effectiveTriggerData) {
    const subPath = trimmedPath.substring(8); // Remove 'trigger.'
    const value = getValueByPath(effectiveTriggerData, subPath);
    if (value !== undefined) {
      return { found: true, value };
    }
    return { found: false, value: undefined };
  }

  // 4. input.* prefix (explicit input reference - uses current step input)
  if (trimmedPath.startsWith('input.') && payload) {
    const subPath = trimmedPath.substring(6); // Remove 'input.'
    const value = getValueByPath(payload, subPath);
    if (value !== undefined) {
      return { found: true, value };
    }
    return { found: false, value: undefined };
  }

  // 5. Direct path lookup (no prefix - look directly in payload)
  if (payload) {
    const value = getValueByPath(payload, trimmedPath);
    if (value !== undefined) {
      return { found: true, value };
    }
  }

  return { found: false, value: undefined };
}

/**
 * CORE FUNCTION: Format a resolved value for template output.
 *
 * This is the SINGLE SOURCE OF TRUTH for value formatting.
 * All template functions should use this function.
 *
 * @param value - The value to format
 * @param options - Formatting options
 * @returns Formatted string representation
 */
export function formatResolvedValue(
  value: unknown,
  options: FormatOptions = {}
): string {
  const { extractIdentifier = false, emptyForMissing = true } = options;

  if (value === undefined || value === null) {
    return emptyForMissing ? '' : 'null';
  }

  if (typeof value === 'object') {
    if (extractIdentifier) {
      // Try to get a meaningful identifier from the object
      const obj = value as Record<string, unknown>;
      if (obj.name) return String(obj.name);
      if (obj.title) return String(obj.title);
      if (obj.id) return String(obj.id);
      if (obj._id) return String(obj._id);
    }
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * CORE FUNCTION: Resolve a single template expression and format the result.
 *
 * Combines resolvePathToValue and formatResolvedValue into a single call.
 *
 * @param path - The path to resolve
 * @param context - The resolution context
 * @param options - Formatting options
 * @param originalMatch - Original match string (for preserveUnresolved option)
 * @returns Formatted string value
 */
export function resolveAndFormat(
  path: string,
  context: PathResolutionContext,
  options: FormatOptions = {},
  originalMatch?: string
): string {
  const result = resolvePathToValue(path, context);

  if (!result.found) {
    if (options.preserveUnresolved && originalMatch) {
      return originalMatch;
    }
    return options.emptyForMissing !== false ? '' : 'null';
  }

  return formatResolvedValue(result.value, options);
}

/**
 * Resolves template variables in a string.
 * Supported variables:
 *   {{callbackUrl}} - Callback URL for current step (single result, completion signals)
 *   {{systemWebhookUrl}} - Smart callback URL that routes to next foreach step when available
 *                          (use for streaming items from external->foreach pattern)
 *   {{foreachWebhookUrl}} - Alias for systemWebhookUrl (backward compatibility)
 *   {{callbackSecret}} - Task-specific callback secret
 *   {{workflowRunId}} - Current workflow run ID
 *   {{stepId}} - Current step ID
 *   {{taskId}} - Current task ID
 *   {{input.path.to.value}} - Value from input payload (explicit prefix)
 *   {{message}} - Direct access to inputPayload.message (no prefix needed)
 *   {{item}} - Current item in foreach loop
 *   {{_index}} - Current index in foreach loop
 *   {{_total}} - Total count in foreach loop
 *   {{anyVariable}} - Direct lookup from input payload
 */
export function resolveTemplateVariables(
  template: string,
  context: TemplateContext
): string {
  let result = template;

  // Unified callback URL - same endpoint handles all callback types
  const callbackUrl = `${getBaseUrl()}/api/workflow-runs/${context.workflowRunId}/callback/${context.stepId}`;

  // {{callbackUrl}} - the primary/preferred variable
  result = result.replace(/\{\{callbackUrl\}\}/g, callbackUrl);

  // {{systemWebhookUrl}} - smart callback URL that routes to foreach step when available
  // This enables the common pattern: external trigger -> streaming items to foreach
  if (context.nextForeachStepId) {
    const smartCallbackUrl = `${getBaseUrl()}/api/workflow-runs/${context.workflowRunId}/callback/${context.nextForeachStepId}`;
    result = result.replace(/\{\{systemWebhookUrl\}\}/g, smartCallbackUrl);
  } else {
    result = result.replace(/\{\{systemWebhookUrl\}\}/g, callbackUrl);
  }

  // {{foreachWebhookUrl}} - backward compatibility (points to same unified endpoint)
  // If there's a next foreach step, use that step's callback URL
  if (context.nextForeachStepId) {
    const nextStepCallbackUrl = `${getBaseUrl()}/api/workflow-runs/${context.workflowRunId}/callback/${context.nextForeachStepId}`;
    result = result.replace(/\{\{foreachWebhookUrl\}\}/g, nextStepCallbackUrl);
  } else {
    // Fall back to current step's callback URL
    result = result.replace(/\{\{foreachWebhookUrl\}\}/g, callbackUrl);
  }
  result = result.replace(/\{\{workflowRunId\}\}/g, context.workflowRunId.toString());
  result = result.replace(/\{\{stepId\}\}/g, context.stepId);

  if (context.taskId) {
    result = result.replace(/\{\{taskId\}\}/g, context.taskId.toString());
  }

  if (context.callbackSecret) {
    result = result.replace(/\{\{callbackSecret\}\}/g, context.callbackSecret);
  }

  // Replace underscore-prefixed system variables ({{_apiUrl}}, {{_apiKey}}, {{_workflowRunId}})
  result = result.replace(/\{\{_apiUrl\}\}/g, getBaseUrl());
  result = result.replace(/\{\{_workflowRunId\}\}/g, context.workflowRunId.toString());
  if (context.apiKey) {
    result = result.replace(/\{\{_apiKey\}\}/g, context.apiKey);
  }

  // Helper to determine if a match position is inside a quoted string
  // by checking if there's a quote immediately before (possibly with whitespace)
  const isInQuotedContext = (str: string, matchIndex: number): boolean => {
    // Look backwards from the match to find what precedes it
    let i = matchIndex - 1;
    // Skip whitespace
    while (i >= 0 && (str[i] === ' ' || str[i] === '\t' || str[i] === '\n' || str[i] === '\r')) {
      i--;
    }
    // Check if the preceding non-whitespace char is a quote
    return i >= 0 && str[i] === '"';
  };

  // Helper to format a value for template output
  const formatValue = (value: unknown, inQuotedContext: boolean): string => {
    if (value === undefined || value === null) {
      // In quoted context ("{{var}}"), return empty string
      // In raw context ({{var}}), return null for valid JSON
      return inQuotedContext ? '' : 'null';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    const strValue = String(value);
    // JSON-escape strings with special characters
    if (strValue.includes('\n') || strValue.includes('\r') || strValue.includes('"') || strValue.includes('\\')) {
      return JSON.stringify(strValue).slice(1, -1);
    }
    return strValue;
  };

  // Replace all remaining {{...}} patterns using core path resolution
  // This handles: input.*, trigger.payload.*, trigger.*, and direct paths
  if (context.inputPayload) {
    const pathContext: PathResolutionContext = { inputPayload: context.inputPayload };
    const directPattern = /\{\{([^}]+)\}\}/g;
    let match;
    let lastIndex = 0;
    let newResult = '';

    while ((match = directPattern.exec(result)) !== null) {
      const trimmedPath = match[1].trim();

      // Skip already-resolved system variables
      if (['callbackUrl', 'systemWebhookUrl', 'foreachWebhookUrl', 'workflowRunId', 'stepId', 'taskId', 'callbackSecret', '_apiUrl', '_apiKey', '_workflowRunId'].includes(trimmedPath)) {
        newResult += result.slice(lastIndex, match.index) + match[0];
        lastIndex = match.index + match[0].length;
        continue;
      }

      // Use core path resolution
      const resolved = resolvePathToValue(trimmedPath, pathContext);
      const inQuoted = isInQuotedContext(result, match.index);
      newResult += result.slice(lastIndex, match.index) + formatValue(resolved.value, inQuoted);
      lastIndex = match.index + match[0].length;
    }
    result = newResult + result.slice(lastIndex);
  }

  return result;
}

/**
 * Resolves a title template string by replacing {{variable}} placeholders.
 *
 * Uses the core resolveAndFormat function for consistent path resolution.
 * See resolvePathToValue for supported path prefixes.
 */
export function resolveTitleTemplate(
  template: string,
  inputPayload?: Record<string, unknown>,
  fallbackTitle?: string
): string {
  if (!template) return fallbackTitle || '';

  const context: PathResolutionContext = { inputPayload };

  // Replace all {{...}} patterns using core resolution
  const result = template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    return resolveAndFormat(path, context, { extractIdentifier: true }, match);
  });

  // If the result is empty after substitution, use fallback
  if (!result.trim()) {
    return fallbackTitle || template;
  }

  return result;
}

/**
 * Async version of resolveTitleTemplate that supports variable packages with nested interpolation.
 *
 * Uses the core resolveAndFormat function for consistent path resolution.
 * See resolvePathToValue for supported path prefixes.
 *
 * Supports nested interpolation like {{variables.{{input.configName}}.value}}
 */
export async function resolveTitleTemplateWithPackages(
  template: string,
  inputPayload?: Record<string, unknown>,
  fallbackTitle?: string
): Promise<string> {
  if (!template) return fallbackTitle || '';

  // Load packages for variable resolution
  const packageContext = await loadPackageContext();
  const context: PathResolutionContext = { inputPayload, packageContext };

  let result = template;
  let iterations = 0;
  const maxIterations = 10;

  // Iterate to resolve nested expressions from innermost outward
  while (iterations < maxIterations) {
    const prevResult = result;

    // Match innermost expressions (those without nested {{ }})
    result = result.replace(/\{\{([^{}]+)\}\}/g, (match, path) => {
      // For variables.*, preserve unresolved to allow nested interpolation
      const trimmedPath = path.trim();
      const isVariablesPath = trimmedPath.startsWith('variables.');

      return resolveAndFormat(
        path,
        context,
        {
          extractIdentifier: true,
          preserveUnresolved: isVariablesPath, // Keep {{variables.x}} for later passes if not found
        },
        match
      );
    });

    // If nothing changed, we're done
    if (result === prevResult) {
      break;
    }

    iterations++;
  }

  // If the result is empty after substitution, use fallback
  if (!result.trim()) {
    return fallbackTitle || template;
  }

  return result;
}

// ============================================================================
// Variables Resolution with Nested Interpolation
// ============================================================================

/**
 * Variable context for template resolution
 * Loaded from database and decrypted for runtime use
 *
 * Template syntax: {{variables.name}} or {{variables.name.path.to.field}}
 */
export interface PackageContext {
  // variables.{variableName} -> parsed value (string or object)
  variables: Record<string, unknown>;
}

/**
 * Cache for loaded packages (cleared on each workflow run start)
 */
let packageCache: PackageContext | null = null;
let packageCacheTime: number = 0;
const PACKAGE_CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Load all active variables from database
 * Returns decrypted values organized by name
 * Returns empty context if database is not available (e.g., in tests)
 */
export async function loadPackageContext(): Promise<PackageContext> {
  const now = Date.now();

  // Return cached if fresh
  if (packageCache && (now - packageCacheTime) < PACKAGE_CACHE_TTL_MS) {
    return packageCache;
  }

  // Handle case where database is not connected (e.g., in tests)
  let db;
  try {
    db = getDb();
  } catch {
    // No database connection - return empty context
    return { variables: {} };
  }

  const variables = await db
    .collection<VariablePackage>('variable_packages')
    .find({ isActive: true })
    .toArray();

  const variablesMap: Record<string, unknown> = {};

  for (const v of variables) {
    let value = v.value;

    // Decrypt if encrypted
    if (v.encrypted && isEncryptionConfigured()) {
      try {
        const { decrypt, isEncrypted } = await import('../encryption.js');
        if (isEncrypted(value)) {
          value = decrypt(value);
        }
      } catch {
        console.warn(`[TemplateUtils] Failed to decrypt variable ${v.name}, using raw value`);
      }
    }

    // Try to parse as JSON, then YAML, for object access
    try {
      variablesMap[v.name] = JSON.parse(value);
    } catch {
      // Not JSON, try YAML
      try {
        const parsed = YAML.parse(value);
        // Only use YAML result if it's actually an object (YAML.parse returns string for plain text)
        if (parsed !== null && typeof parsed === 'object') {
          variablesMap[v.name] = parsed;
        } else {
          // Not structured data, store as string
          variablesMap[v.name] = value;
        }
      } catch {
        // Not YAML either, store as string
        variablesMap[v.name] = value;
      }
    }
  }

  const context: PackageContext = {
    variables: variablesMap,
  };

  // Update cache
  packageCache = context;
  packageCacheTime = now;

  return context;
}

/**
 * Clear the package cache (call when packages are updated)
 */
export function clearPackageCache(): void {
  packageCache = null;
  packageCacheTime = 0;
}

// ============================================================================
// Agent Resolution Cache
// ============================================================================

/**
 * Cache for active agent lookups.
 * Maps criteria keys (e.g., "complexity.3", "tag.api-integration", "name.claude opus")
 * to agent ObjectId strings. Cached for 60s, invalidated on user mutations.
 *
 * Two caches share the same DB query and TTL:
 * - agentCache: first-match per key (for single-agent {{agent.*}} resolution)
 * - agentCacheAll: all matches per key (for multi-agent {{agents.*}} resolution)
 */
let agentCache: Map<string, string> | null = null;
let agentCacheAll: Map<string, AgentRecord[]> | null = null;
let agentCacheTime: number = 0;
const AGENT_CACHE_TTL_MS = 60000; // 1 minute, same as package cache

export type AgentRecord = Pick<User, '_id' | 'displayName' | 'agentComplexity' | 'agentTags'>;

/**
 * Load all active agents from database into a lookup cache.
 * Builds indexes by complexity, tag, and name for O(1) resolution.
 */
async function loadAgentCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (agentCache && agentCacheAll && (now - agentCacheTime) < AGENT_CACHE_TTL_MS) {
    return agentCache;
  }

  let db;
  try {
    db = getDb();
  } catch {
    agentCache = new Map();
    agentCacheAll = new Map();
    agentCacheTime = now;
    return agentCache;
  }

  const agents = await db
    .collection<AgentRecord>('users')
    .find({ isAgent: true, isActive: true })
    .sort({ createdAt: 1 }) // Deterministic: oldest first wins
    .project<AgentRecord>({ _id: 1, displayName: 1, agentComplexity: 1, agentTags: 1 })
    .toArray();

  const cache = new Map<string, string>();
  const cacheAll = new Map<string, AgentRecord[]>();

  for (const agent of agents) {
    const idStr = agent._id.toString();

    // Index by complexity (first match wins due to sort order)
    if (agent.agentComplexity) {
      const key = `complexity.${agent.agentComplexity}`;
      if (!cache.has(key)) {
        cache.set(key, idStr);
      }
      if (!cacheAll.has(key)) cacheAll.set(key, []);
      cacheAll.get(key)!.push(agent);
    }

    // Index by each tag
    if (agent.agentTags) {
      for (const tag of agent.agentTags) {
        const key = `tag.${tag.toLowerCase()}`;
        if (!cache.has(key)) {
          cache.set(key, idStr);
        }
        if (!cacheAll.has(key)) cacheAll.set(key, []);
        cacheAll.get(key)!.push(agent);
      }
    }

    // Index by display name (case-insensitive)
    const nameKey = `name.${agent.displayName.toLowerCase()}`;
    if (!cache.has(nameKey)) {
      cache.set(nameKey, idStr);
    }
    if (!cacheAll.has(nameKey)) cacheAll.set(nameKey, []);
    cacheAll.get(nameKey)!.push(agent);
  }

  agentCache = cache;
  agentCacheAll = cacheAll;
  agentCacheTime = now;
  return cache;
}

/**
 * Resolve a template string containing an {{agent.*}} reference to an ObjectId string.
 *
 * Supported syntax:
 *   {{agent.complexity.3}}          → first active agent with agentComplexity=3
 *   {{agent.complexity.1}}          → first active agent with agentComplexity=1
 *   {{agent.tag.api-integration}}   → first active agent tagged "api-integration"
 *   {{agent.name.Claude Opus}}      → agent by display name (case-insensitive)
 *
 * Returns the agent ObjectId string, or undefined if no match.
 */
export async function resolveAgentTemplate(template: string): Promise<string | undefined> {
  const match = template.match(/^\{\{agent\.(.+)\}\}$/);
  if (!match) return undefined;

  const criteria = match[1].toLowerCase();
  const cache = await loadAgentCache();
  const resolved = cache.get(criteria);

  if (!resolved) {
    console.warn(`[TemplateUtils] Agent query "agent.${match[1]}" matched no active agents`);
  }

  return resolved;
}

/**
 * Resolve an agents query to ALL matching active agents.
 *
 * Supports combined criteria with '+' for AND filtering:
 *   'complexity.3'                    → all agents with agentComplexity=3
 *   'tag.reasoning'                   → all agents tagged 'reasoning'
 *   'complexity.3+tag.reasoning'      → agents with complexity 3 AND tagged 'reasoning'
 *
 * Returns array of matching AgentRecord objects (may be empty).
 */
export async function resolveAllAgents(query: string): Promise<AgentRecord[]> {
  await loadAgentCache();

  const parts = query.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return [];

  if (parts.length === 1) {
    return agentCacheAll?.get(parts[0]) || [];
  }

  // AND filter: intersect all matching agent sets
  let candidates: AgentRecord[] | null = null;
  for (const part of parts) {
    const matching = agentCacheAll?.get(part) || [];
    if (candidates === null) {
      candidates = [...matching];
    } else {
      const matchingIds = new Set(matching.map(a => a._id.toString()));
      candidates = candidates.filter(a => matchingIds.has(a._id.toString()));
    }
  }

  const result = candidates || [];
  if (result.length === 0) {
    console.warn(`[TemplateUtils] Agent query "${query}" matched no active agents`);
  }
  return result;
}

/**
 * Clear the agent cache (call when agent users are created/updated/deactivated)
 */
export function clearAgentCache(): void {
  agentCache = null;
  agentCacheAll = null;
  agentCacheTime = 0;
}

/**
 * Resolve nested template expressions
 * Handles patterns like:
 *   {{variables.config.database.host}}     - dot notation
 *   {{variables.config[env].database}}     - bracket notation for dynamic keys
 *   {{variables.{{input.varName}}.field}}  - nested interpolation
 *
 * Uses the core resolveAndFormat function for consistent path resolution.
 *
 * Resolution order:
 * 1. Resolve innermost expressions first (those without nested braces)
 * 2. Continue until no more expressions can be resolved
 */
export function resolveNestedExpressions(
  template: string,
  context: TemplateContext,
  packageContext?: PackageContext
): string {
  const pathContext: PathResolutionContext = {
    inputPayload: context.inputPayload,
    packageContext,
  };

  let result = template;
  let iterations = 0;
  const maxIterations = 10; // Safety limit to prevent infinite loops

  while (iterations < maxIterations) {
    const prevResult = result;

    // Find and resolve innermost expressions (those without nested {{ }})
    // Pattern matches {{...}} where ... doesn't contain {{ or }}
    result = result.replace(/\{\{([^{}]+)\}\}/g, (match, expression) => {
      // For variables.*, preserve unresolved to allow nested interpolation
      const trimmedPath = expression.trim();
      const isVariablesPath = trimmedPath.startsWith('variables.');

      return resolveAndFormat(
        expression,
        pathContext,
        {
          extractIdentifier: false, // Don't extract identifiers in general template resolution
          preserveUnresolved: isVariablesPath, // Keep {{variables.x}} for later passes if not found
        },
        match
      );
    });

    // If nothing changed, we're done
    if (result === prevResult) {
      break;
    }

    iterations++;
  }

  return result;
}

/**
 * Full template resolution with variable support and nested interpolation
 *
 * Supports:
 * - All standard template variables (system, input, etc.)
 * - Variables: {{variables.name}} or {{variables.name.path.to.field}}
 * - Nested interpolation: {{variables.{{input.configName}}.value}}
 */
export async function resolveTemplateWithPackages(
  template: string,
  context: TemplateContext
): Promise<string> {
  // Load packages
  const packageContext = await loadPackageContext();

  // First, resolve nested expressions (innermost first)
  let result = resolveNestedExpressions(template, context, packageContext);

  // Then apply standard template resolution for remaining variables
  result = resolveTemplateVariables(result, context);

  // Final pass for any remaining variables that may have been unresolved
  result = resolveNestedExpressions(result, context, packageContext);

  return result;
}

/**
 * Synchronous version for use when packages are already loaded
 */
export function resolveTemplateWithPackagesSync(
  template: string,
  context: TemplateContext,
  packageContext: PackageContext
): string {
  // First, resolve nested expressions (innermost first)
  let result = resolveNestedExpressions(template, context, packageContext);

  // Then apply standard template resolution for remaining variables
  result = resolveTemplateVariables(result, context);

  // Final pass for any remaining variables
  result = resolveNestedExpressions(result, context, packageContext);

  return result;
}

/**
 * Resolve a single template value expression like "{{output.field}}" or "{{item.name}}"
 * Returns the extracted value (not a string), preserving the original type.
 *
 * Uses the core resolvePathToValue function for consistent path resolution.
 *
 * This is used for input mapping where we want to extract actual values,
 * not string representations.
 */
export async function resolveTemplateValue(
  template: string,
  sourceData: Record<string, unknown>,
  triggerData?: Record<string, unknown>
): Promise<unknown> {
  const context: PathResolutionContext = {
    inputPayload: sourceData,
    triggerPayload: triggerData,
  };

  // Debug logging for trigger.payload templates
  if (template.includes('trigger.payload')) {
    console.log(`[resolveTemplateValue] template: "${template}"`);
    console.log(`[resolveTemplateValue] triggerData present: ${!!triggerData}`);
    if (triggerData) {
      console.log(`[resolveTemplateValue] triggerData keys: ${Object.keys(triggerData)}`);
      console.log(`[resolveTemplateValue] triggerData.data: ${triggerData.data ? 'present' : 'missing'}`);
    }
  }

  // If the template is just a simple variable reference like "{{output.field}}"
  // extract the path and return the actual value (preserving type)
  const simpleMatch = template.match(/^\{\{([^}]+)\}\}$/);
  if (simpleMatch) {
    const result = resolvePathToValue(simpleMatch[1], context);
    if (template.includes('trigger.payload')) {
      console.log(`[resolveTemplateValue] resolvePathToValue result: found=${result.found}, value=${JSON.stringify(result.value)?.substring(0, 100)}`);
    }
    return result.value; // Return raw value, not stringified
  }

  // If the template contains multiple variables or text,
  // resolve it as a string template using the core function
  const result = template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    return resolveAndFormat(path, context, { extractIdentifier: false }, match);
  });

  return result;
}
