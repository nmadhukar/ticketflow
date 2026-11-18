import { and, eq } from "drizzle-orm";
import { taskComments } from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { ensureAiSystemUser } from "../../utils/aiSystemUser";
import { afterTicketUpdated, recipientsNow } from "./notifier";

/**
 * "Was this solved?" — the customer's confirmation closes an AI-resolved ticket.
 *
 * The rule the customer asked for: the AI moves a ticket to `resolved` when its confidence is high,
 * but CLOSING is the customer's decision. A resolved ticket therefore waits for the ticket's own
 * creator to say yes (the confirm button on the ticket) or to reply with a thank-you ("thanks, that
 * fixed it"). Until then nothing closes it automatically; a reply saying it is still broken sends it
 * back to the team (in_progress) instead.
 *
 * Only the creator counts, and only on a `resolved` ticket, so a staff member's comment can never
 * close a ticket on the customer's behalf.
 */

/** How the customer said the fix worked: the confirm button, or a thank-you reply. */
export type ConfirmationVia = "confirmed" | "reply";

export { isConfirmationReply, isNotFixedReply } from "./confirmationWording";



export interface ConfirmationResult {
  /** True when this call closed the ticket. */
  closed: boolean;
  /** True when the reply moved a resolved ticket back to the team. */
  reopened: boolean;
}

/**
 * Closes a resolved ticket on the CUSTOMER's confirmation. Never throws: the caller is a customer
 * action (a button or a comment) that must succeed on its own.
 */
export async function closeOnCustomerConfirmation(
  ticketId: number,
  customerId: string,
  via: ConfirmationVia,
  actionBaseUrl: string | null = null
): Promise<ConfirmationResult> {
  try {
    const current = await storage.getTask(ticketId);
    // Only the creator confirms, and only a resolved ticket is waiting for it. Reopened or
    // closed in the meantime: nothing to do.
    if (!current || current.createdBy !== customerId || current.status !== "resolved") {
      return { closed: false, reopened: false };
    }
    const actor = await ensureAiSystemUser();
    if (!actor) {
      console.error(`Customer confirmation for ticket ${ticketId}: skipped (AI system user unavailable)`);
      return { closed: false, reopened: false };
    }
    const updates = { status: "closed" as const };
    const recipientsBefore = await recipientsNow(ticketId);
    const updatedTask = await storage.updateTask(ticketId, updates, actor, { expectedStatus: "resolved" });
    await afterTicketUpdated({
      ticketId,
      before: current,
      updatedTask,
      updates,
      actorId: actor,
      recipientsBefore,
      reassigns: false,
      actionBaseUrl,
    });
    console.log(`Ticket ${ticketId}: closed by the customer's confirmation (${via})`);
    return { closed: true, reopened: false };
  } catch (error) {
    console.error(
      `Customer confirmation for ticket ${ticketId} failed [${error instanceof Error ? error.name : "error"}]`
    );
    return { closed: false, reopened: false };
  }
}

/**
 * A customer's reply on a resolved ticket that says it is NOT fixed: back to the team. Nothing else
 * happens (no close), because the answer did not resolve the problem.
 */
export async function reopenOnCustomerReply(
  ticketId: number,
  customerId: string,
  actionBaseUrl: string | null = null
): Promise<ConfirmationResult> {
  try {
    const current = await storage.getTask(ticketId);
    if (!current || current.createdBy !== customerId || current.status !== "resolved") {
      return { closed: false, reopened: false };
    }
    const actor = await ensureAiSystemUser();
    if (!actor) return { closed: false, reopened: false };
    const updates = { status: "in_progress" as const };
    const recipientsBefore = await recipientsNow(ticketId);
    const updatedTask = await storage.updateTask(ticketId, updates, actor, { expectedStatus: "resolved" });
    await afterTicketUpdated({
      ticketId,
      before: current,
      updatedTask,
      updates,
      actorId: actor,
      recipientsBefore,
      reassigns: false,
      actionBaseUrl,
    });
    console.log(`Ticket ${ticketId}: the customer says it is not fixed; back to the team`);
    return { closed: false, reopened: true };
  } catch (error) {
    console.error(
      `Customer reply on ticket ${ticketId} failed [${error instanceof Error ? error.name : "error"}]`
    );
    return { closed: false, reopened: false };
  }
}

/** True when the ticket's creator has commented on it at all (the confirm card hides then). */
export async function customerAlreadyReplied(ticketId: number, customerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: taskComments.id })
    .from(taskComments)
    .where(and(eq(taskComments.taskId, ticketId), eq(taskComments.userId, customerId)))
    .limit(1);
  return row !== undefined;
}
