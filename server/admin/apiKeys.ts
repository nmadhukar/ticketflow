/**
 * API key routes. Keys are issued only by an admin, for a chosen user, with
 * permissions the server sets. The plaintext is in the 201 response once and is
 * stored nowhere (only its sha256 is). Nothing here ever logs a key or a hash.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../services/auth";
import { getUserId } from "../middleware/admin.middleware";
import { storage } from "../storage";
import { HttpError } from "../http/errors";
import { parseIdParam } from "../http/params";
import {
  MAX_API_KEY_EXPIRY_DAYS,
  issueApiKey,
  keyOwnerBlockReason,
  toPublicApiKey,
} from "../services/auth/apiKeys";

// Strict: anything else in the body (permissions, keyHash, expiresAt, isActive)
// is ignored by design, never copied onto the row.
const issueKeySchema = z.object({
  userId: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  expiresInDays: z.number().int().min(1).max(MAX_API_KEY_EXPIRY_DAYS).optional(),
});

async function assertAdmin(req: Request): Promise<void> {
  const id = getUserId(req);
  if (!id) throw new HttpError(401, "unauthenticated", "Authentication required");
  const me = await storage.getUser(id);
  if (!me || me.role !== "admin") {
    throw new HttpError(403, "forbidden", "Admin access required");
  }
}

const BLOCK_MESSAGE = {
  account_inactive: "That account is inactive",
  pending_approval: "That account is not approved yet",
  system_account: "System accounts cannot hold API keys",
} as const;

export function registerApiKeysRoutes(app: Express): void {
  // GET /api/api-keys[?userId=] - active keys, never the key or its hash
  app.get(
    "/api/api-keys",
    isAuthenticated,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await assertAdmin(req);
        const userId = req.query.userId;
        if (userId !== undefined && typeof userId !== "string") {
          throw new HttpError(400, "invalid_user", "userId must be a string");
        }
        const keys = userId
          ? await storage.getApiKeys(userId)
          : await storage.getAllApiKeys();
        res.json(keys.map(toPublicApiKey));
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/api-keys - issue a key for a chosen user (admin only)
  app.post(
    "/api/api-keys",
    isAuthenticated,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await assertAdmin(req);
        const parsed = issueKeySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new HttpError(
            400,
            "validation_failed",
            "Invalid input",
            parsed.error.flatten()
          );
        }
        const { userId, name, expiresInDays } = parsed.data;
        const owner = await storage.getUser(userId);
        if (!owner) throw new HttpError(404, "user_not_found", "User not found");
        const blocked = keyOwnerBlockReason(owner);
        if (blocked) throw new HttpError(400, blocked, BLOCK_MESSAGE[blocked]);

        const { apiKey, plaintext } = await issueApiKey({
          userId: owner.id,
          name,
          expiresInDays,
        });
        res.status(201).json({ ...toPublicApiKey(apiKey), plainKey: plaintext });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /api/api-keys/:id - revoke (admin only)
  app.delete(
    "/api/api-keys/:id",
    isAuthenticated,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await assertAdmin(req);
        const id = parseIdParam(req.params.id);
        const key = await storage.getApiKey(id);
        if (!key || !key.isActive) {
          throw new HttpError(404, "api_key_not_found", "API key not found");
        }
        await storage.revokeApiKey(id);
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );
}
