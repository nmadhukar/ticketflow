import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";

describe("sessions of users who stop being active or approved", () => {
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

  it("deactivating a logged-in user makes their next request 401", async () => {
    const u = await createUser({ role: "agent" });
    const agent = await loginAs(ctx.app, u);
    expect((await agent.get("/api/auth/user")).status).toBe(200);
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    expect((await agent.get("/api/auth/user")).status).toBe(401);
  });

  it("un-approving a logged-in user makes their next request 401", async () => {
    const u = await createUser({ role: "agent" });
    const agent = await loginAs(ctx.app, u);
    await db.update(users).set({ isApproved: false }).where(eq(users.id, u.id));
    expect((await agent.get("/api/auth/user")).status).toBe(401);
  });
});
