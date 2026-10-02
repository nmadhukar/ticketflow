import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { notifyTicket, ticketRecipients } from "../../realtime/ws";
import { notifyTicketWebhooks } from "../teamsNotifications";

/**
 * Everything that follows a ticket write besides the write itself: realtime
 * messages, Teams webhooks and knowledge-base learning. One module so REST and
 * MCP produce the same side effects. None of these may fail the write.
 */

const REASSIGN_KEYS = ["assigneeId", "assigneeType", "assigneeTeamId"];

export const isReassignment = (updates: Record<string, unknown>): boolean =>
  REASSIGN_KEYS.some((k) => k in updates);

/** Who can see the ticket right now (taken BEFORE a reassignment or delete). */
export const recipientsNow = (ticketId: number): Promise<string[]> =>
  ticketRecipients(ticketId).catch(() => [] as string[]);

export async function afterTicketUpdated(args: {
  ticketId: number;
  before: Pick<Task, "status">;
  updatedTask: Task;
  updates: Record<string, unknown>;
  actorId: string;
  recipientsBefore: string[];
  reassigns: boolean;
  actionBaseUrl: string | null;
}): Promise<void> {
  const { ticketId, before, updatedTask, updates, actorId, recipientsBefore, reassigns, actionBaseUrl } = args;

  // If the ticket was resolved, trigger knowledge base learning (policy-aware).
  if (updates.status === "resolved" && before.status !== "resolved") {
    try {
      const { knowledgeBaseService } = await import("../ai/knowledgeBase");
      const { getAISettings } = await import("../../admin/aiSettings");
      const aiSettings = await getAISettings();
      if (aiSettings.autoLearnEnabled) {
        await knowledgeBaseService.learnFromResolvedTicket(ticketId, {
          minScore: Math.max(0, Math.min(1, Number(aiSettings.minResolutionScore ?? 0))),
          requireApproval: !!aiSettings.articleApprovalRequired,
        });
      }
      console.log(`Knowledge base learning triggered for resolved ticket ${updatedTask.ticketNumber}`);
    } catch (error) {
      console.error("Error in knowledge base learning:", error);
    }
  }

  // Only webhooks whose owner can access this ticket (as updated) receive it.
  try {
    const actor = await storage.getUser(actorId);
    await notifyTicketWebhooks({
      task: updatedTask,
      kind: "updated",
      assignedToUserId: updates.assigneeId as string | null | undefined,
      actorEmail: actor?.email,
      actionUrl: actionBaseUrl === null ? null : `${actionBaseUrl}/my-tasks`,
    });
  } catch (error) {
    console.error("Error sending Teams notifications:", error instanceof Error ? error.name : "error");
  }

  // Realtime: everyone connected who can see the ticket as it is now (plus those who could before a reassignment).
  if (reassigns) {
    const recipientsAfter = await recipientsNow(ticketId);
    await notifyTicket(ticketId, "updated", [...recipientsBefore, ...recipientsAfter]);
  } else {
    await notifyTicket(ticketId, "updated");
  }
}

export const notifyTicketDeleted = (ticketId: number, recipients: string[]) =>
  notifyTicket(ticketId, "deleted", recipients);

export const notifyCommentAdded = (ticketId: number) => notifyTicket(ticketId, "comment");
