import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storage } from "../storage";

/**
 * S3 Service for file upload, download, and deletion
 * Handles company logos and task attachments
 */
class S3Service {
  private client: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.region =
      process.env.AWS_S3_REGION || process.env.AWS_REGION || "us-east-1";
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || "";

    if (!this.bucketName) {
      console.warn(
        "AWS_S3_BUCKET_NAME not configured. S3 operations will fail."
      );
    }

    this.client = new S3Client({
      region: this.region,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
    });
  }

  /**
   * Check if S3 is properly configured
   * Checks environment variables OR bedrock_settings table for AWS credentials
   * AWS_S3_BUCKET_NAME is required from environment variables only
   * @returns Object with isConfigured flag and missing configuration details
   */
  async isConfigured(): Promise<{ isConfigured: boolean; missing: string[] }> {
    const missing: string[] = [];

    // Check environment variables first
    const envAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const envSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    // Check bedrock_settings only if env vars are missing
    let bedrockSettings: any = null;
    if (!envAccessKeyId || !envSecretAccessKey) {
      try {
        bedrockSettings = await storage.getBedrockSettings();
      } catch (error) {
        // If bedrock_settings table doesn't exist or query fails, continue with env check only
        console.warn(
          "Could not check bedrock_settings for AWS credentials:",
          error
        );
      }
    }

    // Check for AWS_ACCESS_KEY_ID in env OR bedrock_settings
    const hasAccessKeyId =
      !!envAccessKeyId || !!bedrockSettings?.bedrockAccessKeyId;
    if (!hasAccessKeyId) {
      missing.push("AWS_ACCESS_KEY_ID");
    }

    // Check for AWS_SECRET_ACCESS_KEY in env OR bedrock_settings
    const hasSecretAccessKey =
      !!envSecretAccessKey || !!bedrockSettings?.bedrockSecretAccessKey;
    if (!hasSecretAccessKey) {
      missing.push("AWS_SECRET_ACCESS_KEY");
    }

    // AWS_S3_BUCKET_NAME is required (only from environment variables)
    if (!this.bucketName) {
      missing.push("AWS_S3_BUCKET_NAME");
    }

    return {
      isConfigured: missing.length === 0,
      missing,
    };
  }

  /**
   * Upload a file to S3
   * @param key - S3 object key (path)
   * @param buffer - File buffer
   * @param contentType - MIME type
   * @returns S3 object key
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.client.send(command);
      return key;
    } catch (error) {
      console.error("S3 upload error:", error);
      throw new Error(
        `Failed to upload file to S3: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Delete a file from S3
   * @param key - S3 object key
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    try {
      // Check if file exists first
      try {
        await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          })
        );
      } catch (error: any) {
        // File doesn't exist, that's okay
        if (
          error.name === "NotFound" ||
          error.$metadata?.httpStatusCode === 404
        ) {
          console.warn(`File ${key} not found in S3, skipping deletion`);
          return;
        }
        throw error;
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
    } catch (error) {
      console.error("S3 delete error:", error);
      // Don't throw - allow deletion to continue even if S3 delete fails
      // This prevents database cleanup from being blocked
    }
  }

  /**
   * Generate a presigned URL for secure file access
   * @param key - S3 object key
   * @param expiresIn - URL expiration in seconds (default: 3600 = 1 hour)
   * @returns Presigned URL
   */
  async getPresignedUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      return url;
    } catch (error) {
      console.error("S3 presigned URL error:", error);
      throw new Error(
        `Failed to generate presigned URL: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Extract S3 key from URL
   * Handles both full S3 URLs and stored keys
   * @param url - S3 URL or key
   * @returns S3 key
   */
  extractKeyFromUrl(url: string): string {
    // If it's already just a key (no http/https), return as is
    if (!url.startsWith("http")) {
      return url;
    }

    // Extract key from S3 URL
    // Format: https://bucket.s3.region.amazonaws.com/key or https://s3.region.amazonaws.com/bucket/key
    try {
      const urlObj = new URL(url);
      // Remove leading slash and bucket name if present
      let key = urlObj.pathname.replace(/^\/+/, "");
      if (key.startsWith(`${this.bucketName}/`)) {
        key = key.replace(`${this.bucketName}/`, "");
      }
      return key;
    } catch {
      // If URL parsing fails, assume it's already a key
      return url;
    }
  }

  /**
   * Check if a URL is an S3 URL/key (not base64 data URL)
   */
  isS3Url(url: string): boolean {
    return !url.startsWith("data:");
  }

  /**
   * Check if a file exists in S3
   * @param key - S3 object key
   * @returns true if file exists, false otherwise
   */
  async fileExists(key: string): Promise<boolean> {
    if (!this.bucketName) {
      return false;
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
      return true;
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      // For other errors, log and return false
      console.warn(`Error checking file existence for ${key}:`, error);
      return false;
    }
  }

  /**
   * Get file metadata from S3
   * @param key - S3 object key
   * @returns File metadata or null if not found
   */
  async getFileMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    etag: string;
  } | null> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);
      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType || "application/octet-stream",
        lastModified: response.LastModified || new Date(),
        etag: response.ETag || "",
      };
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List objects in S3 bucket with optional prefix filter
   * @param prefix - Optional prefix to filter objects (e.g., "attachments/")
   * @param maxKeys - Maximum number of keys to return (default: 1000)
   * @param continuationToken - Token for pagination
   * @returns List of object keys and metadata
   */
  async listObjects(
    prefix?: string,
    maxKeys: number = 1000,
    continuationToken?: string
  ): Promise<{
    objects: Array<{
      key: string;
      size: number;
      lastModified: Date;
    }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      });

      const response: ListObjectsV2CommandOutput = await this.client.send(
        command
      );

      return {
        objects:
          response.Contents?.map((obj) => ({
            key: obj.Key || "",
            size: obj.Size || 0,
            lastModified: obj.LastModified || new Date(),
          })) || [],
        isTruncated: response.IsTruncated || false,
        nextContinuationToken: response.NextContinuationToken,
      };
    } catch (error) {
      console.error("S3 list objects error:", error);
      throw new Error(
        `Failed to list S3 objects: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get total storage size and file count for a prefix
   * Useful for monitoring storage usage by folder/prefix
   * @param prefix - Prefix to filter objects (e.g., "attachments/")
   * @returns Total size in bytes and file count
   */
  async getStorageStats(prefix?: string): Promise<{
    totalSize: number;
    fileCount: number;
  }> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    let totalSize = 0;
    let fileCount = 0;
    let continuationToken: string | undefined;

    try {
      do {
        const result = await this.listObjects(prefix, 1000, continuationToken);
        for (const obj of result.objects) {
          totalSize += obj.size;
          fileCount++;
        }
        continuationToken = result.nextContinuationToken;
      } while (continuationToken);

      return { totalSize, fileCount };
    } catch (error) {
      console.error("Error calculating storage stats:", error);
      throw error;
    }
  }

  /**
   * Delete multiple files from S3 in batch
   * @param keys - Array of S3 object keys to delete
   * @returns Array of successfully deleted keys and failed keys
   */
  async deleteFiles(keys: string[]): Promise<{
    deleted: string[];
    failed: Array<{ key: string; error: string }>;
  }> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured");
    }

    const deleted: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];

    // Delete files in parallel (with reasonable concurrency limit)
    const batchSize = 10;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (key) => {
          await this.deleteFile(key);
          return key;
        })
      );

      results.forEach((result, index) => {
        const key = batch[index];
        if (result.status === "fulfilled") {
          deleted.push(key);
        } else {
          failed.push({
            key,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown error",
          });
        }
      });
    }

    return { deleted, failed };
  }

  /**
   * Verify S3 connection and permissions
   * @returns Object with connection status and any errors
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    configured: boolean;
    error?: string;
  }> {
    const configCheck = await this.isConfigured();
    if (!configCheck.isConfigured) {
      return {
        healthy: false,
        configured: false,
        error: `Missing configuration: ${configCheck.missing.join(", ")}`,
      };
    }

    try {
      // Try to list objects (with limit 1) to verify permissions
      await this.listObjects(undefined, 1);
      return { healthy: true, configured: true };
    } catch (error) {
      return {
        healthy: false,
        configured: true,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to S3 bucket",
      };
    }
  }

  /**
   * Get bucket region
   * @returns AWS region string
   */
  getRegion(): string {
    return this.region;
  }

  /**
   * Get bucket name
   * @returns Bucket name or empty string if not configured
   */
  getBucketName(): string {
    return this.bucketName;
  }
}

// Export singleton instance
export const s3Service = new S3Service();
