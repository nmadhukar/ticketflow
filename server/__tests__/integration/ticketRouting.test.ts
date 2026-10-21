import { eq } from "drizzle-orm";
import { departments, tasks, taskHistory } from "@shared/schema";
import { aiModelMock, MOCK_MODEL_ID } from "../mocks/openRouter.mock";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTeam, createTicketAs, createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import * as realtime from "../../realtime/ws";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";
import { routeTicket } from "../../services/ai/ticketRouting";
import type { Task } from "@shared/schema";

/**
 * 0031: a new ticket whose analysis finds no confident answer is classified and assigned to the
 * team that owns its problem area. The whole feature is gated on ai_settings.auto_routing_enabled
 * (default false), so every existing create path is unchanged when it is off.
 */
describe("0031 content-based ticket routing", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const priorOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
    if (priorOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouterApiKey;
  });
  beforeEach(async () => {
    await resetDb();
    await ensureAiSystemUser();
    aiModelMock.reset();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** AI active, auto-response on but a threshold the ticket cannot reach: analysis finds no answer. */
  async function enableRouting(opts: { autoRoutingEnabled: boolean; threshold?: string } = { autoRoutingEnabled: true }) {
    const admin = await createUser({ role: "admin" });
    await storage.updateAISettings({
      modelId: MOCK_MODEL_ID,
      isActive: true,
      autoResponseEnabled: true,
      confidenceThreshold: opts.threshold ?? "0.95",
      maxResponseLength: 1000,
      maxTokensPerRequest: 3000,
      autoRoutingEnabled: opts.autoRoutingEnabled,
    }, admin.id);
    return admin;
  }

  const taskRow = (id: number) => db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  it("off by default: no classification call and no assignment", async () => {
    const admin = await createUser({ role: "admin" });
    const team = await createTeam(admin);
    expect(await storage.getAISettings()).toBeUndefined();

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken" });
    expect(res.status).toBe(201);
    expect(res.body.assigneeTeamId).toBeNull();
    expect(res.body.assigneeType).not.toBe("team");
    expect(aiModelMock.totalCalls()).toBe(0);
    expect(team.id).toBeGreaterThan(0);
  });

  it("with routing on, an unmatched ticket is classified and assigned to the owning team", async () => {
    // Two teams in active departments: the mock answers with the first team id it sees.
    const admin = await createUser({ role: "admin" });
    const otherTeam = await createTeam(admin, { name: "Billing" });
    const target = await createTeam(admin, { name: "AAA Technical Support" });
    await enableRouting({ autoRoutingEnabled: true });

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken", description: "The app crashes on save." });
    expect(res.status).toBe(201);

    const [row] = await taskRow(res.body.id as number);
    expect(row.assigneeType).toBe("team");
    expect(row.assigneeTeamId).not.toBeNull();
    expect([target.id, otherTeam.id]).toContain(row.assigneeTeamId as number);
    expect(row.assigneeId).toBeNull();

    // The assignment is attributable: a person can see the AI moved it.
    const history = await db.select().from(taskHistory).where(eq(taskHistory.taskId, res.body.id as number));
    const assignment = history.find((h) => h.field === "assigneeTeamId");
    expect(assignment?.userId).toBe(AI_SYSTEM_USER_ID);

    // And the routing prompt was a real model call carrying the team list.
    expect(aiModelMock.prompts.some((p) => p.includes("expert helpdesk triage router"))).toBe(true);
  });

  it("with auto-response off but routing on, the ticket is still routed (no reply is written)", async () => {
    const admin = await createUser({ role: "admin" });
    const team = await createTeam(admin);
    await storage.updateAISettings({
      modelId: MOCK_MODEL_ID, isActive: true, autoResponseEnabled: false,
      maxTokensPerRequest: 3000, autoRoutingEnabled: true,
    }, admin.id);

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken" });
    expect(res.status).toBe(201);
    const [row] = await taskRow(res.body.id as number);
    expect(row.assigneeTeamId).toBe(team.id);
    expect(aiModelMock.prompts.every((p) => !p.includes("helpful IT support assistant"))).toBe(true);
  });

  it("a ticket already owned by a specific team is left alone", async () => {
    const admin = await createUser({ role: "admin" });
    const owningTeam = await createTeam(admin);
    await enableRouting({ autoRoutingEnabled: true });

    const task = {
      id: 999999, title: "Already owned", description: "d", category: "support",
      priority: "medium", status: "new", assigneeType: "team", assigneeTeamId: owningTeam.id,
      assigneeId: null, createdBy: admin.id, ticketNumber: "TKT-1",
    } as unknown as Task;
    expect(await routeTicket(task)).toBeNull();
  });

  it("a low-confidence guess does not move the ticket out of triage", async () => {
    const admin = await createUser({ role: "admin" });
    const escalationTeam = await createTeam(admin, { name: "Escalation" });
    const routedTeam = await createTeam(admin, { name: "AAA Technical Support" });
    await enableRouting({ autoRoutingEnabled: true });
    await storage.updateAISettings({ escalationTeamId: escalationTeam.id }, admin.id);

    const base = aiModelMock.handler;
    aiModelMock.handler = (p) =>
      p.includes("expert helpdesk triage router")
        ? JSON.stringify({ teamId: routedTeam.id, departmentId: null, confidence: 0.05, reason: "guess" })
        : base(p);

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken", description: "The app crashes on save." });
    expect(res.status).toBe(201);

    const [row] = await taskRow(res.body.id as number);
    // The weak guess is not acted on: the escalation fallback wins instead.
    expect(row.assigneeTeamId).not.toBe(routedTeam.id);
    expect(row.assigneeTeamId).toBe(escalationTeam.id);
  });

  it("re-reads before writing, so an agent who takes the ticket is not overwritten", async () => {
    // The routing decision is taken on the row as it was created, then the model call takes
    // seconds. This reproduces that window: the snapshot says "unassigned", the database says
    // "an agent owns it", and the late write must not act on the stale snapshot.
    const admin = await createUser({ role: "admin" });
    const target = await createTeam(admin, { name: "AAA Technical Support" });
    const agent = await createUser({ role: "agent" });
    await enableRouting({ autoRoutingEnabled: false });

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const created = await createTicketAs(customerA, { title: "Printerjam broken", description: "The app crashes on save." });
    expect(created.status).toBe(201);

    // The stamp the routing pass will carry: read before anyone touches the ticket.
    const [snapshot] = await taskRow(created.body.id as number);
    expect(snapshot.assigneeId).toBeNull();
    expect(target.id).toBeGreaterThan(0);

    // Routing is on for the explicit pass, and an agent takes the ticket in the meantime.
    await enableRouting({ autoRoutingEnabled: true });
    await storage.updateTask(created.body.id as number, { assigneeType: "user", assigneeId: agent.id, assigneeTeamId: null }, admin.id);

    // A late routing pass carrying the stale snapshot must leave that assignment alone.
    expect(await routeTicket(snapshot as Task)).toBeNull();
    const [after] = await taskRow(created.body.id as number);
    expect(after.assigneeId).toBe(agent.id);
    expect(after.assigneeTeamId).toBeNull();
  });

  it("notifies the new team through the normal update hooks", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createTeam(admin, { name: "AAA Technical Support" });
    await enableRouting({ autoRoutingEnabled: true });
    const notify = jest.spyOn(realtime, "notifyTicket");

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken", description: "The app crashes on save." });
    expect(res.status).toBe(201);

    const [row] = await taskRow(res.body.id as number);
    expect(row.assigneeTeamId).toBe(target.id);
    // Routing goes through the same hooks as a person's reassignment: the ticket is announced
    // as updated, which is what tells the team it landed on their queue.
    expect(notify).toHaveBeenCalledWith(res.body.id as number, "updated", expect.anything());
  });

  it("an unusable model answer falls back to the escalation team, and never throws", async () => {
    const admin = await createUser({ role: "admin" });
    const escalationTeam = await createTeam(admin, { name: "Escalation" });
    await enableRouting({ autoRoutingEnabled: true });
    await storage.updateAISettings({ escalationTeamId: escalationTeam.id }, admin.id);

    const base = aiModelMock.handler;
    aiModelMock.handler = (p) => (p.includes("expert helpdesk triage router") ? "not json at all" : base(p));

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken" });
    expect(res.status).toBe(201);
    const [row] = await taskRow(res.body.id as number);
    expect(row.assigneeTeamId).toBe(escalationTeam.id);
  });

  it("the admin API round-trips the new setting and defaults it off", async () => {
    const adminA = await loginAs(ctx.app, await createUser({ role: "admin" }));
    const initial = await adminA.get("/api/admin/ai-settings");
    expect(initial.status).toBe(200);
    expect(initial.body.autoRoutingEnabled).toBe(false);

    const put = await adminA.put("/api/admin/ai-settings").send({ autoRoutingEnabled: true });
    expect(put.status).toBe(200);
    expect(put.body.autoRoutingEnabled).toBe(true);
  });

  it("the active department filter is honoured: teams in inactive departments are not routable", async () => {
    const admin = await createUser({ role: "admin" });
    const team = await createTeam(admin);
    await db.update(departments).set({ isActive: false }).where(eq(departments.id, team.departmentId as number));
    await enableRouting({ autoRoutingEnabled: true });

    const customer = await createUser({ role: "customer" });
    const customerA = await loginAs(ctx.app, customer);
    const res = await createTicketAs(customerA, { title: "Printerjam broken" });
    expect(res.status).toBe(201);
    const [row] = await taskRow(res.body.id as number);
    expect(row.assigneeTeamId).toBeNull();
  });
});