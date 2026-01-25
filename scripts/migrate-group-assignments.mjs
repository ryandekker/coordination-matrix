#!/usr/bin/env node
/**
 * Migration script to assign groupId to items that don't have one
 * Assigns all items without a groupId to the default group
 *
 * This is needed because:
 * - Tasks, workflows, documents, etc. now require groupId for filtering
 * - Existing items may not have groupId set
 * - Items without groupId won't show up in any group's filtered view
 *
 * Usage:
 *   node scripts/migrate-group-assignments.mjs
 *   node scripts/migrate-group-assignments.mjs --dry-run    # Preview changes without modifying
 *
 * Environment variables:
 *   MONGODB_URI - MongoDB connection string (default: mongodb://localhost:27017/coordination_matrix)
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:adminpassword@localhost:27017/coordination_matrix?authSource=admin';
const DRY_RUN = process.argv.includes('--dry-run');

// Collections that have groupId field
const COLLECTIONS_WITH_GROUP_ID = [
  'tasks',
  'workflows',
  'documents',
];

async function migrate() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Group Assignment Migration                             ║');
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

    // Step 1: Find or create the default group
    console.log('=== Finding Default Group ===');
    const groupsCollection = db.collection('groups');

    let defaultGroup = await groupsCollection.findOne({ name: 'default' });

    if (!defaultGroup) {
      console.log('No default group found. Looking for any group to use as default...');

      // Try to find any group
      defaultGroup = await groupsCollection.findOne({});

      if (!defaultGroup) {
        // Create a default group if none exists
        console.log('No groups found. Creating a default group...');

        if (!DRY_RUN) {
          const result = await groupsCollection.insertOne({
            name: 'default',
            displayName: 'Default',
            description: 'Default group for all users',
            settings: {
              allowPublicViews: false,
              allowGuestAccess: false,
            },
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          defaultGroup = await groupsCollection.findOne({ _id: result.insertedId });
          console.log(`  + Created default group: ${defaultGroup._id}`);
        } else {
          console.log('  [DRY RUN] Would create default group');
          defaultGroup = { _id: new ObjectId(), name: 'default', displayName: 'Default' };
        }
      }
    }

    console.log(`Using group: "${defaultGroup.displayName || defaultGroup.name}" (${defaultGroup._id})\n`);
    const defaultGroupId = defaultGroup._id;

    // Step 2: Update each collection
    const results = {};

    for (const collectionName of COLLECTIONS_WITH_GROUP_ID) {
      console.log(`=== Migrating ${collectionName} ===`);
      const collection = db.collection(collectionName);

      // Count items without groupId
      const countWithout = await collection.countDocuments({
        $or: [
          { groupId: { $exists: false } },
          { groupId: null },
        ],
      });

      // Count items with groupId already set
      const countWith = await collection.countDocuments({
        groupId: { $exists: true, $ne: null },
      });

      console.log(`  Items without groupId: ${countWithout}`);
      console.log(`  Items with groupId: ${countWith}`);

      if (countWithout > 0) {
        if (!DRY_RUN) {
          const updateResult = await collection.updateMany(
            {
              $or: [
                { groupId: { $exists: false } },
                { groupId: null },
              ],
            },
            {
              $set: {
                groupId: defaultGroupId,
                updatedAt: new Date(),
              },
            }
          );
          console.log(`  ✓ Updated ${updateResult.modifiedCount} ${collectionName}`);
          results[collectionName] = { updated: updateResult.modifiedCount, skipped: countWith };
        } else {
          console.log(`  [DRY RUN] Would update ${countWithout} ${collectionName}`);
          results[collectionName] = { wouldUpdate: countWithout, alreadySet: countWith };
        }
      } else {
        console.log(`  ✓ All ${collectionName} already have groupId set`);
        results[collectionName] = { updated: 0, skipped: countWith };
      }
      console.log('');
    }

    // Step 3: Ensure all users are members of the default group
    console.log('=== Ensuring User Group Memberships ===');
    const usersCollection = db.collection('users');
    const groupMembersCollection = db.collection('group_members');

    // Get all active users
    const users = await usersCollection.find({ isActive: true }).toArray();
    console.log(`  Found ${users.length} active users`);

    let membershipsCreated = 0;
    let membershipsSkipped = 0;

    for (const user of users) {
      // Check if user already has a membership in default group
      const existingMembership = await groupMembersCollection.findOne({
        groupId: defaultGroupId,
        userId: user._id,
      });

      if (!existingMembership) {
        if (!DRY_RUN) {
          await groupMembersCollection.insertOne({
            groupId: defaultGroupId,
            userId: user._id,
            role: 'member',
            isPrimary: true, // Set as primary group
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          membershipsCreated++;
          console.log(`  + Added ${user.displayName || user.email} to default group`);
        } else {
          membershipsCreated++;
          console.log(`  [DRY RUN] Would add ${user.displayName || user.email} to default group`);
        }
      } else {
        membershipsSkipped++;
      }
    }

    console.log(`  Memberships: ${membershipsCreated} created, ${membershipsSkipped} already existed\n`);

    // Summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                     Migration Summary                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`Default Group: ${defaultGroup.displayName || defaultGroup.name} (${defaultGroupId})`);
    console.log('');
    console.log('Collections updated:');
    for (const [collection, stats] of Object.entries(results)) {
      if (DRY_RUN) {
        console.log(`  ${collection}: ${stats.wouldUpdate || 0} would be updated, ${stats.alreadySet || 0} already set`);
      } else {
        console.log(`  ${collection}: ${stats.updated || 0} updated, ${stats.skipped || 0} already had groupId`);
      }
    }
    console.log(`\nUser memberships: ${membershipsCreated} ${DRY_RUN ? 'would be ' : ''}created`);

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - No changes were made');
      console.log('   Run without --dry-run to apply changes');
    } else {
      console.log('\n✅ Migration complete!');
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
