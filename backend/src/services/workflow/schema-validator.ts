import Ajv from 'ajv';

// AJV has nested default export in ESM context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = ((Ajv as any).default || Ajv) as typeof Ajv.default;
const ajv = new AjvClass({
  allErrors: true,       // Report all errors, not just the first
  strict: false,         // Don't require strict JSON Schema compliance
});

export interface SchemaValidationError {
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

/**
 * Validate data against a JSON Schema.
 * Returns a normalized result suitable for API error responses.
 */
export function validateAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>
): SchemaValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors || []).map((err: { instancePath?: string; message?: string; keyword: string; params: Record<string, unknown> }) => ({
    path: err.instancePath || '/',
    message: err.message || 'Validation error',
    keyword: err.keyword,
    params: err.params as Record<string, unknown>,
  }));

  return { valid: false, errors };
}

/**
 * Extract the list of required field names from a JSON Schema.
 */
export function getRequiredFields(schema: Record<string, unknown>): string[] {
  if (Array.isArray(schema.required)) {
    return schema.required as string[];
  }
  return [];
}

/**
 * Extract all defined property names from a JSON Schema.
 */
export function getSchemaPropertyNames(schema: Record<string, unknown>): string[] {
  if (schema.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties);
  }
  return [];
}

/**
 * Generate a human-readable summary of a JSON Schema for agent prompts.
 * Example: "Required: email (string), name (string). Optional: age (number)"
 */
export function summarizeSchema(schema: Record<string, unknown>): string {
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = new Set(getRequiredFields(schema));
  const requiredFields: string[] = [];
  const optionalFields: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const type = prop.type || 'any';
    const desc = prop.description ? ` - ${prop.description}` : '';
    const entry = `${name} (${type})${desc}`;
    if (required.has(name)) {
      requiredFields.push(entry);
    } else {
      optionalFields.push(entry);
    }
  }

  const parts: string[] = [];
  if (requiredFields.length > 0) {
    parts.push(`Required: ${requiredFields.join(', ')}`);
  }
  if (optionalFields.length > 0) {
    parts.push(`Optional: ${optionalFields.join(', ')}`);
  }
  return parts.join('. ') || 'No fields defined';
}
