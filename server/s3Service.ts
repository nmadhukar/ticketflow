/**
 * AWS S3 Service for File Storage
 * 
 * Handles file uploads and downloads using AWS S3.
 * Uses presigned URLs for secure client-side uploads.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { Response } from "express";

// Initialize S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'us-east-1';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    }

    s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return s3Client;
}

function getBucketName(): string {
  const bucketName = process.env.S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('S3_BUCKET_NAME not configured. Please set S3_BUCKET_NAME environment variable.');
  }
  return bucketName;
}

export class S3Service {
  /**
   * Generate a presigned URL for uploading a file to S3
   * @param fileType MIME type of the file
   * @param folder Folder path in the bucket (e.g., 'help-documents', 'company-policies')
   * @param filename Original filename (optional, will use UUID if not provided)
   * @returns Object containing the presigned URL and the S3 key
   */
  async getPresignedUploadUrl(
    fileType: string,
    folder: string,
    filename?: string
  ): Promise<{ uploadUrl: string; key: string; url: string }> {
    const client = getS3Client();
    const bucketName = getBucketName();

    // Generate unique key
    const fileId = randomUUID();
    const extension = filename ? filename.split('.').pop() : '';
    const key = `${folder}/${fileId}${extension ? `.${extension}` : ''}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    // Generate presigned URL (valid for 15 minutes)
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    // Construct the final URL for accessing the file
    const url = `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    return { uploadUrl, key, url };
  }

  /**
   * Generate a presigned URL for downloading a file from S3
   * @param key S3 object key
   * @param expiresIn Expiration time in seconds (default: 1 hour)
   * @returns Presigned download URL
   */
  async getPresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const client = getS3Client();
    const bucketName = getBucketName();

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    return await getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Stream a file from S3 to an Express response
   * @param key S3 object key
   * @param res Express response object
   */
  async streamFileToResponse(key: string, res: Response): Promise<void> {
    try {
      const client = getS3Client();
      const bucketName = getBucketName();

      // Get object metadata first
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const metadata = await client.send(headCommand);

      // Set response headers
      res.set({
        'Content-Type': metadata.ContentType || 'application/octet-stream',
        'Content-Length': metadata.ContentLength?.toString() || '0',
        'Cache-Control': 'public, max-age=3600',
      });

      // Get and stream the object
      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const response = await client.send(getCommand);

      if (response.Body) {
        // @ts-ignore - Body is a readable stream
        response.Body.pipe(res);
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error: any) {
      console.error('Error streaming file from S3:', error);
      
      if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: 'Error retrieving file from S3' });
      }
    }
  }

  /**
   * Delete a file from S3
   * @param key S3 object key
   */
  async deleteFile(key: string): Promise<void> {
    const client = getS3Client();
    const bucketName = getBucketName();

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await client.send(command);
  }

  /**
   * Extract S3 key from a full S3 URL
   * @param url Full S3 URL
   * @returns S3 object key
   */
  extractKeyFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove leading slash
      return urlObj.pathname.substring(1);
    } catch (error) {
      // If not a valid URL, assume it's already a key
      return url;
    }
  }

  /**
   * Check if S3 is properly configured
   * @returns true if S3 is configured, false otherwise
   */
  isConfigured(): boolean {
    try {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const bucketName = process.env.S3_BUCKET_NAME;
      
      return !!(accessKeyId && secretAccessKey && bucketName);
    } catch {
      return false;
    }
  }
}

export const s3Service = new S3Service();
