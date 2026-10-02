import { randomUUID } from "crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { knowledgeArticles, ticketAutoResponses, users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { AI_SYSTEM_USER_ID, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { seedSystemUser } from "../../seed/seedUsers";

/**
 * Task 17: the remaining contract items (K2, I4, T18, T5, T6, T8, T9, A7, A9),
 * the customer view of staff (R19) and the hidden system accounts.
 */
describe("remaining API contract items", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  type Agent = ReturnType<typeof request.agent>;
  async function as(role: "admin" | "manager" | "agent" | "customer") {
    const u = await createUser({ role });
    return { u, a: (await loginAs(ctx.app, u)) as Agent };
  }

  describe("K2 publish toggle", () => {
    async function seed(createdBy: string, over: Partial<typeof knowledgeArticles.$inferInsert> = {}) {
      const [row] = await db
        .insert(knowledgeArticles)
        .values({ title: "Reset password guide", content: "Steps to reset", createdBy, ...over })
        .returning();
      return row;
    }
    const reload = async (id: number) =>
      (await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id)))[0];

    it("PATCH publish with no body flips isPublished both ways", async () => {
      const { u, a } = await as("admin");
      const row = await seed(u.id, { isPublished: false, status: "draft" });

      const first = await a.patch(`/api/admin/knowledge/${row.id}/publish`);
      expect(first.status).toBe(200);
      expect((await reload(row.id)).isPublished).toBe(true);
      expect((await reload(row.id)).status).toBe("published");

      const second = await a.patch(`/api/admin/knowledge/${row.id}/publish`);
      expect(second.status).toBe(200);
      expect((await reload(row.id)).isPublished).toBe(false);
      expect((await reload(row.id)).status).toBe("draft");
    });

    it("an explicit boolean still wins; a non-boolean is 400; unknown id is 404", async () => {
      const { u, a } = await as("admin");
      const row = await seed(u.id, { isPublished: true, status: "published" });
      await a.patch(`/api/admin/knowledge/${row.id}/publish`).send({ isPublished: true }).expect(200);
      expect((await reload(row.id)).isPublished).toBe(true);
      const bad = await a.patch(`/api/admin/knowledge/${row.id}/publish`).send({ isPublished: "yes" });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("validation_failed");
      const missing = await a.patch(`/api/admin/knowledge/999999/publish`);
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("not_found");
    });

    it("a non-admin cannot publish", async () => {
      const { u } = await as("admin");
      const row = await seed(u.id);
      const { a } = await as("agent");
      const res = await a.patch(`/api/admin/knowledge/${row.id}/publish`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden");
    });

    it("GET /api/knowledge/search never returns unpublished articles", async () => {
      const { u } = await as("admin");
      await seed(u.id, { title: "Public guide", isPublished: true, status: "published" });
      await seed(u.id, { title: "Secret draft guide", isPublished: false, status: "draft" });
      const { a: customer } = await as("customer");
      const res = await customer.get("/api/knowledge/search?query=guide");
      expect(res.status).toBe(200);
      const titles = (res.body as Array<{ title: string }>).map((r) => r.title);
      expect(titles).toContain("Public guide");
      expect(titles).not.toContain("Secret draft guide");
    });
  });

  describe("I4 AI feedback", () => {
    it("auto-response feedback on a ticket with no auto-response is 404 not_found", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a);
      expect(t.status).toBe(201);
      const res = await a.post(`/api/tasks/${t.body.id}/auto-response/feedback`).send({ wasHelpful: true });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    });

    it("auto-response feedback needs a boolean wasHelpful", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a);
      const res = await a.post(`/api/tasks/${t.body.id}/auto-response/feedback`).send({ wasHelpful: "maybe" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_failed");
    });

    it("auto-response feedback is recorded when an auto-response exists", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a);
      const [ar] = await db
        .insert(ticketAutoResponses)
        .values({ ticketId: t.body.id, aiResponse: "Try this", confidenceScore: "0.80" })
        .returning();
      const res = await a.post(`/api/tasks/${t.body.id}/auto-response/feedback`).send({ wasHelpful: true });
      expect(res.status).toBe(200);
      const [after] = await db.select().from(ticketAutoResponses).where(eq(ticketAutoResponses.id, ar.id));
      expect(after.wasHelpful).toBe(true);
    });

    it("POST /api/ai-feedback then GET /api/ai-feedback/:type/:referenceId returns the stored rating", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a);
      const [ar] = await db
        .insert(ticketAutoResponses)
        .values({ ticketId: t.body.id, aiResponse: "Try this", confidenceScore: "0.80" })
        .returning();
      const post = await a
        .post("/api/ai-feedback")
        .send({ feedbackType: "auto_response", referenceId: ar.id, rating: 5, comment: "great" });
      expect(post.status).toBe(200);
      const get = await a.get(`/api/ai-feedback/auto_response/${ar.id}`);
      expect(get.status).toBe(200);
      expect(get.body).toHaveLength(1);
      expect(get.body[0].rating).toBe(5);
      expect(get.body[0].comment).toBe("great");
    });

    it("an invalid rating is 400 validation_failed", async () => {
      const { a } = await as("admin");
      const res = await a.post("/api/ai-feedback").send({ feedbackType: "knowledge_article", referenceId: 1, rating: 3 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_failed");
    });
  });

  describe("T18 ticket fields", () => {
    it("dueDate:null clears the date; tags round-trip", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a, { dueDate: "2031-05-05T00:00:00.000Z", tags: ["x", "y"] });
      expect(t.status).toBe(201);
      expect((await a.get(`/api/tasks/${t.body.id}`)).body.dueDate).toBeTruthy();

      const cleared = await a.patch(`/api/tasks/${t.body.id}`).send({ dueDate: null });
      expect(cleared.status).toBe(200);
      const read = await a.get(`/api/tasks/${t.body.id}`);
      expect(read.body.dueDate).toBeNull();
      expect(read.body.tags).toEqual(["x", "y"]);

      await a.patch(`/api/tasks/${t.body.id}`).send({ tags: ["z"] }).expect(200);
      expect((await a.get(`/api/tasks/${t.body.id}`)).body.tags).toEqual(["z"]);
    });

    it("Ruling: a customer sending hours gets 403 on PATCH and 400 on create", async () => {
      const { a } = await as("customer");
      const created = await createTicketAs(a);
      expect(created.status).toBe(201);
      for (const f of ["estimatedHours", "actualHours"]) {
        const patch = await a.patch(`/api/tasks/${created.body.id}`).send({ [f]: 4 });
        expect(patch.status).toBe(403);
        expect(patch.body.error).toBe("forbidden");
        const create = await createTicketAs(a, { [f]: 4 });
        expect(create.status).toBe(400);
      }
    });
  });

  describe("T5 T6 T8 T9 ticket lists", () => {
    it("every list row carries number, title, status, priority and assignee", async () => {
      const { u, a } = await as("agent");
      await createTicketAs(a, { assigneeId: u.id });
      const rows = (await a.get("/api/tasks")).body as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      for (const k of ["ticketNumber", "title", "status", "priority", "assigneeId", "assigneeName"]) {
        expect(rows[0]).toHaveProperty(k);
      }
      expect(rows[0].assigneeId).toBe(u.id);
      expect(String(rows[0].assigneeName)).not.toBe("");
    });

    it("filters by status, category and assigneeId return only matching visible tickets", async () => {
      const { u, a } = await as("admin");
      const other = await createUser({ role: "agent" });
      const t1 = await createTicketAs(a, { title: "one", category: "support", assigneeId: u.id });
      const t2 = await createTicketAs(a, { title: "two", category: "bug", assigneeId: other.id });
      await a.patch(`/api/tasks/${t2.body.id}`).send({ status: "in_progress" }).expect(200);

      const ids = async (qs: string) =>
        ((await a.get(`/api/tasks${qs}`)).body as Array<{ id: number }>).map((r) => r.id).sort();
      expect(await ids("?status=open")).toEqual([t1.body.id]);
      expect(await ids("?status=in_progress")).toEqual([t2.body.id]);
      expect(await ids("?category=bug")).toEqual([t2.body.id]);
      expect(await ids(`?assigneeId=${other.id}`)).toEqual([t2.body.id]);
      expect(await ids("?priority=medium")).toEqual([t1.body.id, t2.body.id].sort());
      expect(await ids("?priority=urgent")).toEqual([]);
    });

    it("a filter never widens visibility", async () => {
      const { a: admin } = await as("admin");
      await createTicketAs(admin, { title: "admins" });
      const { a: customer } = await as("customer");
      const mine = await createTicketAs(customer, { title: "mine" });
      const res = await customer.get("/api/tasks?status=open");
      expect((res.body as Array<{ id: number }>).map((r) => r.id)).toEqual([mine.body.id]);
    });

    it("invalid status, priority, category, limit or offset is 400, never zero rows", async () => {
      const { a } = await as("admin");
      await createTicketAs(a);
      for (const qs of [
        "status=bogus",
        "priority=critical",
        "category=nope",
        "limit=abc",
        "limit=0",
        "limit=501",
        "offset=-1",
        "offset=x",
        "teamId=abc",
        "departmentId=-2",
      ]) {
        const res = await a.get(`/api/tasks?${qs}`);
        expect([qs, res.status]).toEqual([qs, 400]);
        expect(res.body.error).toBe("validation_failed");
      }
      expect((await a.get("/api/tasks/my?status=bogus")).status).toBe(400);
    });

    it("limit and offset page without overlap", async () => {
      const { a } = await as("admin");
      const made: number[] = [];
      for (let i = 0; i < 5; i++) made.push((await createTicketAs(a, { title: `t${i}` })).body.id);
      const page = async (offset: number) =>
        ((await a.get(`/api/tasks?limit=2&offset=${offset}`)).body as Array<{ id: number }>).map((r) => r.id);
      const p1 = await page(0);
      const p2 = await page(2);
      const p3 = await page(4);
      expect(p1).toHaveLength(2);
      expect(p2).toHaveLength(2);
      expect(p3).toHaveLength(1);
      const all = [...p1, ...p2, ...p3];
      expect(new Set(all).size).toBe(5);
      expect(all.sort()).toEqual(made.sort());
    });

    it("GET /api/tasks/my returns only tickets assigned to the caller", async () => {
      const { u, a } = await as("agent");
      const other = await createUser({ role: "agent" });
      const team = await createTeam(u);
      await storage.addTeamMember({ teamId: team.id, userId: u.id, role: "member" });
      const mine = await createTicketAs(a, { assigneeId: u.id });
      await createTicketAs(a, { title: "created by me, assigned elsewhere" }); // unassigned
      const queued = await createTicketAs(a, { assigneeTeamId: team.id, title: "queued to my team" });
      expect(queued.status).toBe(201);
      void other;
      const res = await a.get("/api/tasks/my");
      expect(res.status).toBe(200);
      expect((res.body as Array<{ id: number }>).map((r) => r.id)).toEqual([mine.body.id]);
    });
  });

  describe("A7 role changes", () => {
    it("an admin changes a role and login returns it", async () => {
      const { a } = await as("admin");
      const target = await createUser({ role: "customer" });
      const res = await a.patch(`/api/admin/users/${target.id}`).send({ role: "manager" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("manager");
      const login = await request(ctx.app)
        .post("/api/auth/login")
        .send({ email: target.email, password: "Passw0rd!test" });
      expect(login.status).toBe(200);
      expect(login.body.role ?? login.body.user?.role).toBe("manager");
    });

    it("an unknown role is 400 and leaves the user alone", async () => {
      const { a } = await as("admin");
      const target = await createUser({ role: "agent" });
      const res = await a.patch(`/api/admin/users/${target.id}`).send({ role: "superuser" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_failed");
      expect((await storage.getUser(target.id))?.role).toBe("agent");
    });

    it("a non-admin cannot change roles; an unknown user is 404", async () => {
      const { a: agent } = await as("agent");
      const target = await createUser({ role: "customer" });
      const denied = await agent.patch(`/api/admin/users/${target.id}`).send({ role: "admin" });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      const { a: admin } = await as("admin");
      const missing = await admin.patch(`/api/admin/users/${randomUUID()}`).send({ role: "agent" });
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("user_not_found");
    });

    it("self-registration defaults to customer", async () => {
      const email = `reg-${randomUUID().slice(0, 8)}@example.test`;
      const res = await request(ctx.app)
        .post("/api/auth/register")
        .send({ email, password: "Passw0rd!test1", firstName: "Reg", lastName: "Ister" });
      expect([200, 201]).toContain(res.status);
      const row = await storage.getUserByEmail(email);
      expect(row?.role).toBe("customer");
    });
  });

  describe("A9 SSO status", () => {
    it("reports not configured, without secrets", async () => {
      const { a } = await as("customer");
      const res = await a.get("/api/sso/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    });

    it("reports configured once an SSO configuration is stored, still without secrets", async () => {
      const { u, a } = await as("admin");
      await storage.upsertSsoConfiguration({
        clientId: "cid",
        tenantId: "tid",
        clientSecret: "do-not-leak",
        updatedBy: u.id,
      });
      const res = await a.get("/api/sso/status");
      expect(res.body).toEqual({ configured: true });
      expect(JSON.stringify(res.body)).not.toMatch(/do-not-leak/);
    });

    it("GET /api/auth/microsoft is a JSON 503 when not configured", async () => {
      const res = await request(ctx.app).get("/api/auth/microsoft").redirects(0);
      expect(res.status).toBe(503);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body.error).toBe("sso_not_configured");
    });
  });

  describe("R19 customers see staff as a minimal profile", () => {
    it("comments and history expose only id, name and picture of staff to a customer", async () => {
      const { u: customer, a: cust } = await as("customer");
      const staff = await createUser({ role: "admin" });
      await storage.updateUserProfile(staff.id, { phone: "555-0100" });
      const staffAgent = await loginAs(ctx.app, staff);
      const t = await createTicketAs(cust);
      await staffAgent.post(`/api/tasks/${t.body.id}/comments`).send({ content: "on it" }).expect(201);
      await staffAgent.patch(`/api/tasks/${t.body.id}`).send({ status: "in_progress" }).expect(200);

      const comments = (await cust.get(`/api/tasks/${t.body.id}/comments`)).body as Array<{ user: Record<string, unknown> }>;
      const history = (await cust.get(`/api/tasks/${t.body.id}/history`)).body as Array<{ user?: Record<string, unknown> }>;
      const staffComment = comments.find((c) => c.user?.id === staff.id)!;
      const staffHistory = history.find((h) => h.user?.id === staff.id)!;
      expect(staffComment).toBeTruthy();
      expect(staffHistory).toBeTruthy();
      for (const projected of [staffComment.user, staffHistory.user!]) {
        expect(Object.keys(projected).sort()).toEqual(["firstName", "id", "lastName", "profileImageUrl"]);
      }
      const raw = JSON.stringify([comments, history]);
      expect(raw).not.toContain(staff.email);
      expect(raw).not.toContain("555-0100");
      void customer;
    });

    it("staff viewers keep the full public projection", async () => {
      const { a } = await as("admin");
      const t = await createTicketAs(a);
      await a.post(`/api/tasks/${t.body.id}/comments`).send({ content: "hello" }).expect(201);
      const comments = (await a.get(`/api/tasks/${t.body.id}/comments`)).body as Array<{ user: Record<string, unknown> }>;
      expect(comments[0].user).toHaveProperty("email");
      expect(comments[0].user).toHaveProperty("role");
    });
  });

  describe("system accounts are not people", () => {
    async function seedSystemAccounts() {
      await seedSystemUser();
      await ensureAiSystemUser();
    }

    it("neither system account appears in listings, pickers or counts", async () => {
      await seedSystemAccounts();
      const { a } = await as("admin");
      const team = await createTeam((await as("manager")).u);
      void team;
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

      const list = (await a.get("/api/users")).body as Array<{ id: string }>;
      expect(ids(list)).not.toContain("system");
      expect(ids(list)).not.toContain(AI_SYSTEM_USER_ID);
      const picker = (await a.get("/api/users?forTeamMemberSelection=true")).body as Array<{ id: string }>;
      expect(ids(picker)).not.toContain("system");
      const adminList = (await a.get("/api/admin/users")).body as Array<{ id: string }>;
      expect(ids(adminList)).not.toContain("system");

      const stats = (await a.get("/api/admin/stats")).body as { totalUsers: number; activeUsers: number };
      const rows = await db.select({ id: users.id }).from(users);
      const people = rows.filter((r) => r.id !== "system" && r.id !== AI_SYSTEM_USER_ID).length;
      expect(stats.totalUsers).toBe(people);
      expect(stats.activeUsers).toBe(people);
    });

    it("the legacy system user is refused as assignee and as team member", async () => {
      await seedSystemAccounts();
      const { u, a } = await as("admin");
      const t = await createTicketAs(a);
      const patch = await a.patch(`/api/tasks/${t.body.id}`).send({ assigneeId: "system" });
      expect(patch.status).toBe(400);
      const create = await createTicketAs(a, { assigneeId: "system" });
      expect(create.status).toBe(400);

      const team = await createTeam(u);
      await expect(storage.addTeamMember({ teamId: team.id, userId: "system", role: "member" })).rejects.toMatchObject({
        status: 404,
      });
      await expect(storage.assignUserToTeam("system", team.id)).rejects.toMatchObject({ status: 404 });
      const res = await a.post(`/api/admin/users/system/assign-team`).send({ teamId: team.id });
      expect(res.status).toBe(404);
    });

    it("admin routes naming a system account answer 404", async () => {
      await seedSystemAccounts();
      const { a } = await as("admin");
      for (const id of ["system", AI_SYSTEM_USER_ID]) {
        const res = await a.patch(`/api/admin/users/${id}`).send({ role: "customer" });
        expect(res.status).toBe(404);
      }
      expect((await storage.getUser("system"))?.role).toBe("admin");
    });
  });
});
