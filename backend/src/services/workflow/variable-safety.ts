/**
 * Variable Safety Module
 *
 * Ensures secret variables are never exposed to LLMs.
 * Provides opaque $VAR{name} references for agent prompts
 * and server-side resolution when agents request actions that need them.
 */

import { getDb } from '../../db/connection.js';
import { VariablePackage } from '../../types/index.js';
import { getValueByPathWithBrackets, loadPackageContext } from './template-utils.js';
import { isEncryptionConfigured } from '../encryption.js';

// Opaque reference format: $VAR{variable_name} or $VAR{variable_name.nested.path}
const OPAQUE_PATTERN = /\$VAR\{([^}]+)\}/g;

// Minimum length for a secret value to be used in sanitization scanning.
// Shorter values would cause too many false positives.
const MIN_SECRET_LENGTH = 8;

/**
 * Determine effective sensitivity for a variable.
 * Defaults to 'secret' for encrypted, 'safe' for unencrypted.
 */
export function getEffectiveSensitivity(v: Pick<VariablePackage, 'sensitivity' | 'encrypted'>): 'secret' | 'safe' {
  if (v.sensitivity) return v.sensitivity;
  return v.encrypted ? 'secret' : 'safe';
}

/**
 * Variable manifest entry — safe to include in LLM prompts (no values).
 */
export interface VariableManifestEntry {
  name: string;
  displayName?: string;
  description?: string;
  sensitivity: 'secret' | 'safe';
  /** Available key paths for structured variables (e.g., ['host', 'port', 'credentials.token']). Keys are not secret — only values are. */
  keys?: string[];
}

/**
 * Extract all dot-path keys from a nested object (keys only, no values).
 * Example: { a: { b: 1, c: { d: 2 } }, e: 3 } => ['a.b', 'a.c.d', 'e']
 */
function extractKeyPaths(obj: unknown, prefix: string = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const paths: string[] = [];
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...extractKeyPaths(value, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

/**
 * Load variable manifest (names + sensitivity + key structure, NO values).
 * Safe to include in LLM prompts so agents know what variables exist
 * and what paths are available for $VAR{name.path} references.
 *
 * Keys are NOT considered secret — only leaf values are.
 * For encrypted structured variables, we decrypt to extract key paths,
 * then discard the values entirely.
 */
export async function getVariableManifest(): Promise<VariableManifestEntry[]> {
  let db;
  try {
    db = getDb();
  } catch {
    return [];
  }

  const variables = await db
    .collection<VariablePackage>('variable_packages')
    .find({ isActive: true })
    .toArray();

  // Load decrypted context to extract structure (if encryption key available)
  const packageContext = await loadPackageContext();

  return variables.map((v) => {
    const entry: VariableManifestEntry = {
      name: v.name,
      displayName: v.displayName,
      description: v.description,
      sensitivity: getEffectiveSensitivity(v),
    };

    // Expose key structure for structured variables (JSON/YAML objects).
    // Keys are not secret — only values are.
    const resolved = packageContext.variables[v.name];
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      entry.keys = extractKeyPaths(resolved);
    }

    return entry;
  });
}

/**
 * Resolve $VAR{name} and $VAR{name.path} references to actual decrypted values.
 * Called SERVER-SIDE ONLY when processing agent responses for HTTP operations.
 *
 * @param text - Text containing $VAR{...} references
 * @returns Text with all resolvable references replaced with actual values
 */
export async function resolveOpaqueReferences(text: string): Promise<string> {
  if (!text.includes('$VAR{')) return text;

  const packageContext = await loadPackageContext();

  return text.replace(OPAQUE_PATTERN, (match, path: string) => {
    const fullPath = `variables.${path}`;
    const value = getValueByPathWithBrackets(
      packageContext as unknown as Record<string, unknown>,
      fullPath
    );
    if (value !== undefined) {
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    return match; // Leave unresolved if not found
  });
}

/**
 * Resolve $VAR{} references in a structured object (recursive).
 * Walks all string values in the object and resolves references.
 */
export async function resolveOpaqueReferencesInObject<T>(obj: T): Promise<T> {
  if (typeof obj === 'string') {
    return await resolveOpaqueReferences(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return await Promise.all(obj.map((item) => resolveOpaqueReferencesInObject(item))) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = await resolveOpaqueReferencesInObject(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Recursively collect all leaf string values from an object.
 */
function collectStringValues(obj: unknown, results: string[], minLength: number = MIN_SECRET_LENGTH): void {
  if (typeof obj === 'string' && obj.length >= minLength) {
    results.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      collectStringValues(item, results, minLength);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      collectStringValues(value, results, minLength);
    }
  }
}

/**
 * Get all decrypted secret values for sanitization scanning.
 * Returns string values that should NEVER appear in LLM-visible text.
 * Only returns values >= MIN_SECRET_LENGTH chars to avoid false positives.
 *
 * When encryption key is not configured, encrypted variables are skipped
 * (they can't be decrypted, so there's nothing to sanitize against).
 */
export async function getSecretValues(): Promise<string[]> {
  let db;
  try {
    db = getDb();
  } catch {
    return [];
  }

  const variables = await db
    .collection<VariablePackage>('variable_packages')
    .find({ isActive: true })
    .toArray();

  const encryptionAvailable = isEncryptionConfigured();
  const packageContext = await loadPackageContext();
  const secrets: string[] = [];

  for (const v of variables) {
    const sensitivity = getEffectiveSensitivity(v);
    if (sensitivity !== 'safe') {
      // Skip encrypted variables when we can't decrypt them —
      // the raw enc:... blob is useless for sanitization
      if (v.encrypted && !encryptionAvailable) continue;

      const decrypted = packageContext.variables[v.name];

      // Also skip values that are still in encrypted format (decryption failed)
      if (typeof decrypted === 'string' && decrypted.startsWith('enc:')) continue;

      if (typeof decrypted === 'string' && decrypted.length >= MIN_SECRET_LENGTH) {
        secrets.push(decrypted);
      } else if (typeof decrypted === 'object' && decrypted !== null) {
        collectStringValues(decrypted, secrets);
      }
    }
  }

  // Sort by length descending so longer patterns match first
  // (prevents partial matches when one secret is a substring of another)
  secrets.sort((a, b) => b.length - a.length);

  return secrets;
}

/**
 * Sanitize text by replacing any occurrence of known secret values with [REDACTED].
 * Used for scrubbing conversation logs, inputPayloads, and any LLM-visible text.
 *
 * @param text - Text to sanitize
 * @param secretValues - Known secret values to scrub (from getSecretValues())
 * @returns Sanitized text
 */
export function sanitizeSecrets(text: string, secretValues: string[]): string {
  let result = text;
  for (const secret of secretValues) {
    if (secret.length >= MIN_SECRET_LENGTH) {
      // Use split+join for safe global replacement (no regex special char issues)
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
}
