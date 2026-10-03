import { readFileSync } from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { taskComments, tasks, ticketAutoResponses } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { AI_SYSTEM_USER_ID, ensureAiSystemUser } from "../../utils/aiSystemUser";
import { aiAutoResponseService } from "../../services/ai/aiAutoResponse";
import { autoResponseCommentExists } from "../../services/ai/autoResponseComment";

// R48: ticket_auto_responses.applied_at is the time a draft was applied. ai-analytics uses it
// for "tickets resolved by AI"; a row without it (applied before 0021) follows the old rule.
describe("ai-analytics uses applied_at (R48) and the AI comment match is a SQL filter (R64)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminA: Awaited<ReturnType<typeof loginAs>>;
  const h = (n: number) => new Date(Date.now() - n * 3600_000);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const newTicket = async () => (await createTicketAs(adminA)).body.id as number;
  const resolveAt = (id: number, when: Date) =>
    db.update(tasks).set({ status: "resolved", resolvedAt: when }).where(eq(tasks.id, id));
  const aiComment = (ticketId: number, createdAt: Date, content = "AI Auto-Response (confidence 80%): r") =>
    db.insert(taskComments).values({ taskId: ticketId, userId: AI_SYSTEM_USER_ID, content, createdAt });
  const draft = async (
    ticketId: number,
    o: { createdAt: Date; wasApplied: boolean; appliedAt?: Date | null; aiResponse?: string }
  ) => {
    const [row] = await db
      .insert(ticketAutoResponses)
      .values({
        ticketId,
        aiResponse: o.aiResponse ?? "r",
        confidenceScore: "0.8",
        wasApplied: o.wasApplied,
        appliedAt: o.appliedAt ?? null,
        respondedBy: AI_SYSTEM_USER_ID,
        createdAt: o.createdAt,
      })
      .returning();
    return row;
  };
  const resolvedByAI = async () => (await adminA.get("/api/admin/ai-analytics")).body.ticketsResolvedByAI as number;
  const rowOf = async (id: number) =>
    (await db.select().from(ticketAutoResponses).where(eq(ticketAutoResponses.id, id)))[0];

  describe("ticketsResolvedByAI", () => {
    it("does not borrow another draft's earlier comment: B applied after the resolve is not counted", async () => {
      const id = await newTicket();
      await resolveAt(id, h(2));
      // B is generated first (h6); A is never applied but its comment was posted at h3, which
      // the old rule (earliest AI comment after B.createdAt) took as B's applied time.
      await draft(id, { createdAt: h(6), wasApplied: true, appliedAt: h(1) });
      await draft(id, { createdAt: h(5), wasApplied: false });
      await aiComment(id, h(3));
      expect(await resolvedByAI()).toBe(0);
    });

    it("counts a draft applied before the resolve", async () => {
      const id = await newTicket();
      await resolveAt(id, h(2));
      await draft(id, { createdAt: h(5), wasApplied: true, appliedAt: h(3) });
      expect(await resolvedByAI()).toBe(1);
    });

    it("applied_at wins over the comment time in both directions", async () => {
      const early = await newTicket();
      await resolveAt(early, h(2));
      // the only AI comment is late (after the resolve) but applied_at says it was applied first
      await draft(early, { createdAt: h(5), wasApplied: true, appliedAt: h(4) });
      await aiComment(early, h(1));
      expect(await resolvedByAI()).toBe(1);
    });

    it("a legacy row (NULL applied_at) still follows the old comment rule", async () => {
      const counted = await newTicket();
      await resolveAt(counted, h(2));
      await draft(counted, { createdAt: h(5), wasApplied: true });
      await aiComment(counted, h(3));

      const notCounted = await newTicket();
      await resolveAt(notCounted, h(2));
      await draft(notCounted, { createdAt: h(5), wasApplied: true });
      await aiComment(notCounted, h(1));

      expect(await resolvedByAI()).toBe(1);
    });
  });

  describe("who sets applied_at", () => {
    it("setApplied(true) sets it and setApplied(false) clears it", async () => {
      const id = await newTicket();
      const row = await draft(id, { createdAt: h(1), wasApplied: false });
      const before = Date.now();
      await aiAutoResponseService.setApplied(row.id, true);
      const set = await rowOf(row.id);
      expect(set.wasApplied).toBe(true);
      expect(set.appliedAt).not.toBeNull();
      expect(Math.abs(set.appliedAt!.getTime() - before)).toBeLessThan(60_000);
      await aiAutoResponseService.setApplied(row.id, false);
      const cleared = await rowOf(row.id);
      expect(cleared.wasApplied).toBe(false);
      expect(cleared.appliedAt).toBeNull();
    });

    it("the apply route sets it when it posts the comment", async () => {
      const id = await newTicket();
      const row = await draft(id, { createdAt: h(1), wasApplied: false });
      const res = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ applied: true, alreadyApplied: false });
      const after = await rowOf(row.id);
      expect(after.wasApplied).toBe(true);
      expect(after.appliedAt).not.toBeNull();
    });

    it("a failed comment write releases the claim and clears applied_at (undo)", async () => {
      const id = await newTicket();
      const row = await draft(id, { createdAt: h(1), wasApplied: false });
      jest.spyOn(storage, "addTaskComment").mockRejectedValue(new Error("db down"));
      const res = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const after = await rowOf(row.id);
      expect(after.wasApplied).toBe(false);
      expect(after.appliedAt).toBeNull();
    });

    it("the alreadyApplied path takes the existing comment's time", async () => {
      const id = await newTicket();
      const row = await draft(id, { createdAt: h(6), wasApplied: false });
      const posted = h(4);
      await aiComment(id, posted);
      const res = await adminA.post(`/api/tasks/${id}/auto-response/apply`);
      expect(res.body).toEqual({ applied: true, alreadyApplied: true });
      const after = await rowOf(row.id);
      expect(after.wasApplied).toBe(true);
      expect(after.appliedAt!.getTime()).toBe(posted.getTime());
    });
  });

  describe("autoResponseCommentExists matches in SQL (R64)", () => {
    const body = (r: string) => `AI Auto-Response (confidence 80%): ${r}`;

    it("finds only a comment holding exactly that response, even with %, _ and quote characters", async () => {
      const id = await newTicket();
      const odd = "100% sure_ it's 'quoted' \\ and %_ wild \u{1F600}";
      await aiComment(id, h(2), body(odd));
      await aiComment(id, h(2), body("100X sure_ it's 'quoted' \\ and %_ wild"));
      await aiComment(id, h(2), body("other"));
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, odd)).toBe(true);
      // the wildcard characters in the response are literals, not patterns
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "%")).toBe(false);
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "_ther")).toBe(false);
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "100_ sure")).toBe(false);
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "it's")).toBe(false);
    });

    it("ignores another author, another ticket and a comment without the prefix", async () => {
      const id = await newTicket();
      const other = await newTicket();
      const human = await createUser({ role: "agent" });
      await db.insert(taskComments).values({ taskId: id, userId: human.id, content: body("r") });
      await db.insert(taskComments).values({ taskId: id, userId: AI_SYSTEM_USER_ID, content: "r" });
      await aiComment(other, h(1), body("r"));
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "r")).toBe(false);
      await aiComment(id, h(1), body("r"));
      expect(await autoResponseCommentExists(id, AI_SYSTEM_USER_ID, "r")).toBe(true);
    });
  });

  describe("migration 0021", () => {
    it("applies twice without error and leaves one nullable applied_at column", async () => {
      const file = readFileSync(
        path.join(__dirname, "..", "..", "..", "migrations", "0021_ticket_auto_responses_applied_at.sql"),
        "utf8"
      );
      await db.execute(sql.raw(file));
      await db.execute(sql.raw(file));
      const { rows } = await db.execute(
        sql`SELECT is_nullable FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'ticket_auto_responses' AND column_name = 'applied_at'`
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as { is_nullable: string }).is_nullable).toBe("YES");
    });
  });
});
