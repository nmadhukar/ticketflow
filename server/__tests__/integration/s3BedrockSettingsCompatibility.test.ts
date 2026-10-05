import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Service } from "../../services/s3Service";
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
});
