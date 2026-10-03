import { eq } from "drizzle-orm";
import { teamsIntegrationSettings, tasks, type User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { mcpFor } from "./helpers/mcpClient";
import { fakeWebhookTransport } from "../utils/fakeWebhookTransport";

const hook = (tenant: string) => `https://${tenant}.webhook.office.com/webhookb2/abc@def/IncomingWebhook/xyz/secret`;

describe("Teams webhook settings and fan-out", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  // R44: webhooks go out through https.request with a pinned lookup. The fake runs that lookup, so
  // a webhook counts as sent only when its host resolved to a public address (see the helper).
  let net: ReturnType<typeof fakeWebhookTransport>;
  let dnsAnswer: string[];
  // R84: the feature is off unless TEAMS_WEBHOOKS_ENABLED is exactly "true"; this file tests it on
  // (and, in the last describe, off).
  const savedFlag = process.env.TEAMS_WEBHOOKS_ENABLED;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.TEAMS_WEBHOOKS_ENABLED;
    else process.env.TEAMS_WEBHOOKS_ENABLED = savedFlag;
    await ctx.close();
  });
  beforeEach(async () => {
    process.env.TEAMS_WEBHOOKS_ENABLED = "true";
    await resetDb();
    dnsAnswer = ["52.96.0.1"];
    net = fakeWebhookTransport({ addresses: () => dnsAnswer });
  });
  afterEach(() => jest.restoreAllMocks());

  const webhookHosts = () =>
    net
      .delivered()
      .map((c) => String(c.options.hostname))
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
      expect(net.calls.filter((c) => c.options.hostname === "evil.example")).toHaveLength(0);
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
    const bodies = () => net.delivered().map((c) => c.body);

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

        net.calls.length = 0;
        const updated = await mcp.call("update_ticket", { id: created.data.id, priority: "high" });
        expect(updated.isError).toBe(false);
        expect(bodies()).toHaveLength(1);
        expect(bodies()[0]).toContain("https://tickets.example.test/my-tasks");

        delete process.env.APP_BASE_URL;
        net.calls.length = 0;
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
      net.calls.length = 0;
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
      expect(net.calls.filter((c) => c.options.hostname === "evil.example")).toHaveLength(0);
      expect(webhookHosts()).toEqual(["customer-owner.webhook.office.com"]);
    });

    it("fan-out posts at most WEBHOOK_CONCURRENCY webhooks at a time and still reaches all of them", async () => {
      jest.restoreAllMocks();
      net = fakeWebhookTransport({ addresses: () => dnsAnswer, delayMs: 25 });
      const requester = await createUser({ role: "customer" });
      const requesterAgent = await loginAs(ctx.app, requester);
      const created = await createTicketAs(requesterAgent, {});
      expect(created.status).toBe(201);
      for (let i = 0; i < 12; i++) await giveWebhook(await createUser({ role: "admin" }), `bulk-${i}`);
      net.calls.length = 0;
      net.resetPeak();
      const [task] = await db.select().from(tasks);
      const { notifyTicketWebhooks, WEBHOOK_CONCURRENCY } = await import("../../services/teamsNotifications");
      await notifyTicketWebhooks({ task, kind: "updated", actionUrl: null });
      expect(webhookHosts()).toHaveLength(12);
      expect(net.peak()).toBeGreaterThan(1);
      expect(net.peak()).toBeLessThanOrEqual(WEBHOOK_CONCURRENCY);
    });

    it("a private DNS answer blocks the call and the ticket still saves", async () => {
      const w = await world();
      dnsAnswer = ["169.254.169.254"];
      const agent = await loginAs(ctx.app, w.customer);
      const res = await createTicketAs(agent, {});
      expect(res.status).toBe(201);
      expect(webhookHosts()).toEqual([]);
      expect(await db.select().from(tasks)).toHaveLength(1);
    });
  });

  describe("R84: off unless TEAMS_WEBHOOKS_ENABLED is exactly 'true'", () => {
    const OFF: Array<string | undefined> = [undefined, "", "false", "TRUE", "True", "1", "yes", " true"];
    const setFlag = (v: string | undefined) => {
      if (v === undefined) delete process.env.TEAMS_WEBHOOKS_ENABLED;
      else process.env.TEAMS_WEBHOOKS_ENABLED = v;
    };

    it.each(OFF)("flag %j: a ticket event sends nothing, makes no fetch or https call, and the ticket saves", async (flag) => {
      const admin = await createUser({ role: "admin" });
      const customer = await createUser({ role: "customer" });
      await giveWebhook(admin, "admin");
      await giveWebhook(customer, "customer-owner");
      setFlag(flag);
      const fetchSpy = jest.spyOn(globalThis, "fetch");
      const agent = await loginAs(ctx.app, customer);
      const res = await createTicketAs(agent, {});
      expect(res.status).toBe(201);
      expect(net.calls).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      const { notifyTicketWebhooks } = await import("../../services/teamsNotifications");
      const [task] = await db.select().from(tasks);
      await notifyTicketWebhooks({ task, kind: "updated", actionUrl: null });
      expect(net.calls).toHaveLength(0);
    });

    it.each(OFF)("flag %j: the test route answers 503 teams_webhooks_disabled with no outbound call", async (flag) => {
      const admin = await createUser({ role: "admin" });
      await giveWebhook(admin, "contoso");
      setFlag(flag);
      const res = await (await loginAs(ctx.app, admin)).post("/api/teams-integration/test");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("teams_webhooks_disabled");
      expect(typeof res.body.message).toBe("string");
      expect(net.calls).toHaveLength(0);
    });

    it.each(OFF)("flag %j: saving webhook settings answers 409 teams_webhooks_disabled and stores nothing", async (flag) => {
      const admin = await createUser({ role: "admin" });
      setFlag(flag);
      const res = await (await loginAs(ctx.app, admin))
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl: hook("contoso"), notificationTypes: ["ticket_created"] });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("teams_webhooks_disabled");
      expect(await db.select().from(teamsIntegrationSettings)).toHaveLength(0);
    });

    it("the settings read says whether the feature is on, and removing settings still works when it is off", async () => {
      const admin = await createUser({ role: "admin" });
      await giveWebhook(admin, "contoso");
      const agent = await loginAs(ctx.app, admin);
      expect((await agent.get("/api/teams-integration/settings")).body.webhooksEnabled).toBe(true);
      setFlag(undefined);
      expect((await agent.get("/api/teams-integration/settings")).body.webhooksEnabled).toBe(false);
      expect((await agent.delete("/api/teams-integration/settings")).status).toBe(200);
    });

    it("exactly 'true' turns it back on", async () => {
      const admin = await createUser({ role: "admin" });
      setFlag("true");
      const res = await (await loginAs(ctx.app, admin))
        .post("/api/teams-integration/settings")
        .send({ enabled: true, webhookUrl: hook("contoso"), notificationTypes: ["ticket_created"] });
      expect(res.status).toBe(200);
    });
  });
});
