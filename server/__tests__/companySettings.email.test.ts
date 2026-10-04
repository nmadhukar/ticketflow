import request from "supertest";
import express from "express";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Bypass auth in tests
jest.mock("../services/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

// Force admin access in tests
jest.mock("../middleware/admin.middleware", () => ({
  isAdmin: (_req: any, _res: any, next: any) => next(),
  getUserId: (_req: any) => "admin-user-id",
}));

// Mock storage methods used by the routes
jest.mock("../storage", () => ({
  storage: {
    getActiveEmailProvider: jest.fn(),
    upsertEmailProvider: jest.fn(),
  },
}));

// Mock SES send for adapter path
jest.mock("../services/ses", () => ({
  sendTestEmail: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
}));

import { registerCompanySettingsRoutes } from "../admin/companySettings";
import { storage } from "../storage";
import { EMAIL_PROVIDERS } from "../../shared/constants";

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
// The one place a mocked storage method is cast; `unknown` first because the
// real signatures do not overlap with the loose mock type.
const asMock = (fn: unknown): AsyncMock => fn as AsyncMock;

describe("Company Settings - Email Endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    registerCompanySettingsRoutes(app);
    jest.clearAllMocks();
  });

  describe("GET /api/company-settings/email", () => {
    it("returns empty object when no active provider", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue(undefined);
      const res = await request(app).get("/api/company-settings/email");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("returns active provider summary when configured", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        metadata: { awsAccessKeyId: "AKIA...", awsRegion: "us-east-1" },
      });
      const res = await request(app).get("/api/company-settings/email");
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe(EMAIL_PROVIDERS.AWS);
      expect(res.body.fromEmail).toBe("no-reply@example.com");
      expect(res.body.awsRegion).toBe("us-east-1");
    });
  });

  describe("POST /api/company-settings/email", () => {
    it("validates payload and saves AWS provider", async () => {
      asMock(storage.upsertEmailProvider).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        isActive: true,
      });

      const res = await request(app).post("/api/company-settings/email").send({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        awsAccessKeyId: "key",
        awsSecretAccessKey: "secret",
        awsRegion: "us-east-1",
      });

      expect(res.status).toBe(200);
      expect(storage.upsertEmailProvider).toHaveBeenCalled();
      const call = asMock(storage.upsertEmailProvider).mock.calls[0][0] as {
        provider: string;
        fromEmail: string;
        metadata: { awsAccessKeyId: string; awsRegion: string };
      };
      expect(call.provider).toBe(EMAIL_PROVIDERS.AWS);
      expect(call.fromEmail).toBe("no-reply@example.com");
      expect(call.metadata.awsAccessKeyId).toBe("key");
      expect(call.metadata.awsRegion).toBe("us-east-1");
    });

    it("rejects invalid payload", async () => {
      const res = await request(app)
        .post("/api/company-settings/email")
        .send({ provider: EMAIL_PROVIDERS.AWS });
      expect(res.status).toBe(400);
    });

    // R58: these four have no adapter, so they cannot be selected. Nothing is stored.
    const UNSUPPORTED_BODIES: Array<[string, Record<string, unknown>]> = [
      [EMAIL_PROVIDERS.SMTP, { host: "smtp.example.com", port: 587, username: "u", password: "p", encryption: "tls" }],
      [EMAIL_PROVIDERS.MAILGUN, { domain: "mg.example.com", apiKey: "k", region: "us" }],
      [EMAIL_PROVIDERS.SENDGRID, { apiKey: "k" }],
      [EMAIL_PROVIDERS.CUSTOM, { config: { a: 1 } }],
    ];
    it.each(UNSUPPORTED_BODIES)("%s is refused 400 provider_not_supported and stores nothing", async (provider, rest) => {
      const res = await request(app)
        .post("/api/company-settings/email")
        .send({ provider, fromEmail: "no-reply@example.com", fromName: "TicketFlow", ...rest });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("provider_not_supported");
      expect(typeof res.body.message).toBe("string");
      expect(res.body.details.fieldErrors.provider).toHaveLength(1);
      expect(storage.upsertEmailProvider).not.toHaveBeenCalled();
    });
    it.each(UNSUPPORTED_BODIES)("%s is refused even when the rest of the payload is incomplete", async (provider) => {
      const res = await request(app).post("/api/company-settings/email").send({ provider });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("provider_not_supported");
      expect(storage.upsertEmailProvider).not.toHaveBeenCalled();
    });

    it("Mailtrap still saves", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue(undefined);
      asMock(storage.upsertEmailProvider).mockResolvedValue({
        provider: EMAIL_PROVIDERS.MAILTRAP,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        isActive: true,
      });
      const res = await request(app).post("/api/company-settings/email").send({
        provider: EMAIL_PROVIDERS.MAILTRAP,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        token: "mt-token",
      });
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe(EMAIL_PROVIDERS.MAILTRAP);
      expect(storage.upsertEmailProvider).toHaveBeenCalledTimes(1);
    });

    it("an existing stored SMTP row still reads back", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue({
        provider: EMAIL_PROVIDERS.SMTP,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        metadata: { host: "smtp.example.com", password: "stored" },
      });
      const res = await request(app).get("/api/company-settings/email");
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe(EMAIL_PROVIDERS.SMTP);
      expect(res.body.hasSmtpPassword).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain("stored");
    });
  });

  describe("POST /api/company-settings/email/test", () => {
    it("succeeds for AWS adapter", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        metadata: {
          awsAccessKeyId: "key",
          awsSecretAccessKey: "secret",
          awsRegion: "us-east-1",
        },
      });

      const res = await request(app)
        .post("/api/company-settings/email/test")
        .send({ testEmail: "user@example.com" });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("successfully");
    });

    it("returns 400 when not configured", async () => {
      asMock(storage.getActiveEmailProvider).mockResolvedValue(undefined);
      const res = await request(app)
        .post("/api/company-settings/email/test")
        .send({ testEmail: "user@example.com" });
      expect(res.status).toBe(400);
    });

    it("validates test payload", async () => {
      const res = await request(app)
        .post("/api/company-settings/email/test")
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
