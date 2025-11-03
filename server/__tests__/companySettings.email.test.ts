import request from "supertest";
import express from "express";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Bypass auth in tests
jest.mock("../auth", () => ({
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
jest.mock("../ses", () => ({
  sendTestEmail: jest.fn().mockResolvedValue(true),
}));

import { registerCompanySettingsRoutes } from "../admin/companySettings";
import { storage } from "../storage";
import { EMAIL_PROVIDERS } from "../../shared/constants";

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
      (storage.getActiveEmailProvider as jest.Mock).mockResolvedValue(
        undefined
      );
      const res = await request(app).get("/api/company-settings/email");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("returns active provider summary when configured", async () => {
      (storage.getActiveEmailProvider as jest.Mock).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        metadata: { awsAccessKeyId: "AKIA...", awsRegion: "us-east-1" },
      } as any);
      const res = await request(app).get("/api/company-settings/email");
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe(EMAIL_PROVIDERS.AWS);
      expect(res.body.fromEmail).toBe("no-reply@example.com");
      expect(res.body.awsRegion).toBe("us-east-1");
    });
  });

  describe("POST /api/company-settings/email", () => {
    it("validates payload and saves AWS provider", async () => {
      (storage.upsertEmailProvider as jest.Mock).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        isActive: true,
      } as any);

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
      const call = (storage.upsertEmailProvider as unknown as jest.Mock).mock
        .calls[0][0] as any;
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
  });

  describe("POST /api/company-settings/email/test", () => {
    it("succeeds for AWS adapter", async () => {
      (storage.getActiveEmailProvider as jest.Mock).mockResolvedValue({
        provider: EMAIL_PROVIDERS.AWS,
        fromEmail: "no-reply@example.com",
        fromName: "TicketFlow",
        metadata: {
          awsAccessKeyId: "key",
          awsSecretAccessKey: "secret",
          awsRegion: "us-east-1",
        },
      } as any);

      const res = await request(app)
        .post("/api/company-settings/email/test")
        .send({ testEmail: "user@example.com" });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("successfully");
    });

    it("returns 400 when not configured", async () => {
      (storage.getActiveEmailProvider as jest.Mock).mockResolvedValue(
        undefined
      );
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
