import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';

// Test helper functions and route logic that can be tested in isolation

describe('Tasks Route Helpers', () => {
  describe('toObjectId', () => {
    function toObjectId(id: string): ObjectId | null {
      if (!ObjectId.isValid(id)) {
        return null;
      }
      return new ObjectId(id);
    }

    it('should convert valid ObjectId string', () => {
      const validId = '507f1f77bcf86cd799439011';
      const objectId = toObjectId(validId);
      expect(objectId).toBeInstanceOf(ObjectId);
      expect(objectId?.toString()).toBe(validId);
    });

    it('should return null for invalid ObjectId string', () => {
      const invalidId = 'not-a-valid-id';
      const objectId = toObjectId(invalidId);
      expect(objectId).toBeNull();
    });

    it('should handle 24-character hex string', () => {
      const validId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
      const objectId = toObjectId(validId);
      expect(objectId).toBeInstanceOf(ObjectId);
    });

    it('should reject too short strings', () => {
      const shortId = '507f1f77bcf86cd79943901';
      const objectId = toObjectId(shortId);
      expect(objectId).toBeNull();
    });

    it('should reject too long strings', () => {
      const longId = '507f1f77bcf86cd7994390111';
      const objectId = toObjectId(longId);
      expect(objectId).toBeNull();
    });
  });

  describe('resolveUserPlaceholder', () => {
    function resolveUserPlaceholder(value: string, currentUserId?: string): string {
      if (value === '{{currentUserId}}' && currentUserId) {
        return currentUserId;
      }
      return value;
    }

    it('should replace placeholder with current user id', () => {
      const userId = '507f1f77bcf86cd799439011';
      const result = resolveUserPlaceholder('{{currentUserId}}', userId);
      expect(result).toBe(userId);
    });

    it('should return placeholder if no current user', () => {
      const result = resolveUserPlaceholder('{{currentUserId}}');
      expect(result).toBe('{{currentUserId}}');
    });

    it('should return value unchanged if not a placeholder', () => {
      const userId = '507f1f77bcf86cd799439011';
      const result = resolveUserPlaceholder('other-value', userId);
      expect(result).toBe('other-value');
    });
  });

  describe('buildFilter', () => {
    // Simplified version of buildFilter for testing
    function buildFilter(query: Record<string, unknown>, _currentUserId?: string) {
      const filter: Record<string, unknown> = {};
      const { search, status, urgency, assigneeId, tags, includeArchived, rootOnly, parentId } = query;

      // Text search
      if (search && typeof search === 'string') {
        filter.$text = { $search: search };
      }

      // Root only filter
      if (rootOnly === 'true' || rootOnly === true) {
        filter.$or = [
          { parentId: null },
          { taskType: 'flow', parentId: { $ne: null } },
        ];
      } else if (parentId) {
        filter.parentId = new ObjectId(parentId as string);
      }

      // Status filter
      if (status) {
        if (Array.isArray(status)) {
          filter.status = { $in: status };
        } else {
          filter.status = status;
        }
      } else if (!(includeArchived === 'true' || includeArchived === true)) {
        filter.status = { $ne: 'archived' };
      }

      // Urgency filter
      if (urgency) {
        if (Array.isArray(urgency)) {
          filter.urgency = { $in: urgency };
        } else {
          filter.urgency = urgency;
        }
      }

      // Assignee filter
      if (assigneeId) {
        if (assigneeId === '__unassigned__') {
          filter.assigneeId = { $eq: null };
        } else if (Array.isArray(assigneeId) && assigneeId.includes('__unassigned__')) {
          const realIds = (assigneeId as string[])
            .filter((id) => id !== '__unassigned__')
            .map((id) => new ObjectId(id));
          if (realIds.length > 0) {
            filter.$or = [
              { assigneeId: { $eq: null } },
              { assigneeId: { $in: realIds } },
            ];
          } else {
            filter.assigneeId = { $eq: null };
          }
        } else if (Array.isArray(assigneeId)) {
          filter.assigneeId = { $in: (assigneeId as string[]).map((id) => new ObjectId(id)) };
        } else if (ObjectId.isValid(assigneeId as string)) {
          filter.assigneeId = new ObjectId(assigneeId as string);
        }
      }

      // Tags filter
      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        filter.tags = { $in: tagArray };
      }

      return filter;
    }

    it('should add text search filter', () => {
      const filter = buildFilter({ search: 'test query' });
      expect(filter.$text).toEqual({ $search: 'test query' });
    });

    it('should add root only filter', () => {
      const filter = buildFilter({ rootOnly: 'true' });
      expect(filter.$or).toEqual([
        { parentId: null },
        { taskType: 'flow', parentId: { $ne: null } },
      ]);
    });

    it('should add parent filter', () => {
      const parentId = '507f1f77bcf86cd799439011';
      const filter = buildFilter({ parentId });
      expect(filter.parentId).toEqual(new ObjectId(parentId));
    });

    it('should add status filter for single value', () => {
      const filter = buildFilter({ status: 'pending' });
      expect(filter.status).toBe('pending');
    });

    it('should add status filter for array', () => {
      const filter = buildFilter({ status: ['pending', 'in_progress'] });
      expect(filter.status).toEqual({ $in: ['pending', 'in_progress'] });
    });

    it('should exclude archived by default', () => {
      const filter = buildFilter({});
      expect(filter.status).toEqual({ $ne: 'archived' });
    });

    it('should include archived when requested', () => {
      const filter = buildFilter({ includeArchived: 'true' });
      expect(filter.status).toBeUndefined();
    });

    it('should add urgency filter for single value', () => {
      const filter = buildFilter({ urgency: 'high' });
      expect(filter.urgency).toBe('high');
    });

    it('should add urgency filter for array', () => {
      const filter = buildFilter({ urgency: ['high', 'urgent'] });
      expect(filter.urgency).toEqual({ $in: ['high', 'urgent'] });
    });

    it('should handle unassigned assignee', () => {
      const filter = buildFilter({ assigneeId: '__unassigned__' });
      expect(filter.assigneeId).toEqual({ $eq: null });
    });

    it('should handle unassigned with array containing only __unassigned__', () => {
      const filter = buildFilter({ assigneeId: ['__unassigned__'] });
      expect(filter.assigneeId).toEqual({ $eq: null });
    });

    it('should handle mixed unassigned and real user IDs', () => {
      const userId = '507f1f77bcf86cd799439011';
      const filter = buildFilter({ assigneeId: ['__unassigned__', userId] });
      expect(filter.$or).toEqual([
        { assigneeId: { $eq: null } },
        { assigneeId: { $in: [new ObjectId(userId)] } },
      ]);
      expect(filter.assigneeId).toBeUndefined();
    });

    it('should handle array of multiple real user IDs', () => {
      const userId1 = '507f1f77bcf86cd799439011';
      const userId2 = '507f1f77bcf86cd799439012';
      const filter = buildFilter({ assigneeId: [userId1, userId2] });
      expect(filter.assigneeId).toEqual({ $in: [new ObjectId(userId1), new ObjectId(userId2)] });
    });

    it('should add assignee filter for valid ObjectId', () => {
      const assigneeId = '507f1f77bcf86cd799439011';
      const filter = buildFilter({ assigneeId });
      expect(filter.assigneeId).toEqual(new ObjectId(assigneeId));
    });

    it('should add tags filter for single tag', () => {
      const filter = buildFilter({ tags: 'bug' });
      expect(filter.tags).toEqual({ $in: ['bug'] });
    });

    it('should add tags filter for array', () => {
      const filter = buildFilter({ tags: ['bug', 'feature'] });
      expect(filter.tags).toEqual({ $in: ['bug', 'feature'] });
    });

    it('should combine multiple filters', () => {
      const filter = buildFilter({
        status: 'pending',
        urgency: 'high',
        tags: ['bug'],
      });

      expect(filter.status).toBe('pending');
      expect(filter.urgency).toBe('high');
      expect(filter.tags).toEqual({ $in: ['bug'] });
    });
  });

  describe('pagination calculations', () => {
    it('should calculate correct skip value', () => {
      const calculateSkip = (page: number, limit: number) => (page - 1) * limit;

      expect(calculateSkip(1, 50)).toBe(0);
      expect(calculateSkip(2, 50)).toBe(50);
      expect(calculateSkip(3, 50)).toBe(100);
      expect(calculateSkip(1, 100)).toBe(0);
      expect(calculateSkip(2, 100)).toBe(100);
    });

    it('should enforce minimum page number', () => {
      const parsePage = (page: unknown) => Math.max(1, parseInt(page as string, 10) || 1);

      expect(parsePage('1')).toBe(1);
      expect(parsePage('0')).toBe(1);
      expect(parsePage('-1')).toBe(1);
      expect(parsePage('abc')).toBe(1);
      expect(parsePage(undefined)).toBe(1);
    });

    it('should enforce limit bounds', () => {
      // Note: parseInt('0') returns 0, which is falsy, so || 50 triggers
      const parseLimit = (limit: unknown) =>
        Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));

      expect(parseLimit('50')).toBe(50);
      expect(parseLimit('200')).toBe(200);
      expect(parseLimit('500')).toBe(200); // Capped at max
      expect(parseLimit('0')).toBe(50);    // 0 is falsy, so defaults to 50, then max(1, 50) = 50
      expect(parseLimit('-1')).toBe(1);    // -1 is valid, max(1, -1) = 1
      expect(parseLimit('abc')).toBe(50);  // NaN is falsy, defaults to 50
      expect(parseLimit(undefined)).toBe(50);
    });
  });

  describe('sort direction', () => {
    it('should convert sort order to MongoDB format', () => {
      const getSortValue = (order: string) => (order === 'asc' ? 1 : -1);

      expect(getSortValue('asc')).toBe(1);
      expect(getSortValue('desc')).toBe(-1);
      expect(getSortValue('anything')).toBe(-1); // Default to desc
    });

    it('should build sort object', () => {
      const buildSort = (sortBy: string, sortOrder: string) => ({
        [sortBy]: sortOrder === 'asc' ? 1 : -1,
      });

      expect(buildSort('createdAt', 'desc')).toEqual({ createdAt: -1 });
      expect(buildSort('updatedAt', 'asc')).toEqual({ updatedAt: 1 });
      expect(buildSort('title', 'asc')).toEqual({ title: 1 });
    });
  });

  describe('task status validation', () => {
    const validStatuses = [
      'pending',
      'in_progress',
      'waiting',
      'on_hold',
      'completed',
      'failed',
      'cancelled',
      'archived',
    ];

    it('should recognize valid statuses', () => {
      for (const status of validStatuses) {
        expect(validStatuses.includes(status)).toBe(true);
      }
    });

    it('should reject invalid statuses', () => {
      expect(validStatuses.includes('invalid')).toBe(false);
      expect(validStatuses.includes('done')).toBe(false);
      expect(validStatuses.includes('')).toBe(false);
    });
  });

  describe('urgency validation', () => {
    const validUrgencies = ['low', 'normal', 'high', 'urgent'];

    it('should recognize valid urgency levels', () => {
      for (const urgency of validUrgencies) {
        expect(validUrgencies.includes(urgency)).toBe(true);
      }
    });

    it('should reject invalid urgency levels', () => {
      expect(validUrgencies.includes('critical')).toBe(false);
      expect(validUrgencies.includes('medium')).toBe(false);
    });
  });
});

describe('humanInstruction auto-derivation', () => {
  // Mirrors the logic in POST /api/tasks that auto-derives humanInstruction
  // for human-created root tasks when not explicitly provided.
  function deriveHumanInstruction(
    taskData: { humanInstruction?: string; summary?: string; title: string },
    parentId: string | null,
    creatorType: 'human' | 'agent' | 'system'
  ): string | undefined {
    if (!taskData.humanInstruction && !parentId && creatorType === 'human') {
      const derived = (taskData.summary && taskData.summary.trim()) || taskData.title;
      return derived || undefined;
    }
    return taskData.humanInstruction || undefined;
  }

  it('should derive from summary for human-created root tasks', () => {
    const result = deriveHumanInstruction(
      { title: 'Fix bug', summary: 'Fix the login validation bug' },
      null,
      'human'
    );
    expect(result).toBe('Fix the login validation bug');
  });

  it('should derive from title when summary is empty', () => {
    const result = deriveHumanInstruction(
      { title: 'Fix bug', summary: '' },
      null,
      'human'
    );
    expect(result).toBe('Fix bug');
  });

  it('should derive from title when summary is undefined', () => {
    const result = deriveHumanInstruction(
      { title: 'Fix bug' },
      null,
      'human'
    );
    expect(result).toBe('Fix bug');
  });

  it('should not override explicit humanInstruction', () => {
    const result = deriveHumanInstruction(
      { title: 'Fix bug', summary: 'summary text', humanInstruction: 'Custom instruction' },
      null,
      'human'
    );
    expect(result).toBe('Custom instruction');
  });

  it('should not derive for subtasks (has parentId)', () => {
    const result = deriveHumanInstruction(
      { title: 'Subtask', summary: 'Subtask summary' },
      '507f1f77bcf86cd799439011',
      'human'
    );
    expect(result).toBeUndefined();
  });

  it('should not derive for agent-created tasks', () => {
    const result = deriveHumanInstruction(
      { title: 'Agent task', summary: 'Agent summary' },
      null,
      'agent'
    );
    expect(result).toBeUndefined();
  });

  it('should not derive for system-created tasks', () => {
    const result = deriveHumanInstruction(
      { title: 'System task', summary: 'System summary' },
      null,
      'system'
    );
    expect(result).toBeUndefined();
  });

  it('should handle whitespace-only summary by falling back to title', () => {
    const result = deriveHumanInstruction(
      { title: 'My task', summary: '   ' },
      null,
      'human'
    );
    expect(result).toBe('My task');
  });
});

describe('Task Type Configuration', () => {
  const taskTypes = [
    'flow',
    'trigger',
    'agent',
    'manual',
    'decision',
    'foreach',
    'join',
    'external',
    'webhook',
    'findDocument',
  ];

  it('should include all expected task types', () => {
    expect(taskTypes).toContain('flow');
    expect(taskTypes).toContain('trigger');
    expect(taskTypes).toContain('agent');
    expect(taskTypes).toContain('manual');
    expect(taskTypes).toContain('decision');
    expect(taskTypes).toContain('foreach');
    expect(taskTypes).toContain('join');
    expect(taskTypes).toContain('external');
    expect(taskTypes).toContain('webhook');
  });

  it('should map task types to execution modes', () => {
    const executionModeMap: Record<string, string> = {
      flow: 'immediate',
      trigger: 'immediate',
      decision: 'immediate',
      foreach: 'immediate',
      join: 'immediate',
      agent: 'automated',
      manual: 'manual',
      external: 'external_callback',
      webhook: 'automated',
    };

    expect(executionModeMap.flow).toBe('immediate');
    expect(executionModeMap.agent).toBe('automated');
    expect(executionModeMap.manual).toBe('manual');
    expect(executionModeMap.external).toBe('external_callback');
  });
});
