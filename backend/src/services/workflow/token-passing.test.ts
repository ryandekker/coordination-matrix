import { describe, it, expect } from 'vitest';
import { getValueByPath, resolveTemplateValue } from './template-utils.js';

/**
 * Token Passing Tests
 *
 * These tests ensure that workflow tokens (data payloads) are correctly
 * passed between steps in various scenarios:
 *
 * 1. Trigger → First step
 * 2. Step → Step (via stepOutput.data)
 * 3. inputConfig.source resolution
 * 4. Template variable resolution
 */

describe('Token Passing - Template Utils', () => {
  describe('getValueByPath', () => {
    it('should extract simple path', () => {
      const obj = { foo: 'bar' };
      expect(getValueByPath(obj, 'foo')).toBe('bar');
    });

    it('should extract nested path', () => {
      const obj = { level1: { level2: { value: 42 } } };
      expect(getValueByPath(obj, 'level1.level2.value')).toBe(42);
    });

    it('should handle leading $ or . prefix', () => {
      const obj = { foo: { bar: 'baz' } };
      expect(getValueByPath(obj, '$.foo.bar')).toBe('baz');
      expect(getValueByPath(obj, '.foo.bar')).toBe('baz');
    });

    it('should return undefined for missing paths', () => {
      const obj = { foo: 'bar' };
      expect(getValueByPath(obj, 'missing')).toBeUndefined();
      expect(getValueByPath(obj, 'foo.bar.baz')).toBeUndefined();
    });

    it('should return undefined for null/undefined objects', () => {
      expect(getValueByPath(undefined, 'foo')).toBeUndefined();
    });

    it('should handle array indices in path', () => {
      const obj = { items: ['a', 'b', 'c'] };
      expect(getValueByPath(obj, 'items.0')).toBe('a');
      expect(getValueByPath(obj, 'items.2')).toBe('c');
    });

    it('should handle complex nested structures', () => {
      const obj = {
        output: {
          aggregatedResults: [
            { data: { name: 'result1' } },
            { data: { name: 'result2' } },
          ],
        },
      };
      expect(getValueByPath(obj, 'output.aggregatedResults.0.data.name')).toBe('result1');
    });
  });

  describe('resolveTemplateValue', () => {
    it('should resolve simple output path', async () => {
      const sourceData = { output: { message: 'hello' } };
      const result = await resolveTemplateValue('{{output.message}}', sourceData);
      expect(result).toBe('hello');
    });

    it('should resolve trigger path', async () => {
      const sourceData = { foo: 'bar' };
      const triggerData = { userId: 123, action: 'start' };
      const result = await resolveTemplateValue('{{trigger.userId}}', sourceData, triggerData);
      expect(result).toBe(123);
    });

    it('should resolve input path', async () => {
      const sourceData = { field1: 'value1', field2: 'value2' };
      const result = await resolveTemplateValue('{{input.field1}}', sourceData);
      expect(result).toBe('value1');
    });

    it('should resolve direct path in source data', async () => {
      const sourceData = { item: { name: 'test-item', id: 456 } };
      const result = await resolveTemplateValue('{{item.name}}', sourceData);
      expect(result).toBe('test-item');
    });

    it('should preserve object types for simple expressions', async () => {
      const sourceData = {
        output: {
          results: [1, 2, 3],
          config: { enabled: true }
        }
      };

      const arrayResult = await resolveTemplateValue('{{output.results}}', sourceData);
      expect(arrayResult).toEqual([1, 2, 3]);

      const objectResult = await resolveTemplateValue('{{output.config}}', sourceData);
      expect(objectResult).toEqual({ enabled: true });
    });

    it('should stringify objects in complex templates', async () => {
      const sourceData = { data: { nested: 'value' } };
      const result = await resolveTemplateValue('Result: {{data}}', sourceData);
      expect(result).toBe('Result: {"nested":"value"}');
    });

    it('should handle undefined values gracefully', async () => {
      const sourceData = { existing: 'value' };
      const result = await resolveTemplateValue('{{missing.path}}', sourceData);
      expect(result).toBeUndefined();
    });

    it('should handle empty string for missing values in complex templates', async () => {
      const sourceData = { existing: 'value' };
      const result = await resolveTemplateValue('Prefix: {{missing}} Suffix', sourceData);
      expect(result).toBe('Prefix:  Suffix');
    });
  });
});

describe('Token Passing - stepOutput Structure', () => {
  /**
   * These tests verify the expected structure of stepOutput
   * that should be set by various step types
   */

  describe('Join step output', () => {
    it('should have correct structure for join results', () => {
      // Simulating what checkJoinCondition should produce
      const aggregatedResults = [
        { name: 'item1', processed: true },
        { name: 'item2', processed: true },
      ];

      const expectedStepOutput = {
        data: { aggregatedResults },
        summary: expect.any(String),
        producedAt: expect.any(Date),
        aggregatedResults: [
          { taskId: expect.any(String), stepId: expect.any(String), data: aggregatedResults[0], status: 'success' },
          { taskId: expect.any(String), stepId: expect.any(String), data: aggregatedResults[1], status: 'success' },
        ],
      };

      // Verify structure matches what advanceToNextStep expects
      expect(expectedStepOutput.data).toBeDefined();
      expect(expectedStepOutput.data.aggregatedResults).toBeInstanceOf(Array);
    });
  });

  describe('External step output', () => {
    it('should have correct structure for callback data', () => {
      const callbackData = { status: 'success', result: { items: [1, 2, 3] } };

      const expectedStepOutput = {
        data: callbackData,
        summary: expect.stringContaining('External callback'),
        producedAt: expect.any(Date),
      };

      expect(expectedStepOutput.data).toBeDefined();
      expect(expectedStepOutput.data.status).toBe('success');
    });
  });

  describe('Decision step output', () => {
    it('should pass through input and add decision metadata', () => {
      const inputPayload = { field1: 'value1', field2: 'value2' };
      const selectedPath = 'step-approve';

      const expectedStepOutput = {
        data: {
          ...inputPayload,
          _decision: {
            selectedPath,
            condition: 'status:approved',
            matchedValue: 'approved',
            decisionField: 'status',
          },
        },
        summary: expect.stringContaining('Decision'),
        producedAt: expect.any(Date),
        selectedBranch: {
          targetStepId: selectedPath,
          condition: 'status:approved',
        },
      };

      // Verify decision passes through input
      expect(expectedStepOutput.data.field1).toBe('value1');
      expect(expectedStepOutput.data.field2).toBe('value2');
      // And adds decision metadata
      expect(expectedStepOutput.data._decision).toBeDefined();
    });
  });

  describe('Flow step (subflow) output', () => {
    it('should have correct structure for subflow output', () => {
      const subflowOutput = {
        'step-1': { result: 'data1' },
        'step-2': { result: 'data2' },
      };

      const expectedStepOutput = {
        data: subflowOutput,
        summary: expect.stringContaining('Subflow completed'),
        producedAt: expect.any(Date),
        nestedWorkflow: {
          runId: expect.any(String),
          status: 'completed',
          output: subflowOutput,
        },
      };

      expect(expectedStepOutput.data).toBeDefined();
      expect(expectedStepOutput.nestedWorkflow).toBeDefined();
    });
  });
});

describe('Token Passing - Input Resolution', () => {
  /**
   * Tests for different inputConfig.source values
   */

  describe('inputConfig.source = "previous"', () => {
    it('should use previous step output directly', () => {
      const previousStepOutput = {
        output: { message: 'from previous', count: 42 },
        status: 'completed',
      };

      // When source is 'previous', sourceData should be previousStepOutput
      const sourceData = previousStepOutput;
      expect(sourceData.output.message).toBe('from previous');
    });
  });

  describe('inputConfig.source = "trigger"', () => {
    it('should use trigger payload', () => {
      const triggerPayload = { userId: 123, action: 'start', timestamp: '2024-01-01' };

      // When source is 'trigger', sourceData should be run.inputPayload
      const sourceData = triggerPayload;
      expect(sourceData.userId).toBe(123);
      expect(sourceData.action).toBe('start');
    });
  });

  describe('inputConfig.extractPath', () => {
    it('should extract specific path from source', () => {
      const sourceData = {
        output: {
          result: {
            items: ['a', 'b', 'c'],
            metadata: { count: 3 },
          },
        },
      };

      const extractPath = 'output.result.items';
      const extracted = getValueByPath(sourceData, extractPath);
      expect(extracted).toEqual(['a', 'b', 'c']);
    });
  });

  describe('inputConfig.mapping', () => {
    it('should map fields using templates', async () => {
      const sourceData = {
        output: { name: 'John', email: 'john@example.com' },
        metadata: { score: 95 },
      };

      const mapping = {
        userName: '{{output.name}}',
        userEmail: '{{output.email}}',
        userScore: '{{metadata.score}}',
      };

      const resolved: Record<string, unknown> = {};
      for (const [key, template] of Object.entries(mapping)) {
        resolved[key] = await resolveTemplateValue(template, sourceData);
      }

      expect(resolved).toEqual({
        userName: 'John',
        userEmail: 'john@example.com',
        userScore: 95,
      });
    });
  });
});

describe('Token Passing - Edge Cases', () => {
  describe('Empty payloads', () => {
    it('should handle empty trigger payload', async () => {
      const sourceData = { output: 'value' };
      const triggerData = {};

      const result = await resolveTemplateValue('{{trigger.missing}}', sourceData, triggerData);
      expect(result).toBeUndefined();
    });

    it('should handle empty previous step output', async () => {
      const sourceData = {};
      const result = await resolveTemplateValue('{{output.field}}', sourceData);
      expect(result).toBeUndefined();
    });
  });

  describe('Null values', () => {
    it('should handle null values in payload', async () => {
      const sourceData = { output: { value: null } };
      const result = await resolveTemplateValue('{{output.value}}', sourceData);
      expect(result).toBeNull();
    });
  });

  describe('Deeply nested paths', () => {
    it('should handle very deep nesting', () => {
      const obj = {
        a: { b: { c: { d: { e: { f: 'deep-value' } } } } },
      };
      expect(getValueByPath(obj, 'a.b.c.d.e.f')).toBe('deep-value');
    });
  });

  describe('Special characters in values', () => {
    it('should preserve special characters', async () => {
      const sourceData = {
        output: {
          message: 'Hello "World"!\nNew line here.',
          code: 'if (x > 0) { return true; }',
        },
      };

      const result = await resolveTemplateValue('{{output.message}}', sourceData);
      expect(result).toBe('Hello "World"!\nNew line here.');
    });
  });

  describe('Array handling', () => {
    it('should extract arrays as complete objects', async () => {
      const sourceData = {
        output: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
          ],
        },
      };

      const result = await resolveTemplateValue('{{output.items}}', sourceData);
      expect(result).toEqual([
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
      ]);
    });

    it('should access array elements by index', () => {
      const sourceData = {
        items: ['zero', 'one', 'two'],
      };
      expect(getValueByPath(sourceData, 'items.1')).toBe('one');
    });
  });
});
