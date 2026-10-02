import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { ApiKey, User } from "@shared/schema";
import { storage } from "../../storage";
import { loginBlockReason } from "./accountStatus";
import {
  AI_SYSTEM_USER_EMAIL,
  AI_SYSTEM_USER_ID,
} from "../../utils/aiSystemUserId";
import { SYSTEM_USER_EMAIL, SYSTEM_USER_ID } from "../../utils/systemUser";

/**
 * API keys: `tfk_` + 32 random bytes (base64url). Only `sha256:<hex>` of the key
 * is stored, so a database read cannot be replayed as a credential, and the key
 * is shown once, to the admin who issued it. Keys are issued by an admin for a
 * chosen user; the caller never chooses permissions.
 *
 * Never log a plaintext key or a hash.
 */

/** What every issued key may do. Set by the server, never taken from a request. */
export const API_KEY_PERMISSIONS = ["mcp:tickets"] as const;
export const DEFAULT_API_KEY_EXPIRY_DAYS = 90;
export const MAX_API_KEY_EXPIRY_DAYS = 365;

const KEY_FORMAT = /^tfk_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function generateApiKey(): { plaintext: string; hash: string } {
  const plaintext = `tfk_${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return `sha256:${createHash("sha256").update(plaintext, "utf8").digest("hex")}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type KeyOwnerBlock =
  | "account_inactive"
  | "pending_approval"
  | "system_account";

/**
 * Why this account may not hold or use a key, or null. Inactive and unapproved
 * accounts cannot sign in, so they cannot use a key either. The AI system user
 * and the legacy "system" user are not people: no key may act as them.
 */
export function keyOwnerBlockReason(user: {
  id: string;
  email?: string | null;
  isActive?: boolean | null;
  isApproved?: boolean | null;
}): KeyOwnerBlock | null {
  const email = user.email?.toLowerCase();
  if (
    user.id === AI_SYSTEM_USER_ID ||
    user.id === SYSTEM_USER_ID ||
    email === AI_SYSTEM_USER_EMAIL ||
    email === SYSTEM_USER_EMAIL
  ) {
    return "system_account";
  }
  return loginBlockReason(user);
}

/** The columns of a key row that may leave the server (never keyHash). */
export function toPublicApiKey(key: ApiKey) {
  return {
    id: key.id,
    userId: key.userId,
    name: key.name,
    keyPrefix: key.keyPrefix,
    permissions: key.permissions ?? [],
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    isActive: key.isActive,
    createdAt: key.createdAt,
  };
}

/** Creates a key for `userId` and returns the plaintext, which exists nowhere else. */
export async function issueApiKey(params: {
  userId: string;
  name: string;
  expiresInDays?: number;
}): Promise<{ apiKey: ApiKey; plaintext: string }> {
  const { plaintext, hash } = generateApiKey();
  const days = params.expiresInDays ?? DEFAULT_API_KEY_EXPIRY_DAYS;
  const apiKey = await storage.createApiKey({
    userId: params.userId,
    name: params.name,
    keyHash: hash,
    keyPrefix: plaintext.slice(0, 8),
    permissions: [...API_KEY_PERMISSIONS],
    expiresAt: new Date(Date.now() + days * DAY_MS),
    isActive: true,
  });
  return { apiKey, plaintext };
}

/**
 * Resolves a presented key to its owner, or null. Refuses revoked and expired
 * keys, and keys whose owner is inactive, unapproved, the AI system user or the
 * legacy system user. Stamps lastUsedAt on success. The lookup is by hash in
 * SQL; the stored value is then compared in constant time.
 */
export async function findActiveKey(
  plaintext: string
): Promise<{
  keyId: number;
  user: User;
  permissions: string[];
} | null> {
  if (typeof plaintext !== "string" || !KEY_FORMAT.test(plaintext)) return null;
  const hash = hashApiKey(plaintext);
  const row = await storage.getApiKeyByHash(hash);
  if (!row || !row.isActive) return null;
  if (!constantTimeEqual(row.keyHash, hash)) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  const user = await storage.getUser(row.userId);
  if (!user || keyOwnerBlockReason(user)) return null;

  await storage.updateApiKeyLastUsed(row.id);
  return { keyId: row.id, user, permissions: row.permissions ?? [] };
}
