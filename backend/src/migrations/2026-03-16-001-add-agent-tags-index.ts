/**
 * Migration: Add agent tags indexes
 *
 * Adds indexes to support dynamic agent resolution via {{agent.*}} templates.
 * The agent cache queries users by isAgent+isActive+agentComplexity and
 * isAgent+isActive+agentTags — these indexes make those queries efficient.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

export const migration: Migration = {
  id: '2026-03-16-001',
  name: 'add-agent-tags-index',
  description: 'Add indexes for dynamic agent resolution by complexity and tags',

  async up(db: Db): Promise<void> {
    await migrationHelpers.ensureIndex(db, 'users',
      { isAgent: 1, isActive: 1, agentComplexity: 1 },
      { sparse: true, name: 'idx_agent_complexity' }
    );
    await migrationHelpers.ensureIndex(db, 'users',
      { isAgent: 1, isActive: 1, agentTags: 1 },
      { sparse: true, name: 'idx_agent_tags' }
    );
  },

  async down(db: Db): Promise<void> {
    const users = db.collection('users');
    try { await users.dropIndex('idx_agent_complexity'); } catch { /* may not exist */ }
    try { await users.dropIndex('idx_agent_tags'); } catch { /* may not exist */ }
  },
};
