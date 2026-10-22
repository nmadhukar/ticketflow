/**
 * Hindsight agent memory: the external memory service the create-time agent reads
 * before answering and writes to when a ticket is resolved.
 *
 * Everything here is opt-in and best-effort. The service's own coordinates are deployment
 * configuration (HINDSIGHT_ENABLED / HINDSIGHT_URL / HINDSIGHT_API_KEY / HINDSIGHT_BANK_ID),
 * so with the flag off - the default - no request is made and the create and resolve paths
 * are exactly what they were. Neither call ever throws: a memory service that is down must
 * not fail a ticket write, so failures are logged by type only (never the ticket text or a
 * memory). The REST surface is the one the service documents for self-hosting: a bank holds
 * memories; retain writes them (`POST /v1/default/banks/{bank}/memories`) and recall reads
 * them back (`POST /v1/default/banks/{bank}/memories/recall`).
 */
import { readHindsightConfig, type HindsightConfig } from "../../env";
import { db } from "../../storage/db";
import { taskComments, type Task } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

/** How long one memory request may take before it is abandoned; the ticket path never waits longer. */
const MEMORY_TIMEOUT_MS = 5000;
/** Recall is a prompt aid, not a data source: a handful of memories is enough. */
export const RECALL_LIMIT = 5;

export interface HindsightMemoryInput {
  content: string;
  context?: string;
  documentId?: string;
  tags?: string[];
}

export function isHindsightEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readHindsightConfig(env) !== null;
}

/** What may be logged about a failed memory call: its type and status, never its body. */
function describeMemoryError(error: unknown): string {
  if (error === null || typeof error !== "object") return "non-error value thrown";
  const e = error as { name?: unknown; status?: unknown; code?: unknown };
  const parts = [typeof e.name === "string" && e.name ? e.name : "Error"];
  if (typeof e.status === "number") parts.push(`status=${e.status}`);
  if (typeof e.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e.code)) parts.push(`code=${e.code}`);
  return parts.join(" ");
}

function memoryUrl(config: HindsightConfig, suffix: string): string {
  return `${config.url}/v1/default/banks/${encodeURIComponent(config.bankId)}${suffix}`;
}

async function postJson(config: HindsightConfig, url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MEMORY_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error("Hindsight request failed") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json().catch(() => null);
}

/** The text of one recalled memory, from whichever field the service used for it. */
function memoryText(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (entry === null || typeof entry !== "object") return "";
  const e = entry as Record<string, unknown>;
  for (const key of ["text", "content", "memory", "summary"]) {
    const value = e[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

/** Pulls the memory list out of the recall response, whichever envelope it arrived in. */
function recallList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload === null || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  for (const key of ["results", "memories", "items", "data"]) {
    if (Array.isArray(p[key])) return p[key] as unknown[];
  }
  return [];
}

/** The tag that scopes a memory to the customer whose ticket produced it. */
export function customerScopeTag(createdBy: string | null | undefined): string | null {
  const id = typeof createdBy === "string" ? createdBy.trim() : "";
  return id.length > 0 ? `customer:${id}` : null;
}

/**
 * Memories relevant to a ticket, for the reply prompt. Returns [] when the feature is off,
 * on any failure, or when nothing matches. Never throws.
 *
 * `scope` limits the recall to the memories of one customer: it is sent to the service as a
 * strict tag filter, so a ticket only ever sees resolutions learned from that same customer's
 * earlier tickets. Callers that have no customer (background jobs) pass nothing and get the
 * unscoped recall those paths have always had.
 */
export async function recallMemories(
  query: string,
  limit: number = RECALL_LIMIT,
  env: NodeJS.ProcessEnv = process.env,
  scope?: string | null
): Promise<string[]> {
  const config = readHindsightConfig(env);
  if (!config) return [];
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const scopeTag = customerScopeTag(scope);
  try {
    const payload = await postJson(config, memoryUrl(config, "/memories/recall"), {
      query: trimmed.slice(0, 2000),
      limit: Math.max(1, Math.min(20, Math.trunc(limit))),
      // any_strict: only memories carrying this exact tag come back, so one customer's
      // resolutions never leak into another customer's reply.
      ...(scopeTag ? { tags: [scopeTag], tags_match: "any_strict" } : {}),
    });
    return recallList(payload)
      .map(memoryText)
      .filter((text) => text.length > 0)
      .slice(0, limit);
  } catch (error) {
    console.warn(`Hindsight recall failed (${describeMemoryError(error)})`);
    return [];
  }
}

/**
 * Stores one memory. Returns true only when the service accepted it; false when the feature
 * is off or the write failed. Never throws.
 */
export async function retainMemory(
  memory: HindsightMemoryInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const config = readHindsightConfig(env);
  if (!config) return false;
  const content = memory.content.trim();
  if (content.length === 0) return false;
  try {
    await postJson(config, memoryUrl(config, "/memories"), {
      items: [
        {
          content,
          ...(memory.context ? { context: memory.context } : {}),
          ...(memory.documentId ? { document_id: memory.documentId } : {}),
          ...(memory.tags && memory.tags.length > 0 ? { tags: memory.tags } : {}),
        },
      ],
    });
    return true;
  } catch (error) {
    console.warn(`Hindsight retain failed (${describeMemoryError(error)})`);
    return false;
  }
}

/**
 * Learns one resolved ticket: its problem and the comments that solved it, as one memory.
 * Called beside knowledge-base learning when a ticket moves to resolved. Best-effort and
 * flag-gated like the rest of this module: with Hindsight off the import is skipped and the
 * resolve path is unchanged. Never throws.
 */
export async function retainResolvedTicketMemory(
  ticket: Task,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!readHindsightConfig(env)) return false;
  try {
    const comments = await db
      .select({ content: taskComments.content })
      .from(taskComments)
      .where(eq(taskComments.taskId, ticket.id))
      .orderBy(desc(taskComments.createdAt))
      .limit(3);
    const resolution = comments
      .map((comment) => comment.content)
      .reverse()
      .join("\n")
      .trim();
    const content = [
      `Ticket ${ticket.ticketNumber}: ${ticket.title}`,
      ticket.description ? `Problem: ${ticket.description}` : "",
      resolution ? `Resolution: ${resolution}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    return await retainMemory(
      {
        content,
        context: "resolved support ticket",
        documentId: `ticket-${ticket.id}`,
        tags: [
          ticket.category,
          ticket.priority,
          "resolved",
          customerScopeTag(ticket.createdBy),
        ].filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
      },
      env
    );
  } catch (error) {
    console.warn(`Hindsight retain for resolved ticket ${ticket.id} failed (${describeMemoryError(error)})`);
    return false;
  }
}