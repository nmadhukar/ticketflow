import { createHmac } from "crypto";
import type { AssistantAuditEventType } from "@shared/schema";

/**
 * The assistant's security record. Every event is one JSON log line AND a row in
 * assistant_audit_events (migration 0034), the durable record admins read: refused tokens and runs,
 * every proposed write and its outcome, saved conversations withheld or deleted.
 *
 * Codes and ids only: never a token, a message, ticket content or a raw IP address (`ip` is
 * replaced by a keyed hash before it is logged or stored).
 *
 * Logging never blocks or fails the request that caused it: the row is written in the background
 * and a failure to write it is itself logged. The one exception is `recordAssistantAudit(...,
 * { required: true })`, which a write confirmation awaits before anything is written.
 */
export interface AssistantSecurityEvent {
  event: AssistantAuditEventType;
  reason: string;
  userId?: string;
  runId?: string;
  agentId?: string;
  proposalId?: string;
  ticketId?: number | null;
  ip?: string;
}

/** Thrown when a required audit row could not be written. */
export class AuditUnavailableError extends Error {
  constructor() {
    super("audit_unavailable");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A keyed hash of an IP address: the same address gives the same value; the value gives no address. */
export function hashIp(ip: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!ip) return undefined;
  const key = env.SESSION_SECRET || env.JWT_SECRET || "assistant-audit";
  return createHmac("sha256", key).update(`assistant-audit-ip:${ip}`).digest("hex").slice(0, 32);
}

type Row = {
  eventType: AssistantAuditEventType;
  reason: string;
  actorUserId: string | null;
  agentId: string | null;
  runId: string | null;
  proposalId: string | null;
  ticketId: number | null;
  ipHash: string | null;
};

function toRow(entry: AssistantSecurityEvent): Row {
  return {
    eventType: entry.event,
    reason: entry.reason.slice(0, 80),
    actorUserId: entry.userId ?? null,
    agentId: entry.agentId ?? null,
    // Only well-formed ids: a refused token's claims are not trusted to be one.
    runId: entry.runId && UUID.test(entry.runId) ? entry.runId : null,
    proposalId: entry.proposalId && UUID.test(entry.proposalId) ? entry.proposalId : null,
    ticketId: Number.isInteger(entry.ticketId) ? (entry.ticketId as number) : null,
    ipHash: hashIp(entry.ip) ?? null,
  };
}

/** Where rows go: the database by default (loaded lazily, so describing modules never reach it). */
export type AuditSink = (row: Row) => Promise<void>;

let sink: AuditSink = async (row) => {
  const [{ db }, { assistantAuditEvents }] = await Promise.all([import("../storage/db"), import("@shared/schema")]);
  await db.insert(assistantAuditEvents).values(row);
};

/** For tests: replaces where rows go; returns the previous sink. */
export function setAuditSink(next: AuditSink): AuditSink {
  const previous = sink;
  sink = next;
  return previous;
}

function logLine(row: Row, log: (line: string) => void) {
  log(`SECURITY_AUDIT: ${JSON.stringify({ timestamp: new Date().toISOString(), type: "ASSISTANT_SECURITY_EVENT", ...row })}`);
}

/**
 * Records an event. Without `required` it returns at once and never throws; with it, it resolves
 * once the row is written, or throws AuditUnavailableError.
 */
export async function recordAssistantAudit(
  entry: AssistantSecurityEvent,
  opts: { required?: boolean; log?: (line: string) => void } = {},
): Promise<void> {
  const row = toRow(entry);
  logLine(row, opts.log ?? console.log);
  const written = sink(row);
  if (opts.required) {
    try {
      await written;
    } catch {
      console.error(`Assistant audit row not written [${row.eventType}]`);
      throw new AuditUnavailableError();
    }
    return;
  }
  written.catch(() => console.error(`Assistant audit row not written [${row.eventType}]`));
}

/** The fire-and-forget form every caller that must not fail uses. */
export function logAssistantSecurityEvent(entry: AssistantSecurityEvent, log: (line: string) => void = console.log): void {
  void recordAssistantAudit(entry, { log });
}
