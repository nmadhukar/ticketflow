import { eq } from "drizzle-orm";
import { knowledgeArticles } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

/**
 * Pins the admin knowledge routes that absorbed fixes from the removed
 * shadowed copies (Task 10).
 */
describe("admin knowledge routes", () => {
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

  async function admin() {
    const u = await createUser({ role: "admin" });
    return { u, a: await loginAs(ctx.app, u) };
  }
  async function seed(createdBy: string, over: Partial<typeof knowledgeArticles.$inferInsert> = {}) {
    const [row] = await db
      .insert(knowledgeArticles)
      .values({ title: "T", content: "C", createdBy, ...over })
      .returning();
    return row;
  }
  const reload = async (id: number) =>
    (await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id)))[0];

  it("list filters by status, source, category and published (all = no filter)", async () => {
    const { u, a } = await admin();
    await seed(u.id, { title: "draft-manual", status: "draft", source: "manual", isPublished: false, category: "x" });
    await seed(u.id, { title: "pub-ai", status: "published", source: "ai_generated", isPublished: true, category: "y" });
    await seed(u.id, { title: "arch-manual", status: "archived", source: "manual", isPublished: false, category: "y" });
    const titles = async (qs: string) =>
      ((await a.get(`/api/admin/knowledge${qs}`)).body as Array<{ title: string }>).map((r) => r.title).sort();

    expect(await titles("")).toEqual(["arch-manual", "draft-manual", "pub-ai"]);
    expect(await titles("?status=archived")).toEqual(["arch-manual"]);
    expect(await titles("?source=ai_generated")).toEqual(["pub-ai"]);
    expect(await titles("?source=manual&status=draft")).toEqual(["draft-manual"]);
    expect(await titles("?category=y")).toEqual(["arch-manual", "pub-ai"]);
    expect(await titles("?published=true")).toEqual(["pub-ai"]);
    expect(await titles("?published=published")).toEqual(["pub-ai"]);
    expect(await titles("?published=false")).toEqual(["arch-manual", "draft-manual"]);
    expect(await titles("?published=all")).toEqual(["arch-manual", "draft-manual", "pub-ai"]);
  });

  it("POST without title or content is 400 in the error contract and stores nothing", async () => {
    const { a } = await admin();
    for (const body of [{}, { title: "only title" }, { content: "only content" }, { title: "", content: "x" }]) {
      const res = await a.post("/api/admin/knowledge").send(body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      expect(res.body.error).toBe("validation_failed");
      expect(typeof res.body.message).toBe("string");
      expect(res.body.details.fieldErrors).toBeDefined();
    }
    expect(await db.select().from(knowledgeArticles)).toHaveLength(0);
  });

  it("POST stores only whitelisted fields; extra fields in the body are ignored", async () => {
    const { u, a } = await admin();
    const res = await a.post("/api/admin/knowledge").send({
      title: "Hello",
      content: "World",
      tags: ["a"],
      id: 9999,
      createdBy: "someone-else",
      source: "ai_generated",
      usageCount: 50,
      viewCount: 77,
    });
    expect(res.status).toBe(201);
    const row = await reload(res.body.id);
    expect(row.id).not.toBe(9999);
    expect(row.createdBy).toBe(u.id);
    expect(row.source).toBe("manual");
    expect(row.usageCount).toBe(0);
    expect(row.viewCount).toBe(0);
    expect(row.category).toBe("general");
    expect(row.tags).toEqual(["a"]);
  });

  it("POST by a non-admin is 403", async () => {
    const a = await loginAs(ctx.app, await createUser({ role: "agent" }));
    expect((await a.post("/api/admin/knowledge").send({ title: "t", content: "c" })).status).toBe(403);
  });

  it("PUT strips id, createdAt, usageCount and createdBy but applies the rest", async () => {
    const { u, a } = await admin();
    const row = await seed(u.id, { usageCount: 3 });
    const res = await a.put(`/api/admin/knowledge/${row.id}`).send({
      title: "Renamed",
      id: 424242,
      createdBy: "someone-else",
      usageCount: 999,
      createdAt: "2001-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
    const after = await reload(row.id);
    expect(after.title).toBe("Renamed");
    expect(after.createdBy).toBe(u.id);
    expect(after.usageCount).toBe(3);
    expect(after.createdAt?.getTime()).toBe(row.createdAt?.getTime());
    expect(await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, 424242))).toHaveLength(0);
  });

  it("PATCH publish keeps status and isPublished consistent, including from archived (archivedAt cleared)", async () => {
    const { u, a } = await admin();
    const draft = await seed(u.id);

    await a.patch(`/api/admin/knowledge/${draft.id}/publish`).send({ isPublished: true }).expect(200);
    let r = await reload(draft.id);
    expect([r.status, r.isPublished, r.archivedAt]).toEqual(["published", true, null]);

    await a.patch(`/api/admin/knowledge/${draft.id}/publish`).send({ isPublished: false }).expect(200);
    r = await reload(draft.id);
    expect([r.status, r.isPublished, r.archivedAt]).toEqual(["draft", false, null]);

    // Pinned: publishing an ARCHIVED article un-archives it (status published, archivedAt cleared).
    const archived = await seed(u.id, { status: "archived", isPublished: false, archivedAt: new Date() });
    await a.patch(`/api/admin/knowledge/${archived.id}/publish`).send({ isPublished: true }).expect(200);
    r = await reload(archived.id);
    expect([r.status, r.isPublished, r.archivedAt]).toEqual(["published", true, null]);

    // Pinned: isPublished=false on an archived article moves it to draft (it is no longer archived).
    const archived2 = await seed(u.id, { status: "archived", isPublished: false, archivedAt: new Date() });
    await a.patch(`/api/admin/knowledge/${archived2.id}/publish`).send({ isPublished: false }).expect(200);
    r = await reload(archived2.id);
    expect([r.status, r.isPublished, r.archivedAt]).toEqual(["draft", false, null]);
  });
});
