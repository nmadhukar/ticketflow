import { and, eq, gt, lt, notInArray, sql } from "drizzle-orm";
import { taskComments, tasks, type Task } from "@shared/schema";
import { db } from "../../storage/db";
import { storage } from "../../storage";

import { ensureAiSystemUser, SYSTEM_ACCOUNT_IDS } from "../../utils/aiSystemUser";
import { logRouteError } from "../../http/errors";
import { afterTicketUpdated, recipientsNow } from "./notifier";

/**
 * Auto-close: a resolved ticket that nobody has come back to is closed after the follow-up window
 * (company settings `autoCloseDays`, 0 = never).
 *
 * Why a window and not "close as soon as it is resolved": `resolved` means "we gave an answer, the
 * customer should confirm", and the customer can reopen a resolved ticket. Closing immediately would
 * take that chance away and hide a wrong answer silently. The window is the customer's reply time.
 *
 * What counts as "come back to": a comment from anyone who is not a system account (a customer
 * saying it is still broken, or a person adding context). Any such comment after `resolved_at`
 * restarts the clock, so an active conversation is never closed underneath the customer.
 *
 * The close is an ordinary ticket update, attributed to the AI system account and followed by
 * afterTicketUpdated, so history, realtime, webhooks and the closed timestamp behave exactly as a
 * person's close does.
 */

/**
 * Close every resolved ticket whose follow-up window has passed. Returns the ids it closed.
 * Never throws per ticket: one failure is logged by type and the rest still run.
 */
export async function closeStaleResolvedTickets(
  now: Date = new Date()
): Promise<number[]> {
  const days = await autoCloseWindowDays();
  if (days === 0) return [];

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // A resolved ticket with no human comment since it was resolved. resolvedAt is stamped by
  // storage.updateTask on the transition; a legacy row without it uses updatedAt.

  const candidates = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "resolved"),
        lt(sql`COALESCE(${tasks.resolvedAt}, ${tasks.updatedAt})`, cutoff),
        // Raw on purpose: the correlated subquery needs the comment table's real name, while
        // Drizzle renders a column reference with the alias of the query it belongs to.
        sql`NOT EXISTS (
          SELECT 1 FROM "task_comments"
          WHERE "task_comments"."task_id" = ${tasks.id}
            AND "task_comments"."created_at" > COALESCE(${tasks.resolvedAt}, ${tasks.updatedAt})
            AND "task_comments"."user_id" NOT IN (${sql.join(
              [...SYSTEM_ACCOUNT_IDS].map((id) => sql`${id}`),
              sql`, `
            )})
        )`
      )
    );


  if (candidates.length === 0) return [];

  const actor = await ensureAiSystemUser();
  if (!actor) {
    console.error("Ticket auto-close skipped: the AI system account is unavailable");
    return [];
  }

  const closed: number[] = [];
  for (const { id } of candidates) {
    try {
      // Re-read: a person may have reopened it, or commented, between the query and now.
      const current = await storage.getTask(id);
      if (!current || current.status !== "resolved") continue;
      const stillIdle = await hasNoHumanCommentSinceResolved(current, cutoff);

      if (!stillIdle) continue;

      const updates = { status: "closed" as const };
      const recipientsBefore = await recipientsNow(id);
      const updatedTask = await storage.updateTask(id, updates, actor, { expectedStatus: "resolved" });
      await afterTicketUpdated({
        ticketId: id,
        before: current,
        updatedTask,
        updates,
        actorId: actor,
        recipientsBefore,
        reassigns: false,
        actionBaseUrl: null,
      });
      closed.push(id);
    } catch (error) {
      // R63: type and id only, through the shared logger.
      logRouteError(`Ticket auto-close for ${id} failed`, error);
    }
  }
  return closed;
}

/** True when nothing but a system account has commented since the ticket was resolved (and the
 *  resolved stamp is older than the cutoff). */
async function hasNoHumanCommentSinceResolved(task: Task, cutoff: Date): Promise<boolean> {
  // Read the row as it is now: the cached copy may predate the resolve or a reply.
  const [fresh] = await db
    .select({ resolvedAt: tasks.resolvedAt, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(eq(tasks.id, task.id))
    .limit(1);
  const resolvedAt = fresh?.resolvedAt ?? fresh?.updatedAt;
  if (!resolvedAt || resolvedAt > cutoff) return false;

  const [human] = await db
    .select({ id: taskComments.id })
    .from(taskComments)
    .where(
      and(
        eq(taskComments.taskId, task.id),
        gt(taskComments.createdAt, resolvedAt),
        notInArray(taskComments.userId, [...SYSTEM_ACCOUNT_IDS])
      )
    )
    .limit(1);
  return human === undefined;
}

/** The window in days, 0 when auto-close is off. Exposed for the status API and for tests. */
export async function autoCloseWindowDays(): Promise<number> {
  const settings = await storage.getCompanySettings();
  const days = Number(settings?.autoCloseDays ?? 7);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/**
 * Runs the sweep on an interval. Called once from server startup; the timer is unref'd so it never
 * keeps the process alive (Jest imports the routes without a server).
 */
export function scheduleTicketAutoClose(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void closeStaleResolvedTickets()
      .then((ids) => {
        if (ids.length > 0) console.log(`Auto-closed ${ids.length} resolved ticket(s): ${ids.join(", ")}`);
      })
      .catch((error) => {
        logRouteError("Ticket auto-close sweep failed", error);
      });
  }, intervalMs);
  timer.unref?.();
  return timer;
}
