import request from "supertest";
import { sql } from "drizzle-orm";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { departments, emailProviders, emailTemplates } from "@shared/schema";

// Capture what Mailtrap would send, so the test reads the real rendered email.
jest.mock("mailtrap", () => {
  const sent: any[] = [];
  return {
    __sent: sent,
    MailtrapClient: class {
      async send(message: any) {
        sent.push(message);
        return { success: true };
      }
    },
  };
});
const sentEmails = (jest.requireMock("mailtrap") as { __sent: Array<{ subject: string; html: string }> }).__sent;

/**
 * R43: the invitation "department" does nothing (users have no department link).
 * It is stripped from the create body, absent from every response and from the
 * email; a stored template's {{department}} renders empty, never literally.
 */
describe("invitations: no department (R43)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let deptId: number;
  const DEPT_NAME = "Quarterly Widgets Department";

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    sentEmails.length = 0;
    const [dept] = await db.insert(departments).values({ name: DEPT_NAME }).returning();
    deptId = dept.id;
    await db.insert(emailProviders).values({
      provider: "mailtrap",
      fromEmail: "from@example.test",
      fromName: "TF",
      metadata: { mailtrapToken: "test-token" },
      isActive: true,
    });
    await db.insert(emailTemplates).values({
      name: "user_invitation",
      subject: "Invited as {{role}}",
      body: "<p>Role: {{role}}</p><p>Department: [{{department}}]</p><a href=\"{{registrationUrl}}\">go</a>",
    });
  });

  const storedDepartmentId = async (id: number) => {
    const r = await db.execute(sql`SELECT department_id, department FROM user_invitations WHERE id = ${id}`);
    return (r.rows[0] as { department_id: number | null; department: string | null });
  };

  it("a create carrying departmentId is 201, stores NULL, answers without it, and the email names no department", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent.post("/api/admin/invitations").send({
      email: "dept@example.test",
      role: "agent",
      departmentId: deptId,
      department: "Free text department",
    });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("departmentId");
    expect(res.body).not.toHaveProperty("department");
    const row = await storedDepartmentId(res.body.id);
    expect(row.department_id).toBeNull();
    expect(row.department).toBeNull();

    expect(sentEmails).toHaveLength(1);
    const html = sentEmails[0].html;
    expect(html).toContain("Department: []");
    expect(html).not.toContain(DEPT_NAME);
    expect(html).not.toContain("Free text department");
    expect(html).not.toContain("Not assigned");
    expect(html).not.toContain("{{");
  });

  it("the admin list and the public token lookup carry no department", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const created = await agent
      .post("/api/admin/invitations")
      .send({ email: "lookup@example.test", role: "agent", departmentId: deptId });
    expect(created.status).toBe(201);
    const listed = await agent.get("/api/admin/invitations");
    expect(listed.status).toBe(200);
    for (const inv of listed.body) {
      expect(inv).not.toHaveProperty("departmentId");
      expect(inv).not.toHaveProperty("department");
    }
    const stored = await storage.getUserInvitationById(created.body.id);
    const lookup = await request(ctx.app).get(`/api/invitations/${stored!.invitationToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ email: "lookup@example.test", role: "agent" });
  });

  it("a resend of a legacy invitation that still has a department id never loads it", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const legacy = await storage.createUserInvitation({
      email: "legacy@example.test",
      role: "agent",
      invitedBy: admin.id,
      status: "pending",
      departmentId: deptId,
      expiresAt: new Date(Date.now() + 86400000),
    } as never);
    const res = await agent.post(`/api/admin/invitations/${legacy.id}/resend`);
    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].html).toContain("Department: []");
    expect(sentEmails[0].html).not.toContain(DEPT_NAME);
    expect(sentEmails[0].html).not.toContain("{{");
  });
});
