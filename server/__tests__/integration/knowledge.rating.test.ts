import request from "supertest";
import { eq } from "drizzle-orm";
import { knowledgeArticles } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

/**
 * K4: POST /api/knowledge/:id/feedback and /rate record a rating and the article's
 * effectiveness changes. The effectiveness score is a 0..1 fraction (the knowledge page
 * shows it x 100), so a rating must never push it outside that range.
 */
describe("knowledge article feedback and ratings (K4)", () => {
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

  async function article(score: string | null = "0.50") {
    const [row] = await db
      .insert(knowledgeArticles)
      .values({ title: "Reset a password", content: "Use the forgot-password link", isPublished: true, status: "published", effectivenessScore: score })
      .returning();
    return row;
  }
  const reload = async (id: number) => (await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id)))[0];
  const score = async (id: number) => Number((await reload(id)).effectivenessScore);

  it("feedback: thumbs-up raises the score, thumbs-down lowers it, and each counts one use", async () => {
    const a = await article("0.50");
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));

    const up = await agent.post(`/api/knowledge/${a.id}/feedback`).send({ wasHelpful: true });
    expect(up.status).toBe(200);
    expect(await score(a.id)).toBeCloseTo(0.55, 2);
    expect((await reload(a.id)).usageCount).toBe(1);

    const down = await agent.post(`/api/knowledge/${a.id}/feedback`).send({ wasHelpful: false });
    expect(down.status).toBe(200);
    expect(await score(a.id)).toBeCloseTo(0.5, 2);
    expect((await reload(a.id)).usageCount).toBe(2);
  });

  it("feedback: a body without a boolean wasHelpful is 400 and changes nothing", async () => {
    const a = await article("0.50");
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));
    for (const body of [{}, { wasHelpful: "yes" }, { wasHelpful: null }, { wasHelpful: 1 }]) {
      const res = await agent.post(`/api/knowledge/${a.id}/feedback`).send(body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await score(a.id)).toBeCloseTo(0.5, 2);
    expect((await reload(a.id)).usageCount).toBe(0);
  });

  it("rate: 5 counts a helpful vote and moves the score up, 1 counts an unhelpful vote and moves it down, inside 0..1", async () => {
    const a = await article("0.50");
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));

    expect((await agent.post(`/api/knowledge/${a.id}/rate`).send({ rating: 5 })).status).toBe(200);
    let row = await reload(a.id);
    expect(row.helpfulVotes).toBe(1);
    expect(row.unhelpfulVotes).toBe(0);
    expect(Number(row.effectivenessScore)).toBeCloseTo(0.75, 2); // (0.5 + 1) / 2

    expect((await agent.post(`/api/knowledge/${a.id}/rate`).send({ rating: 1 })).status).toBe(200);
    row = await reload(a.id);
    expect(row.helpfulVotes).toBe(1);
    expect(row.unhelpfulVotes).toBe(1);
    expect(Number(row.effectivenessScore)).toBeCloseTo(0.38, 2); // (0.75 + 0) / 2

    // A middle rating moves the score but counts no vote.
    expect((await agent.post(`/api/knowledge/${a.id}/rate`).send({ rating: 3 })).status).toBe(200);
    row = await reload(a.id);
    expect((row.helpfulVotes ?? 0) + (row.unhelpfulVotes ?? 0)).toBe(2);
    expect(Number(row.effectivenessScore)).toBeCloseTo(0.44, 2); // (0.38 + 0.5) / 2

    // Repeated thumbs-up can never leave the 0..1 range.
    for (let i = 0; i < 8; i++) await agent.post(`/api/knowledge/${a.id}/rate`).send({ rating: 5 });
    const s = await score(a.id);
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("rate: a missing, fractional, out-of-range or string rating is 400 and stores nothing (it used to store NaN)", async () => {
    const a = await article("0.50");
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));
    for (const body of [{}, { rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: "5" }, { rating: null }, { rating: -1 }]) {
      const res = await agent.post(`/api/knowledge/${a.id}/rate`).send(body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    const row = await reload(a.id);
    expect(Number(row.effectivenessScore)).toBeCloseTo(0.5, 2);
    expect(row.helpfulVotes).toBe(0);
    expect(row.unhelpfulVotes).toBe(0);
  });

  it("an unknown article is 404 on both routes and an anonymous caller is 401", async () => {
    const a = await article();
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));
    expect((await agent.post("/api/knowledge/999999/rate").send({ rating: 5 })).status).toBe(404);
    expect((await agent.post("/api/knowledge/999999/feedback").send({ wasHelpful: true })).status).toBe(404);
    expect((await request(ctx.app).post(`/api/knowledge/${a.id}/rate`).send({ rating: 5 })).status).toBe(401);
    expect((await request(ctx.app).post(`/api/knowledge/${a.id}/feedback`).send({ wasHelpful: true })).status).toBe(401);
    expect(await score(a.id)).toBeCloseTo(0.5, 2);
  });

  it("an article that has no score yet starts from 0 on /rate", async () => {
    const a = await article(null);
    const agent = await loginAs(ctx.app, await createUser({ role: "agent" }));
    await agent.post(`/api/knowledge/${a.id}/rate`).send({ rating: 5 }).expect(200);
    expect(await score(a.id)).toBeCloseTo(0.5, 2); // (0 + 1) / 2
  });
});
