import { sql } from "drizzle-orm";
import { insertTaskCommentSchema, tasks, users } from "@shared/schema";
import { TICKET_CATEGORIES } from "@shared/constants";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { canAccessTask } from "../../permissions/ticketAccess";
import { normalizeRole } from "../../permissions/roles";
import { loginBlockReason } from "../auth/accountStatus";
import { AI_SYSTEM_USER_ID } from "../../utils/aiSystemUserId";
import { SYSTEM_USER_ID } from "../../utils/systemUser";
import { createTicketSchema } from "../tickets/schemas";
import { COMMENT_MAX_LENGTH, commentBodySchema } from "../tickets/commentSchema";
import { createTicketRecord, runTicketCreatedHooks } from "../tickets/create";
import { parseEmail, parseSingleMailbox } from "./mime";

/**
 * Inbound email (SES receipt rule -> SNS -> POST /api/email/inbound), after the SNS
 * signature has been verified by the route. Three outcomes:
 *  - the subject carries an existing ticket number the sender can access -> a comment
 *  - no ticket number -> a new ticket
 *  - anything else -> nothing is written (the reason is returned, never the content)
 * Attachments are out of scope: they are not read and not stored.
 *
 * Who may write (ruling R25): only an active, approved CUSTOMER account. Staff, the AI
 * user and the system user are never inbound senders. A customer's access is the normal
 * rule (canAccessTask), which for a customer means their own tickets.
 *
 * Who the sender is (ruling R26): SES must report DMARC PASS for the message. The sender
 * address is the single mailbox of the From header, tokenised (see mime.ts parseSingleMailbox),
 * not searched for; DMARC aligns with the From header's domain, so this is the address SES
 * evaluated. SES's own parsed `mail.commonHeaders.from` is required (one element) and must
 * name the same single mailbox, otherwise the message is refused. The envelope sender
 * (`mail.source`) is not used: it is not what DMARC covers.
 */

export type InboundOutcome =
  | { status: "created"; ticketId: number }
  | { status: "commented"; ticketId: number }
  | { status: "ignored"; reason: string };

/** The outcome, plus work that may run after the HTTP answer (it must never fail it). */
export interface InboundResult {
  outcome: InboundOutcome;
  after?: () => Promise<void>;
}

const ignored = (reason: string): InboundResult => ({ outcome: { status: "ignored", reason } });

/** [TKT-2026-0001]; the prefix is the company's ticketPrefix (at most 10 characters). */
const TICKET_TAG = /\[([A-Za-z0-9]{1,10}-\d{4}-\d{4,9})\]/;

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 50000;
/** SNS caps a message at 256 KB; nothing larger is a real SES notification. */
const CONTENT_MAX = 400 * 1024;

interface SesVerdict {
  status?: string;
}
interface SesNotification {
  notificationType?: string;
  mail?: { source?: string; commonHeaders?: { subject?: string; from?: unknown } };
  receipt?: {
    dmarcVerdict?: SesVerdict;
    virusVerdict?: SesVerdict;
    spamVerdict?: SesVerdict;
  };
  content?: string;
}

/** The category an emailed ticket gets: INBOUND_EMAIL_CATEGORY when it is a real category, else support. */
function inboundCategory(): (typeof TICKET_CATEGORIES)[number] {
  const configured = process.env.INBOUND_EMAIL_CATEGORY;
  return (TICKET_CATEGORIES as readonly string[]).includes(configured ?? "")
    ? (configured as (typeof TICKET_CATEGORIES)[number])
    : "support";
}

/** A NUL byte is legal in an email and rejected by Postgres text columns. */
const stripNul = (s: string) => s.split("\u0000").join("");

type SenderLookup =
  | { ok: true; user: { id: string; role: string } }
  | { ok: false; reason: string };

/** An active, approved customer, matched by exact case-insensitive email. */
async function findSender(address: string): Promise<SenderLookup> {
  const rows = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive, isApproved: users.isApproved })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${address})`)
    .limit(2);
  const unknown: SenderLookup = { ok: false, reason: "unknown_or_ineligible_sender" };
  if (rows.length !== 1) return unknown; // none, or two accounts differing only by case: ambiguous
  const user = rows[0];
  if (user.id === AI_SYSTEM_USER_ID || user.id === SYSTEM_USER_ID) return { ok: false, reason: "sender_not_customer" };
  if (normalizeRole(user.role) !== "customer") return { ok: false, reason: "sender_not_customer" };
  if (loginBlockReason(user) !== null) return unknown;
  return { ok: true, user };
}

export async function processSesNotification(input: unknown): Promise<InboundResult> {
  const notification = (input && typeof input === "object" ? input : {}) as SesNotification;
  if (notification.notificationType !== "Received") return ignored("not_a_received_message");
  if (typeof notification.content !== "string" || notification.content === "") return ignored("no_content");
  if (notification.content.length > CONTENT_MAX) return ignored("content_too_large");

  // Cheap receipt checks first: nothing attacker-controlled is parsed until they pass.
  const receipt = notification.receipt;
  if (receipt?.virusVerdict?.status === "FAIL") return ignored("virus_verdict_fail");
  if (receipt?.spamVerdict?.status === "FAIL") return ignored("spam_verdict_fail");
  if (receipt?.dmarcVerdict?.status !== "PASS") return ignored("sender_not_verified");

  const mail = parseEmail(notification.content);

  // Automatic replies and bulk mail must never open tickets or answer themselves in a loop.
  const autoSubmitted = (mail.headers["auto-submitted"] ?? "no").toLowerCase();
  const precedence = (mail.headers.precedence ?? "").toLowerCase();
  if (autoSubmitted !== "no" || ["bulk", "junk", "list", "auto_reply"].includes(precedence)) {
    return ignored("automatic_message");
  }

  if (mail.refusal) return ignored(mail.refusal);
  if (mail.duplicateFrom) return ignored("ambiguous_sender");
  if (!mail.fromAddress) return ignored("no_single_sender");

  // SES's own parse of the From header is required and must name the same single mailbox.
  // Only the addresses are compared (never the display names), each tokenised the same way.
  const sesFrom = notification.mail?.commonHeaders?.from;
  if (!Array.isArray(sesFrom) || sesFrom.length !== 1 || typeof sesFrom[0] !== "string") {
    return ignored("ses_from_missing");
  }
  const named = parseSingleMailbox(sesFrom[0]);
  if (!named || named.toLowerCase() !== mail.fromAddress.toLowerCase()) return ignored("ambiguous_sender");

  const found = await findSender(mail.fromAddress);
  if (!found.ok) return ignored(found.reason);
  const sender = found.user;

  const subject = stripNul(mail.subject);
  const text = stripNul(mail.text);

  const tag = TICKET_TAG.exec(subject)?.[1];
  if (tag) {
    const [ticket] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`lower(${tasks.ticketNumber}) = lower(${tag})`)
      .limit(1);
    if (!ticket) return ignored("unknown_ticket");
    // The one access rule; a reply to a ticket outside the sender's scope writes nothing.
    if (!(await canAccessTask({ id: sender.id, role: sender.role }, ticket.id))) {
      return ignored("no_access_to_ticket");
    }
    const parsed = commentBodySchema.safeParse({ content: text.slice(0, COMMENT_MAX_LENGTH) });
    if (!parsed.success) return ignored("empty_body");
    await storage.addTaskComment(
      insertTaskCommentSchema.parse({ content: parsed.data.content, taskId: ticket.id, userId: sender.id })
    );
    return { outcome: { status: "commented", ticketId: ticket.id } };
  }

  // A new ticket takes the same validation as POST /api/tasks.
  const description = text.slice(0, DESCRIPTION_MAX);
  const fields = createTicketSchema.parse({
    title: subject.slice(0, TITLE_MAX) || "(no subject)",
    description: description === "" ? null : description,
    category: inboundCategory(),
  });
  const ticket = await createTicketRecord({ ...fields }, sender.id);
  // The same after-create effects as POST /api/tasks (AI auto-response per settings, realtime
  // broadcast, Teams webhooks), run by the route after it has answered SNS. APP_BASE_URL is the
  // site origin for the Teams link; unset, the card has no link (there is no request to read it from).
  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  return {
    outcome: { status: "created", ticketId: ticket.id },
    after: () => runTicketCreatedHooks(ticket, sender.id, baseUrl === "" ? null : baseUrl),
  };
}
