import { describe, it, expect } from 'vitest';
import { getEffectiveSensitivity, sanitizeSecrets } from './variable-safety.js';

describe('Variable Safety', () => {
  describe('getEffectiveSensitivity', () => {
    it('should return explicit sensitivity when set', () => {
      expect(getEffectiveSensitivity({ sensitivity: 'secret', encrypted: false })).toBe('secret');
      expect(getEffectiveSensitivity({ sensitivity: 'safe', encrypted: true })).toBe('safe');
    });

    it('should default to secret for encrypted variables', () => {
      expect(getEffectiveSensitivity({ encrypted: true })).toBe('secret');
    });

    it('should default to safe for unencrypted variables', () => {
      expect(getEffectiveSensitivity({ encrypted: false })).toBe('safe');
    });

    it('should handle undefined sensitivity', () => {
      expect(getEffectiveSensitivity({ sensitivity: undefined, encrypted: true })).toBe('secret');
      expect(getEffectiveSensitivity({ sensitivity: undefined, encrypted: false })).toBe('safe');
    });
  });

  describe('sanitizeSecrets', () => {
    it('should replace known secret values with [REDACTED]', () => {
      const text = 'Authorization: Bearer sk-abc123xyz789';
      const secrets = ['sk-abc123xyz789'];
      expect(sanitizeSecrets(text, secrets)).toBe('Authorization: Bearer [REDACTED]');
    });

    it('should handle multiple occurrences of the same secret', () => {
      const text = 'key=mySecretKey123, backup=mySecretKey123';
      const secrets = ['mySecretKey123'];
      expect(sanitizeSecrets(text, secrets)).toBe('key=[REDACTED], backup=[REDACTED]');
    });

    it('should handle multiple different secrets', () => {
      const text = 'token=ghp_abcdef123456 key=sk-xyz789abc';
      const secrets = ['ghp_abcdef123456', 'sk-xyz789abc'];
      expect(sanitizeSecrets(text, secrets)).toBe('token=[REDACTED] key=[REDACTED]');
    });

    it('should skip short secrets (< 8 chars) to avoid false positives', () => {
      const text = 'The value is abc and the key is longSecretValue99';
      const secrets = ['abc', 'longSecretValue99'];
      expect(sanitizeSecrets(text, secrets)).toBe('The value is abc and the key is [REDACTED]');
    });

    it('should handle empty secret list', () => {
      const text = 'no secrets here';
      expect(sanitizeSecrets(text, [])).toBe('no secrets here');
    });

    it('should handle empty text', () => {
      expect(sanitizeSecrets('', ['someSecret123'])).toBe('');
    });

    it('should handle secrets with regex special characters', () => {
      const text = 'password=p@$$w0rd.123+test';
      const secrets = ['p@$$w0rd.123+test'];
      expect(sanitizeSecrets(text, secrets)).toBe('password=[REDACTED]');
    });

    it('should handle JSON-encoded secrets', () => {
      const text = '{"headers":{"Authorization":"Bearer ghp_realtoken123456"}}';
      const secrets = ['ghp_realtoken123456'];
      expect(sanitizeSecrets(text, secrets)).toBe('{"headers":{"Authorization":"Bearer [REDACTED]"}}');
    });

    it('should handle overlapping secrets (longer match first)', () => {
      const text = 'key=my-long-secret-key-value';
      // Longer secrets should be sorted first by the caller
      const secrets = ['my-long-secret-key-value', 'secret-key'];
      expect(sanitizeSecrets(text, secrets)).toBe('key=[REDACTED]');
    });
  });
});
