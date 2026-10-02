/**
 * The registry of open WebSockets, with no imports from auth or storage so that
 * both can call disconnectUser without an import cycle (ws.ts imports auth).
 */
import { WebSocket } from "ws";

export interface ConnectionUser {
  id: string;
  role: unknown;
}

export interface Connection {
  ws: WebSocket;
  user: ConnectionUser;
  /** The session's authAt at upgrade time (for the password-change revocation rule). */
  authAt: unknown;
  alive: boolean;
}

// userId -> that user's open sockets (one per tab).
const connections = new Map<string, Set<Connection>>();

export function allConnections(): Connection[] {
  return Array.from(connections.values()).flatMap((set) => Array.from(set));
}

export function connectionCount(): number {
  return allConnections().length;
}

export function addConnection(conn: Connection): void {
  let set = connections.get(conn.user.id);
  if (!set) connections.set(conn.user.id, (set = new Set()));
  set.add(conn);
  conn.ws.on("close", () => removeConnection(conn));
}

export function removeConnection(conn: Connection): void {
  const s = connections.get(conn.user.id);
  if (!s) return;
  s.delete(conn);
  if (s.size === 0) connections.delete(conn.user.id);
}

export function clearConnections(): void {
  for (const c of allConnections()) c.ws.terminate();
  connections.clear();
}

export function userConnections(userId: string): Connection[] {
  return Array.from(connections.get(userId) ?? []);
}

/**
 * Closes every socket of a user. Default 1008 (policy: the account or session no
 * longer qualifies; the client does not retry). Use 1012 when the user stays valid
 * (role or password change on the current session) so the client reconnects and is
 * re-authenticated with the new state. Never throws.
 */
export function disconnectUser(userId: string, code: number = 1008): void {
  for (const c of userConnections(userId)) {
    try {
      c.ws.close(code, code === 1008 ? "unauthorized" : "reconnect");
    } catch {
      c.ws.terminate();
    }
    removeConnection(c);
  }
}

export function sendTo(userIds: string[], message: unknown): void {
  const payload = JSON.stringify(message);
  for (const id of userIds) {
    for (const c of userConnections(id)) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      try {
        c.ws.send(payload);
      } catch (error) {
        console.error("WS send error:", error instanceof Error ? error.message : "unknown");
      }
    }
  }
}
