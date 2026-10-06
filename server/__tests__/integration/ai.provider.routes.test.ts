import request from "supertest";
import { db } from "../../storage/db";
import { bedrockSettings } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";

describe("provider-neutral AI and AWS storage settings", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.close(); });
  beforeEach(async () => { await resetDb(); });

  it("keeps OpenRouter model changes separate from retained AWS credentials", async () => {
    const adminUser = await createUser({ role: "admin" });
    const admin = await loginAs(ctx.app, adminUser);
    await storage.updateBedrockSettings({
      bedrockAccessKeyId: "retained-access",
      bedrockSecretAccessKey: "retained-secret",
      bedrockRegion: "us-east-1",
      bedrockModelId: "amazon.titan-text-express-v1",
      isActive: true,
    } as any, adminUser.id);

    const updated = await admin.post("/api/ai/settings").send({ modelId: "deepseek/deepseek-v4-pro", maxTokens: 1200 });
    expect(updated.status).toBe(200);
    expect(updated.body.modelId).toBe("deepseek/deepseek-v4-pro");
    expect(updated.body.maxTokens).toBe(1200);
    expect(updated.body).toHaveProperty("openRouterKeyConfigured");
    expect(JSON.stringify(updated.body)).not.toContain("retained-secret");

    const model = await admin.get("/api/ai/settings");
    expect(model.status).toBe(200);
    expect(model.body.modelId).toBe("deepseek/deepseek-v4-pro");
    const old = (await db.select().from(bedrockSettings))[0];
    expect(old.bedrockAccessKeyId).toBe("retained-access");
    expect(old.bedrockSecretAccessKey).toBe("retained-secret");
    expect(old.bedrockModelId).toBe("amazon.titan-text-express-v1");

    const storageSettings = await admin.get("/api/storage/aws-settings");
    const legacySettings = await admin.get("/api/bedrock/settings");
    expect(storageSettings.status).toBe(200);
    expect(storageSettings.body).toEqual(legacySettings.body);
    expect(storageSettings.body.hasBedrockSecret).toBe(true);
    expect(JSON.stringify(storageSettings.body)).not.toContain("retained-secret");
  });

  it("keeps AWS storage writes available through both settings URLs", async () => {
    const admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const written = await admin.post("/api/storage/aws-settings").send({ bedrockAccessKeyId: "aws-key", bedrockSecretAccessKey: "aws-secret", bedrockRegion: "us-west-2" });
    expect(written.status).toBe(200);
    expect(written.body.hasBedrockSecret).toBe(true);
    expect(JSON.stringify(written.body)).not.toContain("aws-secret");
    const legacy = await admin.get("/api/bedrock/settings");
    expect(legacy.body).toEqual(written.body);
  });

  it("requires admin access for AI and AWS settings", async () => {
    const nonAdmin = await loginAs(ctx.app, await createUser({ role: "agent" }));
    for (const url of ["/api/ai/settings", "/api/storage/aws-settings"]) {
      expect((await nonAdmin.get(url)).status).toBe(403);
      expect((await nonAdmin.post(url).send({})).status).toBe(403);
      expect((await request(ctx.app).get(url)).status).toBe(401);
    }
    expect((await nonAdmin.post("/api/ai/test-connection")).status).toBe(403);
    expect((await request(ctx.app).post("/api/ai/test-connection")).status).toBe(401);
  });
});
