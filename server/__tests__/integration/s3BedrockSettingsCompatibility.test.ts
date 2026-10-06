import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Service, resolveS3Region } from "../../services/s3Service";
import { storage } from "../../storage";
import { createUser } from "./helpers/fixtures";
import { resetDb } from "./helpers/testDb";
import { pool } from "../../storage/db";

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return { ...actual, S3Client: jest.fn().mockImplementation((config) => ({ config, send: jest.fn().mockResolvedValue({}) })) };
});
jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: jest.fn().mockResolvedValue("https://example.test/signed-download") }));

describe("S3 retains its legacy AWS credential store after the AI migration", () => {
  const originalBucket = process.env.AWS_S3_BUCKET_NAME;
  const originalRegion = process.env.AWS_S3_REGION;

  beforeEach(async () => {
    await resetDb();
    process.env.AWS_S3_BUCKET_NAME = "compatibility-test-bucket";
    process.env.AWS_S3_REGION = "us-west-2";
    jest.clearAllMocks();
  });
  afterAll(async () => {
    if (originalBucket === undefined) delete process.env.AWS_S3_BUCKET_NAME;
    else process.env.AWS_S3_BUCKET_NAME = originalBucket;
    if (originalRegion === undefined) delete process.env.AWS_S3_REGION;
    else process.env.AWS_S3_REGION = originalRegion;
    await pool.end();
  });

  it("uses retained credentials for upload, presigned read, and delete", async () => {
    const admin = await createUser({ role: "admin" });
    await storage.updateBedrockSettings({
      bedrockAccessKeyId: "retained-access",
      bedrockSecretAccessKey: "retained-secret",
      bedrockRegion: "us-east-1",
      bedrockModelId: "amazon.titan-text-express-v1",
      isActive: true,
    } as any, admin.id);
    await storage.updateAISettings({ modelId: "deepseek/deepseek-v4-pro", isActive: false }, admin.id);

    // A new service instance avoids the singleton's five-minute cached credentials.
    const service = new (s3Service.constructor as new () => typeof s3Service)();
    const key = "attachments/compatibility.txt";
    await expect(service.uploadFile(key, Buffer.from("hello"), "text/plain")).resolves.toBe(key);
    await expect(service.getPresignedUrl(key)).resolves.toBe("https://example.test/signed-download");
    await expect(service.deleteFile(key)).resolves.toBeUndefined();

    const client = (S3Client as jest.Mock).mock.results[0].value;
    expect(client.config).toEqual({ region: "us-west-2", credentials: { accessKeyId: "retained-access", secretAccessKey: "retained-secret" } });
    expect(client.send.mock.calls.map(([command]: [object]) => command.constructor)).toEqual([PutObjectCommand, HeadObjectCommand, DeleteObjectCommand]);
    expect((getSignedUrl as jest.Mock).mock.calls[0][1]).toBeInstanceOf(GetObjectCommand);
    expect((getSignedUrl as jest.Mock).mock.calls[0][2]).toEqual({ expiresIn: 3600 });
  });

  // I2: before the AI move the S3 region was hard-coded to us-east-2. A deployment that never set
  // AWS_S3_REGION must keep signing for us-east-2, and the saved bedrock_region only counts when
  // somebody saved a region on purpose: us-east-1 is the column's own default (bedrock_settings
  // inserts without a region get it), so it says nothing about the bucket.
  describe("S3 region", () => {
    async function regionUsedWith(env: string | undefined, saved: { bedrockRegion?: string }) {
      if (env === undefined) delete process.env.AWS_S3_REGION;
      else process.env.AWS_S3_REGION = env;
      const admin = await createUser({ role: "admin" });
      await storage.updateBedrockSettings({
        bedrockAccessKeyId: "region-access",
        bedrockSecretAccessKey: "region-secret",
        bedrockModelId: "amazon.titan-text-express-v1",
        isActive: true,
        ...saved,
      } as any, admin.id);
      const service = new (s3Service.constructor as new () => typeof s3Service)();
      await service.uploadFile("attachments/region.txt", Buffer.from("hello"), "text/plain");
      const client = (S3Client as jest.Mock).mock.results[0].value;
      return client.config.region as string;
    }

    it("falls back to us-east-2 with no AWS_S3_REGION and a saved region that is only the column default", async () => {
      await expect(regionUsedWith(undefined, {})).resolves.toBe("us-east-2");
    });

    it("falls back to us-east-2 when AWS_S3_REGION is blank (docker-compose passes it through empty) and the saved region is the default", async () => {
      await expect(regionUsedWith("", { bedrockRegion: "us-east-1" })).resolves.toBe("us-east-2");
    });

    it("uses an explicitly saved region when AWS_S3_REGION is not set", async () => {
      await expect(regionUsedWith(undefined, { bedrockRegion: "eu-west-1" })).resolves.toBe("eu-west-1");
    });

    it("lets AWS_S3_REGION win over the saved region", async () => {
      await expect(regionUsedWith("ap-south-1", { bedrockRegion: "eu-west-1" })).resolves.toBe("ap-south-1");
    });

    it("resolveS3Region orders env, then an explicitly saved region, then us-east-2", () => {
      expect(resolveS3Region("us-west-2", "eu-west-1")).toBe("us-west-2");
      expect(resolveS3Region(undefined, "eu-west-1")).toBe("eu-west-1");
      expect(resolveS3Region("  ", " eu-west-1 ")).toBe("eu-west-1");
      expect(resolveS3Region(undefined, "us-east-1")).toBe("us-east-2");
      expect(resolveS3Region(undefined, null)).toBe("us-east-2");
      expect(resolveS3Region("", "")).toBe("us-east-2");
    });
  });
});
