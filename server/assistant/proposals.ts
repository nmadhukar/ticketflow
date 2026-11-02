import { createHash } from "crypto";
import { and, eq, gt, inArray, isNotNull, lt, or } from "drizzle-orm";
import { assistantWriteProposals, type AssistantWriteProposal, type User } from "@shared/schema";
import type { AssistantAgentId } from "@shared/assistant";
import { db } from "../storage/db";
import { addComment, createTicket, getTicket, prepareTicketCreate } from "../services/tickets/ticketService";
import { commentBodySchema } from "../services/tickets/commentSchema";
import { TicketError } from "../services/tickets/ticketError";
import { publicBaseUrl } from "../utils/appBaseUrl";
import { logAssistantSecurityEvent } from "./securityLog";

/**
 * Assistant-proposed writes. The assistant never writes a ticket or a comment: its propose_* tools
 * record a proposal here and the user decides on a card in the chat. Only the user's Confirm
 * executes it, once, as that user, through the same ticket service REST uses, so every rule
 * (access, validation, notifications, history) applies exactly as if they had typed it themselves.
 *
 *   - Proposing already checks access and validates, so a proposal the user could not make is
 *     refused at once, and the model hears why.
 *   - Confirming checks again (access may have changed) and claims the proposal atomically
 *     (pending -> executing): a double click or a retried request executes it at most once.
 *   - A repeated proposal (same user, action and content within DEDUPE_MINUTES) returns the
 *     pending one instead of a second card, which also absorbs a model or network retry.
 */

export type ProposalAction = "create_ticket" | "add_comment";
export const PROPOSAL_TTL_MINUTES = 15;
const DEDUPE_MINUTES = 10;
/** The only fields a proposed ticket may set: what a customer would type into "New ticket". */
const TICKET_FIELDS = ["title", "description", "category", "priority"] as const;

export interface RunContext {
  runId: string;
  agentId: AssistantAgentId;
}

export interface ProposalView {
  proposalId: string;
  action: ProposalAction;
  status: "pending";
  expiresAt: string;
  ticket?: { id: number; ticketNumber: string; title: string };
  draft: Record<string, unknown>;
  /** Read by the model: it must not claim anything was done. */
  note: string;
}

const NOTE =
  "Nothing has been posted. The user must review this on the card and press Confirm; until then, say it is waiting for their confirmation.";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Same fields with the same values, whatever the key order. */
function sameContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

function pickTicketFields(input: unknown): Record<string, unknown> {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(TICKET_FIELDS.filter((k) => source[k] !== undefined && source[k] !== null).map((k) => [k, source[k]]));
}

function view(row: AssistantWriteProposal, ticket?: ProposalView["ticket"]): ProposalView {
  return {
    proposalId: row.id,
    action: row.action as ProposalAction,
    status: "pending",
    expiresAt: row.expiresAt.toISOString(),
    ...(ticket ? { ticket } : {}),
    draft: (row.payload as Record<string, unknown>) ?? {},
    note: NOTE,
  };
}

async function record(
  user: User,
  run: RunContext,
  action: ProposalAction,
  ticketId: number | null,
  payload: Record<string, unknown>,
): Promise<AssistantWriteProposal> {
  const digest = sha256({ action, ticketId, payload });
  const now = new Date();
  const [existing] = await db
    .select()
    .from(assistantWriteProposals)
    .where(
      and(
        eq(assistantWriteProposals.userId, user.id),
        eq(assistantWriteProposals.action, action),
        eq(assistantWriteProposals.payloadSha256, digest),
        eq(assistantWriteProposals.status, "pending"),
        gt(assistantWriteProposals.expiresAt, now),
        gt(assistantWriteProposals.createdAt, new Date(now.getTime() - DEDUPE_MINUTES * 60_000)),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(assistantWriteProposals)
    .values({
      userId: user.id,
      agentId: run.agentId,
      runId: run.runId,
      action,
      ticketId,
      payload,
      payloadSha256: digest,
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000),
    })
    .returning();
  logAssistantSecurityEvent({ event: "write_proposed", reason: action, userId: user.id, runId: run.runId, agentId: run.agentId });
  return row;
}

/** propose_ticket: a new ticket as this user, validated now and created only on Confirm. */
export async function proposeTicket(user: User, run: RunContext, input: unknown): Promise<ProposalView> {
  const payload = pickTicketFields(input);
  // The same validation "New ticket" runs; nothing is created.
  await prepareTicketCreate(user, payload);
  return view(await record(user, run, "create_ticket", null, payload));
}

/** propose_comment: a comment on a ticket this user can see, posted only on Confirm. */
export async function proposeComment(user: User, run: RunContext, ticketId: number, content: unknown): Promise<ProposalView> {
  const ticket = await getTicket(user, ticketId); // access check: NOT_FOUND / FORBIDDEN as REST
  const parsed = commentBodySchema.safeParse({ content });
  if (!parsed.success) throw new TicketError("VALIDATION", "A comment needs 1 to 10000 characters of text.");
  const row = await record(user, run, "add_comment", ticket.id, { content: parsed.data.content });
  return view(row, { id: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title });
}

export type DecisionResult =
  | { status: "executed"; action: ProposalAction; ticketNumber?: string; commentId?: number }
  | { status: "rejected" };

/** Why a decision cannot be made; mapped to HTTP by the route. */
export class ProposalDecisionError extends Error {
  constructor(
    public readonly code: "not_found" | "already_decided" | "expired",
    public readonly current?: { status: string; resultRef: string | null },
  ) {
    super(code);
  }
}

async function loadOwn(user: User, id: string): Promise<AssistantWriteProposal> {
  const [row] = await db
    .select()
    .from(assistantWriteProposals)
    .where(and(eq(assistantWriteProposals.id, id), eq(assistantWriteProposals.userId, user.id)))
    .limit(1);
  // Someone else's proposal is indistinguishable from none.
  if (!row) throw new ProposalDecisionError("not_found");
  return row;
}

/** Why a pending-only update matched nothing. */
async function explain(user: User, id: string): Promise<never> {
  const row = await loadOwn(user, id);
  if (row.status === "pending" && row.expiresAt <= new Date()) {
    await db.update(assistantWriteProposals).set({ status: "expired" }).where(and(eq(assistantWriteProposals.id, id), eq(assistantWriteProposals.status, "pending")));
    throw new ProposalDecisionError("expired");
  }
  throw new ProposalDecisionError("already_decided", { status: row.status, resultRef: row.resultRef });
}

const pendingAndLive = (user: User, id: string) =>
  and(
    eq(assistantWriteProposals.id, id),
    eq(assistantWriteProposals.userId, user.id),
    eq(assistantWriteProposals.status, "pending"),
    gt(assistantWriteProposals.expiresAt, new Date()),
  );

export async function rejectProposal(user: User, id: string): Promise<DecisionResult> {
  const [row] = await db
    .update(assistantWriteProposals)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(pendingAndLive(user, id))
    .returning();
  if (!row) return explain(user, id);
  logAssistantSecurityEvent({ event: "write_rejected", reason: row.action, userId: user.id, runId: row.runId, agentId: row.agentId });
  return { status: "rejected" };
}

/**
 * Executes a proposal as `user` (the session's freshly loaded row). `edits` lets the user change
 * the text on the card before confirming; it is validated like the original.
 */
export async function confirmProposal(user: User, id: string, edits: unknown = undefined): Promise<DecisionResult> {
  // Claim first, so a second confirm (double click, retry) finds nothing to claim.
  const [claimed] = await db
    .update(assistantWriteProposals)
    .set({ status: "executing", decidedAt: new Date() })
    .where(pendingAndLive(user, id))
    .returning();
  if (!claimed) return explain(user, id);

  const action = claimed.action as ProposalAction;
  const original = (claimed.payload as Record<string, unknown>) ?? {};
  const changed = edits && typeof edits === "object" ? (edits as Record<string, unknown>) : {};
  const audit = { userId: user.id, runId: claimed.runId, agentId: claimed.agentId };
  try {
    let result: DecisionResult;
    let finalPayload: Record<string, unknown>;
    let resultRef: string;
    if (action === "add_comment") {
      finalPayload = { content: typeof changed.content === "string" ? changed.content : original.content };
      const comment = await addComment(user, claimed.ticketId!, finalPayload.content);
      result = { status: "executed", action, commentId: comment.id };
      resultRef = `comment:${comment.id}`;
    } else {
      finalPayload = { ...original, ...pickTicketFields(changed) };
      const ticket = await createTicket(user, finalPayload, { actionBaseUrl: publicBaseUrl() });
      result = { status: "executed", action, ticketNumber: ticket.ticketNumber };
      resultRef = ticket.ticketNumber;
    }
    await db
      .update(assistantWriteProposals)
      .set({ status: "executed", resultRef, payload: finalPayload, payloadSha256: sha256({ action, ticketId: claimed.ticketId, payload: finalPayload }) })
      .where(eq(assistantWriteProposals.id, id));
    const edited = !sameContent(finalPayload, original);
    logAssistantSecurityEvent({ event: "write_executed", reason: edited ? `${action}:edited` : action, ...audit });
    return result;
  } catch (error) {
    const failureCode = error instanceof TicketError ? error.code : "INTERNAL";
    await db.update(assistantWriteProposals).set({ status: "failed", failureCode }).where(eq(assistantWriteProposals.id, id));
    logAssistantSecurityEvent({ event: "write_failed", reason: `${action}:${failureCode}`, ...audit });
    throw error;
  }
}

/**
 * Retention: pending proposals past their expiry become expired; proposed text is cleared 7 days
 * after a proposal is decided or expired; rows are deleted after 90 days. Returns what it changed.
 */
export async function cleanUpProposals(now = new Date()): Promise<{ expired: number; cleared: number; deleted: number }> {
  const day = 24 * 60 * 60 * 1000;
  const expired = await db
    .update(assistantWriteProposals)
    .set({ status: "expired" })
    .where(and(eq(assistantWriteProposals.status, "pending"), lt(assistantWriteProposals.expiresAt, now)))
    .returning({ id: assistantWriteProposals.id });
  const cleared = await db
    .update(assistantWriteProposals)
    .set({ payload: null })
    .where(
      and(
        isNotNull(assistantWriteProposals.payload),
        inArray(assistantWriteProposals.status, ["executed", "rejected", "expired", "failed"]),
        or(lt(assistantWriteProposals.decidedAt, new Date(now.getTime() - 7 * day)), lt(assistantWriteProposals.expiresAt, new Date(now.getTime() - 7 * day))),
      ),
    )
    .returning({ id: assistantWriteProposals.id });
  const deleted = await db
    .delete(assistantWriteProposals)
    .where(lt(assistantWriteProposals.createdAt, new Date(now.getTime() - 90 * day)))
    .returning({ id: assistantWriteProposals.id });
  return { expired: expired.length, cleared: cleared.length, deleted: deleted.length };
}

/** Hourly, unref'd (as tickets/autoClose.ts), once the assistant is enabled. */
export function startProposalCleanup(log: (line: string) => void = console.log): NodeJS.Timeout {
  const run = () =>
    cleanUpProposals()
      .then((r) => (r.expired || r.cleared || r.deleted) && log(`assistant proposals: ${r.expired} expired, ${r.cleared} cleared, ${r.deleted} deleted`))
      .catch((error) => console.error(`assistant proposal cleanup failed [${error instanceof Error ? error.name : "error"}]`));
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
