import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { storageService } from '../services/storage-service.js';
import type { FileDocument, FileSource, FileAttachmentType, FileWithUrl } from '../types/index.js';

const router = Router();

// Configure multer for memory storage (we'll stream to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// Validation schemas
const uploadSchema = z.object({
  attachToType: z.enum(['task', 'workflow-run']),
  attachToId: z.string().refine((id) => ObjectId.isValid(id), 'Invalid ObjectId'),
  source: z.enum(['user', 'ai-tool', 'webhook', 'workflow-step']).default('user'),
  permanent: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(false)
  ),
  // Optional source details
  toolName: z.string().optional(),
  prompt: z.string().optional(),
  stepId: z.string().optional(),
  workflowRunId: z.string().refine((id) => !id || ObjectId.isValid(id), 'Invalid ObjectId').optional(),
});

const listFilesSchema = z.object({
  attachToType: z.enum(['task', 'workflow-run']).optional(),
  attachToId: z.string().refine((id) => !id || ObjectId.isValid(id), 'Invalid ObjectId').optional(),
  source: z.enum(['user', 'ai-tool', 'webhook', 'workflow-step']).optional(),
  mimeType: z.string().optional(),
  permanent: z.preprocess(
    (val) => val === 'true' ? true : val === 'false' ? false : undefined,
    z.boolean().optional()
  ),
  search: z.string().optional(),
  page: z.preprocess((val) => Number(val) || 1, z.number().min(1).default(1)),
  limit: z.preprocess((val) => Number(val) || 20, z.number().min(1).max(100).default(20)),
  sortBy: z.enum(['createdAt', 'filename', 'size']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const updateFileSchema = z.object({
  permanent: z.boolean().optional(),
  filename: z.string().min(1).max(255).optional(),
});

/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Upload a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - attachToType
 *               - attachToId
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               attachToType:
 *                 type: string
 *                 enum: [task, workflow-run]
 *               attachToId:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [user, ai-tool, webhook, workflow-step]
 *               permanent:
 *                 type: boolean
 *               toolName:
 *                 type: string
 *               prompt:
 *                 type: string
 *               stepId:
 *                 type: string
 *               workflowRunId:
 *                 type: string
 *     responses:
 *       201:
 *         description: File uploaded successfully
 *       400:
 *         description: Invalid request
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // Check if S3 is configured
    if (!storageService.isConfigured()) {
      res.status(503).json({ error: 'File storage not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.' });
      return;
    }

    // Validate file exists
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    // Validate request body
    const parseResult = uploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }

    const { attachToType, attachToId, source, permanent, toolName, prompt, stepId, workflowRunId } = parseResult.data;

    // Verify the target entity exists
    const db = getDb();
    const collectionName = attachToType === 'task' ? 'tasks' : 'workflow_runs';
    const targetEntity = await db.collection(collectionName).findOne({
      _id: new ObjectId(attachToId),
    });

    if (!targetEntity) {
      res.status(404).json({ error: `${attachToType} not found` });
      return;
    }

    // Generate file ID
    const fileId = new ObjectId();

    // Upload to S3
    const { storageKey, bucket } = await storageService.upload(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      permanent,
      fileId: fileId.toString(),
    });

    // Build source details
    const sourceDetails: Record<string, unknown> = {};
    if (toolName) sourceDetails.toolName = toolName;
    if (prompt) sourceDetails.prompt = prompt;
    if (stepId) sourceDetails.stepId = stepId;
    if (workflowRunId) sourceDetails.workflowRunId = new ObjectId(workflowRunId);
    if (req.user) sourceDetails.userId = new ObjectId(req.user.id);

    // Create file document
    const now = new Date();
    const fileDoc: Omit<FileDocument, '_id'> = {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storageKey,
      bucket,
      permanent,
      source: source as FileSource,
      sourceDetails: Object.keys(sourceDetails).length > 0 ? sourceDetails : undefined,
      attachedTo: {
        type: attachToType as FileAttachmentType,
        id: new ObjectId(attachToId),
      },
      createdById: req.user ? new ObjectId(req.user.id) : null,
      createdAt: now,
      expiresAt: permanent ? null : storageService.getExpirationDate(),
    };

    const result = await db.collection('files').insertOne({
      _id: fileId,
      ...fileDoc,
    });

    // Generate download URL
    const url = await storageService.getSignedUrl(storageKey);

    res.status(201).json({
      _id: result.insertedId,
      ...fileDoc,
      url,
    });
  } catch (error) {
    console.error('[Files] Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

/**
 * @swagger
 * /api/files:
 *   get:
 *     summary: List files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: attachToType
 *         schema:
 *           type: string
 *           enum: [task, workflow-run]
 *       - in: query
 *         name: attachToId
 *         schema:
 *           type: string
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [user, ai-tool, webhook, workflow-step]
 *       - in: query
 *         name: permanent
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of files with pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const parseResult = listFilesSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parseResult.error.errors });
      return;
    }

    const { attachToType, attachToId, source, mimeType, permanent, search, page, limit, sortBy, sortOrder } = parseResult.data;

    // Build query
    const query: Record<string, unknown> = {};

    if (attachToType) {
      query['attachedTo.type'] = attachToType;
    }
    if (attachToId) {
      query['attachedTo.id'] = new ObjectId(attachToId);
    }
    if (source) {
      query.source = source;
    }
    if (mimeType) {
      // Support prefix matching (e.g., 'image/' matches all images)
      if (mimeType.endsWith('/')) {
        query.mimeType = { $regex: `^${mimeType}` };
      } else {
        query.mimeType = mimeType;
      }
    }
    if (permanent !== undefined) {
      query.permanent = permanent;
    }
    if (search) {
      query.$text = { $search: search };
    }

    const db = getDb();
    const skip = (page - 1) * limit;
    const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [files, total] = await Promise.all([
      db.collection<FileDocument>('files')
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('files').countDocuments(query),
    ]);

    // Generate signed URLs for each file
    const filesWithUrls: FileWithUrl[] = await Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await storageService.getSignedUrl(file.storageKey),
      }))
    );

    res.json({
      data: filesWithUrls,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Files] List error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

/**
 * @swagger
 * /api/files/{id}:
 *   get:
 *     summary: Get file metadata
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File metadata with download URL
 *       404:
 *         description: File not found
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid file ID' });
      return;
    }

    const db = getDb();
    const file = await db.collection<FileDocument>('files').findOne({
      _id: new ObjectId(id),
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const url = await storageService.getSignedUrl(file.storageKey);

    res.json({
      ...file,
      url,
    });
  } catch (error) {
    console.error('[Files] Get error:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

/**
 * @swagger
 * /api/files/{id}/download:
 *   get:
 *     summary: Get download URL (redirect)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to signed S3 URL
 *       404:
 *         description: File not found
 */
router.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid file ID' });
      return;
    }

    const db = getDb();
    const file = await db.collection<FileDocument>('files').findOne({
      _id: new ObjectId(id),
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const url = await storageService.getSignedUrl(file.storageKey, {
      expiresIn: 300, // 5 minutes for direct download
    });

    res.redirect(url);
  } catch (error) {
    console.error('[Files] Download error:', error);
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

/**
 * @swagger
 * /api/files/{id}:
 *   patch:
 *     summary: Update file (e.g., mark as permanent)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permanent:
 *                 type: boolean
 *               filename:
 *                 type: string
 *     responses:
 *       200:
 *         description: File updated
 *       404:
 *         description: File not found
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid file ID' });
      return;
    }

    const parseResult = updateFileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }

    const updates = parseResult.data;
    const db = getDb();

    // Get current file
    const file = await db.collection<FileDocument>('files').findOne({
      _id: new ObjectId(id),
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const updateDoc: Record<string, unknown> = {};

    // Handle permanent status change
    if (updates.permanent !== undefined && updates.permanent !== file.permanent) {
      if (updates.permanent) {
        // Moving to permanent - move file in S3 and clear expiration
        const newKey = await storageService.moveToPermanent(file.storageKey);
        updateDoc.storageKey = newKey;
        updateDoc.permanent = true;
        updateDoc.expiresAt = null;
      } else {
        // Moving to temp - move file in S3 and set expiration
        const newKey = await storageService.moveToTemp(file.storageKey);
        updateDoc.storageKey = newKey;
        updateDoc.permanent = false;
        updateDoc.expiresAt = storageService.getExpirationDate();
      }
    }

    if (updates.filename) {
      updateDoc.filename = updates.filename;
    }

    if (Object.keys(updateDoc).length === 0) {
      res.json(file);
      return;
    }

    const result = await db.collection<FileDocument>('files').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const url = await storageService.getSignedUrl(result.storageKey);

    res.json({
      ...result,
      url,
    });
  } catch (error) {
    console.error('[Files] Update error:', error);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

/**
 * @swagger
 * /api/files/{id}:
 *   delete:
 *     summary: Delete a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: File deleted
 *       404:
 *         description: File not found
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid file ID' });
      return;
    }

    const db = getDb();
    const file = await db.collection<FileDocument>('files').findOne({
      _id: new ObjectId(id),
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Delete from S3
    await storageService.delete(file.storageKey);

    // Delete from database
    await db.collection('files').deleteOne({ _id: new ObjectId(id) });

    res.status(204).send();
  } catch (error) {
    console.error('[Files] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

/**
 * @swagger
 * /api/tasks/{taskId}/files:
 *   get:
 *     summary: List files attached to a task
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of files attached to the task
 */
// This endpoint will be added in tasks.ts as a sub-route

export const filesRouter = router;
