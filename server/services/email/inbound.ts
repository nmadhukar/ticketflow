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
import { parseEmail } from "./mime";

/**
 * Inbound email (SES receipt rule -> SNS -> POST /api/email/inbound), after the SNS
 * signature has been verified by the route. Three outcomes:
 *  - the subject carries an existing ticket number the sender can access -> a comment
 *  - no ticket number, sender is a known active account -> a new ticket
 *  - anything else -> nothing is written (the reason is returned, never the content)
 * Attachments are out of scope: they are not read and not stored.
 */

export type InboundOutcome =
  | { status: "created"; ticketId: number }
  | { status: "commented"; ticketId: number }
  | { status: "ignored"; reason: string };

const ignored = (reason: string): InboundOutcome => ({ status: "ignored", reason });

/** [TKT-2026-0001]; the prefix is the company's ticketPrefix (at most 10 characters). */
const TICKET_TAG = /\[([A-Za-z0-9]{1,10}-\d{4}-\d{4,9})\]/;

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 50000;

interface SesVerdict {
  status?: string;
}
interface SesNotification {
  notificationType?: string;
  mail?: { source?: string; commonHeaders?: { subject?: string; from?: string[] } };
  receipt?: {
    dkimVerdict?: SesVerdict;
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

/**
 * The From header is forgeable. SES reports whether the message passed DMARC or DKIM; a
 * sender is only trusted when it did. INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER=true lifts
 * the requirement (for a mail path that does not run SES's checks).
 */
function senderVerified(receipt: SesNotification["receipt"]): boolean {
  if (process.env.INBOUND_EMAIL_ALLOW_UNVERIFIED_SENDER === "true") return true;
  return receipt?.dmarcVerdict?.status === "PASS" || receipt?.dkimVerdict?.status === "PASS";
}

/** An active, approved account with a real role, matched by exact case-insensitive email. */
async function findSender(address: string) {
  const rows = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive, isApproved: users.isApproved })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${address})`)
    .limit(2);
  if (rows.length !== 1) return null; // none, or two accounts differing only by case: ambiguous
  const user = rows[0];
  if (user.id === AI_SYSTEM_USER_ID || user.id === SYSTEM_USER_ID) return null;
  if (loginBlockReason(user) !== null) return null;
  if (!normalizeRole(user.role)) return null;
  return user;
}

export async function processSesNotification(input: unknown): Promise<InboundOutcome> {
  const notification = (input && typeof input === "object" ? input : {}) as SesNotification;
  if (notification.notificationType !== "Received") return ignored("not_a_received_message");
  if (typeof notification.content !== "string" || notification.content === "") return ignored("no_content");

  const receipt = notification.receipt;
  if (receipt?.virusVerdict?.status === "FAIL") return ignored("virus_verdict_fail");

  const mail = parseEmail(notification.content);
  if (!senderVerified(receipt)) return ignored("sender_not_verified");

  // Automatic replies and bulk mail must never open tickets or answer themselves in a loop.
  const autoSubmitted = (mail.headers["auto-submitted"] ?? "no").toLowerCase();
  const precedence = (mail.headers.precedence ?? "").toLowerCase();
  if (autoSubmitted !== "no" || ["bulk", "junk", "list", "auto_reply"].includes(precedence)) {
    return ignored("automatic_message");
  }

  if (!mail.fromAddress) return ignored("no_sender");
  const sender = await findSender(mail.fromAddress);
  if (!sender) return ignored("unknown_or_ineligible_sender");

  const tag = TICKET_TAG.exec(mail.subject)?.[1];
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
    const parsed = commentBodySchema.safeParse({ content: mail.text.slice(0, COMMENT_MAX_LENGTH) });
    if (!parsed.success) return ignored("empty_body");
    await storage.addTaskComment(
      insertTaskCommentSchema.parse({ content: parsed.data.content, taskId: ticket.id, userId: sender.id })
    );
    return { status: "commented", ticketId: ticket.id };
  }

  // A new ticket takes the same validation as POST /api/tasks.
  const description = mail.text.slice(0, DESCRIPTION_MAX);
  const fields = createTicketSchema.parse({
    title: mail.subject.slice(0, TITLE_MAX) || "(no subject)",
    description: description === "" ? null : description,
    category: inboundCategory(),
  });
  const ticket = await createTicketRecord({ ...fields }, sender.id);
  // The same after-create effects as POST /api/tasks (AI auto-response per settings,
  // realtime broadcast, Teams webhooks); none can fail the create. APP_BASE_URL is the
  // site origin for the Teams link (there is no request to read it from).
  await runTicketCreatedHooks(ticket, sender.id, (process.env.APP_BASE_URL ?? "").replace(/\/+$/, ""));
  return { status: "created", ticketId: ticket.id };
}
