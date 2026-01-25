#!/usr/bin/env node
/**
 * Migration script to update MongoDB collection validators
 *
 * This updates the JSON Schema validators on existing collections to add
 * new fields like groupId and projectId. This is needed because the validators
 * were set when the database was first created and don't include newer fields.
 *
 * Usage:
 *   node scripts/migrate-schema-validators.mjs
 *   node scripts/migrate-schema-validators.mjs --dry-run    # Preview changes without modifying
 *
 * Environment variables:
 *   MONGODB_URI - MongoDB connection string (default: mongodb://localhost:27017/coordination_matrix)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:adminpassword@localhost:27017/coordination_matrix?authSource=admin';
const DRY_RUN = process.argv.includes('--dry-run');

// Updated documents schema with groupId and projectId
const DOCUMENTS_SCHEMA = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['title', 'content', 'type', 'status', 'version', 'createdAt'],
    properties: {
      title: {
        bsonType: 'string',
        description: 'Document title - required'
      },
      content: {
        bsonType: 'string',
        description: 'Markdown content - required'
      },
      summary: {
        bsonType: 'string',
        description: 'Brief summary of the document (AI-generated or manual)'
      },

      // Group and Project access control
      groupId: {
        bsonType: ['objectId', 'null'],
        description: 'Group this document belongs to (admin-only if null)'
      },
      projectId: {
        bsonType: ['objectId', 'null'],
        description: 'Project within the group (optional)'
      },

      // Classification
      type: {
        bsonType: 'string',
        enum: ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'],
        description: 'Document type - required'
      },
      status: {
        bsonType: 'string',
        enum: ['draft', 'review', 'approved', 'archived'],
        description: 'Document status - required'
      },
      tags: {
        bsonType: 'array',
        items: { bsonType: 'string' },
        description: 'Document tags for categorization'
      },

      // Ownership
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who created this document'
      },
      lastModifiedById: {
        bsonType: ['objectId', 'null'],
        description: 'User who last modified this document'
      },

      // Semantic search - vector embedding
      embedding: {
        bsonType: 'array',
        items: { bsonType: 'double' },
        description: 'Vector embedding for semantic search'
      },
      embeddingModel: {
        bsonType: 'string',
        description: 'Model used to generate embedding (e.g., text-embedding-3-small)'
      },
      embeddingUpdatedAt: {
        bsonType: ['date', 'null'],
        description: 'When the embedding was last updated'
      },

      // Relationships
      parentDocumentId: {
        bsonType: ['objectId', 'null'],
        description: 'Parent document for hierarchical organization'
      },
      relatedTaskIds: {
        bsonType: 'array',
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

      // Flexible metadata
      metadata: {
        bsonType: 'object',
        description: 'Additional metadata for the document'
      },

      // Timestamps
      createdAt: {
        bsonType: 'date',
        description: 'Creation timestamp - required'
      },
      updatedAt: {
        bsonType: 'date',
        description: 'Last update timestamp'
      }
    }
  }
};

// Updated workflows schema with groupId
const WORKFLOWS_SCHEMA = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['name', 'steps', 'isActive', 'createdAt'],
    properties: {
      name: {
        bsonType: 'string',
        description: 'Workflow name - required'
      },
      description: {
        bsonType: 'string',
        description: 'Workflow description'
      },

      // Group access control
      groupId: {
        bsonType: ['objectId', 'null'],
        description: 'Group this workflow belongs to (admin-only if null)'
      },

      steps: {
        bsonType: 'array',
        description: 'Workflow step definitions'
      },
      connections: {
        bsonType: 'array',
        description: 'Connections between steps'
      },
      isActive: {
        bsonType: 'bool',
        description: 'Whether workflow is active'
      },
      version: {
        bsonType: 'int',
        description: 'Workflow version number'
      },
      folderId: {
        bsonType: ['objectId', 'null'],
        description: 'Folder containing this workflow'
      },
      taskDefaults: {
        bsonType: 'object',
        description: 'Default values for tasks created by this workflow'
      },
      createdById: {
        bsonType: ['objectId', 'null'],
        description: 'User who created this workflow'
      },
      createdAt: {
        bsonType: 'date',
        description: 'Creation timestamp'
      },
      updatedAt: {
        bsonType: 'date',
        description: 'Last update timestamp'
      }
    }
  }
};

async function migrate() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Schema Validator Migration                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  console.log('Connecting to MongoDB...');
  console.log(`URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    console.log('Connected successfully!\n');

    const updates = [
      { collection: 'documents', schema: DOCUMENTS_SCHEMA },
      { collection: 'workflows', schema: WORKFLOWS_SCHEMA },
    ];

    for (const { collection, schema } of updates) {
      console.log(`=== Updating ${collection} validator ===`);

      if (!DRY_RUN) {
        await db.command({
          collMod: collection,
          validator: schema,
          validationLevel: 'moderate', // Don't fail on existing invalid docs
          validationAction: 'error'    // But fail on new invalid docs
        });
        console.log(`  ✓ Updated ${collection} validator`);
      } else {
        console.log(`  [DRY RUN] Would update ${collection} validator`);
      }
      console.log('');
    }

    // Summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                     Migration Summary                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`Collections updated: ${updates.map(u => u.collection).join(', ')}`);

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes were made');
      console.log('   Run without --dry-run to apply changes');
    } else {
      console.log('\n✅ Schema validators updated!');
      console.log('');
      console.log('New fields added:');
      console.log('  - documents: groupId, projectId');
      console.log('  - workflows: groupId');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nConnection closed.');
  }
}

// Run migration
migrate();
