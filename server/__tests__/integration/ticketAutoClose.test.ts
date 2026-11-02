import { eq } from "drizzle-orm";
import { taskComments, tasks } from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { closeStaleResolvedTickets, autoCloseWindowDays } from "../../services/tickets/autoClose";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";

/**
 * Auto-close: a resolved ticket nobody came back to is closed after the follow-up window
 * (company settings autoCloseDays). A reply restarts the clock, and 0 turns the sweep off.
 */
describe("resolved tickets auto-close after the follow-up window", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
  });

  async function windowDays(days: number | null) {
    const admin = await createUser({ role: "admin" });
    await storage.updateCompanySettings({ autoCloseDays: days } as never, admin.id);
  }

  /** A resolved ticket whose resolved stamp is `daysAgo` old. */
  async function resolvedTicket(daysAgo: number) {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser({ role: "customer" });
    const agent = await loginAs(ctx.app, customer);
    const res: { status: number; body: { id?: number } } = await createTicketAs(agent, { title: "Resolved a while ago" });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    await db
      .update(tasks)
      .set({ status: "resolved", resolvedAt: new Date(Date.now() - daysAgo * DAY) })
      .where(eq(tasks.id, id));
    return { id, admin, customer };
  }

  const statusOf = async (id: number) =>
    (await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id)).limit(1))[0].status;

  it("reads the window from company settings, defaulting to 7 days and off at 0", async () => {
    await windowDays(null);
    expect(await autoCloseWindowDays()).toBe(7);
    await windowDays(0);
    expect(await autoCloseWindowDays()).toBe(0);
    await windowDays(3);
    expect(await autoCloseWindowDays()).toBe(3);
  });

  it("closes a resolved ticket whose window has passed, and records it like any other close", async () => {
    await windowDays(7);
    const { id } = await resolvedTicket(10);
    expect(await closeStaleResolvedTickets()).toContain(id);
    expect(await statusOf(id)).toBe("closed");

    // It is an ordinary update attributed to the AI system account, not a silent row edit.
    const history = await storage.getTaskHistory(id);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "updated", field: "status", oldValue: "resolved", newValue: "closed" }),
      ]),
    );
    // Attributed to the AI system account, not left with the last human who touched it.
    const close = history.find((h: { field: string | null }) => h.field === "status") as { userId: string };
    expect(close.userId).toBe(AI_SYSTEM_USER_ID);
  });

  it("leaves a ticket inside its window alone", async () => {
    await windowDays(7);
    const { id } = await resolvedTicket(2);
    expect(await closeStaleResolvedTickets()).not.toContain(id);
    expect(await statusOf(id)).toBe("resolved");
  });

  it("a human reply restarts the clock; a system note does not", async () => {
    await windowDays(7);
    const { id, customer } = await resolvedTicket(10);
    await db.insert(taskComments).values({ taskId: id, userId: customer.id, content: "Still broken, thanks." });
    expect(await closeStaleResolvedTickets()).not.toContain(id);
    expect(await statusOf(id)).toBe("resolved");
  });

  it("does nothing while auto-close is off (0 days)", async () => {
    await windowDays(0);
    const { id } = await resolvedTicket(30);
    expect(await closeStaleResolvedTickets()).toEqual([]);
    expect(await statusOf(id)).toBe("resolved");
  });

  it("never touches a ticket that is not resolved", async () => {
    await windowDays(7);
    const admin = await createUser({ role: "admin" });
    const task = await storage.createTask({
      title: "Open and old",
      category: "support",
      createdBy: admin.id,
      status: "open",
    } as never);
    await db
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 30 * DAY) })
      .where(eq(tasks.id, task.id));
    expect(await closeStaleResolvedTickets()).not.toContain(task.id);
    expect(await statusOf(task.id)).toBe("open");
  });
});
