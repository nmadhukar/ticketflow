import { z } from "zod";
import type { Request } from "express";
import { asyncHandler, HttpError } from "../../http/errors";
import { assertTaskAccess, type AccessUser } from "../../permissions/ticketAccess";
import { isStaffRole } from "../../permissions/staff";
import { storage } from "../../storage";

const aiTicketBody = z.object({
  ticketId: z.coerce.number().int().positive(),
});

/**
 * Gate for the AI tools that act on one ticket (analyze-ticket, generate-response).
 * The body is `{ ticketId }` and nothing else is read: the ticket text comes from
 * the database, so a client cannot make the model say or analyse what it likes.
 *
 * Order: 400 invalid body, 404 no such ticket, 403 ticket outside the caller's scope
 * (same rule as every other ticket route), 403 not staff, 503 AI not configured.
 * The loaded ticket is left on `req.aiTicket`.
 */
export const loadAiTicket = asyncHandler(async (req, _res, next) => {
  const { ticketId } = aiTicketBody.parse(req.body ?? {});
  await assertTaskAccess(req.user as AccessUser, ticketId);
  if (!isStaffRole((req.user as { role?: unknown }).role)) {
    throw new HttpError(403, "forbidden", "This is a staff-only feature");
  }
  const task = await storage.getTask(ticketId);
  if (!task) throw new HttpError(404, "not_found", "Ticket not found");

  const bedrock = await storage.getBedrockSettings();
  if (!bedrock?.bedrockAccessKeyId || !bedrock?.bedrockSecretAccessKey) {
    throw new HttpError(503, "ai_not_configured", "AI service not configured");
  }
  (req as Request & { aiTicket?: unknown }).aiTicket = task;
  next();
});
