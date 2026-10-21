import { insertTaskSchema, type Task } from "@shared/schema";
import { storage } from "../../storage";
import type { DbTx } from "../../storage/db";
import { notifyTicketWebhooks } from "../teamsNotifications";
import { runCreateTimeAutoResponse } from "../ai/createTimeAutoResponse";

/**
 * The one place a validated ticket becomes a row: the insert schema, the author, and
 * storage.createTask (which takes the ticket number from the counter and writes the
 * history entry). POST /api/tasks and inbound email both end here. `fields` has already
 * passed createTicketSchema; `createdBy` always comes from the caller, never from input.
 */
export async function createTicketRecord(
  fields: Record<string, unknown>,
  createdBy: string,
  tx?: DbTx
): Promise<Task> {
  const taskData = insertTaskSchema.parse({ ...fields, createdBy });
  // R46: with a `tx` (inbound email) the number, the row and the history entry all join it.
  return tx ? storage.createTask(taskData, tx) : storage.createTask(taskData);
}

/** Sends a "ticket:created" realtime message to one user. Registered by registerRoutes, which owns the sockets. */
export type TicketCreatedBroadcaster = (task: Task, userId: string) => void;

let broadcaster: TicketCreatedBroadcaster | null = null;

export function setTicketCreatedBroadcaster(fn: TicketCreatedBroadcaster | null): void {
  broadcaster = fn;
}

/** True once registerRoutes has wired the realtime broadcast (a guard against a merge dropping it). */
export function hasTicketCreatedBroadcaster(): boolean {
  return broadcaster !== null;
}

/**
 * Everything that follows a created ticket, shared by POST /api/tasks and inbound email:
 * the AI create-time auto-response (follows settings), the realtime broadcast to the
 * creator, and the Teams webhook notifications. None of them may fail the create.
 * `actionBaseUrl` is the site origin used for the Teams link.
 *
 * Returns the ticket as it stands when the hooks finish, which is not always the row that
 * came in: the AI step can route an unmatched ticket onto another team. The broadcast, the
 * webhook and the caller's 201 all use that re-read row, so none of them announce the triage
 * assignment the ticket has already left. A re-read that finds nothing (a delete racing the
 * create) falls back to the row we were given.
 */
export async function runTicketCreatedHooks(
  task: Task,
  creatorId: string,
  actionBaseUrl: string | null
): Promise<Task> {
  // Log the error type only: error objects can carry request or model text.
  const errorType = (e: unknown) => (e instanceof Error ? e.name : "error");

  try {
    await runCreateTimeAutoResponse(task, actionBaseUrl);
  } catch (e) {
    console.error(`create-time auto-response failed: ${errorType(e)}`);
  }

  // The AI step may have reassigned the ticket: everything below announces the row as it is
  // now, not the snapshot from before routing.
  let current = task;
  try {
    current = (await storage.getTask(task.id)) ?? task;
  } catch (e) {
    console.error(`re-read after create-time hooks failed: ${errorType(e)}`);
  }

  try {
    broadcaster?.(current, creatorId);
  } catch (e) {
    console.error(`WS notify ticket:created failed: ${errorType(e)}`);
  }

  try {
    // Only webhooks whose owner can access this ticket receive it (notifyTicketWebhooks);
    // access is worked out from the routed row, so the team the ticket landed on is included.
    const user = await storage.getUser(creatorId);
    await notifyTicketWebhooks({
      task: current,
      kind: "created",
      actorEmail: user?.email,
      actionUrl: actionBaseUrl === null ? null : `${actionBaseUrl}/my-tasks`,
    });
  } catch (e) {
    console.error(`Teams notifications failed: ${errorType(e)}`);
  }

  return current;
}
