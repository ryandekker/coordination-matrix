import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// S3 Configuration from environment
const S3_BUCKET = process.env.S3_BUCKET || 'coordination-matrix-files';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_ENDPOINT = process.env.S3_ENDPOINT; // Optional: for R2/MinIO
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

// Prefixes for lifecycle management
const TEMP_PREFIX = 'temp/';
const PERMANENT_PREFIX = 'permanent/';

// Default expiration for temp files (3 days in seconds)
const TEMP_EXPIRATION_SECONDS = 3 * 24 * 60 * 60;

// Create S3 client
const s3Client = new S3Client({
  region: S3_REGION,
  ...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
  ...(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && {
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  }),
});

export interface UploadOptions {
  filename: string;
  mimeType: string;
  permanent?: boolean;
  fileId: string;  // MongoDB ObjectId as string for path
}

export interface StorageResult {
  storageKey: string;
  bucket: string;
}

export interface DownloadUrlOptions {
  expiresIn?: number;  // Seconds, default 1 hour
}

class StorageService {
  /**
   * Generate storage key for a file
   */
  private generateStorageKey(options: UploadOptions): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = options.permanent ? PERMANENT_PREFIX : TEMP_PREFIX;

    // Sanitize filename (remove path separators, limit length)
    const safeFilename = options.filename
      .replace(/[/\\]/g, '_')
      .slice(0, 100);

    return `${prefix}${year}/${month}/${options.fileId}/${safeFilename}`;
  }

  /**
   * Upload a file to S3
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<StorageResult> {
    const storageKey = this.generateStorageKey(options);

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: options.mimeType,
      // Add metadata for tracking
      Metadata: {
        'original-filename': options.filename,
        'file-id': options.fileId,
        'permanent': String(options.permanent ?? false),
      },
    });

    await s3Client.send(command);

    return {
      storageKey,
      bucket: S3_BUCKET,
    };
  }

  /**
   * Get a signed URL for downloading a file
   */
  async getSignedUrl(
    storageKey: string,
    options: DownloadUrlOptions = {}
  ): Promise<string> {
    const { expiresIn = 3600 } = options; // Default 1 hour

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: storageKey,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  }

  /**
   * Delete a file from S3
   */
  async delete(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: storageKey,
    });

    await s3Client.send(command);
  }

  /**
   * Move a file from temp to permanent storage
   * Returns the new storage key
   */
  async moveToPermanent(storageKey: string): Promise<string> {
    if (!storageKey.startsWith(TEMP_PREFIX)) {
      // Already permanent or unknown prefix
      return storageKey;
    }

    // Generate new key with permanent prefix
    const newKey = storageKey.replace(TEMP_PREFIX, PERMANENT_PREFIX);

    // Copy to new location
    const copyCommand = new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${storageKey}`,
      Key: newKey,
    });
    await s3Client.send(copyCommand);

    // Delete old file
    await this.delete(storageKey);

    return newKey;
  }

  /**
   * Move a file from permanent to temp storage (to enable expiration)
   * Returns the new storage key
   */
  async moveToTemp(storageKey: string): Promise<string> {
    if (!storageKey.startsWith(PERMANENT_PREFIX)) {
      // Already temp or unknown prefix
      return storageKey;
    }

    // Generate new key with temp prefix
    const newKey = storageKey.replace(PERMANENT_PREFIX, TEMP_PREFIX);

    // Copy to new location
    const copyCommand = new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${storageKey}`,
      Key: newKey,
    });
    await s3Client.send(copyCommand);

    // Delete old file
    await this.delete(storageKey);

    return newKey;
  }

  /**
   * Check if a file exists in S3
   */
  async exists(storageKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: storageKey,
      });
      await s3Client.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate expiration date for temp files
   */
  getExpirationDate(): Date {
    return new Date(Date.now() + TEMP_EXPIRATION_SECONDS * 1000);
  }

  /**
   * Get the bucket name
   */
  getBucket(): string {
    return S3_BUCKET;
  }

  /**
   * Check if S3 is configured
   */
  isConfigured(): boolean {
    return !!(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);
  }
}

export const storageService = new StorageService();
