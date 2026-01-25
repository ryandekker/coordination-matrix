import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { createError } from '../middleware/error-handler.js';
import { loadUserGroups } from '../middleware/group-access.js';
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
const VALID_TYPES: DocumentType[] = ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'];
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
  const { search, type, status, tags, includeArchived, createdById, workflowRunId, parentDocumentId, groupId, projectId, filters } = query;

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
      groupId,
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
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;

    // Determine groupId - use provided, or fall back to user's primary group
    let resolvedGroupId: ObjectId | null = null;
    if (groupId && ObjectId.isValid(groupId)) {
      resolvedGroupId = new ObjectId(groupId);
    } else if (req.userGroupIds && req.userGroupIds.length > 0) {
      // Use user's first (primary) group
      resolvedGroupId = req.userGroupIds[0];
    }

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

    // Debug: log the document being inserted
    console.log('Inserting document:', JSON.stringify(newDocument, (_key, value) => {
      if (value instanceof Date) return `Date(${value.toISOString()})`;
      if (value && value._bsontype === 'ObjectId') return `ObjectId(${value.toString()})`;
      return value;
    }, 2));

    const result = await db.collection<Document>('documents').insertOne(newDocument as Document);
    const inserted = await db.collection<Document>('documents').findOne({ _id: result.insertedId });

    // Create initial version record
    if (inserted && userId) {
      await db.collection<DocumentVersion>('document_versions').insertOne({
        documentId: result.insertedId,
        version: 1,
        title: inserted.title,
        content: inserted.content,
        summary: inserted.summary,
        changeDescription: 'Initial version',
        modifiedById: userId,
        modifiedAt: now,
      } as DocumentVersion);
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
      updates.summary = summary?.trim() || undefined;
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

    // Add update metadata
    const now = new Date();
    updates.updatedAt = now;
    updates.lastModifiedById = req.user?.userId ? new ObjectId(req.user.userId) : existing.lastModifiedById;

    // If content changed, increment version and create version record
    if (contentChanged) {
      updates.version = existing.version + 1;

      // Clear embedding (will need to be regenerated)
      updates.embedding = undefined;
      updates.embeddingUpdatedAt = null;
    }

    const result = await db.collection<Document>('documents').findOneAndUpdate(
      { _id: documentId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw createError('Document not found', 404);
    }

    // Create version record if content changed
    if (contentChanged && updates.lastModifiedById) {
      await db.collection<DocumentVersion>('document_versions').insertOne({
        documentId,
        version: result.version,
        title: result.title,
        content: result.content,
        summary: result.summary,
        changeDescription: changeDescription || `Updated to version ${result.version}`,
        modifiedById: updates.lastModifiedById,
        modifiedAt: now,
      } as DocumentVersion);

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

// DELETE /api/documents/:id - Soft delete (archive) or hard delete a document
documentsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { permanent } = req.query;

    if (!ObjectId.isValid(req.params.id)) {
      throw createError('Invalid document ID', 400);
    }

    const documentId = new ObjectId(req.params.id);

    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;

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
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;
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
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;
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
    const userId = req.user?.userId ? new ObjectId(req.user.userId) : null;
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
