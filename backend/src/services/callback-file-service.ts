import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { storageService } from './storage-service.js';
import type { FileDocument, FileSource } from '../types/index.js';

export interface CallbackFileInput {
  filename: string;
  mimeType: string;
  contentBase64: string;
  permanent?: boolean;
  toolName?: string;
}

export interface ProcessedFile {
  _id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  permanent: boolean;
}

/**
 * Process files from a workflow callback payload.
 * Files can be embedded as base64 in the `files` array of the payload.
 *
 * Example payload:
 * {
 *   "item": { "status": "complete" },
 *   "files": [
 *     { "filename": "image.png", "mimeType": "image/png", "contentBase64": "..." }
 *   ]
 * }
 */
export async function processCallbackFiles(
  payload: Record<string, unknown>,
  context: {
    workflowRunId: string;
    stepId: string;
    taskId: string;
  }
): Promise<{ processedFiles: ProcessedFile[]; cleanedPayload: Record<string, unknown> }> {
  const processedFiles: ProcessedFile[] = [];

  // Check if storage is configured
  if (!storageService.isConfigured()) {
    console.log('[CallbackFiles] S3 not configured, skipping file processing');
    return { processedFiles, cleanedPayload: payload };
  }

  // Extract files array from payload
  const files = payload.files as CallbackFileInput[] | undefined;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { processedFiles, cleanedPayload: payload };
  }

  console.log(`[CallbackFiles] Processing ${files.length} files from callback`);

  const db = getDb();
  const taskObjectId = new ObjectId(context.taskId);

  for (const fileInput of files) {
    try {
      // Validate required fields
      if (!fileInput.filename || !fileInput.mimeType || !fileInput.contentBase64) {
        console.warn('[CallbackFiles] Skipping file with missing fields:', {
          filename: fileInput.filename,
          hasMimeType: !!fileInput.mimeType,
          hasContent: !!fileInput.contentBase64,
        });
        continue;
      }

      // Decode base64 content
      const buffer = Buffer.from(fileInput.contentBase64, 'base64');
      const fileId = new ObjectId();
      const permanent = fileInput.permanent ?? false;

      // Upload to S3
      const { storageKey, bucket } = await storageService.upload(buffer, {
        filename: fileInput.filename,
        mimeType: fileInput.mimeType,
        permanent,
        fileId: fileId.toString(),
      });

      // Create file document
      const now = new Date();
      const fileDoc: Omit<FileDocument, '_id'> = {
        filename: fileInput.filename,
        mimeType: fileInput.mimeType,
        size: buffer.length,
        storageKey,
        bucket,
        permanent,
        source: 'workflow-step' as FileSource,
        sourceDetails: {
          stepId: context.stepId,
          workflowRunId: new ObjectId(context.workflowRunId),
          ...(fileInput.toolName && { toolName: fileInput.toolName }),
        },
        attachedTo: {
          type: 'task',
          id: taskObjectId,
        },
        createdAt: now,
        expiresAt: permanent ? null : storageService.getExpirationDate(),
      };

      await db.collection('files').insertOne({
        _id: fileId,
        ...fileDoc,
      });

      // Generate signed URL for immediate access
      const url = await storageService.getSignedUrl(storageKey);

      processedFiles.push({
        _id: fileId.toString(),
        filename: fileInput.filename,
        mimeType: fileInput.mimeType,
        size: buffer.length,
        url,
        permanent,
      });

      console.log(`[CallbackFiles] Processed file: ${fileInput.filename} (${buffer.length} bytes)`);
    } catch (error) {
      console.error(`[CallbackFiles] Error processing file ${fileInput.filename}:`, error);
      // Continue processing other files
    }
  }

  // Return cleaned payload without the files array (but with file references)
  const { files: _, ...restPayload } = payload;
  const cleanedPayload = {
    ...restPayload,
    // Add file references that can be used by downstream steps
    ...(processedFiles.length > 0 && {
      _files: processedFiles,
      _fileIds: processedFiles.map((f) => f._id),
    }),
  };

  return { processedFiles, cleanedPayload };
}

/**
 * Check if a payload contains files to process
 */
export function hasCallbackFiles(payload: Record<string, unknown>): boolean {
  const files = payload.files;
  return Array.isArray(files) && files.length > 0;
}
