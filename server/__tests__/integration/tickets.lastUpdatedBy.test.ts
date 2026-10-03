import { sql } from "drizzle-orm";
import { taskHistory } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

/**
 * R59: the detail's lastUpdatedBy follows the list's rule. A history row whose user no longer
 * exists gives no name ('' on both), never the "Support agent" label of a user that is gone.
 */
describe("lastUpdatedBy: detail and list agree (R59)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const FK = "task_history_user_id_users_id_fk";
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("a last history row whose user is gone is '' in the detail and the list", async () => {
    const admin = await createUser({ role: "admin" });
    const ghost = await createUser({ role: "agent" });
    const a = await loginAs(ctx.app, admin);
    const t = await createTicketAs(a);
    expect(t.status).toBe(201);
    await db.insert(taskHistory).values({
      taskId: t.body.id,
      userId: ghost.id,
      action: "updated",
      createdAt: new Date(Date.now() + 60_000),
    });
    // The FK stops a delete today; production data from before it can hold an orphan, so drop it for the case.
    await db.execute(sql.raw(`ALTER TABLE task_history DROP CONSTRAINT IF EXISTS ${FK}`));
    try {
      await db.execute(sql`DELETE FROM users WHERE id = ${ghost.id}`);
      const detail = (await a.get(`/api/tasks/${t.body.id}`)).body;
      const list = (await a.get("/api/tasks")).body.find((r: any) => r.id === t.body.id);
      expect(list.lastUpdatedBy).toBe("");
      expect(detail.lastUpdatedBy).toBe(list.lastUpdatedBy);
      expect(detail.lastUpdatedBy).not.toBe("Support agent");
    } finally {
      await db.execute(sql`DELETE FROM task_history WHERE user_id = ${ghost.id}`);
      await db.execute(
        sql.raw(`ALTER TABLE task_history ADD CONSTRAINT ${FK} FOREIGN KEY (user_id) REFERENCES users(id)`)
      );
    }
  });
});
