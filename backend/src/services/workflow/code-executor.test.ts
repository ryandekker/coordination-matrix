import { describe, it, expect } from 'vitest';
import { executeCode, getAvailablePackages, getDefaultPackages } from './code-executor.js';

describe('Code Executor', () => {
  describe('executeCode', () => {
    it('should execute simple code and return result', async () => {
      const result = await executeCode(
        'return input.value * 2',
        { value: 21 }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe(42);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should handle async code', async () => {
      const result = await executeCode(
        'return await Promise.resolve(input.name.toUpperCase())',
        { name: 'hello' }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('HELLO');
    });

    it('should use lodash when requested', async () => {
      const result = await executeCode(
        'return _.groupBy(input.items, "category")',
        { items: [{ name: 'a', category: 'x' }, { name: 'b', category: 'y' }, { name: 'c', category: 'x' }] },
        { packages: ['lodash'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        x: [{ name: 'a', category: 'x' }, { name: 'c', category: 'x' }],
        y: [{ name: 'b', category: 'y' }],
      });
    });

    it('should use date-fns when requested', async () => {
      const result = await executeCode(
        'return dateFns.addDays(new Date("2024-01-15T00:00:00Z"), 1).toISOString().slice(0, 10)',
        {},
        { packages: ['date-fns'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('2024-01-16');
    });

    it('should support trigger and steps context', async () => {
      const result = await executeCode(
        'return { inputVal: input.x, triggerVal: trigger.y, step1Val: steps.step1.z }',
        { input: { x: 1 }, trigger: { y: 2 }, steps: { step1: { z: 3 } } }
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ inputVal: 1, triggerVal: 2, step1Val: 3 });
    });

    it('should inject requested packages', async () => {
      const result = await executeCode(
        'return uuid.v4().length',
        {},
        { packages: ['uuid'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe(36); // UUID v4 is 36 characters
    });

    it('should capture console logs', async () => {
      const result = await executeCode(
        'console.log("hello"); console.warn("warning"); return "done"',
        {}
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('done');
      expect(result.logs).toContain('[LOG] hello');
      expect(result.logs).toContain('[WARN] warning');
    });

    it('should handle errors gracefully', async () => {
      const result = await executeCode(
        'throw new Error("Test error")',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Test error');
    });

    it('should timeout on infinite loops', async () => {
      const result = await executeCode(
        'while(true) {}',
        {},
        { timeout: 100 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 5000);

    it('should require explicit return for output', async () => {
      const result = await executeCode(
        'return input.a + input.b',
        { a: 10, b: 32 }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe(42);
    });

    it('should use zod for validation when requested', async () => {
      const result = await executeCode(
        `const schema = z.object({ name: z.string() });
         return schema.parse(input)`,
        { name: 'test' },
        { packages: ['zod'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ name: 'test' });
    });

    it('should use JSONPath when requested', async () => {
      const result = await executeCode(
        'return JSONPath({ path: "$.items[*].name", json: input })',
        { items: [{ name: 'a' }, { name: 'b' }] },
        { packages: ['jsonpath-plus'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual(['a', 'b']);
    });

    it('should have fetch available when node-fetch is requested', async () => {
      const result = await executeCode(
        'return typeof fetch === "function" ? "fetch_available" : "not_available"',
        {},
        { packages: ['node-fetch'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('fetch_available');
    });

    it('should have axios available when requested', async () => {
      const result = await executeCode(
        'return typeof axios.get === "function" ? "axios_available" : "not_available"',
        {},
        { packages: ['axios'] }
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('axios_available');
    });
  });

  describe('getAvailablePackages', () => {
    it('should return list of available packages', () => {
      const packages = getAvailablePackages();

      expect(packages.length).toBeGreaterThan(0);

      // Find packages by name and verify their structure
      const lodashPkg = packages.find(p => p.package === 'lodash');
      expect(lodashPkg).toBeDefined();
      expect(lodashPkg?.sandboxName).toBe('_');
      expect(lodashPkg?.category).toBeDefined();
      expect(lodashPkg?.description).toBeDefined();

      const dateFnsPkg = packages.find(p => p.package === 'date-fns');
      expect(dateFnsPkg).toBeDefined();
      expect(dateFnsPkg?.sandboxName).toBe('dateFns');

      const uuidPkg = packages.find(p => p.package === 'uuid');
      expect(uuidPkg).toBeDefined();
      expect(uuidPkg?.sandboxName).toBe('uuid');

      // Verify fetch is available (key requirement)
      const fetchPkg = packages.find(p => p.package === 'node-fetch');
      expect(fetchPkg).toBeDefined();
      expect(fetchPkg?.sandboxName).toBe('fetch');
    });
  });

  describe('getDefaultPackages', () => {
    it('should return default packages', () => {
      const defaults = getDefaultPackages();

      expect(defaults).toContain('lodash');
      expect(defaults).toContain('date-fns');
    });
  });
});
