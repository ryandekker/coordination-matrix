/**
 * Migration: Add text search index to documents collection
 *
 * The GET /api/documents endpoint uses MongoDB $text search when the `search`
 * query parameter is provided, but the required text index was only created
 * in mongo-init (fresh installs). This migration adds it to existing databases.
 */

import { Db } from 'mongodb';
import { Migration, migrationHelpers } from './runner.js';

export const migration: Migration = {
  id: '2026-04-10-001',
  name: 'add-document-text-search-index',
  description: 'Add text index on documents(title, content, summary) for $text search',

  async up(db: Db): Promise<void> {
    await migrationHelpers.ensureIndex(db, 'documents',
      { title: 'text', content: 'text', summary: 'text' },
      { name: 'idx_documents_text_search' }
    );
  },

  async down(db: Db): Promise<void> {
    const documents = db.collection('documents');
    try { await documents.dropIndex('idx_documents_text_search'); } catch { /* may not exist */ }
  },
};
