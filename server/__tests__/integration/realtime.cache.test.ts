import http from "http";
import { EventEmitter } from "events";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import request from "supertest";
import WebSocket from "ws";
import type { Express } from "express";
import type { User } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createTicketAs, createUser, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { pool } from "../../storage/db";
import { storage } from "../../storage";
import { hashPassword } from "../../services/auth";
import { addConnection, clearConnections, type Connection } from "../../realtime/connections";
import { attachRealtime, closeRealtime, notifyStaff, notifyTicket, ticketRecipients } from "../../realtime/ws";

/**
 * R51: eligibility is read once per second per connected set (not per event), and a ticket event
 * runs ONE set-based visibility query however many sockets are connected.
 */
describe("realtime eligibility cache and one visibility query", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let server: http.Server;
  let detach: () => void;
  let url: string;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    server = http.createServer(ctx.app as Express);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    detach = attachRealtime(server);
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });
  afterAll(async () => {
    detach();
    await closeRealtime();
    await new Promise<void>((r) => server.close(() => r()));
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const s of sockets.splice(0)) s.terminate();
    clearConnections();
  });

  /** Every SQL text sent through the pool while `fn` runs. */
  async function queriesDuring(fn: () => Promise<unknown>): Promise<string[]> {
    const seen: string[] = [];
    const real = pool.query.bind(pool) as (...a: unknown[]) => unknown;
    const spy = jest.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
      const first = args[0] as string | { text?: string };
      seen.push(typeof first === "string" ? first : String(first?.text ?? ""));
      return real(...args);
    }) as never);
    try {
      await fn();
    } finally {
      spy.mockRestore();
    }
    return seen;
  }
  const usersReads = (qs: string[]) => qs.filter((q) => /from "users"/i.test(q));
  const visibilityQueries = (qs: string[]) => qs.filter((q) => /unnest\(/i.test(q) || /union all/i.test(q));

  async function login(user: User) {
    const agent = request.agent(ctx.app);
    const res = await agent.post("/api/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
    return { agent, cookie };
  }

  function open(cookie: string) {
    return new Promise<{ ws: WebSocket; messages: any[]; closed: Promise<number> }>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { cookie } });
      sockets.push(ws);
      const messages: any[] = [];
      ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
      const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
      ws.on("open", () => resolve({ ws, messages, closed }));
      ws.on("error", reject);
    });
  }
  const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  function fakeSocket() {
    const ws: any = new EventEmitter();
    ws.readyState = WebSocket.OPEN;
    ws.send = jest.fn();
    ws.close = jest.fn(() => ws.emit("close"));
    ws.terminate = jest.fn();
    ws.ping = jest.fn();
    return ws as WebSocket & { send: jest.Mock };
  }
  function connect(user: { id: string; role: string }): ReturnType<typeof fakeSocket> {
    const ws = fakeSocket();
    const conn: Connection = { ws, user: { id: user.id, role: user.role }, authAt: Date.now(), pwdAt: undefined, alive: true };
    addConnection(conn);
    return ws;
  }

  it("a burst of 10 events within 1 s performs one users read", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const sa = await login(admin);
    const sg = await login(agent);
    const ticketId = (await createTicketAs(sg.agent)).body.id as number;
    const a = await open(sa.cookie);
    await open(sg.cookie);

    // The clock is held still so a slow machine cannot let the 1 s window lapse mid-burst.
    const frozen = jest.spyOn(Date, "now").mockReturnValue(Date.now());
    let qs: string[];
    try {
      qs = await queriesDuring(async () => {
        for (let i = 0; i < 10; i++) await notifyTicket(ticketId, "updated");
      });
    } finally {
      frozen.mockRestore();
    }
    expect(usersReads(qs)).toHaveLength(1);
    expect(visibilityQueries(qs)).toHaveLength(10); // one visibility query per event
    await quiet();
    expect(a.messages.filter((m) => m.ticketId === ticketId)).toHaveLength(10);
  });

  it("concurrent events share one in-flight users read, and staff broadcasts use the same cache", async () => {
    const admin = await createUser({ role: "admin" });
    const sa = await login(admin);
    const a = await open(sa.cookie);
    const qs = await queriesDuring(async () => {
      await Promise.all([notifyStaff("department:updated", {}), notifyStaff("department:updated", {}), notifyStaff("department:created", {})]);
    });
    expect(usersReads(qs)).toHaveLength(1);
    await quiet();
    expect(a.messages.filter((m) => String(m.type).startsWith("department:"))).toHaveLength(3);
  });

  it("one event with 250 connected sockets runs exactly one visibility query", async () => {
    const password = await hashPassword(DEFAULT_PASSWORD);
    const customers: User[] = [];
    for (let i = 0; i < 250; i++) {
      const id = randomUUID();
      customers.push(
        await storage.createUser({
          id,
          email: `bulk-${i}-${id.slice(0, 6)}@example.test`,
          password,
          firstName: "Bulk",
          lastName: String(i),
          role: "customer",
          isApproved: true,
          isActive: true,
        })
      );
    }
    const admin = await createUser({ role: "admin" });
    const task = await storage.createTask({
      title: "bulk",
      description: "bulk",
      category: "support",
      priority: "medium",
      status: "open",
      createdBy: customers[7].id,
    });
    const owner = connect(customers[7]);
    const others = customers.filter((_, i) => i !== 7).map((u) => connect(u));
    const adminSocket = connect(admin);
    expect(others).toHaveLength(249);

    let recipients: string[] = [];
    const qs = await queriesDuring(async () => {
      recipients = await ticketRecipients(task.id);
    });
    expect(visibilityQueries(qs)).toHaveLength(1);
    expect(usersReads(qs)).toHaveLength(1);
    expect(recipients.sort()).toEqual([admin.id, customers[7].id].sort());

    await notifyTicket(task.id, "updated");
    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(adminSocket.send).toHaveBeenCalledTimes(1);
    for (const o of others) expect(o.send).not.toHaveBeenCalled();
  });

  it("a user deactivated through the admin API is still closed at once, even with a warm cache", async () => {
    const a1 = await createUser({ role: "agent" });
    const admin = await createUser({ role: "admin" });
    const s1 = await login(a1);
    const sa = await login(admin);
    const ticketId = (await createTicketAs(s1.agent)).body.id as number;
    const c = await open(s1.cookie);
    const adminSocket = await open(sa.cookie);
    await notifyTicket(ticketId, "updated"); // warms the cache with a1 eligible
    await quiet(100);
    expect(c.messages).toHaveLength(1);

    await sa.agent.patch(`/api/admin/users/${a1.id}`).send({ isActive: false }).expect(200);
    expect(await c.closed).toBe(1008);
    await notifyTicket(ticketId, "updated");
    await quiet(200);
    expect(c.messages).toHaveLength(1);
    expect(adminSocket.messages.filter((m) => m.ticketId === ticketId)).toHaveLength(2);
  });

  it("approving a user (1012) drops the cached view: the reconnected socket is judged afresh", async () => {
    const u = await createUser({ role: "agent" });
    const admin = await createUser({ role: "admin" });
    const su = await login(u);
    const sa = await login(admin);
    const ticketId = (await createTicketAs(su.agent)).body.id as number;
    const c = await open(su.cookie);
    await open(sa.cookie);
    await notifyTicket(ticketId, "updated"); // warm
    await storage.approveUser(u.id);
    expect(await c.closed).toBe(1012);
    const again = await open(su.cookie);
    await notifyTicket(ticketId, "updated");
    await quiet(200);
    expect(again.messages.filter((m) => m.ticketId === ticketId)).toHaveLength(1);
  });

  it("a demotion through the admin API (disconnectUser epoch) is not served from the cache after an immediate reconnect", async () => {
    const admin = await createUser({ role: "admin" });
    const boss = await createUser({ role: "admin" });
    const other = await createUser({ role: "agent" });
    const sa = await login(admin);
    const sb = await login(boss);
    const so = await login(other);
    // A ticket the agent-scoped admin cannot see once demoted.
    const ticketId = (await createTicketAs(so.agent)).body.id as number;
    const first = await open(sa.cookie);
    await notifyTicket(ticketId, "updated"); // warms the cache: admin is eligible, role admin
    await quiet(100);
    expect(first.messages.filter((m) => m.ticketId === ticketId)).toHaveLength(1);

    await sb.agent.patch(`/api/admin/users/${admin.id}`).send({ role: "agent" }).expect(200);
    expect(await first.closed).toBe(1012);
    // Same user, same session stamps, same connected-set key: only the epoch tells the cache to drop.
    const again = await open(sa.cookie);
    await notifyTicket(ticketId, "updated");
    await quiet(300);
    expect(again.messages).toEqual([]);
  });

  it("a socket that connects inside the cache window is judged by the next event", async () => {
    const admin = await createUser({ role: "admin" });
    const late = await createUser({ role: "admin" });
    const sa = await login(admin);
    const sl = await login(late);
    const ticketId = (await createTicketAs(sa.agent)).body.id as number;
    await open(sa.cookie);
    await notifyTicket(ticketId, "updated"); // warm: only `admin` connected
    const l = await open(sl.cookie);
    await notifyTicket(ticketId, "updated");
    await quiet(200);
    expect(l.messages.filter((m) => m.ticketId === ticketId)).toHaveLength(1);
  });
});
