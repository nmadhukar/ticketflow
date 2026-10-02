/**
 * Real-time updates over a WebSocket at /ws.
 *
 * Identity comes from the session cookie on the upgrade request, never from a
 * message the client sends: the upgrade runs through the same session middleware
 * and passport deserializeUser as an HTTP request (services/auth
 * authenticateUpgrade). An upgrade without a valid session is accepted and then
 * closed with 1008 so a browser sees a close code, not a bare network error.
 *
 * Ticket events go only to connected users for whom the ticket is visible by the
 * one access rule (ticketVisibilityWhere, the rule behind canAccessTask). The
 * recipients of one event are resolved with ONE query (chunked), not one per user.
 *
 * Protocol (server to client only; client messages are ignored):
 *   { type: "ticket_updated", ticketId, reason: "created"|"updated"|"comment"|"deleted", ts, v: 1 }
 *   { type: "department:created"|"department:updated"|"department:deleted", data, ts, v: 1 }  (staff only)
 */
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { sql } from "drizzle-orm";
import { WebSocketServer, WebSocket } from "ws";
import { tasks } from "@shared/schema";
import { db } from "../storage/db";
import { authenticateUpgrade } from "../services/auth";
import { ticketVisibilityWhere, type AccessUser } from "../permissions/ticketAccess";
import { normalizeRole } from "../permissions/roles";

export const WS_PATH = "/ws";
const HEARTBEAT_MS = 30_000;
/** Visibility branches per recipient query. */
const RECIPIENT_CHUNK = 200;

export type TicketEventReason = "created" | "updated" | "comment" | "deleted";

interface Connection {
  ws: WebSocket;
  user: AccessUser;
  alive: boolean;
}

// userId -> that user's open sockets (one per tab).
const connections = new Map<string, Set<Connection>>();
let wss: WebSocketServer | undefined;
let heartbeat: NodeJS.Timeout | undefined;

function allConnections(): Connection[] {
  return Array.from(connections.values()).flatMap((set) => Array.from(set));
}

/** One representative connection per user (a user's tabs share id and role). */
function connectedUsers(): AccessUser[] {
  return Array.from(connections.values()).map((set) => Array.from(set)[0].user);
}

function getWss(): WebSocketServer {
  if (!wss) {
    wss = new WebSocketServer({ noServer: true });
    heartbeat = setInterval(() => {
      for (const c of allConnections()) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          c.ws.terminate();
        }
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }
  return wss;
}

function register(ws: WebSocket, user: AccessUser): void {
  const conn: Connection = { ws, user: { id: user.id, role: user.role }, alive: true };
  let set = connections.get(user.id);
  if (!set) connections.set(user.id, (set = new Set()));
  set.add(conn);
  ws.on("pong", () => {
    conn.alive = true;
  });
  // Nothing a client sends changes who it is or what it receives.
  ws.on("message", () => {});
  ws.on("error", () => {});
  ws.on("close", () => {
    const s = connections.get(user.id);
    if (!s) return;
    s.delete(conn);
    if (s.size === 0) connections.delete(user.id);
  });
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  let user: AccessUser | null = null;
  try {
    user = await authenticateUpgrade(req);
  } catch {
    user = null;
  }
  if (socket.destroyed) return;
  getWss().handleUpgrade(req, socket, head, (ws) => {
    if (!user) {
      ws.close(1008, "unauthorized");
      return;
    }
    register(ws, user);
  });
}

/** Starts serving /ws on this HTTP server. Returns a function that stops doing so. */
export function attachRealtime(server: Server): () => void {
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      /* unparseable URL: not ours */
    }
    // Other upgrade paths (the Vite dev server's HMR socket) are not ours to touch.
    if (pathname !== WS_PATH) return;
    void handleUpgrade(req, socket, head);
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
  };
}

/** Closes every socket and stops the heartbeat. */
export async function closeRealtime(): Promise<void> {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
  for (const c of allConnections()) c.ws.terminate();
  connections.clear();
  const server = wss;
  wss = undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Open sockets right now (all users, all tabs). */
export function connectionCount(): number {
  return allConnections().length;
}

function sendTo(userIds: string[], message: unknown): void {
  const payload = JSON.stringify(message);
  for (const id of userIds) {
    for (const c of Array.from(connections.get(id) ?? [])) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      try {
        c.ws.send(payload);
      } catch (error) {
        console.error("WS send error:", error instanceof Error ? error.message : "unknown");
      }
    }
  }
}

/**
 * The connected users who can see ticket `ticketId` right now. One query per
 * RECIPIENT_CHUNK connected users: each user contributes a branch
 * `SELECT <id> FROM tasks WHERE id = <ticket> AND <ticketVisibilityWhere(user)>`,
 * UNION ALLed, so the rule is exactly the one canAccessTask applies.
 */
export async function ticketRecipients(ticketId: number): Promise<string[]> {
  const candidates = connectedUsers();
  const allowed: string[] = [];
  for (let i = 0; i < candidates.length; i += RECIPIENT_CHUNK) {
    const branches = candidates.slice(i, i + RECIPIENT_CHUNK).map(
      (u) =>
        sql`(SELECT ${u.id}::text AS uid FROM ${tasks} WHERE ${tasks.id} = ${ticketId} AND ${ticketVisibilityWhere(u)})`
    );
    const result = await db.execute(sql.join(branches, sql` UNION ALL `));
    for (const row of result.rows as Array<{ uid: string }>) allowed.push(row.uid);
  }
  return allowed;
}

function ticketMessage(ticketId: number, reason: TicketEventReason) {
  return { type: "ticket_updated", ticketId, reason, ts: Date.now(), v: 1 };
}

/**
 * Tells everyone connected who can see the ticket that it changed. Never throws:
 * a failed notification must not fail the write that triggered it.
 * Pass `recipients` (from ticketRecipients, taken BEFORE a delete) to skip the lookup.
 */
export async function notifyTicket(
  ticketId: number,
  reason: TicketEventReason,
  recipients?: string[]
): Promise<void> {
  try {
    if (connectionCount() === 0) return;
    const to = recipients ?? (await ticketRecipients(ticketId));
    sendTo(to, ticketMessage(ticketId, reason));
  } catch (error) {
    console.error("WS notify ticket error:", error instanceof Error ? error.message : "unknown");
  }
}

/** Staff-only broadcast (department changes): customers get nothing. */
export function notifyStaff(type: string, data: unknown): void {
  const message = { type, data, ts: Date.now(), v: 1 };
  const ids = connectedUsers()
    .filter((u) => {
      const role = normalizeRole(u.role);
      return role === "admin" || role === "manager" || role === "agent";
    })
    .map((u) => u.id);
  sendTo(ids, message);
}
