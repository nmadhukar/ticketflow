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
import { db } from "../../storage/db";
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
    const deleteFile = jest.spyOn(s3Service, "deleteFile").mockResolvedValue(undefined as any);

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
    expect(deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      "Acme/sep-10-2025/a.txt",
      "Acme/sep-10-2025/b.txt",
    ]);
  });

  it("a failing S3 delete is logged and does not undo the delete", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id } = await ticketWithEverything(admin, adminA);
    jest.spyOn(s3Service, "deleteFile").mockRejectedValue(new Error("s3 down"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await adminA.delete(`/api/tasks/${id}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    expect(logged).toHaveBeenCalled();
  });

  it("a failure inside the transaction rolls everything back and deletes no S3 object", async () => {
    const admin = await createUser({ role: "admin" });
    const adminA = await loginAs(ctx.app, admin);
    const { id, usageId } = await ticketWithEverything(admin, adminA);
    const deleteFile = jest.spyOn(s3Service, "deleteFile").mockResolvedValue(undefined as any);
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
      expect(deleteFile).not.toHaveBeenCalled();
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
