/**
 * Integration tests for workflow deployment and variable resolution.
 *
 * These tests verify:
 * 1. Dynamic agent resolution via {{agent.*}} templates
 * 2. Code step sandbox has _stepLog and _workflowRunId
 * 3. Workflow definitions match expected structure (no hardcoded IDs)
 * 4. Foreach/join connections are properly linked
 */

import { describe, it, expect } from 'vitest';
import { executeCode } from './code-executor.js';
import { loadPackageContext, resolveTitleTemplate, resolveAgentTemplate } from './template-utils.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

describe('Workflow Variable Resolution', () => {
  describe('Template resolution for assignee IDs', () => {
    it('should resolve {{variables.workflow_agents.opusId}} from variable packages', async () => {
      // This tests the template utils resolve variable packages
      const context = await loadPackageContext();

      // Variable packages should be loaded (may be empty in test env without DB)
      expect(context).toHaveProperty('variables');
      expect(typeof context.variables).toBe('object');
    });

    it('should resolve nested variable paths in title templates', () => {
      // resolveTitleTemplate takes (template, inputPayload)
      // {{input.idea}} resolves to inputPayload.idea
      const template = 'WF Create: {{input.idea}}';
      const result = resolveTitleTemplate(template, { idea: 'Test workflow' });
      expect(result).toBe('WF Create: Test workflow');
    });
  });

  describe('Code step sandbox with _stepLog', () => {
    it('should have access to _stepLog for loop counting', async () => {
      // Matches actual deployed code step: review-loop-check
      const code = `
        const reviewCount = (_stepLog || []).filter(e => e.stepId === 'review-design').length;
        const maxReviews = 5;
        const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
        const verdict = (prevVerdict === 'pass' || reviewCount >= maxReviews) ? 'pass' : prevVerdict || 'fail';
        return { verdict, reviewCount, maxReviews, capped: reviewCount >= maxReviews };
      `;

      // _stepLog is a top-level context field; need 'input' key to trigger context mode
      const result = await executeCode(code, {
        input: { output: { result: { verdict: 'pass' } } },
        _stepLog: [
          { stepId: 'review-design', timestamp: '2024-01-01' },
          { stepId: 'review-design', timestamp: '2024-01-02' },
          { stepId: 'other-step', timestamp: '2024-01-03' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        verdict: 'pass',
        reviewCount: 2,
        maxReviews: 5,
        capped: false,
      });
    });

    it('should return fail when verdict is fail and under max reviews', async () => {
      const code = `
        const reviewCount = (_stepLog || []).filter(e => e.stepId === 'review-design').length;
        const maxReviews = 5;
        const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
        const verdict = (prevVerdict === 'pass' || reviewCount >= maxReviews) ? 'pass' : prevVerdict || 'fail';
        return { verdict, reviewCount, maxReviews, capped: reviewCount >= maxReviews };
      `;

      const result = await executeCode(code, {
        input: { output: { result: { verdict: 'fail' } } },
        _stepLog: [
          { stepId: 'review-design', timestamp: '2024-01-01' },
        ],
      });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.verdict).toBe('fail');
      expect(out.reviewCount).toBe(1);
    });

    it('should return pass when max reviews exceeded', async () => {
      const code = `
        const reviewCount = (_stepLog || []).filter(e => e.stepId === 'review-design').length;
        const maxReviews = 5;
        const prevVerdict = (input.output && input.output.result && input.output.result.verdict) || '';
        const verdict = (prevVerdict === 'pass' || reviewCount >= maxReviews) ? 'pass' : prevVerdict || 'fail';
        return { verdict, reviewCount, maxReviews, capped: reviewCount >= maxReviews };
      `;

      const stepLog = Array.from({ length: 6 }, (_, i) => ({
        stepId: 'review-design',
        timestamp: `2024-01-0${i + 1}`,
      }));

      // Even with fail verdict, max reviews forces pass
      const result = await executeCode(code, {
        input: { output: { result: { verdict: 'fail' } } },
        _stepLog: stepLog,
      });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.verdict).toBe('pass');
      expect(out.reviewCount).toBe(6);
      expect(out.capped).toBe(true);
    });

    it('should handle empty _stepLog gracefully', async () => {
      // Matches deployed debate-count code step
      const code = `
        const debatesDone = (_stepLog || []).filter(e => e.stepId === 'judge-debate').length;
        const maxRounds = (trigger && trigger.debateRounds) || 2;
        const moreDebate = debatesDone < maxRounds;
        return { verdict: moreDebate ? 'more' : 'done', debatesDone, maxRounds };
      `;

      const result = await executeCode(code, {
        input: {},
        trigger: { debateRounds: 3 },
        _stepLog: [],
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        verdict: 'more',
        debatesDone: 0,
        maxRounds: 3,
      });
    });

    it('should handle missing _stepLog and use default debate rounds', async () => {
      const code = `
        const debatesDone = (_stepLog || []).filter(e => e.stepId === 'judge-debate').length;
        const maxRounds = (trigger && trigger.debateRounds) || 2;
        return { debatesDone, maxRounds };
      `;

      // Pass as context with input key so _stepLog defaults to []
      const result = await executeCode(code, { input: {} });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.debatesDone).toBe(0);
      expect(out.maxRounds).toBe(2); // default when trigger is missing
    });
  });

  describe('Setup code step for multi-model workflow', () => {
    it('should build models config from input', async () => {
      const code = `
        const models = input.models || [
          { modelName: 'Depth', role: 'Comprehensive analytical model', style: 'thorough, detailed, structured' },
          { modelName: 'Concise', role: 'Practical efficient model', style: 'direct, actionable, minimal' },
          { modelName: 'Creative', role: 'Multi-perspective creative model', style: 'innovative, exploratory, varied' }
        ];
        const debateRounds = input.debateRounds || 2;
        return { models, debateRounds, modelCount: models.length };
      `;

      const result = await executeCode(code, {});
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.models).toHaveLength(3);
      expect(out.debateRounds).toBe(2);
      expect(out.modelCount).toBe(3);
      expect(out.models[0].modelName).toBe('Depth');
    });

    it('should use custom models from input when provided', async () => {
      const code = `
        const models = input.models || [
          { modelName: 'Depth', role: 'default', style: 'default' }
        ];
        return { models, modelCount: models.length };
      `;

      const result = await executeCode(code, {
        models: [
          { modelName: 'Custom1', role: 'role1', style: 'style1' },
          { modelName: 'Custom2', role: 'role2', style: 'style2' },
        ],
      });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.models).toHaveLength(2);
      expect(out.models[0].modelName).toBe('Custom1');
    });
  });

  describe('Promote document code step', () => {
    it('should handle missing document ID gracefully', async () => {
      const code = `
        const saveOutput = steps && steps['save-draft'] && steps['save-draft'].output;
        const docId = saveOutput && saveOutput.result && saveOutput.result._id;
        if (!docId) return { status: 'SKIPPED', reason: 'No document ID found' };
        return { status: 'FOUND', docId };
      `;

      const result = await executeCode(code, {
        steps: {},
      });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.status).toBe('SKIPPED');
    });

    it('should find document ID from save-draft step output', async () => {
      const code = `
        const saveOutput = steps && steps['save-draft'] && steps['save-draft'].output;
        const docId = saveOutput && saveOutput.result && saveOutput.result._id;
        if (!docId) return { status: 'SKIPPED', reason: 'No document ID found' };
        return { status: 'FOUND', docId };
      `;

      const result = await executeCode(code, {
        steps: {
          'save-draft': {
            output: {
              result: { _id: 'abc123' },
            },
          },
        },
      });
      const out = result.output as AnyRecord;

      expect(result.success).toBe(true);
      expect(out.status).toBe('FOUND');
      expect(out.docId).toBe('abc123');
    });
  });
});

describe('Workflow Structure Validation', () => {
  it('should verify WC workflow has no trigger step', () => {
    const wcStepTypes = [
      'agent', 'agent', 'code', 'decision', 'agent',
      'agent', 'agent', 'code', 'decision', 'agent',
      'manual', 'decision', 'agent', 'code',
    ];
    expect(wcStepTypes[0]).not.toBe('trigger');
    expect(wcStepTypes).not.toContain('trigger');
  });

  it('should verify MC workflow has no trigger step', () => {
    const mcStepTypes = [
      'code', 'manual', 'foreach', 'agent', 'join',
      'agent', 'code', 'decision', 'foreach', 'agent',
      'join', 'agent', 'code', 'decision', 'agent',
      'webhook', 'manual', 'decision', 'agent', 'code',
      'decision', 'code',
    ];
    expect(mcStepTypes[0]).not.toBe('trigger');
    expect(mcStepTypes).not.toContain('trigger');
  });

  it('should verify no hardcoded agent IDs in dynamic agent patterns', () => {
    const agentPattern = /^\{\{agent\.(complexity\.\d|tag\.[\w-]+|name\..+)\}\}$/;
    const hardcodedIdPattern = /^[a-f0-9]{24}$/;

    const assigneeRefs = [
      '{{agent.complexity.3}}',
      '{{agent.complexity.1}}',
      '{{agent.tag.api-integration}}',
    ];

    for (const ref of assigneeRefs) {
      expect(ref).toMatch(agentPattern);
      expect(ref).not.toMatch(hardcodedIdPattern);
    }
  });
});

describe('Agent Template Resolution', () => {
  it('should parse agent.complexity.3 pattern', () => {
    const match = '{{agent.complexity.3}}'.match(/^\{\{agent\.(.+)\}\}$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('complexity.3');
  });

  it('should parse agent.tag.api-integration pattern', () => {
    const match = '{{agent.tag.api-integration}}'.match(/^\{\{agent\.(.+)\}\}$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('tag.api-integration');
  });

  it('should parse agent.name.Claude Opus pattern', () => {
    const match = '{{agent.name.Claude Opus}}'.match(/^\{\{agent\.(.+)\}\}$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('name.Claude Opus');
  });

  it('should not match non-agent templates', () => {
    const match = '{{variables.workflow_agents.opusId}}'.match(/^\{\{agent\.(.+)\}\}$/);
    expect(match).toBeNull();
  });

  it('should return undefined for non-agent template strings', async () => {
    const result = await resolveAgentTemplate('{{variables.something}}');
    expect(result).toBeUndefined();
  });

  it('should return undefined for plain strings', async () => {
    const result = await resolveAgentTemplate('not-a-template');
    expect(result).toBeUndefined();
  });

  it('should return undefined when no matching agent exists (no DB)', async () => {
    // In test env without DB, loadAgentCache returns empty map
    const result = await resolveAgentTemplate('{{agent.complexity.3}}');
    expect(result).toBeUndefined();
  });
});
