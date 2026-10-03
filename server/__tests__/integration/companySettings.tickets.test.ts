import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";

/** M5: the ticket prefix is 1 to 6 letters or digits; anything else is 400 and changes nothing. */
describe("PATCH /api/company-settings/tickets ticketPrefix", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    // storage caches the settings row in memory; the truncated row must not be served from it.
    (storage as unknown as { companySettingsCache?: unknown }).companySettingsCache = undefined;
  });

  it("refuses anything but ^[A-Za-z0-9]{1,6}$ with 400 validation_failed, and keeps the old prefix", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    expect((await agent.patch("/api/company-settings/tickets").send({ ticketPrefix: "HD" })).status).toBe(200);

    for (const bad of ["", "TOOLONG", "AB-1", "A B", " HD", "HD\n", "TKT%", "ÄBC", "x".repeat(50), 123, null, ["HD"]]) {
      const res = await agent.patch("/api/company-settings/tickets").send({ ticketPrefix: bad });
      expect({ bad, status: res.status, error: res.body.error }).toEqual({ bad, status: 400, error: "validation_failed" });
      expect(res.body.details.fieldErrors.ticketPrefix).toBeDefined();
    }
    expect((await storage.getCompanySettings())?.ticketPrefix).toBe("HD");
  });

  it("accepts 1 to 6 letters or digits, and new tickets use it", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    for (const good of ["A", "hd", "Tk2026", "123456"]) {
      const res = await agent.patch("/api/company-settings/tickets").send({ ticketPrefix: good });
      expect({ good, status: res.status, prefix: res.body.ticketPrefix }).toEqual({ good, status: 200, prefix: good });
    }
    const created = await createTicketAs(agent);
    expect(created.status).toBe(201);
    expect(created.body.ticketNumber).toMatch(/^123456-\d{4}-\d{4,}$/);
  });

  it("a request without ticketPrefix still updates the other fields", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAs(ctx.app, admin);
    const res = await agent.patch("/api/company-settings/tickets").send({ defaultTicketPriority: "high" });
    expect(res.status).toBe(200);
    expect(res.body.defaultTicketPriority).toBe("high");
  });
});
