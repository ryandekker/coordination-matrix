import { ObjectId, WithId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { Group, GroupMember, GroupRole, GROUP_ROLE_HIERARCHY, Project } from '../types/index.js';

// Slugify a string for use as a group/project name
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateGroupInput {
  name?: string;
  displayName: string;
  description?: string;
  visibility?: 'private' | 'internal';
}

export interface UpdateGroupInput {
  displayName?: string;
  description?: string;
  visibility?: 'private' | 'internal';
}

export interface AddMemberInput {
  userId: string;
  role: GroupRole;
}

class GroupService {
  private get collection() {
    return getDb().collection<Group>('groups');
  }

  /**
   * Create a new group
   */
  async createGroup(
    input: CreateGroupInput,
    creatorId: string | null
  ): Promise<WithId<Group>> {
    const now = new Date();
    const name = input.name || slugify(input.displayName);

    // Check for name uniqueness
    const existing = await this.collection.findOne({ name });
    if (existing) {
      throw new Error(`Group with name '${name}' already exists`);
    }

    const creatorObjId = creatorId ? new ObjectId(creatorId) : null;
    const groupId = new ObjectId();

    const group: Partial<Group> = {
      _id: groupId,
      name,
      displayName: input.displayName,
      visibility: input.visibility || 'private',
      members: creatorObjId
        ? [
            {
              userId: creatorObjId,
              role: 'owner',
              addedAt: now,
              addedById: null,
            },
          ]
        : [],
      createdById: creatorObjId,
      createdAt: now,
      updatedAt: now,
    };
    // Only include description if provided (MongoDB validator rejects null for string field)
    if (input.description) {
      group.description = input.description;
    }

    await this.collection.insertOne(group as Group);

    // Create a default project for the group
    const db = getDb();
    const projectsCollection = db.collection<Project>('projects');
    const defaultProject: Project = {
      _id: new ObjectId(),
      name: 'default',
      displayName: 'Default',
      description: 'Default project for new items',
      groupId: groupId,
      status: 'active',
      color: '#6366F1', // Indigo
      createdById: creatorObjId,
      createdAt: now,
      updatedAt: now,
    };
    await projectsCollection.insertOne(defaultProject);

    return group as unknown as WithId<Group>;
  }

  /**
   * Get a group by ID
   */
  async getGroupById(groupId: string): Promise<WithId<Group> | null> {
    return this.collection.findOne({ _id: new ObjectId(groupId) });
  }

  /**
   * Get a group by name
   */
  async getGroupByName(name: string): Promise<WithId<Group> | null> {
    return this.collection.findOne({ name });
  }

  /**
   * Get all groups a user is a member of
   */
  async getUserGroups(userId: string): Promise<WithId<Group>[]> {
    return this.collection
      .find({ 'members.userId': new ObjectId(userId) })
      .sort({ displayName: 1 })
      .toArray();
  }

  /**
   * Get all groups (for admins or internal visibility)
   */
  async getAllGroups(options?: {
    visibility?: 'private' | 'internal';
    limit?: number;
    offset?: number;
  }): Promise<{ groups: WithId<Group>[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (options?.visibility) {
      filter.visibility = options.visibility;
    }

    const [groups, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ displayName: 1 })
        .skip(options?.offset || 0)
        .limit(options?.limit || 100)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { groups, total };
  }

  /**
   * Update a group
   */
  async updateGroup(
    groupId: string,
    input: UpdateGroupInput
  ): Promise<WithId<Group> | null> {
    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.displayName !== undefined) {
      updateFields.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      updateFields.description = input.description;
    }
    if (input.visibility !== undefined) {
      updateFields.visibility = input.visibility;
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(groupId) },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Delete a group
   */
  async deleteGroup(groupId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: new ObjectId(groupId),
    });
    return result.deletedCount === 1;
  }

  /**
   * Add a member to a group
   */
  async addMember(
    groupId: string,
    input: AddMemberInput,
    addedById: string | null
  ): Promise<WithId<Group> | null> {
    const userObjId = new ObjectId(input.userId);
    const addedByObjId = addedById ? new ObjectId(addedById) : null;

    // Check if user is already a member
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    const existingMember = group.members.find(
      (m) => m.userId.toString() === input.userId
    );
    if (existingMember) {
      throw new Error('User is already a member of this group');
    }

    const member: GroupMember = {
      userId: userObjId,
      role: input.role,
      addedAt: new Date(),
      addedById: addedByObjId,
    };

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(groupId) },
      {
        $push: { members: member },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(
    groupId: string,
    userId: string,
    role: GroupRole
  ): Promise<WithId<Group> | null> {
    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(groupId),
        'members.userId': new ObjectId(userId),
      },
      {
        $set: {
          'members.$.role': role,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Remove a member from a group
   */
  async removeMember(
    groupId: string,
    userId: string
  ): Promise<WithId<Group> | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(groupId) },
      {
        $pull: { members: { userId: new ObjectId(userId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Get a user's membership in a group
   */
  async getMembership(
    groupId: string,
    userId: string
  ): Promise<GroupMember | null> {
    const group = await this.getGroupById(groupId);
    if (!group) {
      console.log(`[getMembership] Group not found: ${groupId}`);
      return null;
    }

    console.log(`[getMembership] Checking user=${userId} in group=${groupId}, members: ${group.members.map(m => m.userId.toString()).join(', ')}`);
    const member = group.members.find((m) => m.userId.toString() === userId) || null;
    console.log(`[getMembership] Result: ${member ? `found with role=${member.role}` : 'not found'}`);
    return member;
  }

  /**
   * Check if a user has at least a certain role in a group
   */
  async hasRole(
    groupId: string,
    userId: string,
    minRole: GroupRole
  ): Promise<boolean> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership) return false;

    return GROUP_ROLE_HIERARCHY[membership.role] >= GROUP_ROLE_HIERARCHY[minRole];
  }

  /**
   * Get all group IDs a user is a member of
   */
  async getUserGroupIds(userId: string): Promise<ObjectId[]> {
    const groups = await this.collection
      .find(
        { 'members.userId': new ObjectId(userId) },
        { projection: { _id: 1 } }
      )
      .toArray();

    return groups.map((g) => g._id);
  }

  /**
   * Check if a user is a member of any of the given groups
   */
  async isMemberOfAny(userId: string, groupIds: string[]): Promise<boolean> {
    if (groupIds.length === 0) return false;

    const count = await this.collection.countDocuments({
      _id: { $in: groupIds.map((id) => new ObjectId(id)) },
      'members.userId': new ObjectId(userId),
    });

    return count > 0;
  }

  /**
   * Get the number of members in a group
   */
  async getMemberCount(groupId: string): Promise<number> {
    const group = await this.getGroupById(groupId);
    return group?.members.length || 0;
  }

  /**
   * Get owners of a group
   */
  async getOwners(groupId: string): Promise<GroupMember[]> {
    const group = await this.getGroupById(groupId);
    if (!group) return [];
    return group.members.filter((m) => m.role === 'owner');
  }
}

export const groupService = new GroupService();
