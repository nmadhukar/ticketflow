import { insertTaskSchema, type Task } from "@shared/schema";
import { storage } from "../../storage";
import { teamsIntegration } from "../microsoftTeams";
import { runCreateTimeAutoResponse } from "../ai/createTimeAutoResponse";

/**
 * The one place a validated ticket becomes a row: the insert schema, the author, and
 * storage.createTask (which takes the ticket number from the counter and writes the
 * history entry). POST /api/tasks and inbound email both end here. `fields` has already
 * passed createTicketSchema; `createdBy` always comes from the caller, never from input.
 */
export async function createTicketRecord(
  fields: Record<string, unknown>,
  createdBy: string
): Promise<Task> {
  const taskData = insertTaskSchema.parse({ ...fields, createdBy });
  return storage.createTask(taskData);
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
    const user = await storage.getUser(creatorId);
    const allUsers = await storage.getAllUsers();
    const notifications = allUsers.map(async (notifyUser) => {
      const settings = await storage.getTeamsIntegrationSettings(notifyUser.id);
      if (settings?.enabled && settings.notificationTypes?.includes("ticket_created")) {
        const actionUrl = actionBaseUrl === null ? null : `${actionBaseUrl}/my-tasks`;
        const message = `New ticket created by ${user?.email || "a user"}`;
        if (settings.webhookUrl) {
          await teamsIntegration.sendWebhookNotification(settings.webhookUrl, task, message, actionUrl);
        }
      }
    });
    await Promise.allSettled(notifications);
  } catch (e) {
    console.error(`Teams notifications failed: ${errorType(e)}`);
  }
}
