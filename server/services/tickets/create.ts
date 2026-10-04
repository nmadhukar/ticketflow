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
 */
export async function runTicketCreatedHooks(
  task: Task,
  creatorId: string,
  actionBaseUrl: string | null
): Promise<void> {
  // Log the error type only: error objects can carry request or model text.
  const errorType = (e: unknown) => (e instanceof Error ? e.name : "error");

  try {
    await runCreateTimeAutoResponse(task);
  } catch (e) {
    console.error(`create-time auto-response failed: ${errorType(e)}`);
  }

  try {
    broadcaster?.(task, creatorId);
  } catch (e) {
    console.error(`WS notify ticket:created failed: ${errorType(e)}`);
  }

  try {
    // Only webhooks whose owner can access this ticket receive it (notifyTicketWebhooks).
    const user = await storage.getUser(creatorId);
    await notifyTicketWebhooks({
      task,
      kind: "created",
      actorEmail: user?.email,
      actionUrl: actionBaseUrl === null ? null : `${actionBaseUrl}/my-tasks`,
    });
  } catch (e) {
    console.error(`Teams notifications failed: ${errorType(e)}`);
  }
}
