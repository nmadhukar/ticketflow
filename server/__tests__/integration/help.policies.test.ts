import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { companyPolicies, helpDocuments, knowledgeArticles, tasks, userGuides, users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, createTicketAs, loginAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { storage } from "../../storage";

/**
 * Task 13: help, policies and guides need sign-in; non-staff see only
 * published guides and active policies; guide HTML is sanitised on write and
 * read; LIKE wildcards in user input match themselves; email lookups are exact.
 */
describe("help, policies and guides access", () => {
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

  async function actors() {
    const adminUser = await createUser({ role: "admin" });
    const agentUser = await createUser({ role: "agent" });
    const customerUser = await createUser({ role: "customer" });
    return {
      adminUser,
      agentUser,
      customerUser,
      admin: await loginAs(ctx.app, adminUser),
      agent: await loginAs(ctx.app, agentUser),
      customer: await loginAs(ctx.app, customerUser),
    };
  }

  async function seedHelp(uploadedBy: string, over: Partial<typeof helpDocuments.$inferInsert> = {}) {
    const [row] = await db
      .insert(helpDocuments)
      .values({ title: "Help doc", filename: "h.txt", content: "how to reset", fileData: "aGk=", uploadedBy, ...over })
      .returning();
    return row;
  }
  async function seedPolicy(uploadedBy: string, over: Partial<typeof companyPolicies.$inferInsert> = {}) {
    const [row] = await db
      .insert(companyPolicies)
      .values({
        title: "Policy",
        fileData: Buffer.from("policy body").toString("base64"),
        fileName: "p.txt",
        fileSize: 11,
        mimeType: "text/plain",
        uploadedBy,
        isActive: true,
        ...over,
      })
      .returning();
    return row;
  }
  async function seedGuide(createdBy: string, over: Partial<typeof userGuides.$inferInsert> = {}) {
    const [row] = await db
      .insert(userGuides)
      .values({ title: "Guide", category: "general", type: "html", content: "<p>hi</p>", createdBy, ...over })
      .returning();
    return row;
  }

  describe("help documents", () => {
    it("anonymous /api/help, /api/help/search and /api/help/:id are 401", async () => {
      const { adminUser } = await actors();
      const doc = await seedHelp(adminUser.id);
      for (const path of ["/api/help", "/api/help/search?q=reset", `/api/help/${doc.id}`]) {
        const res = await request(ctx.app).get(path);
        expect([path, res.status]).toEqual([path, 401]);
      }
    });

    it("any signed-in user can list, search and open help documents", async () => {
      const { adminUser, customer } = await actors();
      const doc = await seedHelp(adminUser.id);
      expect((await customer.get("/api/help")).body).toHaveLength(1);
      expect((await customer.get("/api/help/search?q=reset")).body).toHaveLength(1);
      const one = await customer.get(`/api/help/${doc.id}`);
      expect(one.status).toBe(200);
      expect(one.body.id).toBe(doc.id);
    });

    it("help search treats % and _ as literal characters", async () => {
      const { adminUser, customer } = await actors();
      await seedHelp(adminUser.id, { title: "Plain", content: "nothing special" });
      await seedHelp(adminUser.id, { title: "Discount", content: "save 50% today" });
      const wild = await customer.get("/api/help/search").query({ q: "%" });
      expect(wild.body.map((d: { title: string }) => d.title)).toEqual(["Discount"]);
      const under = await customer.get("/api/help/search").query({ q: "_" });
      expect(under.body).toEqual([]);
    });
  });

  describe("company policies", () => {
    it("anonymous policy list, item and download are 401", async () => {
      const { adminUser } = await actors();
      const p = await seedPolicy(adminUser.id);
      for (const path of ["/api/company-policies", `/api/company-policies/${p.id}`, `/api/company-policies/${p.id}/download`]) {
        expect([path, (await request(ctx.app).get(path)).status]).toEqual([path, 401]);
      }
    });

    it("includeInactive=true lists inactive policies for an admin only", async () => {
      const { adminUser, admin, agent, customer } = await actors();
      await seedPolicy(adminUser.id, { title: "live", isActive: true });
      await seedPolicy(adminUser.id, { title: "retired", isActive: false });
      const titles = async (a: typeof admin, qs: string) =>
        ((await a.get(`/api/company-policies${qs}`)).body as Array<{ title: string }>).map((p) => p.title).sort();

      expect(await titles(admin, "?includeInactive=true")).toEqual(["live", "retired"]);
      expect(await titles(admin, "")).toEqual(["live"]);
      expect(await titles(customer, "?includeInactive=true")).toEqual(["live"]);
      expect(await titles(agent, "?includeInactive=true")).toEqual(["live"]);
    });

    it("an inactive policy is 404 by id and by download for a non-admin, readable by an admin", async () => {
      const { adminUser, admin, agent, customer } = await actors();
      const retired = await seedPolicy(adminUser.id, { isActive: false });
      const live = await seedPolicy(adminUser.id, { isActive: true });

      for (const who of [customer, agent]) {
        expect((await who.get(`/api/company-policies/${retired.id}`)).status).toBe(404);
        expect((await who.get(`/api/company-policies/${retired.id}/download`)).status).toBe(404);
        expect((await who.get(`/api/company-policies/${live.id}`)).status).toBe(200);
        expect((await who.get(`/api/company-policies/${live.id}/download`)).status).toBe(200);
      }
      expect((await admin.get(`/api/company-policies/${retired.id}`)).status).toBe(200);
      expect((await admin.get(`/api/company-policies/${retired.id}/download`)).status).toBe(200);
    });
  });

  describe("guides", () => {
    it("a customer sees only published guides, even when asking for drafts", async () => {
      const { adminUser, customer, agent, admin } = await actors();
      const pub = await seedGuide(adminUser.id, { title: "pub", isPublished: true });
      const draft = await seedGuide(adminUser.id, { title: "draft", isPublished: false });
      const titles = async (a: typeof admin, qs = "") =>
        ((await a.get(`/api/guides${qs}`)).body as Array<{ title: string }>).map((g) => g.title).sort();

      expect(await titles(customer)).toEqual(["pub"]);
      expect(await titles(customer, "?published=false")).toEqual(["pub"]);
      expect(await titles(agent)).toEqual(["draft", "pub"]);
      expect(await titles(admin)).toEqual(["draft", "pub"]);
      expect(await titles(admin, "?published=true")).toEqual(["pub"]);

      expect((await customer.get(`/api/guides/${pub.id}`)).status).toBe(200);
      expect((await customer.get(`/api/guides/${draft.id}`)).status).toBe(404);
      expect((await agent.get(`/api/guides/${draft.id}`)).status).toBe(200);
    });

    it("a draft guide's view count is not bumped by a customer's refused read", async () => {
      const { adminUser, customer } = await actors();
      const draft = await seedGuide(adminUser.id, { isPublished: false });
      await customer.get(`/api/guides/${draft.id}`);
      const [row] = await db.select().from(userGuides).where(eq(userGuides.id, draft.id));
      expect(row.viewCount).toBe(0);
    });

    const DIRTY = "<img src=x onerror=alert(1)><script>alert(2)</script><p>ok</p>";
    const CLEAN = '<img src="x" /><p>ok</p>';

    it("a guide saved with script and handlers is stored and returned sanitised", async () => {
      const { admin, customer } = await actors();
      const created = await admin
        .post("/api/admin/guides")
        .send({ title: "G", category: "general", type: "html", content: DIRTY, isPublished: true });
      expect(created.status).toBe(200);
      expect(created.body.content).toBe(CLEAN);

      const [stored] = await db.select().from(userGuides).where(eq(userGuides.id, created.body.id));
      expect(stored.content).toBe(CLEAN);

      const read = await customer.get(`/api/guides/${created.body.id}`);
      expect(read.body.content).toBe(CLEAN);

      const updated = await admin.put(`/api/admin/guides/${created.body.id}`).send({ content: DIRTY });
      expect(updated.status).toBe(200);
      expect(updated.body.content).toBe(CLEAN);
      const [again] = await db.select().from(userGuides).where(eq(userGuides.id, created.body.id));
      expect(again.content).toBe(CLEAN);
    });

    it("a dirty row already in the database is cleaned on read, in the list and by id", async () => {
      const { adminUser, customer } = await actors();
      const g = await seedGuide(adminUser.id, { content: DIRTY, isPublished: true });
      expect((await customer.get(`/api/guides/${g.id}`)).body.content).toBe(CLEAN);
      const list = await customer.get("/api/guides?published=true");
      expect(list.body[0].content).toBe(CLEAN);
    });

    it("a customer cannot create or edit a guide", async () => {
      const { customer } = await actors();
      const res = await customer.post("/api/admin/guides").send({ title: "x", category: "c", type: "html", content: DIRTY });
      expect(res.status).toBe(403);
    });
  });

  describe("LIKE wildcards in user input", () => {
    it("knowledge search treats % and _ literally and bounds limit", async () => {
      const { adminUser, customer } = await actors();
      await db.insert(knowledgeArticles).values([
        { title: "plain article", content: "nothing", createdBy: adminUser.id, isPublished: true },
        { title: "50% article", content: "x", createdBy: adminUser.id, isPublished: true },
      ]);
      const wild = await customer.get("/api/knowledge/search").query({ query: "%" });
      expect(wild.status).toBe(200);
      expect(wild.body.map((a: { title: string }) => a.title)).toEqual(["50% article"]);
      expect((await customer.get("/api/knowledge/search").query({ query: "_" })).body).toEqual([]);

      for (const limit of ["abc", "0", "101", "-1", "1.5", ""]) {
        const res = await customer.get("/api/knowledge/search").query({ limit });
        expect([limit, res.status, res.body.error]).toEqual([limit, 400, "validation_failed"]);
      }
      expect((await customer.get("/api/knowledge/search").query({ limit: "1" })).body).toHaveLength(1);
      expect((await customer.get("/api/knowledge/search")).status).toBe(200);
    });

    it("ticket search treats % and _ literally", async () => {
      const { agent } = await actors();
      await createTicketAs(agent, { title: "Plain ticket title", description: "nothing special in here" });
      await createTicketAs(agent, { title: "Cost is 50% more", description: "percent in the title here" });
      expect(await db.select().from(tasks)).toHaveLength(2);
      const search = async (s: string) =>
        ((await agent.get("/api/tasks").query({ search: s })).body as { tasks?: Array<{ title: string }> } | Array<{ title: string }>);
      const rows = (b: Awaited<ReturnType<typeof search>>) => (Array.isArray(b) ? b : (b.tasks ?? []));
      expect(rows(await search("%")).map((t) => t.title)).toEqual(["Cost is 50% more"]);
      expect(rows(await search("_"))).toEqual([]);
    });
  });

  describe("email lookups are exact, case-insensitive", () => {
    it("getUserByEmail ignores % and _ and still matches by case", async () => {
      const u = await createUser({ role: "customer", email: "a@example.test" });
      expect(await storage.getUserByEmail("%@example.test")).toBeUndefined();
      expect(await storage.getUserByEmail("_@example.test")).toBeUndefined();
      expect((await storage.getUserByEmail("A@Example.TEST"))?.id).toBe(u.id);
    });

    it("login, forgot-password and register do not treat _ or % as wildcards", async () => {
      const u = await createUser({ role: "customer", email: "a@example.test" });
      const app = ctx.app;

      const login = await request(app).post("/api/auth/login").send({ email: "_@example.test", password: DEFAULT_PASSWORD });
      expect(login.status).toBe(401);

      const forgot = await request(app).post("/api/auth/forgot-password").send({ email: "_@example.test" });
      expect(forgot.status).toBe(200);
      const [after] = await db.select().from(users).where(eq(users.id, u.id));
      expect(after.passwordResetToken).toBeNull();

      const reg = await request(app)
        .post("/api/auth/register")
        .send({ email: "_@example.test", password: "Passw0rd!x", firstName: "W", lastName: "C" });
      expect(reg.body.message).not.toBe("Email already registered");
    });

    it("register answers an existing email identically for password and password-less accounts", async () => {
      await createUser({ role: "customer", email: "has-pw@example.test" });
      await storage.createUser({
        id: randomUUID(),
        email: "sso@example.test",
        password: null,
        firstName: "S",
        lastName: "O",
        role: "customer",
        isApproved: true,
        isActive: true,
      });
      const body = { password: "Passw0rd!x", firstName: "N", lastName: "E" };
      const a = await request(ctx.app).post("/api/auth/register").send({ ...body, email: "has-pw@example.test" });
      const b = await request(ctx.app).post("/api/auth/register").send({ ...body, email: "sso@example.test" });
      expect(a.status).toBe(b.status);
      expect(a.body).toEqual(b.body);
      expect(a.status).toBe(400);
    });

    it("check-email no longer exists: the same 404 for a known and an unknown email", async () => {
      await createUser({ role: "customer", email: "known@example.test" });
      const known = await request(ctx.app).post("/api/auth/check-email").send({ email: "known@example.test" });
      const unknown = await request(ctx.app).post("/api/auth/check-email").send({ email: "nobody@example.test" });
      expect(known.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(known.body).toEqual(unknown.body);
      expect(known.body.error).toBe("not_found");
    });
  });
});
