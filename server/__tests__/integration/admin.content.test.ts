import request from "supertest";
import { eq } from "drizzle-orm";
import { companyPolicies, emailTemplates, helpDocuments, knowledgeArticles } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { seedEmailTemplates } from "../../seed/seedEmailTemplates";
import { defaultEmailTemplates } from "../../services/ses/emailTemplates";

type Agent = ReturnType<typeof request.agent>;

/**
 * K1 (delete an article), K5 (help-document admin upload, edit, delete), K6 (policy admin
 * create, toggle, edit, delete) and E2 (email-template list and first-start seeding).
 *
 * Help documents and policies are stored in the database (base64 `fileData`); no route here
 * touches S3, so nothing needs faking.
 */
describe("admin content routes (K1, K5, K6, E2)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const admin = async () => loginAs(ctx.app, await createUser({ role: "admin" }));
  const nonAdmins = async (): Promise<Array<[string, Agent]>> => {
    const out: Array<[string, Agent]> = [];
    for (const role of ["manager", "agent", "customer"] as const) out.push([role, await loginAs(ctx.app, await createUser({ role }))]);
    return out;
  };

  describe("K1: DELETE /api/admin/knowledge/:id", () => {
    const seed = async () => {
      const [row] = await db.insert(knowledgeArticles).values({ title: "Doomed", content: "c" }).returning();
      return row;
    };
    const exists = async (id: number) => (await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id))).length === 1;

    it("an admin deletes it: 200 and the row is gone", async () => {
      const a = await admin();
      const row = await seed();
      const res = await a.delete(`/api/admin/knowledge/${row.id}`);
      expect(res.status).toBe(200);
      expect(await exists(row.id)).toBe(false);
    });

    it("a non-admin is 403 and the row stays; anonymous is 401", async () => {
      const row = await seed();
      for (const [role, agent] of await nonAdmins()) {
        const res = await agent.delete(`/api/admin/knowledge/${row.id}`);
        expect([role, res.status]).toEqual([role, 403]);
        expect(res.body.error).toBe("forbidden");
      }
      expect((await request(ctx.app).delete(`/api/admin/knowledge/${row.id}`)).status).toBe(401);
      expect(await exists(row.id)).toBe(true);
    });

    it("an unknown id is 404 not_found, and deleting twice is 404 the second time", async () => {
      const a = await admin();
      const missing = await a.delete("/api/admin/knowledge/999999");
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe("not_found");

      const row = await seed();
      expect((await a.delete(`/api/admin/knowledge/${row.id}`)).status).toBe(200);
      expect((await a.delete(`/api/admin/knowledge/${row.id}`)).status).toBe(404);
    });
  });

  describe("K5: help documents (admin)", () => {
    const doc = { title: "VPN guide", filename: "vpn.txt", content: "Install the client", fileData: Buffer.from("Install the client").toString("base64") };

    it("an admin uploads, edits and deletes; everyone signed in sees the change", async () => {
      const a = await admin();
      const customer = await loginAs(ctx.app, await createUser({ role: "customer" }));

      const created = await a.post("/api/admin/help").send(doc);
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({ title: "VPN guide", filename: "vpn.txt" });
      const id = created.body.id as number;
      expect((await customer.get("/api/help")).body.map((d: any) => d.id)).toEqual([id]);

      const edited = await a.put(`/api/admin/help/${id}`).send({ title: "VPN guide v2" });
      expect(edited.status).toBe(200);
      expect(edited.body.title).toBe("VPN guide v2");
      expect((await customer.get(`/api/help/${id}`)).body.title).toBe("VPN guide v2");

      const deleted = await a.delete(`/api/admin/help/${id}`);
      expect(deleted.status).toBe(200);
      expect(await db.select().from(helpDocuments)).toHaveLength(0);
      expect((await customer.get(`/api/help/${id}`)).status).toBe(404);
    });

    it("an upload missing a field is 400 and stores nothing", async () => {
      const a = await admin();
      const res = await a.post("/api/admin/help").send({ title: "No file" });
      expect(res.status).toBe(400);
      expect(await db.select().from(helpDocuments)).toHaveLength(0);
    });

    it("a non-admin is 403 on upload, edit and delete, and the document is untouched", async () => {
      const [row] = await db.insert(helpDocuments).values({ ...doc }).returning();
      for (const [role, agent] of await nonAdmins()) {
        expect([role, (await agent.post("/api/admin/help").send(doc)).status]).toEqual([role, 403]);
        expect([role, (await agent.put(`/api/admin/help/${row.id}`).send({ title: "Hacked" })).status]).toEqual([role, 403]);
        expect([role, (await agent.delete(`/api/admin/help/${row.id}`)).status]).toEqual([role, 403]);
      }
      const rows = await db.select().from(helpDocuments);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("VPN guide");
    });
  });

  describe("K6: company policies (admin)", () => {
    const create = (a: Agent, name = "Remote work.pdf", body = "policy text") =>
      a.post("/api/admin/company-policies").field("description", "d").attach("file", Buffer.from(body), { filename: name, contentType: "application/pdf" });

    it("an admin creates (title from the file name), toggles, edits and deletes", async () => {
      const a = await admin();
      const customer = await loginAs(ctx.app, await createUser({ role: "customer" }));

      const created = await create(a);
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({ title: "Remote work", fileName: "Remote work.pdf", isActive: true, fileSize: 11 });
      const id = created.body.id as number;
      expect((await customer.get("/api/company-policies")).body.map((p: any) => p.id)).toEqual([id]);

      const off = await a.post(`/api/admin/company-policies/${id}/toggle`);
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);
      expect((await customer.get("/api/company-policies")).body).toEqual([]); // an inactive policy is hidden
      const on = await a.post(`/api/admin/company-policies/${id}/toggle`);
      expect(on.body.isActive).toBe(true);

      const edited = await a.put(`/api/admin/company-policies/${id}`).field("title", "Remote work 2025").field("description", "new");
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ title: "Remote work 2025", description: "new" });

      const deleted = await a.delete(`/api/admin/company-policies/${id}`);
      expect(deleted.status).toBe(200);
      expect(await db.select().from(companyPolicies)).toHaveLength(0);
    });

    it("creating without a file is 400 and stores nothing", async () => {
      const a = await admin();
      expect((await a.post("/api/admin/company-policies").field("title", "x")).status).toBe(400);
      expect(await db.select().from(companyPolicies)).toHaveLength(0);
    });

    it("a non-admin is 403 on create, toggle, edit and delete, and the policy is untouched", async () => {
      const a = await admin();
      const id = (await create(a)).body.id as number;
      for (const [role, agent] of await nonAdmins()) {
        expect([role, (await create(agent, "x.pdf")).status]).toEqual([role, 403]);
        expect([role, (await agent.post(`/api/admin/company-policies/${id}/toggle`)).status]).toEqual([role, 403]);
        expect([role, (await agent.put(`/api/admin/company-policies/${id}`).field("title", "Hacked")).status]).toEqual([role, 403]);
        expect([role, (await agent.delete(`/api/admin/company-policies/${id}`)).status]).toEqual([role, 403]);
      }
      const rows = await db.select().from(companyPolicies);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: "Remote work", isActive: true });
    });
  });

  describe("E2: GET /api/email-templates", () => {
    it("is empty before the first start, then lists every seeded default after the seeder runs (and seeding twice adds none)", async () => {
      const a = await admin();
      expect((await a.get("/api/email-templates")).body).toEqual([]);

      await seedEmailTemplates();
      const listed = await a.get("/api/email-templates");
      expect(listed.status).toBe(200);
      const names = (listed.body as Array<{ name: string }>).map((t) => t.name);
      expect(names).toEqual([...defaultEmailTemplates.map((t) => t.name)].sort());
      expect(names.length).toBeGreaterThanOrEqual(2);
      for (const t of listed.body) expect(t).toEqual(expect.objectContaining({ subject: expect.any(String), body: expect.any(String), isActive: true }));

      await seedEmailTemplates();
      expect(await db.select().from(emailTemplates)).toHaveLength(defaultEmailTemplates.length);
    });

    it("a template an admin edited is kept by the next seeding", async () => {
      const a = await admin();
      await seedEmailTemplates();
      const target = defaultEmailTemplates[0];
      expect((await a.put(`/api/email-templates/${target.name}`).send({ subject: "Edited subject" })).status).toBe(200);
      await seedEmailTemplates();
      const listed = await a.get("/api/email-templates");
      expect(listed.body.find((t: any) => t.name === target.name).subject).toBe("Edited subject");
    });

    it("only an admin may list (403 for manager, agent and customer; 401 anonymous)", async () => {
      await seedEmailTemplates();
      for (const [role, agent] of await nonAdmins()) {
        expect([role, (await agent.get("/api/email-templates")).status]).toEqual([role, 403]);
      }
      expect((await request(ctx.app).get("/api/email-templates")).status).toBe(401);
    });
  });
});
