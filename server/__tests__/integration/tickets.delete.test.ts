import { eq, sql } from "drizzle-orm";
import {
  aiFeedback,
  aiUsage,
  learningQueue,
  taskAttachments,
  taskComments,
  taskHistory,
  teamTaskAssignments,
  tasks,
  ticketAutoResponses,
  ticketComplexityScores,
} from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db, pool } from "../../storage/db";
import { storage } from "../../storage";
import { s3Service } from "../../services/s3Service";

describe("DELETE /api/tasks/:id", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const savedFlag = process.env.ALLOW_MANAGER_DELETE;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    delete process.env.ALLOW_MANAGER_DELETE;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (savedFlag === undefined) delete process.env.ALLOW_MANAGER_DELETE;
    else process.env.ALLOW_MANAGER_DELETE = savedFlag;
  });

  /** A ticket with a row in every table that points at it. */
  async function ticketWithEverything(adminUser: { id: string }, adminA: any) {
    const created = await createTicketAs(adminA, { title: "Doomed" });
    expect(created.status).toBe(201);
    const id: number = created.body.id;
    await adminA.post(`/api/tasks/${id}/comments`).send({ content: "a comment" }).expect(201);
    await adminA.patch(`/api/tasks/${id}`).send({ status: "in_progress" }).expect(200);
    const team = await createTeam(adminUser as any);
    await db
      .insert(teamTaskAssignments)
      .values({ taskId: id, teamId: team.id, assignedBy: adminUser.id });
    await db.insert(taskAttachments).values([
      { taskId: id, userId: adminUser.id, fileName: "a.txt", fileSize: 1, fileType: "text/plain", fileUrl: "Acme/sep-10-2025/a.txt" },
      { taskId: id, userId: adminUser.id, fileName: "b.txt", fileSize: 1, fileType: "text/plain", fileUrl: "Acme/sep-10-2025/b.txt" },
    ]);
    const [auto] = await db
      .insert(ticketAutoResponses)
      .values({ ticketId: id, aiResponse: "try this", confidenceScore: "0.50" })
      .returning();
    await db.insert(learningQueue).values({ ticketId: id });
    await db.insert(ticketComplexityScores).values({ ticketId: id, complexityScore: 40, factors: {} });
    const [usage] = await db
      .insert(aiUsage)
      .values({
        modelId: "m",
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: "0.001000",
        operation: "auto_response",
        userId: adminUser.id,
        ticketId: id,
      })
      .returning();
    const [feedback] = await db
      .insert(aiFeedback)
      .values({ feedbackType: "auto_response", referenceId: auto.id, userId: adminUser.id, rating: 5, ticketId: id })
      .returning();
    return { id, usageId: usage.id, feedbackId: feedback.id };
  }

  async function childCounts(id: number) {
    const n = async (table: any, col: any) => (await db.select().from(table).where(eq(col, id))).length;
    return {
      comments: await n(taskComments, taskComments.taskId),
      history: await n(taskHistory, taskHistory.taskId),
      attachments: await n(taskAttachments, taskAttachments.taskId),
      autoResponses: await n(ticketAutoResponses, ticketAutoResponses.ticketId),
      learning: await n(learningQueue, learningQueue.ticketId),
      complexity: await n(ticketComplexityScores, ticketComplexityScores.ticketId),
      assignments: await n(teamTaskAssignments, teamTaskAssignments.taskId),
    };
  }

  it("admin deletes a ticket with every kind of child: 204, then 404, children gone, cost rows kept with a NULL ticket", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id, usageId, feedbackId } = await ticketWithEverything(admin, adminA);
    const before = await childCounts(id);
    expect(Object.values(before).every((c) => c >= 1)).toBe(true);
    const deleteFiles = jest
      .spyOn(s3Service, "deleteFiles")
      .mockResolvedValue({ deleted: [], failed: [] });

    const res = await adminA.delete(`/api/tasks/${id}`);
    expect(res.status).toBe(204);

    expect((await adminA.get(`/api/tasks/${id}`)).status).toBe(404);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    expect(Object.values(await childCounts(id)).every((c) => c === 0)).toBe(true);

    const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, usageId));
    expect(usage).toBeDefined();
    expect(usage.ticketId).toBeNull();
    const [feedback] = await db.select().from(aiFeedback).where(eq(aiFeedback.id, feedbackId));
    expect(feedback).toBeDefined();
    expect(feedback.ticketId).toBeNull();

    // The S3 objects go after the commit.
    expect(deleteFiles).toHaveBeenCalledTimes(1);
    expect([...deleteFiles.mock.calls[0][0]].sort()).toEqual([
      "Acme/sep-10-2025/a.txt",
      "Acme/sep-10-2025/b.txt",
    ]);
  });

  it("a failing S3 delete is logged (key and error type, no message, no Error object) and does not undo the delete", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id } = await ticketWithEverything(admin, adminA);
    // deleteFiles reports the error TYPE in `failed[].error` (see the deleteFiles test below).
    jest.spyOn(s3Service, "deleteFiles").mockResolvedValue({
      deleted: ["Acme/sep-10-2025/b.txt"],
      failed: [{ key: "Acme/sep-10-2025/a.txt", error: "RangeError" }],
    });
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await adminA.delete(`/api/tasks/${id}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);

    const lines = logged.mock.calls.filter((c) => String(c[0]).includes("Acme/sep-10-2025/a.txt"));
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain("RangeError");
    expect(logged.mock.calls.some((c) => c.some((a) => String(a).includes("s3 down")))).toBe(false);
    // One string argument per call: no Error object or stack reaches the logger.
    for (const call of logged.mock.calls) {
      expect(call.every((arg) => typeof arg === "string")).toBe(true);
      expect(call.some((arg) => /\n\s+at /.test(String(arg)))).toBe(false);
    }
  });

  it("deleteFiles reports a failed key with the error's type, never its text (R63)", async () => {
    const svc = s3Service as any;
    const saved = { bucketName: svc.bucketName, client: svc.client };
    svc.bucketName = "test-bucket";
    svc.client = {};
    jest.spyOn(svc, "getAwsCredentials").mockResolvedValue(undefined);
    jest.spyOn(s3Service, "deleteFile").mockRejectedValue(new RangeError("s3 down: secret request detail"));
    try {
      const result = await s3Service.deleteFiles(["k1"]);
      expect(result.failed).toEqual([{ key: "k1", error: "RangeError" }]);
    } finally {
      svc.bucketName = saved.bucketName;
      svc.client = saved.client;
    }
  });

  it("a whole-batch S3 failure (deleteFiles throws) is logged by error type, not text, and does not undo the delete", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id } = await ticketWithEverything(admin, adminA);
    jest.spyOn(s3Service, "deleteFiles").mockRejectedValue(new TypeError("bucket not configured"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await adminA.delete(`/api/tasks/${id}`)).status).toBe(204);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    expect(logged.mock.calls.some((c) => String(c[0]).includes("TypeError"))).toBe(true);
    expect(logged.mock.calls.some((c) => String(c[0]).includes("bucket not configured"))).toBe(false);
    expect(logged.mock.calls.every((c) => c.every((a) => typeof a === "string"))).toBe(true);
  });

  it("the ticket row is locked first: a comment inserted in an open transaction is deleted with the ticket, not left to fail the delete", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const t = await createTicketAs(adminA);
    const id: number = t.body.id;
    jest.spyOn(s3Service, "deleteFiles").mockResolvedValue({ deleted: [], failed: [] });

    // Another session inserts a comment and keeps its transaction open. The
    // insert holds a key-share lock on the ticket row through the FK.
    //
    // With FOR UPDATE first, deleteTask queues behind that lock, then (after the
    // COMMIT) sees the comment and deletes it with the rest. Without FOR UPDATE
    // it would delete its children while the comment is still invisible, then
    // block on the ticket row, and fail with an FK violation once the comment
    // commits. So this only passes when the ticket row is locked first.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "INSERT INTO task_comments (task_id, user_id, content) VALUES ($1, $2, $3)",
        [id, admin.id, "in flight"]
      );
      let deleteDone = false;
      const deleting = storage.deleteTask(id).then(() => {
        deleteDone = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(deleteDone).toBe(false);
      await holder.query("COMMIT");
      await expect(deleting).resolves.toBeUndefined();
    } finally {
      holder.release();
    }
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    expect(await db.select().from(taskComments).where(eq(taskComments.taskId, id))).toHaveLength(0);
  });

  it("a failure inside the transaction rolls everything back and deletes no S3 object", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id, usageId } = await ticketWithEverything(admin, adminA);
    const deleteFiles = jest.spyOn(s3Service, "deleteFiles").mockResolvedValue({ deleted: [], failed: [] });
    const before = await childCounts(id);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    // An extra FK the code does not know about makes the final ticket delete fail.
    await db.execute(sql.raw(`CREATE TABLE zz_blocker (task_id integer REFERENCES tasks(id))`));
    await db.execute(sql.raw(`INSERT INTO zz_blocker VALUES (${id})`));
    try {
      const res = await adminA.delete(`/api/tasks/${id}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
      expect(await childCounts(id)).toEqual(before);
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.id, usageId));
      expect(usage.ticketId).toBe(id);
      expect(deleteFiles).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql.raw(`DROP TABLE zz_blocker`));
    }
  });

  it("only this ticket's cost rows are detached; other tickets' rows are untouched", async () => {
    const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const t = await createTicketAs(adminA);
    const other = await createTicketAs(adminA, { title: "Other" });
    await db.insert(aiUsage).values({
      modelId: "m", inputTokens: 1, outputTokens: 1, estimatedCost: "0.000001", operation: "x", ticketId: other.body.id,
    });
    expect((await adminA.delete(`/api/tasks/${t.body.id}`)).status).toBe(204);
    const rows = await db.select().from(aiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticketId).toBe(other.body.id);
  });

  it("deleting a ticket id that does not exist is 404", async () => {
    const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const res = await adminA.delete("/api/tasks/999999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("agent, customer and manager (flag off) get 403 and the ticket remains", async () => {
    const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
    for (const role of ["agent", "customer", "manager"] as const) {
      const u = await createUser({ role });
      const a = await loginAs(ctx.app, u);
      // Each deleter owns the ticket, so the 403 is the role rule, not scope.
      const t = await createTicketAs(a, { title: `Owned by ${role}` });
      expect(t.status).toBe(201);
      const res = await a.delete(`/api/tasks/${t.body.id}`);
      expect([role, res.status]).toEqual([role, 403]);
      expect(res.body.error).toBe("forbidden");
      expect((await adminA.get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    }
  });

  it("a manager may delete when ALLOW_MANAGER_DELETE=true", async () => {
    process.env.ALLOW_MANAGER_DELETE = "true";
    const a = await loginAs(ctx.app, await createUser({ role: "manager" }));
    const t = await createTicketAs(a);
    expect((await a.delete(`/api/tasks/${t.body.id}`)).status).toBe(204);
    expect((await a.get(`/api/tasks/${t.body.id}`)).status).toBe(404);
  });
});
