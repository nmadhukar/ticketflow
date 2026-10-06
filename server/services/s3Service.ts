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
// R63: a log line names the error's type (describeError), never the SDK error object or its text.
import { describeError } from "../http/errors";

/**
 * The region S3 used before it became configurable: hard-coded since 9b9617e. Deployments that
 * never set AWS_S3_REGION have their bucket here, so it stays the last fallback.
 */
export const LEGACY_S3_REGION = "us-east-2";

/**
 * bedrock_settings.bedrock_region defaults to this at the column level (shared/schema.ts,
 * migration 0001) and in the storage and save routes, so a row nobody chose a region for carries
 * it. It cannot be told apart from a region saved on purpose, and it says nothing about the
 * bucket, so it is never taken as the S3 region. To sign for us-east-1, set AWS_S3_REGION.
 */
const BEDROCK_REGION_DEFAULT = "us-east-1";

/**
 * AWS_S3_REGION first, then a region explicitly saved in bedrock_settings (anything but that
 * column's default), then the legacy hard-coded region.
 */
export function resolveS3Region(
  envRegion: string | null | undefined,
  savedRegion: string | null | undefined
): string {
  const fromEnv = envRegion?.trim();
  if (fromEnv) return fromEnv;
  const saved = savedRegion?.trim();
  if (saved && saved !== BEDROCK_REGION_DEFAULT) return saved;
  return LEGACY_S3_REGION;
}

/**
 * S3 Service for file upload, download, and deletion
 * Handles company logos and task attachments
 *
 * Configuration:
 * - Access Key/Secret: bedrock_settings table ONLY (no env fallback)
 * - Region: AWS_S3_REGION env variable first, then an explicitly saved bedrockRegion from
 *   bedrock_settings (not the "us-east-1" column default), then "us-east-2" (see resolveS3Region)
 * - Bucket Name: AWS_S3_BUCKET_NAME environment variable ONLY (no bedrock_settings fallback)
 */
class S3Service {
  private client: S3Client | null = null;
  private bucketName: string = "";
  private settingsCache: {
    accessKeyId: string | null;
    secretAccessKey: string | null;
    region: string;
    expiresAt: number;
  } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Bucket name is read from env variable only
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || "";

    if (!this.bucketName) {
      console.warn(
        "AWS_S3_BUCKET_NAME not configured. S3 operations will fail."
      );
    }

    // Client will be initialized when credentials are loaded from bedrock_settings
  }

  /**
   * Get AWS credentials and region from bedrock_settings table
   * Caches results for 5 minutes to avoid excessive DB queries
   */
  private async getAwsCredentials(): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  }> {
    // Check cache first
    if (
      this.settingsCache &&
      this.settingsCache.expiresAt > Date.now() &&
      this.settingsCache.accessKeyId &&
      this.settingsCache.secretAccessKey
    ) {
      return {
        accessKeyId: this.settingsCache.accessKeyId,
        secretAccessKey: this.settingsCache.secretAccessKey,
        region: this.settingsCache.region,
      };
    }

    // Fetch from bedrock_settings table
    let bedrockSettings: any;
    try {
      bedrockSettings = await storage.getBedrockSettings();
    } catch (error) {
      console.error(
        "Could not fetch bedrock_settings for S3 credentials:",
        describeError(error)
      );
      throw new Error(
        "AWS credentials not found in bedrock_settings table. Please configure access key, secret, and region in Storage Settings."
      );
    }

    // Access Key and Secret: bedrock_settings ONLY (no env fallback)
    const accessKeyId = bedrockSettings?.bedrockAccessKeyId || null;
    const secretAccessKey = bedrockSettings?.bedrockSecretAccessKey || null;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "AWS credentials not configured in bedrock_settings table. Please configure access key and secret in Storage Settings."
      );
    }

    // S3 bucket region can be different from the saved Bedrock region.
    const region = resolveS3Region(process.env.AWS_S3_REGION, bedrockSettings?.bedrockRegion);

    // Update cache
    this.settingsCache = {
      accessKeyId,
      secretAccessKey,
      region,
      expiresAt: Date.now() + this.CACHE_TTL,
    };

    // Initialize or update S3 client
    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    return { accessKeyId, secretAccessKey, region };
  }

  /**
   * Check if S3 is properly configured
   * - Access Key/Secret: bedrock_settings table ONLY
   * - Region: AWS_S3_REGION env variable or an explicitly saved bedrockRegion (optional, falls back to us-east-2)
   * - Bucket Name: AWS_S3_BUCKET_NAME environment variable ONLY
   * @returns Object with isConfigured flag and missing configuration details
   */
  async isConfigured(): Promise<{ isConfigured: boolean; missing: string[] }> {
    const missing: string[] = [];

    // Check bucket name from env variable
    if (!this.bucketName) {
      missing.push("AWS_S3_BUCKET_NAME (environment variable)");
    }

    // Check credentials from bedrock_settings table
    try {
      const bedrockSettings = await storage.getBedrockSettings();

      if (!bedrockSettings?.bedrockAccessKeyId) {
        missing.push("bedrock_access_key_id (in bedrock_settings table)");
      }

      if (!bedrockSettings?.bedrockSecretAccessKey) {
        missing.push("bedrock_secret_access_key (in bedrock_settings table)");
      }

      // Region is optional (has default), but we check if it exists
      // No need to add to missing if it's not set, as it has a default
    } catch {
      missing.push("bedrock_settings table (unable to access)");
    }

    return {
      isConfigured: missing.length === 0,
      missing,
    };
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
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
      console.error("S3 upload error:", describeError(error));
      throw new Error(
        `Failed to upload file to S3: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
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
      console.error(`S3 delete error for ${key}:`, describeError(error));
      // Don't throw - allow deletion to continue even if S3 delete fails
    }
  }

  /**
   * Generate a presigned URL for secure file access
   */
  async getPresignedUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      return url;
    } catch (error) {
      console.error(`S3 presigned URL error for ${key}:`, describeError(error));
      throw new Error(
        `Failed to generate presigned URL: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Extract S3 key from URL
   */
  extractKeyFromUrl(url: string): string {
    // If it's already just a key (no http/https), return as is
    if (!url.startsWith("http")) {
      return url;
    }

    // Extract key from S3 URL
    try {
      const urlObj = new URL(url);
      const key = urlObj.pathname.replace(/^\/+/, "");
      // Bucket name is dynamic, so we can't hardcode it here
      // Just return the pathname after removing leading slashes
      return key;
    } catch {
      return url;
    }
  }

  /**
   * Check if a URL is an S3 URL/key
   */
  isS3Url(url: string): boolean {
    return !url.startsWith("data:");
  }

  /**
   * Check if a file exists in S3
   */
  async fileExists(key: string): Promise<boolean> {
    if (!this.bucketName) {
      return false;
    }

    try {
      await this.getAwsCredentials();

      if (!this.client) {
        return false;
      }

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
      console.warn(`Error checking file existence for ${key}:`, describeError(error));
      return false;
    }
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    etag: string;
  } | null> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
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
   * List objects in S3 bucket
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
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
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
      console.error("S3 list objects error:", describeError(error));
      throw new Error(
        `Failed to list S3 objects: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get total storage size and file count
   */
  async getStorageStats(prefix?: string): Promise<{
    totalSize: number;
    fileCount: number;
  }> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
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
      console.error("Error calculating storage stats:", describeError(error));
      throw error;
    }
  }

  /**
   * Delete multiple files from S3 in batch
   */
  async deleteFiles(keys: string[]): Promise<{
    deleted: string[];
    failed: Array<{ key: string; error: string }>;
  }> {
    if (!this.bucketName) {
      throw new Error("S3 bucket name not configured (AWS_S3_BUCKET_NAME)");
    }

    await this.getAwsCredentials();

    if (!this.client) {
      throw new Error("S3 client not initialized");
    }

    const deleted: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];

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
            // The error's type (R63), never its text: callers log this field.
            error: describeError(result.reason),
          });
        }
      });
    }

    return { deleted, failed };
  }

  /**
   * Verify S3 connection and permissions
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
   * Get bucket region (from bedrock_settings)
   */
  async getRegion(): Promise<string> {
    const credentials = await this.getAwsCredentials();
    return credentials.region;
  }

  /**
   * Get bucket name (from environment variable)
   */
  getBucketName(): string {
    return this.bucketName;
  }
}

// Export singleton instance
export const s3Service = new S3Service();
