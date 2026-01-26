import { ObjectId, WithId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { Project, ProjectStatus } from '../types/index.js';
import { slugify } from './group-service.js';

export interface CreateProjectInput {
  name?: string;
  displayName: string;
  description?: string;
  groupId: string;
  color?: string;
}

export interface UpdateProjectInput {
  displayName?: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
}

class ProjectService {
  private get collection() {
    return getDb().collection<Project>('projects');
  }

  /**
   * Create a new project
   */
  async createProject(
    input: CreateProjectInput,
    creatorId: string | null
  ): Promise<WithId<Project>> {
    const now = new Date();
    const name = input.name || slugify(input.displayName);
    const groupObjId = new ObjectId(input.groupId);

    // Check for name uniqueness within the group
    const existing = await this.collection.findOne({
      groupId: groupObjId,
      name,
    });
    if (existing) {
      throw new Error(`Project with name '${name}' already exists in this group`);
    }

    const project: Project = {
      _id: new ObjectId(),
      name,
      displayName: input.displayName,
      description: input.description,
      groupId: groupObjId,
      status: 'active',
      color: input.color,
      createdById: creatorId ? new ObjectId(creatorId) : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne(project);
    return project as WithId<Project>;
  }

  /**
   * Get a project by ID
   */
  async getProjectById(projectId: string): Promise<WithId<Project> | null> {
    return this.collection.findOne({ _id: new ObjectId(projectId) });
  }

  /**
   * Get a project by name within a group
   */
  async getProjectByName(
    groupId: string,
    name: string
  ): Promise<WithId<Project> | null> {
    return this.collection.findOne({
      groupId: new ObjectId(groupId),
      name,
    });
  }

  /**
   * Get all projects in a group
   */
  async getProjectsByGroup(
    groupId: string,
    options?: {
      status?: ProjectStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ projects: WithId<Project>[]; total: number }> {
    const filter: Record<string, unknown> = {
      groupId: new ObjectId(groupId),
    };
    if (options?.status) {
      filter.status = options.status;
    }

    const [projects, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ displayName: 1 })
        .skip(options?.offset || 0)
        .limit(options?.limit || 100)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { projects, total };
  }

  /**
   * Get all projects across multiple groups
   */
  async getProjectsByGroups(
    groupIds: string[],
    options?: {
      status?: ProjectStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ projects: WithId<Project>[]; total: number }> {
    if (groupIds.length === 0) {
      return { projects: [], total: 0 };
    }

    const filter: Record<string, unknown> = {
      groupId: { $in: groupIds.map((id) => new ObjectId(id)) },
    };
    if (options?.status) {
      filter.status = options.status;
    }

    const [projects, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ displayName: 1 })
        .skip(options?.offset || 0)
        .limit(options?.limit || 100)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { projects, total };
  }

  /**
   * Update a project
   */
  async updateProject(
    projectId: string,
    input: UpdateProjectInput
  ): Promise<WithId<Project> | null> {
    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.displayName !== undefined) {
      updateFields.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      updateFields.description = input.description;
    }
    if (input.status !== undefined) {
      updateFields.status = input.status;
    }
    if (input.color !== undefined) {
      updateFields.color = input.color;
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(projectId) },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Archive a project
   */
  async archiveProject(projectId: string): Promise<WithId<Project> | null> {
    return this.updateProject(projectId, { status: 'archived' });
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: new ObjectId(projectId),
    });
    return result.deletedCount === 1;
  }

  /**
   * Get the count of projects in a group
   */
  async getProjectCount(groupId: string): Promise<number> {
    return this.collection.countDocuments({
      groupId: new ObjectId(groupId),
    });
  }

  /**
   * Check if a project belongs to a specific group
   */
  async projectBelongsToGroup(
    projectId: string,
    groupId: string
  ): Promise<boolean> {
    const count = await this.collection.countDocuments({
      _id: new ObjectId(projectId),
      groupId: new ObjectId(groupId),
    });
    return count === 1;
  }
}

export const projectService = new ProjectService();
