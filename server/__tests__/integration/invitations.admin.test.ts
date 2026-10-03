import { jest } from "@jest/globals";
import request from "supertest";
import { emailProviders, emailTemplates } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

const mockSent: Array<{ to: string; variables: Record<string, string> }> = [];
jest.mock("../../services/mailtrap", () => ({
  sendEmailWithTemplate: async (opts: any) => {
    mockSent.push({ to: opts.to, variables: opts.variables });
    return true;
  },
}));

/** E3 (resend) and G7 (the admin invitation list and its statuses), with the email adapter faked. */
describe("admin invitations: resend (E3) and the list (G7)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const savedBase = process.env.APP_BASE_URL;
  beforeAll(async () => {
    process.env.APP_BASE_URL = "https://tickets.example.test";
    ctx = await createTestApp();
  });
  afterAll(async () => {
    if (savedBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedBase;
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    mockSent.length = 0;
    await db.insert(emailTemplates).values({ name: "user_invitation", subject: "Invite", body: "{{registrationUrl}}" });
    await db.insert(emailProviders).values({ provider: "mailtrap", fromEmail: "no-reply@example.test" });
  });

  async function invitation(
    email: string,
    opts: { status?: "pending" | "accepted" | "cancelled"; expiresAt?: Date } = {}
  ) {
    const admin = await createUser({ role: "admin" });
    const inv = await storage.createUserInvitation({
      email,
      role: "agent",
      invitedBy: admin.id,
      status: "pending",
      expiresAt: (opts.expiresAt ?? new Date(Date.now() + 86_400_000)) as any,
    } as any);
    if (opts.status === "accepted") await storage.markInvitationAccepted(inv.id);
    if (opts.status === "cancelled") await storage.cancelUserInvitation(inv.id);
    return inv;
  }
  const adminAgent = async () => loginAs(ctx.app, await createUser({ role: "admin" }));

  describe("E3: POST /api/admin/invitations/:id/resend", () => {
    it("re-sends a pending invitation: the invitee gets the registration link carrying the stored token", async () => {
      const inv = await invitation("pending@example.test");
      const a = await adminAgent();
      const res = await a.post(`/api/admin/invitations/${inv.id}/resend`);
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/resent/i);
      expect(mockSent).toHaveLength(1);
      expect(mockSent[0].to).toBe("pending@example.test");
      const link = new URL(mockSent[0].variables.registrationUrl);
      expect(link.origin).toBe("https://tickets.example.test");
      expect(link.searchParams.get("token")).toBe(inv.invitationToken);
      expect(link.searchParams.get("email")).toBe("pending@example.test");

      // Each resend is one more mail; the invitation itself is unchanged.
      expect((await a.post(`/api/admin/invitations/${inv.id}/resend`)).status).toBe(200);
      expect(mockSent).toHaveLength(2);
      expect((await storage.getUserInvitationById(inv.id))?.status).toBe("pending");
    });

    it("refuses an accepted and a cancelled invitation (400) and sends nothing; an unknown id is 404", async () => {
      const accepted = await invitation("accepted@example.test", { status: "accepted" });
      const cancelled = await invitation("cancelled@example.test", { status: "cancelled" });
      const a = await adminAgent();

      const acc = await a.post(`/api/admin/invitations/${accepted.id}/resend`);
      expect(acc.status).toBe(400);
      expect(acc.body.error).toBe("validation_failed");
      const can = await a.post(`/api/admin/invitations/${cancelled.id}/resend`);
      expect(can.status).toBe(400);
      expect(can.body.error).toBe("validation_failed");
      expect(mockSent).toHaveLength(0);

      const missing = await a.post("/api/admin/invitations/999999/resend");
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("not_found");
    });

    it("is admin only: 403 for manager, agent and customer, 401 anonymous, and nothing is sent", async () => {
      const inv = await invitation("pending@example.test");
      for (const role of ["manager", "agent", "customer"] as const) {
        const a = await loginAs(ctx.app, await createUser({ role }));
        expect([role, (await a.post(`/api/admin/invitations/${inv.id}/resend`)).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).post(`/api/admin/invitations/${inv.id}/resend`)).status).toBe(401);
      expect(mockSent).toHaveLength(0);
    });
  });

  describe("G7: GET /api/admin/invitations", () => {
    it("lists pending, accepted, cancelled and expired invitations with the right status, and never a token", async () => {
      const now = Date.now();
      await invitation("pending@example.test");
      await invitation("accepted@example.test", { status: "accepted" });
      await invitation("cancelled@example.test", { status: "cancelled" });
      await invitation("expired@example.test", { expiresAt: new Date(now - 3_600_000) });
      const a = await adminAgent();

      const res = await a.get("/api/admin/invitations");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      const by = Object.fromEntries((res.body as any[]).map((i) => [i.email, i]));
      expect(by["pending@example.test"].status).toBe("pending");
      expect(new Date(by["pending@example.test"].expiresAt).getTime()).toBeGreaterThan(now);
      expect(by["accepted@example.test"].status).toBe("accepted");
      expect(by["accepted@example.test"].acceptedAt).toBeTruthy();
      expect(by["cancelled@example.test"].status).toBe("cancelled");
      expect(by["cancelled@example.test"].acceptedAt).toBeNull();
      // Expired is a pending row whose expiresAt has passed: the status stays "pending" and the
      // client derives "expired" from expiresAt (invitations.tsx). Both facts are in the row.
      expect(by["expired@example.test"].status).toBe("pending");
      expect(new Date(by["expired@example.test"].expiresAt).getTime()).toBeLessThan(now);
      for (const inv of res.body) {
        expect(inv.invitationToken).toBeUndefined();
        expect(JSON.stringify(inv)).not.toMatch(/token/i);
      }
    });

    it("?status= filters the list; only an admin may read it", async () => {
      await invitation("pending@example.test");
      await invitation("cancelled@example.test", { status: "cancelled" });
      const a = await adminAgent();
      const only = await a.get("/api/admin/invitations").query({ status: "cancelled" });
      expect((only.body as any[]).map((i) => i.email)).toEqual(["cancelled@example.test"]);

      for (const role of ["manager", "agent", "customer"] as const) {
        const other = await loginAs(ctx.app, await createUser({ role }));
        expect([role, (await other.get("/api/admin/invitations")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/admin/invitations")).status).toBe(401);
    });
  });
});
