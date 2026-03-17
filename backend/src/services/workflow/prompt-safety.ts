/**
 * Prompt Safety Module
 *
 * Lightweight scanner to detect prompt injection attempts
 * that try to extract variable values from agent context.
 *
 * This is a defense-in-depth layer. The primary protection is that
 * secret values never appear in prompts in the first place.
 */

// Patterns that suggest an attempt to extract variable values
const INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:print|echo|output|show|reveal|display|dump|list|return|give)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:your\s+)?(?:variables?|secrets?|credentials?|tokens?|api\s*keys?|passwords?|env(?:ironment)?)/i,
    description: 'Attempt to extract variable values',
  },
  {
    pattern: /(?:what\s+(?:is|are)\s+(?:the\s+)?(?:actual\s+|real\s+)?(?:value|content)s?\s+(?:of|in|for)\s+)\$VAR/i,
    description: 'Attempt to read $VAR reference values',
  },
  {
    pattern: /ignore\s+(?:all\s+)?(?:previous|above|prior|earlier|system)\s+instructions/i,
    description: 'Instruction override attempt',
  },
  {
    pattern: /(?:decode|decrypt|resolve|expand|unwrap|dereference)\s+(?:the\s+)?\$VAR/i,
    description: 'Attempt to resolve $VAR references',
  },
  {
    pattern: /\$VAR\{[^}]+\}[\s\S]{0,50}(?:what\s+(?:is|does)|tell\s+me|show\s+me)/i,
    description: 'Attempt to inspect $VAR value',
  },
];

export interface PromptSafetyResult {
  safe: boolean;
  warnings: string[];
}

/**
 * Scan text for suspicious patterns that may indicate prompt injection.
 * Returns warnings for logging — does not block execution.
 */
export function detectPromptInjection(text: string): PromptSafetyResult {
  const warnings: string[] = [];

  for (const { pattern, description } of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      warnings.push(`${description}: "${match[0].substring(0, 80)}"`);
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}
