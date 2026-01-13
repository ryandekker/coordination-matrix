import { ObjectId } from 'mongodb';

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

export interface TemplateContext {
  workflowRunId: ObjectId;
  stepId: string;
  taskId?: ObjectId;
  callbackSecret?: string;
  inputPayload?: Record<string, unknown>;
  nextForeachStepId?: string;
  apiKey?: string; // For external API calls
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

  // Replace input payload variables ({{input.path.to.value}})
  if (context.inputPayload) {
    // Use a function that captures match index for context detection
    const inputPattern = /\{\{input\.([^}]+)\}\}/g;
    let match;
    let lastIndex = 0;
    let newResult = '';
    while ((match = inputPattern.exec(result)) !== null) {
      const path = match[1];
      const value = getValueByPath(context.inputPayload!, path);
      const inQuoted = isInQuotedContext(result, match.index);
      newResult += result.slice(lastIndex, match.index) + formatValue(value, inQuoted);
      lastIndex = match.index + match[0].length;
    }
    result = newResult + result.slice(lastIndex);
  }

  // Replace direct variable references ({{message}}, {{item}}, {{_index}}, etc.)
  // This allows foreach items and other payload properties to be accessed without "input." prefix
  if (context.inputPayload) {
    const directPattern = /\{\{([^}]+)\}\}/g;
    let match;
    let lastIndex = 0;
    let newResult = '';
    while ((match = directPattern.exec(result)) !== null) {
      const trimmedPath = match[1].trim();
      // Skip already-resolved system variables (they start with specific prefixes we've already handled)
      if (['callbackUrl', 'systemWebhookUrl', 'foreachWebhookUrl', 'workflowRunId', 'stepId', 'taskId', 'callbackSecret', '_apiUrl', '_apiKey', '_workflowRunId'].includes(trimmedPath)) {
        newResult += result.slice(lastIndex, match.index) + match[0];
        lastIndex = match.index + match[0].length;
        continue;
      }
      // Skip input. prefix (already handled above)
      if (trimmedPath.startsWith('input.')) {
        newResult += result.slice(lastIndex, match.index) + match[0];
        lastIndex = match.index + match[0].length;
        continue;
      }
      const value = getValueByPath(context.inputPayload!, trimmedPath);
      const inQuoted = isInQuotedContext(result, match.index);
      newResult += result.slice(lastIndex, match.index) + formatValue(value, inQuoted);
      lastIndex = match.index + match[0].length;
    }
    result = newResult + result.slice(lastIndex);
  }

  return result;
}

/**
 * Resolves a title template string by replacing {{variable}} placeholders.
 * Supports:
 *   {{input.path.to.value}} - Value from input payload
 *   {{item}} or {{_item}} - Current item in foreach loop
 *   {{_index}} - Current index in foreach loop
 *   {{_total}} - Total count in foreach loop
 *   {{anyVariable}} - Direct lookup from input payload
 */
export function resolveTitleTemplate(
  template: string,
  inputPayload?: Record<string, unknown>,
  fallbackTitle?: string
): string {
  if (!template) return fallbackTitle || '';

  let result = template;

  // Replace all {{...}} patterns
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
    const trimmedPath = path.trim();

    // Handle input.* prefix explicitly
    if (trimmedPath.startsWith('input.')) {
      const inputPath = trimmedPath.substring(6); // Remove 'input.' prefix
      const value = getValueByPath(inputPayload, inputPath);
      return value !== undefined && value !== null ? String(value) : '';
    }

    // Handle direct property lookup (for item, _index, _total, etc.)
    const value = getValueByPath(inputPayload, trimmedPath);
    if (value !== undefined && value !== null) {
      // For objects, provide a brief representation
      if (typeof value === 'object') {
        // Try to get a meaningful identifier from the object
        const obj = value as Record<string, unknown>;
        if (obj.name) return String(obj.name);
        if (obj.title) return String(obj.title);
        if (obj.id) return String(obj.id);
        if (obj._id) return String(obj._id);
        // Fallback to JSON for simple objects
        return JSON.stringify(value);
      }
      return String(value);
    }

    // If not found, return empty string (variable not available)
    return '';
  });

  // If the result is empty after substitution, use fallback
  if (!result.trim()) {
    return fallbackTitle || template;
  }

  return result;
}
