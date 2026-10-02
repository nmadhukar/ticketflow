import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import WebSocket from "ws";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, createTicketAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { attachRealtime, closeRealtime, connectionCount } from "../../realtime/ws";
import type { Express } from "express";
import type { User } from "@shared/schema";

type Agent = ReturnType<typeof request.agent>;

interface Client {
  ws: WebSocket;
  messages: any[];
  closed: Promise<{ code: number }>;
  waitFor(pred: (m: any) => boolean, ms?: number): Promise<any>;
}

describe("real-time updates over an authenticated WebSocket", () => {
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
    for (const s of sockets.splice(0)) s.terminate();
  });

  /** Logs in and keeps the cookie header (the ws client sends it on the upgrade). */
  async function login(user: User): Promise<{ agent: Agent; cookie: string }> {
    const agent = request.agent(ctx.app);
    const res = await agent.post("/api/auth/login").send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    const raw = res.headers["set-cookie"] as unknown as string[];
    const cookie = raw.map((c) => c.split(";")[0]).join("; ");
    return { agent, cookie };
  }

  /** Opens a socket; resolves once the server has either accepted it or closed it. */
  function open(cookie?: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
      sockets.push(ws);
      const messages: any[] = [];
      const waiters: Array<{ pred: (m: any) => boolean; res: (m: any) => void }> = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        messages.push(m);
        for (const w of [...waiters]) {
          if (w.pred(m)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.res(m);
          }
        }
      });
      const closed = new Promise<{ code: number }>((r) => ws.on("close", (code) => r({ code })));
      const client: Client = {
        ws,
        messages,
        closed,
        waitFor(pred, ms = 2000) {
          const hit = messages.find(pred);
          if (hit) return Promise.resolve(hit);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`no matching message within ${ms}ms`)), ms);
            waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
          });
        },
      };
      ws.on("open", () => resolve(client));
      ws.on("error", reject);
    });
  }

  const quiet = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  it("closes an upgrade with no session cookie with 1008", async () => {
    const c = await open();
    expect((await c.closed).code).toBe(1008);
    expect(connectionCount()).toBe(0);
  });

  it("closes an upgrade with a forged session cookie with 1008", async () => {
    const c = await open("connect.sid=s%3Anot-a-real-session.forged");
    expect((await c.closed).code).toBe(1008);
  });

  it("closes the upgrade of a user who has since been deactivated", async () => {
    const u = await createUser({ role: "agent" });
    const { cookie } = await login(u);
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    expect((await (await open(cookie)).closed).code).toBe(1008);
  });

  it("closes the upgrade of a session revoked by a later password change", async () => {
    const u = await createUser({ role: "agent" });
    const { cookie } = await login(u);
    await db.update(users).set({ passwordChangedAt: new Date(Date.now() + 5000) }).where(eq(users.id, u.id));
    expect((await (await open(cookie)).closed).code).toBe(1008);
  });

  it("tells A1 when their ticket changes, and tells A3 (no access) nothing, even after forging an auth message", async () => {
    const admin = await createUser({ role: "admin" });
    const a1 = await createUser({ role: "agent" });
    const a3 = await createUser({ role: "agent" });
    const s1 = await login(a1);
    const s3 = await login(a3);
    const created = await createTicketAs(s1.agent);
    expect(created.status).toBe(201);
    const ticketId = created.body.id as number;

    const c1 = await open(s1.cookie);
    const c3 = await open(s3.cookie);
    // The client used to name itself this way; the server must ignore it.
    c3.ws.send(JSON.stringify({ type: "auth", userId: admin.id }));
    await quiet(100);

    const patch = await s1.agent.patch(`/api/tasks/${ticketId}`).send({ priority: "high" });
    expect(patch.status).toBe(200);

    const msg = await c1.waitFor((m) => m.type === "ticket_updated" && m.ticketId === ticketId);
    expect(msg.type).toBe("ticket_updated");
    expect(msg.ticketId).toBe(ticketId);
    await quiet();
    expect(c3.messages).toEqual([]);
  });

  it("reaches every tab of the same user", async () => {
    const a1 = await createUser({ role: "agent" });
    const s1 = await login(a1);
    const ticketId = (await createTicketAs(s1.agent)).body.id as number;
    const tab1 = await open(s1.cookie);
    const tab2 = await open(s1.cookie);
    expect(connectionCount()).toBe(2);

    await s1.agent.patch(`/api/tasks/${ticketId}`).send({ priority: "urgent" }).expect(200);

    const isIt = (m: any) => m.type === "ticket_updated" && m.ticketId === ticketId;
    await Promise.all([tab1.waitFor(isIt), tab2.waitFor(isIt)]);
  });

  it("removes a socket from the registry when it closes", async () => {
    const a1 = await createUser({ role: "agent" });
    const s1 = await login(a1);
    const tab = await open(s1.cookie);
    expect(connectionCount()).toBe(1);
    tab.ws.close();
    await tab.closed;
    await quiet(50);
    expect(connectionCount()).toBe(0);
  });

  it("sends a comment on a ticket to users who can see it, not to others", async () => {
    const a1 = await createUser({ role: "agent" });
    const a3 = await createUser({ role: "agent" });
    const admin = await createUser({ role: "admin" });
    const s1 = await login(a1);
    const s3 = await login(a3);
    const sa = await login(admin);
    const ticketId = (await createTicketAs(s1.agent)).body.id as number;
    const c1 = await open(s1.cookie);
    const c3 = await open(s3.cookie);

    await sa.agent.post(`/api/tasks/${ticketId}/comments`).send({ content: "hello" }).expect(201);

    await c1.waitFor((m) => m.type === "ticket_updated" && m.ticketId === ticketId);
    await quiet();
    expect(c3.messages).toEqual([]);
  });

  it("still tells the people who could see a ticket when it is deleted", async () => {
    const a1 = await createUser({ role: "agent" });
    const admin = await createUser({ role: "admin" });
    const s1 = await login(a1);
    const sa = await login(admin);
    const ticketId = (await createTicketAs(s1.agent)).body.id as number;
    const c1 = await open(s1.cookie);

    await sa.agent.delete(`/api/tasks/${ticketId}`).expect(204);

    const m = await c1.waitFor((x) => x.type === "ticket_updated" && x.ticketId === ticketId);
    expect(m.reason).toBe("deleted");
  });
});
