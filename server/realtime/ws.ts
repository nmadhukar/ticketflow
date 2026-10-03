/**
 * Real-time updates over a WebSocket at /ws.
 *
 * Identity comes from the session cookie on the upgrade request, never from a
 * message the client sends: the upgrade runs through the same session middleware
 * and passport deserializeUser as an HTTP request (services/auth
 * authenticateUpgrade). An upgrade without a valid session (or from a foreign
 * Origin) is accepted and then closed with 1008 so a browser sees a close code,
 * not a bare network error.
 *
 * Ticket events go only to connected users for whom the ticket is visible by the
 * one access rule (ticketVisibilityWhere, the rule behind canAccessTask), judged
 * on the user's CURRENT row (role, active, approved, password change), not what
 * was true at connect time: a user who no longer qualifies has their sockets
 * closed with 1008 the next time an event is routed, or at once through
 * disconnectUser from the code paths that change a user.
 *
 * Protocol (server to client only; client messages are ignored):
 *   { type: "ticket_updated", ticketId, reason: "created"|"updated"|"comment"|"deleted", ts, v: 1 }
 *   { type: "department:created"|"department:updated"|"department:deleted", data, ts, v: 1 }  (staff only)
 */
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { inArray } from "drizzle-orm";
import { WebSocketServer } from "ws";
import { users } from "@shared/schema";
import { db } from "../storage/db";
import { authenticateUpgrade, isSessionRevoked } from "../services/auth";
import { usersWhoCanAccessTask, type AccessUser } from "../permissions/ticketAccess";
import { normalizeRole } from "../permissions/roles";
import { isAiSystemUserId } from "../utils/aiSystemUserId";
import {
  addConnection,
  allConnections,
  clearConnections,
  removeConnection,
  sendTo,
  type Connection,
} from "./connections";

export { connectionCount, disconnectUser } from "./connections";

export const WS_PATH = "/ws";
const HEARTBEAT_MS = 30_000;
/** Visibility branches / user rows per query. */
const RECIPIENT_CHUNK = 200;
/** Clients send nothing we read; anything bigger than a ping-sized frame is abuse. */
const MAX_PAYLOAD = 1024;

export type TicketEventReason = "created" | "updated" | "comment" | "deleted";

let wss: WebSocketServer | undefined;
let heartbeat: NodeJS.Timeout | undefined;

function getWss(): WebSocketServer {
  if (!wss) {
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
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

/**
 * Origins allowed besides the request's own host: CORS_ORIGIN (comma separated),
 * the app's existing CORS setting. "*" is ignored here: a wildcard CORS policy
 * must not turn the cookie-authenticated socket into a cross-site one.
 */
function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "" && s !== "*");
}

/**
 * Whether X-Forwarded-Host is believed. It is only the proxy's word when the app was told
 * a proxy sits in front (Express "trust proxy", which server/index.ts sets to 1 for the
 * deployed reverse proxy); on a direct connection any client can send that header and
 * choose its own "same origin". attachRealtime(server, { trustProxy }) sets this from the app.
 */
let trustForwardedHost = false;

/** No Origin (non-browser client) passes: it still needs the session cookie. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // "null" or garbage
  }
  const fwd = trustForwardedHost ? req.headers["x-forwarded-host"] : undefined;
  // With a trusted proxy the LAST entry is the one it wrote; earlier ones came from the client.
  const forwarded = String(Array.isArray(fwd) ? fwd[fwd.length - 1] : fwd ?? "")
    .split(",")
    .pop()!
    .trim();
  const host = (forwarded !== "" ? forwarded : String(req.headers.host ?? "")).trim().toLowerCase();
  if (host !== "" && originHost === host) return true;
  return allowedOrigins().includes(origin.toLowerCase());
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  let auth: { user: AccessUser; authAt: unknown; pwdAt: unknown } | null = null;
  if (originAllowed(req)) {
    try {
      auth = await authenticateUpgrade(req);
    } catch {
      auth = null;
    }
  }
  if (socket.destroyed) return;
  getWss().handleUpgrade(req, socket, head, (ws) => {
    // First thing, on every socket and before any branch: an 'error' event with no
    // listener (a malformed or oversized frame while we close) would crash the process.
    ws.on("error", (error) => {
      console.error("WS error:", error instanceof Error ? error.name : "unknown");
    });
    if (!auth) {
      ws.close(1008, "unauthorized");
      return;
    }
    const conn: Connection = {
      ws,
      user: { id: auth.user.id, role: auth.user.role },
      authAt: auth.authAt,
      pwdAt: auth.pwdAt,
      alive: true,
    };
    ws.on("pong", () => {
      conn.alive = true;
    });
    // Nothing a client sends changes who it is or what it receives.
    ws.on("message", () => {});
    addConnection(conn);
  });
}

/**
 * Starts serving /ws on this HTTP server. Returns a function that stops doing so.
 * `trustProxy`: the app's Express "trust proxy" setting is on, so X-Forwarded-Host
 * may stand for the public host in the Origin check (default: not trusted).
 */
export function attachRealtime(server: Server, opts: { trustProxy?: boolean } = {}): () => void {
  trustForwardedHost = opts.trustProxy === true;
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      /* unparseable URL: not ours */
    }
    // Other upgrade paths (the Vite dev server's HMR socket) are not ours to touch.
    if (pathname !== WS_PATH) return;
    // The raw socket can error while authentication is still pending.
    socket.on("error", () => {});
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
  clearConnections();
  const server = wss;
  wss = undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * Re-reads every connected user's CURRENT row. Sockets whose user is now inactive,
 * unapproved, without a valid role, the AI user, forced to change password, or
 * whose session predates a password change are closed with 1008. Returns one entry
 * per remaining user, with the role as it is now (and refreshes the stored role).
 */
async function currentlyEligibleUsers(): Promise<AccessUser[]> {
  const conns = allConnections();
  const ids = Array.from(new Set(conns.map((c) => c.user.id)));
  const rows = new Map<string, typeof users.$inferSelect>();
  for (let i = 0; i < ids.length; i += RECIPIENT_CHUNK) {
    const found = await db
      .select()
      .from(users)
      .where(inArray(users.id, ids.slice(i, i + RECIPIENT_CHUNK)));
    for (const r of found) rows.set(r.id, r);
  }
  const eligible = new Map<string, AccessUser>();
  for (const c of conns) {
    const row = rows.get(c.user.id);
    const role = row ? normalizeRole(row.role) : null;
    const ok =
      !!row &&
      !!role &&
      row.isActive &&
      row.isApproved &&
      !row.mustChangePassword &&
      !isAiSystemUserId(row.id) &&
      !isSessionRevoked(row, { authAt: c.authAt, pwdAt: c.pwdAt });
    if (!ok) {
      try {
        c.ws.close(1008, "unauthorized");
      } catch {
        c.ws.terminate();
      }
      removeConnection(c);
      continue;
    }
    c.user.role = role;
    eligible.set(row.id, { id: row.id, role });
  }
  return Array.from(eligible.values());
}

/**
 * The connected users who can see ticket `ticketId` right now. Two queries per
 * RECIPIENT_CHUNK connected users: one re-reads the user rows (current role and
 * state), one (usersWhoCanAccessTask) is a UNION ALL of
 * `SELECT <id> FROM tasks WHERE id = <ticket> AND <ticketVisibilityWhere(user)>`
 * branches, so the rule is exactly the one canAccessTask applies.
 */
export async function ticketRecipients(ticketId: number): Promise<string[]> {
  const candidates = await currentlyEligibleUsers();
  return Array.from(await usersWhoCanAccessTask(candidates, ticketId));
}

function ticketMessage(ticketId: number, reason: TicketEventReason) {
  return { type: "ticket_updated", ticketId, reason, ts: Date.now(), v: 1 };
}

/**
 * Tells everyone connected who can see the ticket that it changed. Never throws:
 * a failed notification must not fail the write that triggered it.
 * Pass `recipients` (from ticketRecipients: taken BEFORE a delete, or the union of
 * before and after a reassignment) to skip the lookup. Passed recipients who are
 * no longer eligible are still screened out by the caller's own lookups; this
 * function only sends.
 */
export async function notifyTicket(
  ticketId: number,
  reason: TicketEventReason,
  recipients?: string[]
): Promise<void> {
  try {
    if (allConnections().length === 0) return;
    const to = recipients ?? (await ticketRecipients(ticketId));
    sendTo(Array.from(new Set(to)), ticketMessage(ticketId, reason));
  } catch (error) {
    console.error("WS notify ticket error:", error instanceof Error ? error.message : "unknown");
  }
}

/** Staff-only broadcast (department changes): customers get nothing. */
export async function notifyStaff(type: string, data: unknown): Promise<void> {
  try {
    const message = { type, data, ts: Date.now(), v: 1 };
    const ids = (await currentlyEligibleUsers())
      .filter((u) => {
        const role = normalizeRole(u.role);
        return role === "admin" || role === "manager" || role === "agent";
      })
      .map((u) => u.id);
    sendTo(ids, message);
  } catch (error) {
    console.error("WS notify staff error:", error instanceof Error ? error.message : "unknown");
  }
}
