import type { User } from "@shared/schema";
import type { AssistantRuns } from "./runAuth";
import { resolveTicketNumber } from "./ticketRef";

/**
 * A staff member's saved assistant conversations, read from the sidecar's memory as that user.
 *
 * Each call opens a short run (so the sidecar receives this user's tokens, and its auth scopes
 * memory to user:<id>), calls one memory route, and ends the run. Thread ids are prefixed with the
 * user's id before they reach Mastra (bridge.ts), so a request can only name its own threads; the
 * prefix never leaves the server.
 *
 * A saved conversation keeps what the tools returned at the time. Before one is shown, every ticket
 * it mentions is checked against what the user can see NOW; if any is no longer visible (access
 * changed, ticket deleted), the conversation is withheld rather than shown in part.
 */

export const STAFF_AGENT = "ticket-assistant";
const THREAD_ID = /^[A-Za-z0-9_-]{1,120}$/;
const MESSAGE_PAGE = 200;
const MAX_MESSAGES = 1000;
const TICKET_NUMBERS = /TKT-\d{4}-\d{1,10}/gi;

export function mastraThreadId(userId: string, threadId: string): string {
  return `u:${userId}:${threadId}`;
}

/** The client's thread id for one of this user's Mastra threads, or null for anyone else's. */
export function clientThreadId(userId: string, mastraId: string): string | null {
  const prefix = `u:${userId}:`;
  return mastraId.startsWith(prefix) ? mastraId.slice(prefix.length) : null;
}

/**
 * The newest turn of a conversation: from the last user message on. With memory the earlier turns
 * come from the saved thread, so the browser's copy of them is never sent (and a browser cannot
 * slip invented earlier turns in: Workforce Nexus' fix M1).
 */
export function newestTurn<M extends { role?: string }>(messages: M[]): M[] {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages.slice(i);
  return messages.slice(-1);
}

export function isThreadId(value: unknown): value is string {
  return typeof value === "string" && THREAD_ID.test(value);
}

export interface HistoryDeps {
  runs: () => Promise<AssistantRuns<User>>;
  agentUrl: string;
  fetch?: typeof fetch;
  resolveTicket?: (user: User, number: string) => Promise<number | null>;
}

export class HistoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

/** Calls one memory route of the staff agent as `user`, inside a run that ends right after. */
async function asUser<T>(deps: HistoryDeps, user: User, path: string, init: RequestInit = {}): Promise<T | null> {
  const runs = await deps.runs();
  const run = runs.start(user.id, STAFF_AGENT);
  try {
    const url = new URL(path, deps.agentUrl);
    url.searchParams.set("agentId", STAFF_AGENT);
    const res = await (deps.fetch ?? fetch)(url, {
      ...init,
      headers: { Authorization: `Bearer ${run.agentToken}`, "X-TicketFlow-MCP-Session": run.mcpToken, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    // The sidecar refuses another user's thread (403) and reports a missing one (404): both are
    // "not found" here, so neither reveals the other.
    if (res.status === 404 || res.status === 403) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HistoryError(502, "history_unavailable");
    }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  } finally {
    runs.end(run.runId);
  }
}

export interface HistoryThread {
  threadId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listHistory(deps: HistoryDeps, user: User): Promise<HistoryThread[]> {
  const body = await asUser<{ threads?: Array<{ id: string; title?: string | null; createdAt: string; updatedAt: string }> }>(
    deps,
    user,
    `/api/memory/threads?perPage=50&page=0&orderBy=${encodeURIComponent(JSON.stringify({ field: "updatedAt", direction: "DESC" }))}`,
  );
  return (body?.threads ?? [])
    .map((t) => ({ t, threadId: clientThreadId(user.id, t.id) }))
    .filter((x): x is { t: typeof x.t; threadId: string } => x.threadId !== null)
    .map(({ t, threadId }) => ({ threadId, title: t.title?.trim() || null, createdAt: t.createdAt, updatedAt: t.updatedAt }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

interface StoredMessage {
  role: string;
  createdAt: string;
  content?: { parts?: Array<{ type?: string; text?: string }> } | string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export type HistoryConversation = { available: true; messages: HistoryMessage[] } | { available: false; reason: "access_changed" };

/** Every ticket number anywhere in the stored conversation, tool results included. */
export function ticketNumbersIn(messages: unknown): string[] {
  return Array.from(new Set((JSON.stringify(messages).match(TICKET_NUMBERS) ?? []).map((n) => n.toUpperCase())));
}

function textOf(message: StoredMessage): string {
  if (typeof message.content === "string") return message.content;
  return (message.content?.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

export async function getHistory(deps: HistoryDeps, user: User, threadId: string): Promise<HistoryConversation> {
  const id = encodeURIComponent(mastraThreadId(user.id, threadId));
  const stored: StoredMessage[] = [];
  for (let page = 0; stored.length < MAX_MESSAGES; page++) {
    const body = await asUser<{ messages?: StoredMessage[]; hasMore?: boolean }>(
      deps,
      user,
      `/api/memory/threads/${id}/messages?perPage=${MESSAGE_PAGE}&page=${page}&orderBy=${encodeURIComponent(JSON.stringify({ field: "createdAt", direction: "ASC" }))}`,
    );
    if (!body) {
      if (page === 0) throw new HistoryError(404, "not_found");
      break;
    }
    stored.push(...(body.messages ?? []));
    if (!body.hasMore || !body.messages?.length) break;
  }

  // Shown only if every ticket it mentions is still visible to this user.
  const resolve = deps.resolveTicket ?? resolveTicketNumber;
  for (const number of ticketNumbersIn(stored)) {
    if ((await resolve(user, number)) === null) return { available: false, reason: "access_changed" };
  }
  const messages = stored
    .filter((m): m is StoredMessage & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, text: textOf(m), createdAt: m.createdAt }))
    .filter((m) => m.text.trim() !== "");
  return { available: true, messages };
}

export async function deleteHistory(deps: HistoryDeps, user: User, threadId: string): Promise<void> {
  const done = await asUser<unknown>(deps, user, `/api/memory/threads/${encodeURIComponent(mastraThreadId(user.id, threadId))}`, { method: "DELETE" });
  if (done === null) throw new HistoryError(404, "not_found");
}
