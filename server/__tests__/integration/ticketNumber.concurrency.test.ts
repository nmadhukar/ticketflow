import { sql } from "drizzle-orm";
import { tasks } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";

const year = new Date().getFullYear();

describe("ticket numbers", () => {
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

  it("20 parallel creates get 20 distinct numbers in TKT-YYYY-NNNN form", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createTicketAs(a, { title: `Parallel ${i}` }))
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const numbers = results.map((r) => r.body.ticketNumber as string);
    for (const n of numbers) expect(n).toMatch(/^TKT-\d{4}-\d{4,}$/);
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()[0]).toBe(`TKT-${year}-0001`);
  });

  it("past 9999 the next number is numeric (10000), not the string max", async () => {
    const admin = await createUser({ role: "admin" });
    for (const n of [`TKT-${year}-9999`, `TKT-${year}-0999`]) {
      await db.insert(tasks).values({ ticketNumber: n, title: n, category: "support", createdBy: admin.id });
    }
    expect(await storage.getNextTicketNumber()).toBe(`TKT-${year}-10000`);
    expect(await storage.getNextTicketNumber()).toBe(`TKT-${year}-10001`);
  });

  it("a ticket written outside the counter that takes the next number does not break the create (re-sync and retry)", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await loginAs(ctx.app, admin);
    const first = await createTicketAs(a, { title: "first" });
    expect(first.status).toBe(201); // the counter row now exists
    await db.insert(tasks).values({
      ticketNumber: `TKT-${year}-0002`,
      title: "out of band",
      category: "support",
      createdBy: admin.id,
    });
    const next = await createTicketAs(a, { title: "after" });
    expect(next.status).toBe(201);
    expect(next.body.ticketNumber).toBe(`TKT-${year}-0003`);
    const again = await createTicketAs(a, { title: "again" });
    expect(again.body.ticketNumber).toBe(`TKT-${year}-0004`);
  });

  it("seeds a missing counter row from existing tickets", async () => {
    const admin = await createUser({ role: "admin" });
    await db.insert(tasks).values({
      ticketNumber: `TKT-${year}-0042`,
      title: "seed",
      category: "support",
      createdBy: admin.id,
    });
    const counters: any = await db.execute(sql`SELECT count(*)::int AS n FROM ticket_number_counters`);
    expect((counters.rows ?? counters)[0].n).toBe(0);
    expect(await storage.getNextTicketNumber()).toBe(`TKT-${year}-0043`);
  });
});
