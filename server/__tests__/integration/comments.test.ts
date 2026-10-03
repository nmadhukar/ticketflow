import { eq } from "drizzle-orm";
import { taskComments } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

describe("POST /api/tasks/:id/comments body validation", () => {
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

  async function setup() {
    const a = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const t = await createTicketAs(a);
    return { a, id: t.body.id as number };
  }
  const count = async (id: number) =>
    (await db.select().from(taskComments).where(eq(taskComments.taskId, id))).length;

  it("an empty or whitespace-only body is 400 and nothing is stored", async () => {
    const { a, id } = await setup();
    for (const content of ["", "   ", "\n\t "]) {
      const res = await a.post(`/api/tasks/${id}/comments`).send({ content });
      expect([content, res.status]).toEqual([content, 400]);
      expect(res.body.error).toBe("validation_failed");
      expect(res.body.details.fieldErrors.content).toBeDefined();
    }
    expect((await a.post(`/api/tasks/${id}/comments`).send({})).status).toBe(400);
    expect(await count(id)).toBe(0);
  });

  it("10001 characters is 400, exactly 10000 is accepted", async () => {
    const { a, id } = await setup();
    const tooLong = await a.post(`/api/tasks/${id}/comments`).send({ content: "x".repeat(10001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe("validation_failed");
    expect(await count(id)).toBe(0);
    const ok = await a.post(`/api/tasks/${id}/comments`).send({ content: "x".repeat(10000) });
    expect(ok.status).toBe(201);
    expect(await count(id)).toBe(1);
  });

  it("stores the trimmed body", async () => {
    const { a, id } = await setup();
    const res = await a.post(`/api/tasks/${id}/comments`).send({ content: "  hello there \n" });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe("hello there");
    const [row] = await db.select().from(taskComments).where(eq(taskComments.taskId, id));
    expect(row.content).toBe("hello there");
  });

  it("taskId and userId in the body cannot redirect the comment", async () => {
    const { a, id } = await setup();
    const other = await createTicketAs(a, { title: "Other" });
    const res = await a
      .post(`/api/tasks/${id}/comments`)
      .send({ content: "mine", taskId: other.body.id, userId: "someone-else" });
    expect(res.status).toBe(201);
    expect(res.body.taskId).toBe(id);
    expect(res.body.userId).not.toBe("someone-else");
    expect(await count(other.body.id)).toBe(0);
  });
});
