import { promises as dnsPromises } from "dns";
import { eq } from "drizzle-orm";
import { teamsIntegrationSettings, tasks, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { mcpFor } from "./helpers/mcpClient";

const hook = (tenant: string) => `https://${tenant}.webhook.office.com/webhookb2/abc@def/IncomingWebhook/xyz/secret`;

describe("Teams webhook settings and fan-out", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fetchMock: jest.SpyInstance;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    jest
      .spyOn(dnsPromises, "lookup")
      .mockResolvedValue([{ address: "52.96.0.1", family: 4 }] as never);
    const real = globalThis.fetch;
    fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
      if (String(input).includes("webhook.office.com")) return Promise.resolve(new Response("1", { status: 200 }));
      return real(input as never, init);
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const webhookHosts = () =>
    fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("webhook.office.com"))
      .map((u) => new URL(u).hostname)
      .sort();

  async function giveWebhook(user: User, tenant: string, types = ["ticket_created", "ticket_updated"]) {
    await db.insert(teamsIntegrationSettings).values({
      userId: user.id,
      enabled: true,
      webhookUrl: hook(tenant),
      notificationTypes: types,
    });
  }

  describe("settings routes are admin-only", () => {
    const calls: [string, (a: any) => Promise<any>][] = [
      ["GET", (a) => a.get("/api/teams-integration/settings")],
      ["POST", (a) => a.post("/api/teams-integration/settings").send({ enabled: true, webhookUrl: hook("t"), notificationTypes: ["ticket_created"] })],
      ["DELETE", (a) => a.delete("/api/teams-integration/settings")],
      ["TEST", (a) => a.post("/api/teams-integration/test")],
    ];
    it.each(["customer", "agent", "manager"] as const)("a %s gets 403 on every route and nothing is stored", async (role) => {
      const user = await createUser({ role });
      const agent = await loginAs(ctx.app, user);
      for (const [name, call] of calls) {
        const res = await call(agent);
        expect([name, res.status]).toEqual([name, 403]);
        expect(res.body.error).toBe("forbidden");
      }
      const rows = await db.select().from(teamsIntegrationSettings).where(eq(teamsIntegrationSettings.userId, user.id));
      expect(rows).toHaveLength(0);
      expect(webhookHosts()).toEqual([]);
    });

    it("an unauthenticated caller gets 401", async () => {
      const res = await (await import("supertest")).default(ctx.app).get("/api/teams-integration/settings");
      expect(res.status).toBe(401);
    });
  });

  describe("an admin saving a webhook", () => {
    it.each([
      ["a foreign host", "https://evil.example/hook"],
      ["plain http", "http://contoso.webhook.office.com/x"],
      ["a suffix trick", "https://contoso.webhook.office.com.evil.example/x"],
      ["a metadata address", "https://169.254.169.254/latest"],
      ["a private address", "https://10.0.0.5/x"],
    ])("refuses %s with 400 and stores nothing", async (_n, webhookUrl) => {
      const admin = await createUser({ role: "admin" });
      const agent = await loginAs(ctx.app, admin);
      const res = await agent
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl, notificationTypes: ["ticket_created"] });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(typeof res.body.message).toBe("string");
      expect(JSON.stringify(res.body)).not.toContain("stack");
      const rows = await db.select().from(teamsIntegrationSettings);
      expect(rows).toHaveLength(0);
    });

    it("accepts https://<tenant>.webhook.office.com/... and stores it for the admin", async () => {
      const admin = await createUser({ role: "admin" });
      const agent = await loginAs(ctx.app, admin);
      const res = await agent
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl: hook("contoso"), notificationTypes: ["ticket_created"] });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(teamsIntegrationSettings);
      expect(row.userId).toBe(admin.id);
      expect(row.webhookUrl).toBe(hook("contoso"));
      expect((await agent.get("/api/teams-integration/settings")).body.webhookUrl).toBe(hook("contoso"));
    });

    it("cannot write another user's row or an unknown notification type", async () => {
      const admin = await createUser({ role: "admin" });
      const other = await createUser({ role: "agent" });
      const agent = await loginAs(ctx.app, admin);
      const spoof = await agent
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl: hook("contoso"), userId: other.id });
      expect(spoof.status).toBe(400);
      const badType = await agent
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl: hook("contoso"), notificationTypes: ["everything"] });
      expect(badType.status).toBe(400);
      expect(await db.select().from(teamsIntegrationSettings)).toHaveLength(0);
    });

    it("the test route refuses a stored legacy URL that is not allow-listed, with no request", async () => {
      const admin = await createUser({ role: "admin" });
      await db.insert(teamsIntegrationSettings).values({
        userId: admin.id,
        enabled: true,
        webhookUrl: "https://evil.example/hook",
        notificationTypes: ["ticket_created"],
      });
      const agent = await loginAs(ctx.app, admin);
      const res = await agent.post("/api/teams-integration/test");
      expect(res.status).toBe(400);
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("evil.example"))).toHaveLength(0);
    });

    it("the test route sends to an allow-listed webhook", async () => {
      const admin = await createUser({ role: "admin" });
      await giveWebhook(admin, "contoso");
      const agent = await loginAs(ctx.app, admin);
      const res = await agent.post("/api/teams-integration/test");
      expect(res.status).toBe(200);
      expect(webhookHosts()).toEqual(["contoso.webhook.office.com"]);
    });
  });

  describe("tickets created and updated through MCP", () => {
    const bodies = () =>
      fetchMock.mock.calls
        .filter((c) => String(c[0]).includes("webhook.office.com"))
        .map((c) => String((c[1] as RequestInit | undefined)?.body ?? ""));

    it("carry a link built from APP_BASE_URL, and none when it is unset", async () => {
      const admin = await createUser({ role: "admin" });
      await giveWebhook(admin, "admin");
      const mcp = await mcpFor(ctx.app, admin);
      const saved = process.env.APP_BASE_URL;
      try {
        process.env.APP_BASE_URL = "https://tickets.example.test/";
        const created = await mcp.call("create_ticket", { title: "from mcp", category: "support" });
        expect(created.isError).toBe(false);
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0]).toContain("https://tickets.example.test/my-tasks");

        fetchMock.mockClear();
        const updated = await mcp.call("update_ticket", { id: created.data.id, priority: "high" });
        expect(updated.isError).toBe(false);
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0]).toContain("https://tickets.example.test/my-tasks");

        delete process.env.APP_BASE_URL;
        fetchMock.mockClear();
        await mcp.call("update_ticket", { id: created.data.id, priority: "low" });
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0]).not.toContain("potentialAction");
      } finally {
        if (saved === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = saved;
      }
    });
  });

  describe("a ticket notifies only the webhooks of users who can access it", () => {
    async function world() {
      const admin = await createUser({ role: "admin" });
      const manager1 = await createUser({ role: "manager" });
      const manager2 = await createUser({ role: "manager" });
      const agentIn = await createUser({ role: "agent" });
      const agentOut = await createUser({ role: "agent" });
      const customer = await createUser({ role: "customer" });
      const otherCustomer = await createUser({ role: "customer" });
      const team1 = await createTeam(manager1);
      await createTeam(manager2);
      await giveWebhook(admin, "admin");
      await giveWebhook(manager1, "manager-in");
      await giveWebhook(manager2, "manager-out");
      await giveWebhook(agentIn, "agent-in");
      await giveWebhook(agentOut, "agent-out");
      await giveWebhook(customer, "customer-owner");
      await giveWebhook(otherCustomer, "customer-other");
      return { admin, manager1, manager2, agentIn, agentOut, customer, otherCustomer, team1 };
    }

    it("on create: the admin and the creator, not unrelated agents, managers or customers", async () => {
      const w = await world();
      const agent = await loginAs(ctx.app, w.customer);
      const res = await createTicketAs(agent, {});
      expect(res.status).toBe(201);
      expect(webhookHosts()).toEqual(["admin.webhook.office.com", "customer-owner.webhook.office.com"]);
    });

    it("on create into a team queue: that team's manager and members are added, outsiders are not", async () => {
      const w = await world();
      await (await import("../../storage")).storage.addTeamMember({ teamId: w.team1.id, userId: w.agentIn.id });
      const agent = await loginAs(ctx.app, w.admin);
      const res = await createTicketAs(agent, { assigneeType: "team", assigneeTeamId: w.team1.id });
      expect(res.status).toBe(201);
      expect(webhookHosts()).toEqual([
        "admin.webhook.office.com",
        "agent-in.webhook.office.com",
        "manager-in.webhook.office.com",
      ]);
    });

    it("on update: same rule", async () => {
      const w = await world();
      const customerAgent = await loginAs(ctx.app, w.customer);
      const created = await createTicketAs(customerAgent, {});
      expect(created.status).toBe(201);
      fetchMock.mockClear();
      const adminAgent = await loginAs(ctx.app, w.admin);
      const res = await adminAgent.patch(`/api/tasks/${created.body.id}`).send({ status: "in_progress" });
      expect(res.status).toBe(200);
      expect(webhookHosts()).toEqual(["admin.webhook.office.com", "customer-owner.webhook.office.com"]);
    });

    it("a legacy webhook with a non-allow-listed host is never called", async () => {
      const w = await world();
      await db
        .update(teamsIntegrationSettings)
        .set({ webhookUrl: "https://evil.example/hook" })
        .where(eq(teamsIntegrationSettings.userId, w.admin.id));
      const agent = await loginAs(ctx.app, w.customer);
      const res = await createTicketAs(agent, {});
      expect(res.status).toBe(201);
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("evil.example"))).toHaveLength(0);
      expect(webhookHosts()).toEqual(["customer-owner.webhook.office.com"]);
    });

    it("fan-out posts at most WEBHOOK_CONCURRENCY webhooks at a time and still reaches all of them", async () => {
      const real = globalThis.fetch;
      let inFlight = 0;
      let peak = 0;
      fetchMock.mockImplementation(((input: unknown, init?: RequestInit) => {
        if (!String(input).includes("webhook.office.com")) return real(input as never, init);
        inFlight++;
        peak = Math.max(peak, inFlight);
        return new Promise((resolve) =>
          setTimeout(() => {
            inFlight--;
            resolve(new Response("1", { status: 200 }));
          }, 25)
        );
      }) as never);
      const requester = await createUser({ role: "customer" });
      const requesterAgent = await loginAs(ctx.app, requester);
      const created = await createTicketAs(requesterAgent, {});
      expect(created.status).toBe(201);
      for (let i = 0; i < 12; i++) await giveWebhook(await createUser({ role: "admin" }), `bulk-${i}`);
      fetchMock.mockClear();
      peak = 0;
      const [task] = await db.select().from(tasks);
      const { notifyTicketWebhooks, WEBHOOK_CONCURRENCY } = await import("../../services/teamsNotifications");
      await notifyTicketWebhooks({ task, kind: "updated", actionUrl: null });
      expect(webhookHosts()).toHaveLength(12);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(WEBHOOK_CONCURRENCY);
    });

    it("a private DNS answer blocks the call and the ticket still saves", async () => {
      const w = await world();
      (dnsPromises.lookup as unknown as jest.Mock).mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
      const agent = await loginAs(ctx.app, w.customer);
      const res = await createTicketAs(agent, {});
      expect(res.status).toBe(201);
      expect(webhookHosts()).toEqual([]);
      expect(await db.select().from(tasks)).toHaveLength(1);
    });
  });
});
