/**
 * Migration: Add workflow-prompt document type
 *
 * Adds 'workflow-prompt' to the document type enum in schema validation.
 * This allows users to create reusable prompts that can be selected
 * in workflow agent steps.
 */

import { Db } from 'mongodb';
import { Migration } from './runner.js';

const DOCUMENT_TYPES = ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'];

export const migration: Migration = {
  id: '2026-01-10-001',
  name: 'add-workflow-prompt-type',
  description: 'Add workflow-prompt to document type enum for prompt library feature',
  schemaVersion: 10,

  async up(db: Db): Promise<void> {
    // Update the documents collection validator to include 'workflow-prompt' type
    // Note: This may fail on MongoDB Atlas shared clusters (M0/M2/M5) due to collMod restrictions
    try {
      await db.command({
        collMod: 'documents',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['title', 'content', 'type', 'status', 'version', 'createdAt', 'updatedAt'],
            properties: {
              _id: { bsonType: 'objectId' },

              // Core fields
              title: {
                bsonType: 'string',
                minLength: 1,
                maxLength: 500,
                description: 'Document title - required'
              },
              content: {
                bsonType: 'string',
                description: 'Markdown content - required'
              },
              summary: {
                bsonType: ['string', 'null'],
                maxLength: 2000,
                description: 'AI-generated or manual summary'
              },

              // Classification
              type: {
                bsonType: 'string',
                enum: DOCUMENT_TYPES,
                description: 'Document type - required'
              },
              status: {
                bsonType: 'string',
                enum: ['draft', 'review', 'approved', 'archived'],
                description: 'Document status - required'
              },
              tags: {
                bsonType: ['array', 'null'],
                items: { bsonType: 'string' },
                description: 'Tags for categorization'
              },

              // Ownership
              createdById: {
                bsonType: ['objectId', 'null'],
                description: 'User who created the document'
              },
              lastModifiedById: {
                bsonType: ['objectId', 'null'],
                description: 'User who last modified the document'
              },

              // Semantic search
              embedding: {
                bsonType: ['array', 'null'],
                description: 'Vector embedding for semantic search'
              },
              embeddingModel: {
                bsonType: ['string', 'null'],
                description: 'Model used to generate embedding'
              },
              embeddingUpdatedAt: {
                bsonType: ['date', 'null'],
                description: 'When embedding was last updated'
              },

              // Relationships
              parentDocumentId: {
                bsonType: ['objectId', 'null'],
                description: 'Parent document for hierarchies'
              },
              relatedTaskIds: {
                bsonType: ['array', 'null'],
                items: { bsonType: 'objectId' },
                description: 'Tasks that reference this document'
              },
              workflowRunId: {
                bsonType: ['objectId', 'null'],
                description: 'Workflow run that created this document'
              },

              // Versioning
              version: {
                bsonType: 'int',
                minimum: 1,
                description: 'Document version number - required'
              },

              // Metadata
              metadata: {
                bsonType: ['object', 'null'],
                description: 'Additional metadata'
              },

              // Timestamps
              createdAt: {
                bsonType: 'date',
                description: 'Creation timestamp - required'
              },
              updatedAt: {
                bsonType: 'date',
                description: 'Last update timestamp - required'
              }
            }
          }
        },
        validationLevel: 'moderate',
        validationAction: 'warn'
      });
      console.log('[Migration] Added workflow-prompt to document type enum');
    } catch (error: unknown) {
      // Handle MongoDB Atlas permission restrictions
      const errorMsg = error instanceof Error ? error.message : String(error);
      const mongoError = error as { code?: number; codeName?: string };
      if (mongoError.code === 8000 && mongoError.codeName === 'AtlasError' ||
          errorMsg.includes('not allowed') || errorMsg.includes('Unauthorized')) {
        console.log('[Migration] ⚠ Skipping validator update (insufficient permissions). Application will still work.');
        console.log('[Migration]   To enable database-level validation, grant dbAdmin role to the Atlas user.');
        return; // Don't throw - migration is considered successful
      }
      throw error; // Re-throw other errors
    }
  },

  async down(db: Db): Promise<void> {
    // Revert to original document types (without workflow-prompt)
    const originalTypes = ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom'];

    try {
      await db.command({
        collMod: 'documents',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['title', 'content', 'type', 'status', 'version', 'createdAt', 'updatedAt'],
            properties: {
              _id: { bsonType: 'objectId' },
              title: {
                bsonType: 'string',
                minLength: 1,
                maxLength: 500,
                description: 'Document title - required'
              },
              content: {
                bsonType: 'string',
                description: 'Markdown content - required'
              },
              summary: {
                bsonType: ['string', 'null'],
                maxLength: 2000,
                description: 'AI-generated or manual summary'
              },
              type: {
                bsonType: 'string',
                enum: originalTypes,
                description: 'Document type - required'
              },
              status: {
                bsonType: 'string',
                enum: ['draft', 'review', 'approved', 'archived'],
                description: 'Document status - required'
              },
              tags: {
                bsonType: ['array', 'null'],
                items: { bsonType: 'string' },
                description: 'Tags for categorization'
              },
              createdById: {
                bsonType: ['objectId', 'null'],
                description: 'User who created the document'
              },
              lastModifiedById: {
                bsonType: ['objectId', 'null'],
                description: 'User who last modified the document'
              },
              embedding: {
                bsonType: ['array', 'null'],
                description: 'Vector embedding for semantic search'
              },
              embeddingModel: {
                bsonType: ['string', 'null'],
                description: 'Model used to generate embedding'
              },
              embeddingUpdatedAt: {
                bsonType: ['date', 'null'],
                description: 'When embedding was last updated'
              },
              parentDocumentId: {
                bsonType: ['objectId', 'null'],
                description: 'Parent document for hierarchies'
              },
              relatedTaskIds: {
                bsonType: ['array', 'null'],
                items: { bsonType: 'objectId' },
                description: 'Tasks that reference this document'
              },
              workflowRunId: {
                bsonType: ['objectId', 'null'],
                description: 'Workflow run that created this document'
              },
              version: {
                bsonType: 'int',
                minimum: 1,
                description: 'Document version number - required'
              },
              metadata: {
                bsonType: ['object', 'null'],
                description: 'Additional metadata'
              },
              createdAt: {
                bsonType: 'date',
                description: 'Creation timestamp - required'
              },
              updatedAt: {
                bsonType: 'date',
                description: 'Last update timestamp - required'
              }
            }
          }
        },
        validationLevel: 'moderate',
        validationAction: 'warn'
      });
      console.log('[Migration] Reverted document type enum (removed workflow-prompt)');
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const mongoError = error as { code?: number; codeName?: string };
      if (mongoError.code === 8000 && mongoError.codeName === 'AtlasError' ||
          errorMsg.includes('not allowed') || errorMsg.includes('Unauthorized')) {
        console.log('[Migration] ⚠ Skipping validator rollback (insufficient permissions).');
        return;
      }
      throw error;
    }
  },
};
