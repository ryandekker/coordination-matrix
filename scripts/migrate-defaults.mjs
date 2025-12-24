#!/usr/bin/env node
/**
 * Migration script to seed default field configs, lookups, and views
 * Safe to run multiple times - only inserts missing records
 *
 * Usage:
 *   node scripts/migrate-defaults.mjs
 *
 * Environment variables:
 *   MONGODB_URI - MongoDB connection string (default: mongodb://localhost:27017/coordination_matrix)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coordination_matrix';

// ============================================================================
// DEFAULT LOOKUPS - Status codes, urgency levels, etc.
// ============================================================================

const DEFAULT_LOOKUPS = [
  // Task statuses
  { type: 'task_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'task_status', code: 'in_progress', displayName: 'In Progress', color: '#3B82F6', icon: 'play', sortOrder: 2, isActive: true },
  { type: 'task_status', code: 'on_hold', displayName: 'On Hold', color: '#F59E0B', icon: 'pause', sortOrder: 3, isActive: true },
  { type: 'task_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 4, isActive: true },
  { type: 'task_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 5, isActive: true },

  // Urgency levels
  { type: 'urgency', code: 'low', displayName: 'Low', color: '#6B7280', icon: 'arrow-down', sortOrder: 1, isActive: true },
  { type: 'urgency', code: 'normal', displayName: 'Normal', color: '#3B82F6', icon: 'minus', sortOrder: 2, isActive: true },
  { type: 'urgency', code: 'high', displayName: 'High', color: '#F97316', icon: 'arrow-up', sortOrder: 3, isActive: true },
  { type: 'urgency', code: 'urgent', displayName: 'Urgent', color: '#EF4444', icon: 'alert-triangle', sortOrder: 4, isActive: true },

  // Batch job statuses
  { type: 'batch_job_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_job_status', code: 'processing', displayName: 'Processing', color: '#3B82F6', icon: 'loader', sortOrder: 2, isActive: true },
  { type: 'batch_job_status', code: 'awaiting_responses', displayName: 'Awaiting Responses', color: '#8B5CF6', icon: 'inbox', sortOrder: 3, isActive: true },
  { type: 'batch_job_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check-circle', sortOrder: 4, isActive: true },
  { type: 'batch_job_status', code: 'completed_with_warnings', displayName: 'Completed with Warnings', color: '#F59E0B', icon: 'alert-triangle', sortOrder: 5, isActive: true },
  { type: 'batch_job_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x-circle', sortOrder: 6, isActive: true },
  { type: 'batch_job_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 7, isActive: true },
  { type: 'batch_job_status', code: 'manual_review', displayName: 'Manual Review', color: '#EC4899', icon: 'user-check', sortOrder: 8, isActive: true },

  // Batch item statuses
  { type: 'batch_item_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_item_status', code: 'received', displayName: 'Received', color: '#3B82F6', icon: 'inbox', sortOrder: 2, isActive: true },
  { type: 'batch_item_status', code: 'processing', displayName: 'Processing', color: '#8B5CF6', icon: 'loader', sortOrder: 3, isActive: true },
  { type: 'batch_item_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 4, isActive: true },
  { type: 'batch_item_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x', sortOrder: 5, isActive: true },
  { type: 'batch_item_status', code: 'skipped', displayName: 'Skipped', color: '#9CA3AF', icon: 'skip-forward', sortOrder: 6, isActive: true },

  // Review decisions
  { type: 'review_decision', code: 'approved', displayName: 'Approved', color: '#10B981', icon: 'check', sortOrder: 1, isActive: true },
  { type: 'review_decision', code: 'rejected', displayName: 'Rejected', color: '#EF4444', icon: 'x', sortOrder: 2, isActive: true },
  { type: 'review_decision', code: 'proceed_with_partial', displayName: 'Proceed with Partial', color: '#F59E0B', icon: 'alert-circle', sortOrder: 3, isActive: true },
];

// ============================================================================
// DEFAULT FIELD CONFIGS - Define how fields are displayed and edited
// ============================================================================

const DEFAULT_FIELD_CONFIGS = [
  // Task collection fields
  {
    collectionName: 'tasks',
    fieldPath: 'title',
    displayName: 'Title',
    fieldType: 'text',
    isRequired: true,
    isEditable: true,
    isSearchable: true,
    isSortable: true,
    isFilterable: true,
    displayOrder: 1,
    width: 600,
    minWidth: 300,
    validation: { minLength: 1, maxLength: 500 },
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'summary',
    displayName: 'Summary',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 2,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'extraPrompt',
    displayName: 'Extra Prompt',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 3,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'status',
    displayName: 'Status',
    fieldType: 'select',
    isRequired: true,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 5,
    width: 140,
    lookupType: 'task_status',
    defaultValue: 'pending',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'urgency',
    displayName: 'Urgency',
    fieldType: 'select',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 6,
    width: 120,
    lookupType: 'urgency',
    defaultValue: 'normal',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'assigneeId',
    displayName: 'Assignee',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 7,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'tags',
    displayName: 'Tags',
    fieldType: 'tags',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 8,
    width: 200,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'dueAt',
    displayName: 'Due',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 9,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdAt',
    displayName: 'Created',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 10,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'updatedAt',
    displayName: 'Updated',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 11,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdById',
    displayName: 'Created By',
    fieldType: 'reference',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 12,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalId',
    displayName: 'External ID',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 13,
    width: 150,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalHoldDate',
    displayName: 'External Hold Date',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 14,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'parentId',
    displayName: 'Parent Task',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: false,
    isFilterable: true,
    displayOrder: 15,
    width: 200,
    referenceCollection: 'tasks',
    referenceDisplayField: 'title',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowId',
    displayName: 'Workflow',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 16,
    width: 180,
    referenceCollection: 'workflows',
    referenceDisplayField: 'name',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowStage',
    displayName: 'Stage',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 17,
    width: 150,
    defaultVisible: true,
  },
];

// ============================================================================
// DEFAULT VIEWS
// ============================================================================

const DEFAULT_VIEWS = [
  {
    name: 'All Tasks',
    collectionName: 'tasks',
    isDefault: true,
    isSystem: true,
    filters: {},
    sorting: [{ field: 'createdAt', direction: 'desc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'workflowId', 'workflowStage', 'tags', 'dueAt', 'createdAt'],
  },
  {
    name: 'My Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { assigneeId: '{{currentUserId}}' },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'dueAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'dueAt', 'tags'],
  },
  {
    name: 'On Hold',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { status: ['on_hold'] },
    sorting: [{ field: 'externalHoldDate', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'externalHoldDate', 'externalId', 'assigneeId'],
  },
  {
    name: 'Urgent Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { urgency: ['high', 'urgent'] },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'dueAt'],
  },
];

// ============================================================================
// MIGRATION LOGIC
// ============================================================================

async function migrate() {
  console.log('Connecting to MongoDB...');
  console.log(`URI: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    console.log('Connected successfully!\n');

    // Migrate lookups
    console.log('=== Migrating Lookups ===');
    const lookupsCollection = db.collection('lookups');
    let lookupsInserted = 0;
    let lookupsSkipped = 0;

    for (const lookup of DEFAULT_LOOKUPS) {
      const existing = await lookupsCollection.findOne({
        type: lookup.type,
        code: lookup.code,
      });

      if (!existing) {
        await lookupsCollection.insertOne(lookup);
        console.log(`  + Added lookup: ${lookup.type}/${lookup.code}`);
        lookupsInserted++;
      } else {
        lookupsSkipped++;
      }
    }
    console.log(`Lookups: ${lookupsInserted} inserted, ${lookupsSkipped} already existed\n`);

    // Migrate field configs
    console.log('=== Migrating Field Configs ===');
    const fieldConfigsCollection = db.collection('field_configs');
    let fieldConfigsInserted = 0;
    let fieldConfigsSkipped = 0;

    for (const config of DEFAULT_FIELD_CONFIGS) {
      const existing = await fieldConfigsCollection.findOne({
        collectionName: config.collectionName,
        fieldPath: config.fieldPath,
      });

      if (!existing) {
        await fieldConfigsCollection.insertOne(config);
        console.log(`  + Added field config: ${config.collectionName}/${config.fieldPath}`);
        fieldConfigsInserted++;
      } else {
        fieldConfigsSkipped++;
      }
    }
    console.log(`Field configs: ${fieldConfigsInserted} inserted, ${fieldConfigsSkipped} already existed\n`);

    // Migrate views
    console.log('=== Migrating Views ===');
    const viewsCollection = db.collection('views');
    let viewsInserted = 0;
    let viewsSkipped = 0;

    for (const view of DEFAULT_VIEWS) {
      const existing = await viewsCollection.findOne({
        name: view.name,
        collectionName: view.collectionName,
        isSystem: true,
      });

      if (!existing) {
        await viewsCollection.insertOne({
          ...view,
          createdAt: new Date(),
        });
        console.log(`  + Added view: ${view.name}`);
        viewsInserted++;
      } else {
        viewsSkipped++;
      }
    }
    console.log(`Views: ${viewsInserted} inserted, ${viewsSkipped} already existed\n`);

    // Summary
    console.log('=== Migration Complete ===');
    console.log(`Total inserted: ${lookupsInserted + fieldConfigsInserted + viewsInserted}`);
    console.log(`Total skipped (already existed): ${lookupsSkipped + fieldConfigsSkipped + viewsSkipped}`);

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
