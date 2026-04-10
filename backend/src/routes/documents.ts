import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { loadUserGroups, resolveRequiredGroupId } from '../middleware/group-access.js';
import { isAdmin } from '../middleware/authorize.js';
import { groupService } from '../services/group-service.js';
import {
  Document,
  DocumentVersion,
  DocumentType,
  DocumentStatus,
  DocumentWithResolved,
  PaginatedResponse,
  DocumentEventType,
  FieldChange,
} from '../types/index.js';
import {
  searchDocuments,
  updateDocumentEmbedding,
  updateMissingEmbeddings,
} from '../services/embedding-service.js';

// Helper to log document activities
async function logDocumentActivity(
  documentId: ObjectId,
  eventType: DocumentEventType,
  actorId: ObjectId | null,
  actorType: 'user' | 'system' | 'daemon' = 'user',
  changes?: FieldChange[],
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const db = getDb();
    const entry: Record<string, unknown> = {
      documentId,
      eventType,
      actorId,
      actorType,
      timestamp: new Date(),
    };
    if (changes && changes.length > 0) {
      entry.changes = changes;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }
    await db.collection('activity_logs').insertOne(entry);
  } catch (error) {
    console.error('Failed to log document activity:', error);
  }
}

export const documentsRouter = Router();

// Valid document types and statuses
const VALID_TYPES: DocumentType[] = ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt', 'capability'];
const VALID_STATUSES: DocumentStatus[] = ['draft', 'review', 'approved', 'archived'];

// Helper to resolve references
async function resolveDocumentReferences(doc: Document): Promise<DocumentWithResolved> {
  const db = getDb();
  const resolved: DocumentWithResolved['_resolved'] = {};

  if (doc.createdById) {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(doc.createdById) },
      { projection: { displayName: 1 } }
    );
    if (user) {
      resolved.createdBy = { _id: doc.createdById.toString(), displayName: user.displayName };
    }
  }

  if (doc.lastModifiedById) {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(doc.lastModifiedById) },
      { projection: { displayName: 1 } }
    );
    if (user) {
      resolved.lastModifiedBy = { _id: doc.lastModifiedById.toString(), displayName: user.displayName };
    }
  }

  if (doc.parentDocumentId) {
    const parent = await db.collection<Document>('documents').findOne(
      { _id: new ObjectId(doc.parentDocumentId) },
      { projection: { title: 1 } }
    );
    if (parent) {
      resolved.parentDocument = { _id: doc.parentDocumentId.toString(), title: parent.title };
    }
  }

  return { ...doc, _resolved: Object.keys(resolved).length > 0 ? resolved : undefined };
}

// Build filter from query params
function buildFilter(query: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const { search, type, status, tags, includeArchived, createdById, workflowRunId, parentDocumentId, groupId, projectId, relatedTaskId, filters } = query;

  // Group filter
  if (groupId && typeof groupId === 'string' && ObjectId.isValid(groupId)) {
    filter.groupId = new ObjectId(groupId);
  }

  // Project filter
  if (projectId && typeof projectId === 'string' && ObjectId.isValid(projectId)) {
    filter.projectId = new ObjectId(projectId);
  }

  // Text search
  if (search && typeof search === 'string') {
    filter.$text = { $search: search };
  }

  // Type filter (can be single or array)
  if (type) {
    if (Array.isArray(type)) {
      filter.type = { $in: type.filter((t: string) => VALID_TYPES.includes(t as DocumentType)) };
    } else if (VALID_TYPES.includes(type as DocumentType)) {
      filter.type = type;
    }
  }

  // Status filter (can be single or array)
  if (status) {
    if (Array.isArray(status)) {
      filter.status = { $in: status.filter((s: string) => VALID_STATUSES.includes(s as DocumentStatus)) };
    } else if (VALID_STATUSES.includes(status as DocumentStatus)) {
      filter.status = status;
    }
  } else if (includeArchived !== 'true') {
    // Default: exclude archived
    filter.status = { $ne: 'archived' };
  }

  // Tags filter
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    filter.tags = { $all: tagArray };
  }

  // Owner filter
  if (createdById && typeof createdById === 'string' && ObjectId.isValid(createdById)) {
    filter.createdById = new ObjectId(createdById);
  }

  // Workflow run filter
  if (workflowRunId && typeof workflowRunId === 'string' && ObjectId.isValid(workflowRunId)) {
    filter.workflowRunId = new ObjectId(workflowRunId);
  }

  // Related task filter (documents linked to a specific task)
  if (relatedTaskId && typeof relatedTaskId === 'string' && ObjectId.isValid(relatedTaskId)) {
    filter.relatedTaskIds = new ObjectId(relatedTaskId);
  }

  // Parent document filter
  if (parentDocumentId === 'null' || parentDocumentId === '__root__') {
    filter.parentDocumentId = null;
  } else if (parentDocumentId && typeof parentDocumentId === 'string' && ObjectId.isValid(parentDocumentId)) {
    filter.parentDocumentId = new ObjectId(parentDocumentId);
  }

  // Generic filters object
  if (filters && typeof filters === 'object') {
    const filtersObj = typeof filters === 'string' ? JSON.parse(filters) : filters;
    for (const [key, value] of Object.entries(filtersObj as Record<string, unknown>)) {
      // Skip already handled filters
      if (['search', 'type', 'status', 'tags', 'includeArchived', 'createdById', 'workflowRunId', 'parentDocumentId'].includes(key)) {
        continue;
      }
      // Handle ObjectId fields
      if (key.endsWith('Id') && typeof value === 'string' && ObjectId.isValid(value)) {
        filter[key] = new ObjectId(value);
      } else {
        filter[key] = value;
      }
    }
  }

  return filter;
}

// GET /api/documents - List documents with filtering and pagination
documentsRouter.get('/', loadUserGroups(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      page = '1',
      limit = '50',
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      resolveReferences,
      groupId,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;
    const sort: Record<string, 1 | -1> = { [sortBy as string]: sortOrder === 'asc' ? 1 : -1 };

    // Validate group access if groupId is provided
    if (groupId && typeof groupId === 'string') {
      if (!ObjectId.isValid(groupId)) {
        res.status(400).json({ error: 'Invalid groupId' });
        return;
      }

      if (!isAdmin(req)) {
        const membership = await groupService.getMembership(groupId, req.user!.userId);
        if (!membership) {
          res.status(403).json({ error: 'Not a member of this group' });
          return;
        }
      }
    }

    const filter = buildFilter(req.query);

    // Get total count and documents
    const [total, documents] = await Promise.all([
      db.collection<Document>('documents').countDocuments(filter),
      db.collection<Document>('documents')
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .toArray(),
    ]);

    // Resolve references if requested
    let data: (Document | DocumentWithResolved)[] = documents;
    if (resolveReferences === 'true') {
      data = await Promise.all(documents.map(resolveDocumentReferences));
    }

    const response: PaginatedResponse<Document | DocumentWithResolved> = {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/:id - Get a single document
documentsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { resolveReferences } = req.query;

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const document = await db.collection<Document>('documents').findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!document) {
      throw createError('Document not found', 404);
    }

    let data: Document | DocumentWithResolved = document;
    if (resolveReferences === 'true') {
      data = await resolveDocumentReferences(document);
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents - Create a new document
documentsRouter.post('/', loadUserGroups(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const {
      title,
      content,
      summary,
      type = 'custom',
      status = 'draft',
      tags,
      parentDocumentId,
      workflowRunId,
      metadata,
      projectId,
    } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string') {
      throw createError('title is required', 400);
    }
    if (content === undefined || typeof content !== 'string') {
      throw createError('content is required', 400);
    }

    // Validate type and status
    if (!VALID_TYPES.includes(type)) {
      throw createError(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
    }
    if (!VALID_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
    }

    const now = new Date();
    const userId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;

    // Resolve groupId — required for all document creation
    const resolvedGroupId = await resolveRequiredGroupId(req);

    // Build the document object, only including fields that have values
    // This prevents undefined values from being sent to MongoDB which would fail validation
    const newDocument: Omit<Document, '_id'> = {
      title: title.trim(),
      content,
      type,
      status,
      tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [],
      groupId: resolvedGroupId,
      projectId: projectId && ObjectId.isValid(projectId) ? new ObjectId(projectId) : null,
      createdById: userId,
      lastModifiedById: userId,
      parentDocumentId: parentDocumentId && ObjectId.isValid(parentDocumentId)
        ? new ObjectId(parentDocumentId)
        : null,
      workflowRunId: workflowRunId && ObjectId.isValid(workflowRunId)
        ? new ObjectId(workflowRunId)
        : null,
      version: 1,
      metadata: metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    // Only add optional string fields if they have values
    if (summary?.trim()) {
      newDocument.summary = summary.trim();
    }

    const result = await db.collection<Document>('documents').insertOne(newDocument as Document);
    const inserted = await db.collection<Document>('documents').findOne({ _id: result.insertedId });

    // Create initial version record
    if (inserted && userId) {
      const versionRecord: Partial<DocumentVersion> = {
        documentId: result.insertedId,
        version: 1,
        title: inserted.title,
        content: inserted.content,
        changeDescription: 'Initial version',
        modifiedById: userId,
        modifiedAt: now,
      };
      // Only include summary if it exists (schema requires string, not undefined)
      if (inserted.summary) {
        versionRecord.summary = inserted.summary;
      }
      await db.collection<DocumentVersion>('document_versions').insertOne(versionRecord as DocumentVersion);
    }

    // Generate embedding asynchronously (don't block response)
    updateDocumentEmbedding(result.insertedId).catch((err) => {
      console.error('Failed to generate embedding for new document:', err);
    });

    // Log activity
    logDocumentActivity(result.insertedId, 'document.created', userId, 'user', undefined, {
      title: inserted?.title,
      type: inserted?.type,
    });

    res.status(201).json({ data: inserted });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/documents/:id - Update a document
documentsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);

    // Get existing document
    const existing = await db.collection<Document>('documents').findOne({ _id: documentId });
    if (!existing) {
      throw createError('Document not found', 404);
    }

    const updates: Partial<Document> = {};
    const {
      title,
      content,
      summary,
      type,
      status,
      tags,
      parentDocumentId,
      metadata,
      changeDescription,
      groupId,
      projectId,
    } = req.body;

    // Track if content changed (for versioning)
    let contentChanged = false;

    if (title !== undefined) {
      updates.title = title.trim();
      if (updates.title !== existing.title) contentChanged = true;
    }
    if (content !== undefined) {
      updates.content = content;
      if (updates.content !== existing.content) contentChanged = true;
    }
    if (summary !== undefined) {
      // Only set summary if it has a value; use $unset for empty values
      const trimmedSummary = summary?.trim();
      if (trimmedSummary) {
        updates.summary = trimmedSummary;
      }
      // Note: to clear summary, we'd need $unset but that's a separate operation
    }
    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) {
        throw createError(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
      }
      updates.type = type;
    }
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        throw createError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
      }
      updates.status = status;
    }
    if (tags !== undefined) {
      updates.tags = Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [];
    }
    if (parentDocumentId !== undefined) {
      updates.parentDocumentId = parentDocumentId && ObjectId.isValid(parentDocumentId)
        ? new ObjectId(parentDocumentId)
        : null;
    }
    if (metadata !== undefined) {
      // Merge metadata rather than replace
      updates.metadata = { ...existing.metadata, ...metadata };
    }

    // Handle group change (requires admin or membership in both groups)
    if (groupId !== undefined && groupId !== existing.groupId?.toString()) {
      if (!ObjectId.isValid(groupId)) {
        throw createError('Invalid groupId', 400);
      }
      // Verify user has access to the target group (admin or member)
      if (!isAdmin(req)) {
        const targetMembership = await groupService.getMembership(groupId, req.user!.userId);
        if (!targetMembership) {
          throw createError('You do not have access to the target group', 403);
        }
      }
      updates.groupId = new ObjectId(groupId);
      // Clear projectId if moving to different group (projects are group-specific)
      if (projectId === undefined) {
        updates.projectId = null;
      }
    }

    // Handle project change
    if (projectId !== undefined) {
      if (projectId === null || projectId === '') {
        updates.projectId = null;
      } else if (ObjectId.isValid(projectId)) {
        updates.projectId = new ObjectId(projectId);
      }
    }

    // Add update metadata
    const now = new Date();
    updates.updatedAt = now;
    updates.lastModifiedById = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : existing.lastModifiedById;

    // If content changed, increment version and create version record
    let unsetFields: Record<string, 1> = {};
    if (contentChanged) {
      updates.version = existing.version + 1;

      // Clear embedding (will need to be regenerated) - use $unset instead of undefined
      unsetFields = { embedding: 1, embeddingUpdatedAt: 1 };
    }

    const updateOperation: { $set: Partial<Document>; $unset?: Record<string, 1> } = { $set: updates };
    if (Object.keys(unsetFields).length > 0) {
      updateOperation.$unset = unsetFields;
    }

    const result = await db.collection<Document>('documents').findOneAndUpdate(
      { _id: documentId },
      updateOperation,
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Document not found', 404);
    }

    // Create version record if content changed
    if (contentChanged && updates.lastModifiedById) {
      const versionRecord: Partial<DocumentVersion> = {
        documentId,
        version: result.version,
        title: result.title,
        content: result.content,
        changeDescription: changeDescription || `Updated to version ${result.version}`,
        modifiedById: updates.lastModifiedById,
        modifiedAt: now,
      };
      // Only include summary if it exists (schema requires string, not undefined)
      if (result.summary) {
        versionRecord.summary = result.summary;
      }
      await db.collection<DocumentVersion>('document_versions').insertOne(versionRecord as DocumentVersion);

      // Regenerate embedding asynchronously
      updateDocumentEmbedding(documentId).catch((err) => {
        console.error('Failed to regenerate embedding:', err);
      });

      // Log version creation
      logDocumentActivity(documentId, 'document.version.created', updates.lastModifiedById, 'user', undefined, {
        version: result.version,
        changeDescription,
      });
    }

    // Log update activity
    const changes: FieldChange[] = [];
    if (updates.title !== undefined && updates.title !== existing.title) {
      changes.push({ field: 'title', oldValue: existing.title, newValue: updates.title });
    }
    if (updates.status !== undefined && updates.status !== existing.status) {
      changes.push({ field: 'status', oldValue: existing.status, newValue: updates.status });
    }
    if (updates.type !== undefined && updates.type !== existing.type) {
      changes.push({ field: 'type', oldValue: existing.type, newValue: updates.type });
    }

    const eventType = updates.status !== existing.status ? 'document.status.changed' : 'document.updated';
    logDocumentActivity(
      documentId,
      eventType,
      updates.lastModifiedById || null,
      'user',
      changes.length > 0 ? changes : undefined
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/bulk-move - Move multiple documents to a different group
documentsRouter.post('/bulk-move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { documentIds, targetGroupId, targetProjectId } = req.body;

    // Validate inputs
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw createError('documentIds must be a non-empty array', 400);
    }

    if (!targetGroupId || !ObjectId.isValid(targetGroupId)) {
      throw createError('Valid targetGroupId is required', 400);
    }

    // Verify all document IDs are valid
    const validDocIds = documentIds.filter((id: string) => ObjectId.isValid(id));
    if (validDocIds.length !== documentIds.length) {
      throw createError('Some document IDs are invalid', 400);
    }

    // Verify user has access to the target group (admin or member)
    if (!isAdmin(req)) {
      const targetMembership = await groupService.getMembership(targetGroupId, req.user!.userId);
      if (!targetMembership) {
        throw createError('You do not have access to the target group', 403);
      }
    }

    // Validate target project if provided
    let resolvedProjectId: ObjectId | null = null;
    if (targetProjectId) {
      if (!ObjectId.isValid(targetProjectId)) {
        throw createError('Invalid targetProjectId', 400);
      }
      // Verify project belongs to target group
      const project = await db.collection('projects').findOne({
        _id: new ObjectId(targetProjectId),
        groupId: new ObjectId(targetGroupId)
      });
      if (!project) {
        throw createError('Target project not found in the specified group', 404);
      }
      resolvedProjectId = new ObjectId(targetProjectId);
    }

    const objectIds = validDocIds.map((id: string) => new ObjectId(id));
    const now = new Date();
    const actorId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;

    // Update all documents
    const result = await db.collection<Document>('documents').updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          groupId: new ObjectId(targetGroupId),
          projectId: resolvedProjectId,
          updatedAt: now,
          lastModifiedById: actorId,
        }
      }
    );

    // Log activity for each document
    for (const docId of objectIds) {
      logDocumentActivity(docId, 'document.updated', actorId, 'user', [
        { field: 'groupId', oldValue: null, newValue: targetGroupId }
      ], { bulkMove: true });
    }

    res.json({
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        targetGroupId,
        targetProjectId: resolvedProjectId?.toString() || null,
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/bulk-archive - Archive multiple documents
documentsRouter.post('/bulk-archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { documentIds } = req.body;

    // Validate inputs
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw createError('documentIds must be a non-empty array', 400);
    }

    // Verify all document IDs are valid
    const validDocIds = documentIds.filter((id: string) => ObjectId.isValid(id));
    if (validDocIds.length !== documentIds.length) {
      throw createError('Some document IDs are invalid', 400);
    }

    const objectIds = validDocIds.map((id: string) => new ObjectId(id));
    const now = new Date();
    const actorId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;

    // Update all documents to archived status
    const result = await db.collection<Document>('documents').updateMany(
      { _id: { $in: objectIds }, status: { $ne: 'archived' } },
      {
        $set: {
          status: 'archived' as DocumentStatus,
          updatedAt: now,
          lastModifiedById: actorId,
        }
      }
    );

    // Log activity for each document
    for (const docId of objectIds) {
      logDocumentActivity(docId, 'document.updated', actorId, 'user', [
        { field: 'status', oldValue: null, newValue: 'archived' }
      ], { bulkArchive: true });
    }

    res.json({
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
      }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/documents/:id - Soft delete (archive) or hard delete a document
documentsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { permanent } = req.query;

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);

    const userId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;

    if (permanent === 'true') {
      // Hard delete - remove document and all versions
      const doc = await db.collection<Document>('documents').findOneAndDelete({ _id: documentId });
      if (!doc) {
        throw createError('Document not found', 404);
      }

      // Delete all versions
      await db.collection<DocumentVersion>('document_versions').deleteMany({ documentId });

      // Log deletion
      logDocumentActivity(documentId, 'document.deleted', userId, 'user', undefined, {
        title: doc.title,
        permanent: true,
      });

      res.json({ success: true, message: 'Document permanently deleted' });
    } else {
      // Soft delete - archive the document
      const existing = await db.collection<Document>('documents').findOne({ _id: documentId });
      const result = await db.collection<Document>('documents').findOneAndUpdate(
        { _id: documentId },
        {
          $set: {
            status: 'archived',
            updatedAt: new Date(),
            lastModifiedById: userId,
          },
        },
        { returnDocument: 'after' }
      );

      if (!result) {
        throw createError('Document not found', 404);
      }

      // Log archive
      logDocumentActivity(documentId, 'document.status.changed', userId, 'user', [
        { field: 'status', oldValue: existing?.status, newValue: 'archived' },
      ]);

      res.json({ success: true, message: 'Document archived' });
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/:id/versions - Get version history for a document
documentsRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);

    // Verify document exists
    const document = await db.collection<Document>('documents').findOne({ _id: documentId });
    if (!document) {
      throw createError('Document not found', 404);
    }

    const versions = await db.collection<DocumentVersion>('document_versions')
      .find({ documentId })
      .sort({ version: -1 })
      .toArray();

    // Resolve modifier names
    const userIds = [...new Set(versions.map(v => v.modifiedById.toString()))];
    const users = await db.collection('users')
      .find({ _id: { $in: userIds.map(id => new ObjectId(id)) } })
      .project({ displayName: 1 })
      .toArray();

    const userMap = new Map(users.map(u => [u._id.toString(), u.displayName]));

    const versionsWithUsers = versions.map(v => ({
      ...v,
      modifiedByName: userMap.get(v.modifiedById.toString()) || 'Unknown',
    }));

    res.json({ data: versionsWithUsers });
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/:id/versions/:version - Get a specific version
documentsRouter.get('/:id/versions/:version', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);
    const versionNum = parseInt(req.params.version, 10);

    if (isNaN(versionNum) || versionNum < 1) {
      throw createError('Invalid version number', 400);
    }

    const version = await db.collection<DocumentVersion>('document_versions').findOne({
      documentId,
      version: versionNum,
    });

    if (!version) {
      throw createError('Version not found', 404);
    }

    // Get modifier name
    const user = await db.collection('users').findOne(
      { _id: version.modifiedById },
      { projection: { displayName: 1 } }
    );

    res.json({
      data: {
        ...version,
        modifiedByName: user?.displayName || 'Unknown',
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/:id/restore/:version - Restore a document to a specific version
documentsRouter.post('/:id/restore/:version', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);
    const versionNum = parseInt(req.params.version, 10);

    if (isNaN(versionNum) || versionNum < 1) {
      throw createError('Invalid version number', 400);
    }

    // Get the version to restore
    const versionToRestore = await db.collection<DocumentVersion>('document_versions').findOne({
      documentId,
      version: versionNum,
    });

    if (!versionToRestore) {
      throw createError('Version not found', 404);
    }

    // Get current document
    const currentDoc = await db.collection<Document>('documents').findOne({ _id: documentId });
    if (!currentDoc) {
      throw createError('Document not found', 404);
    }

    const now = new Date();
    const userId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;
    const newVersion = currentDoc.version + 1;

    // Update document with restored content
    const result = await db.collection<Document>('documents').findOneAndUpdate(
      { _id: documentId },
      {
        $set: {
          title: versionToRestore.title,
          content: versionToRestore.content,
          summary: versionToRestore.summary,
          version: newVersion,
          updatedAt: now,
          lastModifiedById: userId,
          // Clear embedding
          embedding: undefined,
          embeddingUpdatedAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Failed to restore document', 500);
    }

    // Create version record for the restore
    if (userId) {
      await db.collection<DocumentVersion>('document_versions').insertOne({
        documentId,
        version: newVersion,
        title: result.title,
        content: result.content,
        summary: result.summary,
        changeDescription: `Restored to version ${versionNum}`,
        modifiedById: userId,
        modifiedAt: now,
      } as DocumentVersion);
    }

    // Log restore activity
    logDocumentActivity(documentId, 'document.restored', userId, 'user', undefined, {
      restoredFromVersion: versionNum,
      newVersion,
    });

    res.json({ data: result, message: `Document restored to version ${versionNum}` });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/:id/diff - Compare two versions
documentsRouter.post('/:id/diff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);
    const { fromVersion, toVersion } = req.body;

    if (!fromVersion || !toVersion) {
      throw createError('fromVersion and toVersion are required', 400);
    }

    const fromVersionNum = parseInt(fromVersion, 10);
    const toVersionNum = parseInt(toVersion, 10);

    if (isNaN(fromVersionNum) || isNaN(toVersionNum)) {
      throw createError('Invalid version numbers', 400);
    }

    // Get both versions
    const [fromDoc, toDoc] = await Promise.all([
      db.collection<DocumentVersion>('document_versions').findOne({
        documentId,
        version: fromVersionNum,
      }),
      db.collection<DocumentVersion>('document_versions').findOne({
        documentId,
        version: toVersionNum,
      }),
    ]);

    if (!fromDoc) {
      throw createError(`Version ${fromVersionNum} not found`, 404);
    }
    if (!toDoc) {
      throw createError(`Version ${toVersionNum} not found`, 404);
    }

    // Return both versions for client-side diff rendering
    // (Could implement server-side diff using 'diff' package if needed)
    res.json({
      data: {
        from: {
          version: fromDoc.version,
          title: fromDoc.title,
          content: fromDoc.content,
          summary: fromDoc.summary,
          modifiedAt: fromDoc.modifiedAt,
        },
        to: {
          version: toDoc.version,
          title: toDoc.title,
          content: toDoc.content,
          summary: toDoc.summary,
          modifiedAt: toDoc.modifiedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/:id/link-task - Link a task to this document
documentsRouter.post('/:id/link-task', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);
    const { taskId } = req.body;

    if (!taskId || !ObjectId.isValid(taskId)) {
      throw createError('Valid taskId is required', 400);
    }

    const taskObjectId = new ObjectId(taskId);

    // Verify both exist
    const [document, task] = await Promise.all([
      db.collection<Document>('documents').findOne({ _id: documentId }),
      db.collection('tasks').findOne({ _id: taskObjectId }),
    ]);

    if (!document) {
      throw createError('Document not found', 404);
    }
    if (!task) {
      throw createError('Task not found', 404);
    }

    // Add task to document's relatedTaskIds (if not already present)
    await db.collection<Document>('documents').updateOne(
      { _id: documentId },
      {
        $addToSet: { relatedTaskIds: taskObjectId },
        $set: { updatedAt: new Date() },
      }
    );

    // Log link activity
    const userId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;
    logDocumentActivity(documentId, 'document.linked', userId, 'user', undefined, {
      taskId: taskId,
      taskTitle: task.title,
    });

    res.json({ success: true, message: 'Task linked to document' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/documents/:id/link-task/:taskId - Unlink a task from this document
documentsRouter.delete('/:id/link-task/:taskId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }
    if (!ObjectId.isValid(req.params.taskId)) {
      throw createError('Invalid task ID', 400);
    }

    const documentId = new ObjectId(req.params.id);
    const taskId = new ObjectId(req.params.taskId);

    const result = await db.collection<Document>('documents').updateOne(
      { _id: documentId },
      {
        $pull: { relatedTaskIds: taskId },
        $set: { updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      throw createError('Document not found', 404);
    }

    // Log unlink activity
    const userId = req.user?.userId && ObjectId.isValid(req.user.userId) ? new ObjectId(req.user.userId) : null;
    logDocumentActivity(documentId, 'document.unlinked', userId, 'user', undefined, {
      taskId: req.params.taskId,
    });

    res.json({ success: true, message: 'Task unlinked from document' });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/search - Semantic search for documents
documentsRouter.post('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, type, status, tags, limit, minScore } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      throw createError('prompt is required', 400);
    }

    const results = await searchDocuments({
      prompt,
      type: type && Array.isArray(type) ? type : type ? [type] : undefined,
      status: status && Array.isArray(status) ? status : status ? [status] : undefined,
      tags: tags && Array.isArray(tags) ? tags : tags ? [tags] : undefined,
      limit: limit ? parseInt(limit, 10) : 10,
      minScore: minScore ? parseFloat(minScore) : 0.5,
    });

    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/:id/generate-embedding - Generate embedding for a document
documentsRouter.post('/:id/generate-embedding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const success = await updateDocumentEmbedding(req.params.id);

    if (!success) {
      throw createError('Failed to generate embedding. Ensure OPENAI_API_KEY is configured.', 500);
    }

    res.json({ success: true, message: 'Embedding generated successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/batch-embeddings - Generate embeddings for documents without them
documentsRouter.post('/batch-embeddings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchSize = 10 } = req.body;

    const updated = await updateMissingEmbeddings(batchSize);

    res.json({
      success: true,
      message: `Generated embeddings for ${updated} documents`,
      updatedCount: updated,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Capability Document Endpoints
// ============================================================================

// GET /api/documents/capabilities - List available capabilities for an agent complexity level
// Query params: ?complexity=1|2|3 (defaults to 1)
documentsRouter.get('/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const complexity = Math.min(3, Math.max(1, parseInt(req.query.complexity as string) || 1)) as 1 | 2 | 3;

    // Find all capability documents that this complexity level can access
    const capabilities = await db.collection<Document>('documents')
      .find({
        type: 'capability',
        status: 'approved',
        capabilityComplexity: { $lte: complexity },
      })
      .project({
        _id: 1,
        title: 1,
        summary: 1,
        capabilityId: 1,
        capabilityComplexity: 1,
        tags: 1,
      })
      .sort({ capabilityComplexity: 1, title: 1 })
      .toArray();

    // Return a manifest format for easy agent consumption
    res.json({
      agentComplexity: complexity,
      capabilities: capabilities.map(cap => ({
        id: cap.capabilityId,
        documentId: cap._id.toString(),
        title: cap.title,
        summary: cap.summary || '',
        complexity: cap.capabilityComplexity,
        tags: cap.tags || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/documents/capabilities/:capabilityId - Get full capability documentation
// Query params: ?complexity=1|2|3 (for access control)
documentsRouter.get('/capabilities/:capabilityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { capabilityId } = req.params;
    const complexity = Math.min(3, Math.max(1, parseInt(req.query.complexity as string) || 1)) as 1 | 2 | 3;

    // Find the capability document
    const capability = await db.collection<Document>('documents').findOne({
      type: 'capability',
      capabilityId,
      status: 'approved',
    });

    if (!capability) {
      throw createError(`Capability '${capabilityId}' not found`, 404);
    }

    // Check if agent has sufficient complexity
    if (capability.capabilityComplexity && capability.capabilityComplexity > complexity) {
      throw createError(
        `Capability '${capabilityId}' requires complexity level ${capability.capabilityComplexity}, agent has ${complexity}`,
        403
      );
    }

    res.json({
      id: capability.capabilityId,
      documentId: capability._id.toString(),
      title: capability.title,
      summary: capability.summary || '',
      content: capability.content,
      complexity: capability.capabilityComplexity,
      tags: capability.tags || [],
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/documents/capabilities/batch - Get multiple capabilities at once
// Body: { capabilityIds: string[], complexity: 1|2|3 }
documentsRouter.post('/capabilities/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { capabilityIds, complexity: reqComplexity } = req.body;
    const complexity = Math.min(3, Math.max(1, parseInt(reqComplexity) || 1)) as 1 | 2 | 3;

    if (!Array.isArray(capabilityIds) || capabilityIds.length === 0) {
      throw createError('capabilityIds must be a non-empty array', 400);
    }

    // Limit batch size
    if (capabilityIds.length > 10) {
      throw createError('Maximum 10 capabilities per batch request', 400);
    }

    // Find all requested capability documents
    const capabilities = await db.collection<Document>('documents')
      .find({
        type: 'capability',
        capabilityId: { $in: capabilityIds },
        status: 'approved',
        capabilityComplexity: { $lte: complexity },
      })
      .toArray();

    // Build response with found capabilities and list of unavailable ones
    const found = capabilities.map(cap => ({
      id: cap.capabilityId,
      documentId: cap._id.toString(),
      title: cap.title,
      summary: cap.summary || '',
      content: cap.content,
      complexity: cap.capabilityComplexity,
      tags: cap.tags || [],
    }));

    const foundIds = new Set(capabilities.map(c => c.capabilityId));
    const notFound = capabilityIds.filter(id => !foundIds.has(id));

    res.json({
      agentComplexity: complexity,
      capabilities: found,
      notFound,
    });
  } catch (error) {
    next(error);
  }
});
