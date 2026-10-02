import { jest } from "@jest/globals";
import { randomBytes } from "crypto";
import express from "express";
import { ssoConfiguration } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { setupMicrosoftAuth } from "../../services/auth/microsoftAuth";

const secret = () => `s3cr3t-${randomBytes(12).toString("hex")}`;

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) parts.push(call.map(String).join(" "));
  }
  return parts.join("\n");
}

describe("settings secrets are masked and never returned", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: Awaited<ReturnType<typeof loginAs>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs(ctx.app, await createUser({ role: "admin" }));
  });

  describe("SSO", () => {
    it("GET /api/sso/config returns hasClientSecret, never clientSecret", async () => {
      const empty = await admin.get("/api/sso/config");
      expect(empty.status).toBe(200);
      expect(empty.body.clientSecret).toBeUndefined();
      expect(empty.body.hasClientSecret).toBe(false);

      const S = secret();
      await storage.upsertSsoConfiguration({ clientId: "cid", clientSecret: S, tenantId: "tid" });
      const res = await admin.get("/api/sso/config");
      expect(res.status).toBe(200);
      expect(res.body.clientSecret).toBeUndefined();
      expect(res.body.hasClientSecret).toBe(true);
      expect(res.body.clientId).toBe("cid");
      expect(res.body.tenantId).toBe("tid");
      expect(JSON.stringify(res.body)).not.toContain(S);

      // The row, not the response, is where the secret lives, and the status route still sees it.
      expect((await admin.get("/api/sso/status")).body).toEqual({ configured: true });
    });

    it("is admin only", async () => {
      for (const role of ["customer", "agent", "manager"] as const) {
        const a = await loginAs(ctx.app, await createUser({ role }));
        expect((await a.get("/api/sso/config")).status).toBe(403);
        expect((await a.post("/api/sso/config").send({ clientId: "x" })).status).toBe(403);
      }
    });

    it("an absent or empty clientSecret keeps the stored one; a non-empty one replaces it", async () => {
      const first = secret();
      const saved = await admin
        .post("/api/sso/config")
        .send({ clientId: "cid", clientSecret: first, tenantId: "tid" });
      expect(saved.status).toBe(200);
      expect(saved.body.clientSecret).toBeUndefined();
      expect(saved.body.hasClientSecret).toBe(true);
      expect(JSON.stringify(saved.body)).not.toContain(first);

      for (const body of [
        { clientId: "cid2", tenantId: "tid" },
        { clientId: "cid2", clientSecret: "", tenantId: "tid" },
        { clientId: "cid2", clientSecret: "   ", tenantId: "tid" },
        { clientId: "cid2", clientSecret: null, tenantId: "tid" },
      ]) {
        const res = await admin.post("/api/sso/config").send(body);
        expect(res.status).toBe(200);
        expect(res.body.hasClientSecret).toBe(true);
        const [row] = await db.select().from(ssoConfiguration);
        expect(row.clientSecret).toBe(first);
        expect(row.clientId).toBe("cid2");
      }

      const second = secret();
      const replaced = await admin
        .post("/api/sso/config")
        .send({ clientId: "cid2", clientSecret: second, tenantId: "tid" });
      expect(replaced.body.clientSecret).toBeUndefined();
      const rows = await db.select().from(ssoConfiguration);
      expect(rows).toHaveLength(1);
      expect(rows[0].clientSecret).toBe(second);
    });

    it("saving with no secret ever stored reports hasClientSecret false", async () => {
      const res = await admin.post("/api/sso/config").send({ clientId: "cid", tenantId: "tid" });
      expect(res.status).toBe(200);
      expect(res.body.hasClientSecret).toBe(false);
      expect((await admin.get("/api/sso/status")).body).toEqual({ configured: false });
    });

    it("ignores columns the caller may not set and rejects wrong types", async () => {
      const res = await admin.post("/api/sso/config").send({ id: 999, updatedBy: "someone-else", clientId: "cid", tenantId: "tid" });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(ssoConfiguration);
      expect(row.id).not.toBe(999);
      expect(row.updatedBy).not.toBe("someone-else");
      const bad = await admin.post("/api/sso/config").send({ clientId: { $ne: 1 } });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("validation_failed");
    });

    it("startup survives an unreachable database: one log line, no secret, SSO stays off", async () => {
      const spy = jest
        .spyOn(storage, "getSsoConfiguration")
        .mockRejectedValue(new Error("connect ECONNREFUSED password=hunter2"));
      try {
        const app = express();
        app.set("microsoftAuthConfigured", true); // skip the session middleware
        const before = process.env.MICROSOFT_CLIENT_ID;
        delete process.env.MICROSOFT_CLIENT_ID;
        const linesBefore = loggedText().split("\n").length;
        await expect(setupMicrosoftAuth(app)).resolves.toBeUndefined();
        if (before !== undefined) process.env.MICROSOFT_CLIENT_ID = before;
        const added = loggedText().split("\n").slice(linesBefore).join("\n");
        expect(added).toMatch(/SSO/);
        expect(added).not.toContain("hunter2");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("email provider", () => {
    const base = { fromEmail: "from@example.test", fromName: "TicketFlow" };

    it("AWS SES: the secret key is never returned and a blank one keeps the stored key", async () => {
      const S = secret();
      const first = await admin.post("/api/company-settings/email").send({
        ...base,
        provider: "aws-ses",
        awsAccessKeyId: "AKIATESTKEY",
        awsSecretAccessKey: S,
        awsRegion: "us-east-1",
      });
      expect(first.status).toBe(200);
      expect(JSON.stringify(first.body)).not.toContain(S);

      const read = await admin.get("/api/company-settings/email");
      expect(read.body.hasAwsSecret).toBe(true);
      expect(read.body.awsSecretAccessKey).toBeUndefined();
      expect(JSON.stringify(read.body)).not.toContain(S);

      const again = await admin.post("/api/company-settings/email").send({
        ...base,
        provider: "aws-ses",
        awsAccessKeyId: "AKIATESTKEY2",
        awsSecretAccessKey: "",
        awsRegion: "eu-west-1",
      });
      expect(again.status).toBe(200);
      const active = await storage.getActiveEmailProvider();
      expect((active as any).metadata.awsSecretAccessKey).toBe(S);
      expect((active as any).metadata.awsAccessKeyId).toBe("AKIATESTKEY2");

      const S2 = secret();
      await admin.post("/api/company-settings/email").send({
        ...base,
        provider: "aws-ses",
        awsAccessKeyId: "AKIATESTKEY2",
        awsSecretAccessKey: S2,
      });
      expect(((await storage.getActiveEmailProvider()) as any).metadata.awsSecretAccessKey).toBe(S2);
    });

    it("Mailtrap: the token is never returned and a blank one keeps the stored token", async () => {
      const T = secret();
      await admin.post("/api/company-settings/email").send({ ...base, provider: "mailtrap", token: T });
      const read = await admin.get("/api/company-settings/email");
      expect(read.body.mailtrapHasToken).toBe(true);
      expect(read.body.mtToken).toBeUndefined();
      expect(JSON.stringify(read.body)).not.toContain(T);

      await admin.post("/api/company-settings/email").send({ ...base, provider: "mailtrap", fromName: "Renamed" });
      const active: any = await storage.getActiveEmailProvider();
      expect(active.fromName).toBe("Renamed");
      expect(active.metadata.mailtrapToken).toBe(T);
    });

    it("SMTP: the password is never returned and a blank one keeps the stored password", async () => {
      const P = secret();
      const smtp = { ...base, provider: "smtp", host: "smtp.example.test", port: 587, username: "u", encryption: "tls" };
      await admin.post("/api/company-settings/email").send({ ...smtp, password: P });
      const read = await admin.get("/api/company-settings/email");
      expect(JSON.stringify(read.body)).not.toContain(P);
      expect(read.body.hasSmtpPassword).toBe(true);
      await admin.post("/api/company-settings/email").send({ ...smtp, host: "smtp2.example.test" });
      const active: any = await storage.getActiveEmailProvider();
      expect(active.metadata.host).toBe("smtp2.example.test");
      expect(active.metadata.password).toBe(P);
    });

    it("a secret from another provider is not carried across a provider switch", async () => {
      const T = secret();
      await admin.post("/api/company-settings/email").send({ ...base, provider: "mailtrap", token: T });
      await admin.post("/api/company-settings/email").send({
        ...base,
        provider: "aws-ses",
        awsAccessKeyId: "AKIATESTKEY",
      });
      const active: any = await storage.getActiveEmailProvider();
      expect(JSON.stringify(active.metadata)).not.toContain(T);
    });
  });

  describe("Bedrock", () => {
    it("never returns the secret and a blank one keeps the stored secret", async () => {
      const S = secret();
      const first = await admin
        .post("/api/bedrock/settings")
        .send({ bedrockAccessKeyId: "AKIABEDROCK", bedrockSecretAccessKey: S, bedrockRegion: "us-east-1" });
      expect(first.status).toBe(200);
      expect(first.body.hasBedrockSecret).toBe(true);
      expect(JSON.stringify(first.body)).not.toContain(S);
      const read = await admin.get("/api/bedrock/settings");
      expect(read.body.hasBedrockSecret).toBe(true);
      expect(JSON.stringify(read.body)).not.toContain(S);
      await admin.post("/api/bedrock/settings").send({ bedrockSecretAccessKey: "", bedrockRegion: "eu-west-1" });
      expect((await storage.getBedrockSettings())?.bedrockSecretAccessKey).toBe(S);
    });
  });
});
