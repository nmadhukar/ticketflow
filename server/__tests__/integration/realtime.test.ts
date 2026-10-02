import http from "http";
import net from "net";
import { createHmac, randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { eq, sql } from "drizzle-orm";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";
import request from "supertest";
import WebSocket from "ws";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, createTicketAs, DEFAULT_PASSWORD } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { attachRealtime, closeRealtime, connectionCount, notifyTicket } from "../../realtime/ws";
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
  function open(cookie?: string, extraHeaders: Record<string, string> = {}): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), ...extraHeaders } });
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

  describe("a bad client cannot crash the server", () => {
    it("survives a malformed frame sent to an unauthenticated (1008-closing) socket", async () => {
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((resolve) => {
        const raw = net.connect(port, "127.0.0.1", () => {
          raw.write(
            "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
              "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
          );
        });
        let sent = false;
        raw.on("data", () => {
          if (sent) return;
          sent = true;
          // FIN + RSV1 + text, masked, empty: an invalid frame (RSV1 without an extension).
          raw.write(Buffer.from([0xc1, 0x80, 1, 2, 3, 4]));
          setTimeout(() => {
            raw.destroy();
            resolve();
          }, 300);
        });
        raw.on("error", () => resolve());
      });
      // Still alive and serving.
      const res = await request(server).post("/api/auth/check-email").send({ email: "nobody@example.test" });
      expect(res.status).toBe(200);
    });

    it("closes an authenticated socket that sends an oversized frame, and keeps serving", async () => {
      const a1 = await createUser({ role: "agent" });
      const s1 = await login(a1);
      const c = await open(s1.cookie);
      c.ws.send(Buffer.alloc(8192, 1));
      expect((await c.closed).code).toBe(1009);
      await quiet(150);
      expect(connectionCount()).toBe(0);
      expect((await request(server).post("/api/auth/check-email").send({ email: "x@example.test" })).status).toBe(200);
    });
  });

  describe("a socket does not outlive the state it was admitted under", () => {
    it("a deactivated user: direct DB change, next event closes the socket and delivers nothing", async () => {
      const a1 = await createUser({ role: "agent" });
      const s1 = await login(a1);
      const ticketId = (await createTicketAs(s1.agent)).body.id as number;
      const c = await open(s1.cookie);
      await db.update(users).set({ isActive: false }).where(eq(users.id, a1.id));
      await notifyTicket(ticketId, "updated");
      expect((await c.closed).code).toBe(1008);
      expect(c.messages).toEqual([]);
    });

    it("a deactivated user: through the admin API the socket closes at once", async () => {
      const a1 = await createUser({ role: "agent" });
      const admin = await createUser({ role: "admin" });
      const s1 = await login(a1);
      const sa = await login(admin);
      const c = await open(s1.cookie);
      await sa.agent.patch(`/api/admin/users/${a1.id}`).send({ isActive: false }).expect(200);
      expect((await c.closed).code).toBe(1008);
      const toggled = await createUser({ role: "agent" });
      const st = await login(toggled);
      const c2 = await open(st.cookie);
      await sa.agent.post(`/api/admin/users/${toggled.id}/toggle-status`).expect(200);
      expect((await c2.closed).code).toBe(1008);
    });

    it("an admin demoted to agent (DB change) gets no events for tickets outside agent scope", async () => {
      const admin = await createUser({ role: "admin" });
      const other = await createUser({ role: "agent" });
      const so = await login(other);
      const sa = await login(admin);
      const ticketId = (await createTicketAs(so.agent)).body.id as number;
      const c = await open(sa.cookie);
      // Control: as admin the event arrives.
      await so.agent.patch(`/api/tasks/${ticketId}`).send({ priority: "low" }).expect(200);
      await c.waitFor((m) => m.ticketId === ticketId);
      c.messages.length = 0;

      await db.update(users).set({ role: "agent" }).where(eq(users.id, admin.id));
      await so.agent.patch(`/api/tasks/${ticketId}`).send({ priority: "high" }).expect(200);
      await quiet();
      expect(c.messages).toEqual([]);
    });

    it("an admin demoted through the admin API is reconnected (1012) and then sees only agent scope", async () => {
      const admin = await createUser({ role: "admin" });
      const boss = await createUser({ role: "admin" });
      const other = await createUser({ role: "agent" });
      const so = await login(other);
      const sa = await login(admin);
      const sb = await login(boss);
      const ticketId = (await createTicketAs(so.agent)).body.id as number;
      const c = await open(sa.cookie);
      await sb.agent.patch(`/api/admin/users/${admin.id}`).send({ role: "agent" }).expect(200);
      expect((await c.closed).code).toBe(1012);
      // The reconnect carries the new role.
      const again = await open(sa.cookie);
      await so.agent.patch(`/api/tasks/${ticketId}`).send({ priority: "high" }).expect(200);
      await quiet();
      expect(again.messages).toEqual([]);
    });

    it("a password change closes the user's other devices (1008 on reconnect) and keeps the changing device", async () => {
      const u = await createUser({ role: "agent" });
      const device1 = await login(u);
      const device2 = await login(u);
      const c1 = await open(device1.cookie);
      const c2 = await open(device2.cookie);
      await device2.agent
        .post("/api/auth/change-password")
        .send({ currentPassword: DEFAULT_PASSWORD, password: "Another-Passw0rd!x" })
        .expect(200);
      expect((await c1.closed).code).toBe(1012);
      expect((await c2.closed).code).toBe(1012);
      // Other device: its session is revoked, so reconnecting is refused.
      expect((await (await open(device1.cookie)).closed).code).toBe(1008);
      // Changing device: its session was re-stamped, reconnecting works.
      const back = await open(device2.cookie);
      expect(connectionCount()).toBe(1);
      back.ws.close();
    });

    it("an admin password reset closes the user's sockets with 1008", async () => {
      const u = await createUser({ role: "agent" });
      const admin = await createUser({ role: "admin" });
      const su = await login(u);
      const sa = await login(admin);
      const c = await open(su.cookie);
      await sa.agent.post(`/api/admin/users/${u.id}/reset-password`).expect(200);
      expect((await c.closed).code).toBe(1008);
    });

    it("a password change in the DB: the next event closes the stale session's socket and delivers nothing", async () => {
      const u = await createUser({ role: "agent" });
      const s = await login(u);
      const ticketId = (await createTicketAs(s.agent)).body.id as number;
      const c = await open(s.cookie);
      await db.update(users).set({ passwordChangedAt: new Date(Date.now() + 5000) }).where(eq(users.id, u.id));
      await notifyTicket(ticketId, "updated");
      expect((await c.closed).code).toBe(1008);
      expect(c.messages).toEqual([]);
    });
  });

  describe("Origin", () => {
    it("closes an upgrade from a foreign Origin with 1008, even with a valid cookie", async () => {
      const u = await createUser({ role: "agent" });
      const { cookie } = await login(u);
      const c = await open(cookie, { origin: "https://evil.example" });
      expect((await c.closed).code).toBe(1008);
      expect(connectionCount()).toBe(0);
    });

    it("accepts the page's own origin", async () => {
      const u = await createUser({ role: "agent" });
      const { cookie } = await login(u);
      const origin = url.replace("ws://", "http://").replace("/ws", "");
      await open(cookie, { origin });
      expect(connectionCount()).toBe(1);
    });

    it("accepts an origin listed in CORS_ORIGIN and ignores a wildcard", async () => {
      const u = await createUser({ role: "agent" });
      const { cookie } = await login(u);
      const saved = process.env.CORS_ORIGIN;
      try {
        process.env.CORS_ORIGIN = "*";
        expect((await (await open(cookie, { origin: "https://app.example" })).closed).code).toBe(1008);
        process.env.CORS_ORIGIN = "https://other.example, https://app.example";
        await open(cookie, { origin: "https://app.example" });
        expect(connectionCount()).toBe(1);
      } finally {
        if (saved === undefined) delete process.env.CORS_ORIGIN;
        else process.env.CORS_ORIGIN = saved;
      }
    });
  });

  describe("reassignment", () => {
    it("tells the user who lost access as well as the one who gained it, and nobody else", async () => {
      const admin = await createUser({ role: "admin" });
      const a2 = await createUser({ role: "agent" });
      const a3 = await createUser({ role: "agent" });
      const a4 = await createUser({ role: "agent" });
      const sa = await login(admin);
      const [s2, s3, s4] = [await login(a2), await login(a3), await login(a4)];
      const created = await createTicketAs(sa.agent, { assigneeId: a2.id });
      expect(created.status).toBe(201);
      const ticketId = created.body.id as number;
      const [c2, c3, c4] = [await open(s2.cookie), await open(s3.cookie), await open(s4.cookie)];

      await sa.agent.patch(`/api/tasks/${ticketId}`).send({ assigneeId: a3.id }).expect(200);

      const isIt = (m: any) => m.type === "ticket_updated" && m.ticketId === ticketId;
      await Promise.all([c2.waitFor(isIt), c3.waitFor(isIt)]);
      await quiet();
      expect(c4.messages).toEqual([]);
    });
  });

  describe("the AI system user", () => {
    function signedCookie(sid: string): string {
      const secret = process.env.SESSION_SECRET || "dev-only-session-secret-not-for-production";
      const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
      return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
    }
    async function insertSession(userId: string): Promise<string> {
      const sid = randomUUID();
      const sess = {
        cookie: { originalMaxAge: 604800000, expires: new Date(Date.now() + 604800000).toISOString(), httpOnly: true, path: "/" },
        passport: { user: userId },
        authAt: Date.now(),
      };
      await db.execute(sql`INSERT INTO sessions (sid, sess, expire) VALUES (${sid}, ${JSON.stringify(sess)}::jsonb, NOW() + interval '1 day')`);
      return signedCookie(sid);
    }

    it("a hand-built session for a real agent is accepted (the harness works)", async () => {
      const u = await createUser({ role: "agent" });
      await open(await insertSession(u.id));
      expect(connectionCount()).toBe(1);
    });

    it("a session whose passport user is the AI system user is closed with 1008", async () => {
      const c = await open(await insertSession(AI_SYSTEM_USER_ID));
      expect((await c.closed).code).toBe(1008);
      expect(connectionCount()).toBe(0);
    });
  });
});
