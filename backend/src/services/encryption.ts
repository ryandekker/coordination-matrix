/**
 * Encryption service for variable package secrets
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Get the encryption key from environment
 * Key should be 32 bytes, base64 encoded
 */
function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.VARIABLE_ENCRYPTION_KEY;

  if (!keyBase64) {
    throw new Error(
      'VARIABLE_ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  const key = Buffer.from(keyBase64, 'base64');

  if (key.length !== 32) {
    throw new Error(
      `VARIABLE_ENCRYPTION_KEY must be exactly 32 bytes (256 bits). Got ${key.length} bytes.`
    );
  }

  return key;
}

/**
 * Check if encryption is configured
 */
export function isEncryptionConfigured(): boolean {
  return !!process.env.VARIABLE_ENCRYPTION_KEY;
}

/**
 * Encrypt a plaintext string
 * Returns format: enc:iv:ciphertext:tag (all base64)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${encrypted}:${tag.toString('base64')}`;
}

/**
 * Decrypt an encrypted string
 * Expects format: enc:iv:ciphertext:tag
 */
export function decrypt(encrypted: string): string {
  if (!isEncrypted(encrypted)) {
    throw new Error('Value is not encrypted (missing enc: prefix)');
  }

  const key = getEncryptionKey();

  // Remove prefix and split
  const parts = encrypted.slice(ENCRYPTED_PREFIX.length).split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format. Expected enc:iv:ciphertext:tag');
  }

  const [ivBase64, ciphertextBase64, tagBase64] = parts;

  const iv = Buffer.from(ivBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }

  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid tag length: ${tag.length}`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a value is encrypted (has enc: prefix)
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt secret fields in a branch data object based on schema
 * Only encrypts fields marked as type 'secret' in the schema
 */
export function encryptBranchSecrets(
  branchData: Record<string, unknown>,
  schema: Array<{ key: string; type: string }>
): Record<string, unknown> {
  const result = { ...branchData };

  for (const field of schema) {
    if (field.type === 'secret' && result[field.key] !== undefined) {
      const value = result[field.key];
      if (typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
        result[field.key] = encrypt(value);
      }
    }
  }

  return result;
}

/**
 * Decrypt secret fields in a branch data object based on schema
 */
export function decryptBranchSecrets(
  branchData: Record<string, unknown>,
  schema: Array<{ key: string; type: string }>
): Record<string, unknown> {
  const result = { ...branchData };

  for (const field of schema) {
    if (field.type === 'secret' && result[field.key] !== undefined) {
      const value = result[field.key];
      if (typeof value === 'string' && isEncrypted(value)) {
        result[field.key] = decrypt(value);
      }
    }
  }

  return result;
}

/**
 * Redact secret fields in a branch data object (for API responses)
 * Replaces secret values with a placeholder
 */
export function redactBranchSecrets(
  branchData: Record<string, unknown>,
  schema: Array<{ key: string; type: string }>,
  placeholder: string = '••••••••'
): Record<string, unknown> {
  const result = { ...branchData };

  for (const field of schema) {
    if (field.type === 'secret' && result[field.key] !== undefined) {
      const value = result[field.key];
      if (typeof value === 'string' && value.length > 0) {
        result[field.key] = placeholder;
      }
    }
  }

  return result;
}

/**
 * Encrypt all branches in a package
 */
export function encryptPackageBranches(
  branches: Record<string, Record<string, unknown>>,
  schema: Array<{ key: string; type: string }>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [branchName, branchData] of Object.entries(branches)) {
    result[branchName] = encryptBranchSecrets(branchData, schema);
  }

  return result;
}

/**
 * Decrypt all branches in a package
 */
export function decryptPackageBranches(
  branches: Record<string, Record<string, unknown>>,
  schema: Array<{ key: string; type: string }>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [branchName, branchData] of Object.entries(branches)) {
    result[branchName] = decryptBranchSecrets(branchData, schema);
  }

  return result;
}

/**
 * Redact all branches in a package (for API responses)
 */
export function redactPackageBranches(
  branches: Record<string, Record<string, unknown>>,
  schema: Array<{ key: string; type: string }>,
  placeholder?: string
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [branchName, branchData] of Object.entries(branches)) {
    result[branchName] = redactBranchSecrets(branchData, schema, placeholder);
  }

  return result;
}
