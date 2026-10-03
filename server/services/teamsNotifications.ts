import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { teamsIntegrationSettings, users, type Task } from "@shared/schema";
import { validateWebhookUrl } from "./webhookGuard";
import { db } from "../storage/db";
import { usersWhoCanAccessTask } from "../permissions/ticketAccess";
import { teamsIntegration } from "./microsoftTeams";
import { mapLimit } from "../utils/concurrency";

/** Outbound webhook posts in flight at once for one ticket event. */
export const WEBHOOK_CONCURRENCY = 5;

export const NOTIFICATION_TYPES = [
  "ticket_created",
  "ticket_updated",
  "ticket_assigned",
  "ticket_resolved",
  "ticket_commented",
] as const;

const optionalText = z.string().trim().max(255).nullable().optional();

/**
 * Body of POST /api/teams-integration/settings. Strict: the owner (userId) and
 * every other column come from the server, never the client. The webhook URL
 * must pass the allow-list (https, *.webhook.office.com); an empty string clears it.
 */
export const teamsSettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    teamId: optionalText,
    teamName: optionalText,
    channelId: optionalText,
    channelName: optionalText,
    webhookUrl: z
      .string()
      .trim()
      .max(2048)
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v === null || v === "") return null;
        try {
          validateWebhookUrl(v);
          return v;
        } catch (e) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: e instanceof Error ? e.message : "Invalid webhook URL" });
          return z.NEVER;
        }
      }),
    notificationTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length).optional(),
  })
  .strict();

export interface TicketWebhookEvent {
  /** The ticket as just created or updated. */
  task: Task;
  kind: "created" | "updated";
  /** Set on an update that (re)assigned the ticket to a user. */
  assignedToUserId?: string | null;
  actorEmail?: string | null;
  /** Link for the card; null when the site origin is unknown (inbound email without APP_BASE_URL). */
  actionUrl: string | null;
}

/**
 * Sends a ticket's Teams webhook notifications. A webhook receives a ticket
 * only when its owner (a) enabled it for this kind of event and (b) can access
 * the ticket under the one visibility rule (the canAccessTask rule). One query finds the
 * enabled webhooks; one more (per 200 owners) checks access for the owners whose
 * notification types match; the posts then go out WEBHOOK_CONCURRENCY at a time.
 * Never throws: a failed webhook is logged by host.
 */
export async function notifyTicketWebhooks(event: TicketWebhookEvent): Promise<void> {
  try {
    const rows = await db
      .select({
        ownerId: users.id,
        role: users.role,
        webhookUrl: teamsIntegrationSettings.webhookUrl,
        notificationTypes: teamsIntegrationSettings.notificationTypes,
      })
      .from(teamsIntegrationSettings)
      .innerJoin(users, eq(users.id, teamsIntegrationSettings.userId))
      .where(
        and(
          eq(teamsIntegrationSettings.enabled, true),
          isNotNull(teamsIntegrationSettings.webhookUrl),
          eq(users.isActive, true)
        )
      );

    const wantsCreated = (types: string[] | null) => !!types?.includes("ticket_created");
    const wantsUpdated = (types: string[] | null) =>
      !!types?.includes("ticket_updated") ||
      (!!event.assignedToUserId && !!types?.includes("ticket_assigned"));

    const candidates = rows.filter(
      (r) => !!r.webhookUrl && (event.kind === "created" ? wantsCreated(r.notificationTypes) : wantsUpdated(r.notificationTypes))
    );

    // Access for every candidate owner in one query (per 200), not one query per webhook row.
    const allowed = await usersWhoCanAccessTask(
      candidates.map((r) => ({ id: r.ownerId, role: r.role })),
      event.task.id
    );

    // At most WEBHOOK_CONCURRENCY posts in flight: a team full of enabled webhooks must not
    // open hundreds of outbound connections for one ticket event.
    await mapLimit(
      candidates.filter((r) => allowed.has(r.ownerId)),
      WEBHOOK_CONCURRENCY,
      async (r) => {
        let message: string;
        if (event.kind === "created") {
          message = `New ticket created by ${event.actorEmail || "a user"}`;
        } else if (event.assignedToUserId && event.assignedToUserId === r.ownerId) {
          message = `Ticket assigned to you by ${event.actorEmail || "a user"}`;
        } else {
          message = `Ticket updated by ${event.actorEmail || "a user"}`;
        }
        await teamsIntegration.sendWebhookNotification(r.webhookUrl!, event.task, message, event.actionUrl);
      }
    );
  } catch (error) {
    console.error("Error sending Teams notifications:", error instanceof Error ? error.name : "error");
  }
}
