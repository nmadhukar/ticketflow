import request from "supertest";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { companySettings } from "@shared/schema";
import { s3Service } from "../../services/s3Service";

/**
 * S2: an admin updates the company name through PATCH /api/company-settings/branding, the
 * ticket prefix through PATCH /api/company-settings/tickets (the prefix itself is proved in
 * companySettings.tickets.test.ts) and uploads a logo through
 * POST /api/company-settings/branding/logo. Readers see the change. S3 is faked.
 */
describe("company branding and logo (S2)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    (storage as unknown as { companySettingsCache?: unknown }).companySettingsCache = undefined;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const admin = async () => loginAs(ctx.app, await createUser({ role: "admin" }));
  const PNG = Buffer.from("not-really-a-png-but-bytes").toString("base64");

  it("an admin changes the company name and colour; every role reads the change", async () => {
    const a = await admin();
    const before = await a.get("/api/company-settings/branding");
    expect(before.body).toEqual({ companyName: "TicketFlow", logoUrl: null, primaryColor: "#3b82f6" });

    const res = await a.patch("/api/company-settings/branding").send({ companyName: "  Acme Support  ", primaryColor: "#ff0000" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ companyName: "Acme Support", primaryColor: "#ff0000" });

    for (const role of ["admin", "manager", "agent", "customer"] as const) {
      const reader = await loginAs(ctx.app, await createUser({ role }));
      const seen = await reader.get("/api/company-settings/branding");
      expect([role, seen.status, seen.body.companyName, seen.body.primaryColor]).toEqual([role, 200, "Acme Support", "#ff0000"]);
    }
  });

  it("a partial update keeps what it does not name", async () => {
    const a = await admin();
    await a.patch("/api/company-settings/branding").send({ companyName: "Acme", primaryColor: "#00ff00" }).expect(200);
    await a.patch("/api/company-settings/branding").send({ companyName: "Acme Two" }).expect(200);
    const seen = await a.get("/api/company-settings/branding");
    expect(seen.body).toMatchObject({ companyName: "Acme Two", primaryColor: "#00ff00" });
  });

  it("a blank, non-string or over-long name and a malformed colour are 400 and change nothing (they were 500s or a blank header)", async () => {
    const a = await admin();
    await a.patch("/api/company-settings/branding").send({ companyName: "Acme" }).expect(200);
    for (const body of [
      { companyName: "" },
      { companyName: "   " },
      { companyName: 42 },
      { companyName: "x".repeat(256) },
      { primaryColor: "red" },
      { primaryColor: "#12345" },
      { primaryColor: "#1234567" },
      { primaryColor: 5 },
    ]) {
      const res = await a.patch("/api/company-settings/branding").send(body);
      expect([JSON.stringify(body).slice(0, 40), res.status]).toEqual([JSON.stringify(body).slice(0, 40), 400]);
    }
    const seen = await a.get("/api/company-settings/branding");
    expect(seen.body.companyName).toBe("Acme");
    expect(seen.body.primaryColor).toBe("#3b82f6");
  });

  it("only an admin may change branding or upload a logo (403); anonymous is 401", async () => {
    for (const role of ["manager", "agent", "customer"] as const) {
      const u = await loginAs(ctx.app, await createUser({ role }));
      expect([role, (await u.patch("/api/company-settings/branding").send({ companyName: "Hijacked" })).status]).toEqual([role, 403]);
      expect([role, (await u.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: PNG })).status]).toEqual([role, 403]);
    }
    expect((await request(ctx.app).patch("/api/company-settings/branding").send({ companyName: "x" })).status).toBe(401);
    expect((await request(ctx.app).get("/api/company-settings/branding")).status).toBe(401);
    expect((await (await admin()).get("/api/company-settings/branding")).body.companyName).toBe("TicketFlow");
  });

  describe("logo", () => {
    const SIGNED = "https://signed.test/logos/company-logo.png?X-Amz-Signature=abc";
    function fakeS3() {
      return {
        upload: jest.spyOn(s3Service, "uploadFile").mockResolvedValue(undefined as any),
        remove: jest.spyOn(s3Service, "deleteFile").mockResolvedValue(undefined as any),
        sign: jest.spyOn(s3Service, "getPresignedUrl").mockResolvedValue(SIGNED),
      };
    }

    it("an upload stores the file under logos/, keeps the key, and readers get a time-limited URL", async () => {
      const s3 = fakeS3();
      const a = await admin();
      const res = await a.post("/api/company-settings/branding/logo").send({ fileName: "logo.png", fileType: "image/png", fileData: PNG });
      expect(res.status).toBe(200);
      expect(s3.upload).toHaveBeenCalledTimes(1);
      const [key, body, type] = s3.upload.mock.calls[0];
      expect(key).toBe("logos/company-logo.png");
      expect(Buffer.from(body as Buffer).toString("base64")).toBe(PNG);
      expect(type).toBe("image/png");

      // The database holds the key, never a signed URL.
      expect((await db.select().from(companySettings))[0].logoUrl).toBe("logos/company-logo.png");

      const customer = await loginAs(ctx.app, await createUser({ role: "customer" }));
      const seen = await customer.get("/api/company-settings/branding");
      expect(seen.body.logoUrl).toBe(SIGNED);
      expect(s3.sign).toHaveBeenCalledWith("logos/company-logo.png", 86400);

      // Reading it again does not overwrite the stored key with the signed URL.
      await customer.get("/api/company-settings/branding").expect(200);
      expect((await db.select().from(companySettings))[0].logoUrl).toBe("logos/company-logo.png");
      expect((await storage.getCompanySettings())?.logoUrl).toBe("logos/company-logo.png");
      expect(s3.sign).toHaveBeenLastCalledWith("logos/company-logo.png", 86400);
    });

    it("replacing a logo deletes the old object; jpeg is stored as .jpg", async () => {
      const s3 = fakeS3();
      const a = await admin();
      await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: PNG }).expect(200);
      expect(s3.remove).not.toHaveBeenCalled();
      await a.post("/api/company-settings/branding/logo").send({ fileType: "image/jpeg", fileData: PNG }).expect(200);
      expect(s3.remove).toHaveBeenCalledWith("logos/company-logo.png");
      expect(s3.upload.mock.calls[1][0]).toBe("logos/company-logo.jpg");
      expect((await db.select().from(companySettings))[0].logoUrl).toBe("logos/company-logo.jpg");
    });

    it("uploading the same type again overwrites in place and never deletes the object it just wrote", async () => {
      const s3 = fakeS3();
      const a = await admin();
      await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: PNG }).expect(200);
      await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: PNG }).expect(200);
      expect(s3.upload).toHaveBeenCalledTimes(2);
      expect(s3.remove).not.toHaveBeenCalled();
    });

    it("refuses a missing file, a type that is not JPG/PNG, bad base64 and an oversize file; nothing is uploaded", async () => {
      const s3 = fakeS3();
      const a = await admin();
      expect((await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png" })).status).toBe(400);
      expect((await a.post("/api/company-settings/branding/logo").send({ fileType: "image/svg+xml", fileData: PNG })).status).toBe(400);
      expect((await a.post("/api/company-settings/branding/logo").send({ fileType: "text/html", fileData: PNG })).status).toBe(400);
      expect((await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: "***not base64***" })).status).toBe(400);

      await a.patch("/api/company-settings/preferences").send({ maxFileUploadSize: 1 }).expect(200);
      const big = Buffer.alloc(1.5 * 1024 * 1024, 1).toString("base64");
      const tooBig = await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: big });
      expect(tooBig.status).toBe(400);
      expect(s3.upload).not.toHaveBeenCalled();
      expect((await db.select().from(companySettings))[0]?.logoUrl ?? null).toBeNull();
    });

    it("when S3 fails the upload is 500 and the stored logo is unchanged", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const s3 = fakeS3();
      const a = await admin();
      await a.post("/api/company-settings/branding/logo").send({ fileType: "image/png", fileData: PNG }).expect(200);
      s3.upload.mockRejectedValueOnce(new Error("bucket gone"));
      const res = await a.post("/api/company-settings/branding/logo").send({ fileType: "image/jpeg", fileData: PNG });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain("bucket gone");
      expect((await db.select().from(companySettings))[0].logoUrl).toBe("logos/company-logo.png");
    });
  });
});
