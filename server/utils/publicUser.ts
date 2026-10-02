import type { User } from "@shared/schema";

/**
 * The only user fields that may leave the server. This is an allow-list: a
 * column added to `users` later (a secret, a token) is dropped by default.
 */
export const PUBLIC_USER_FIELDS = [
  "id",
  "email",
  "firstName",
  "lastName",
  "role",
  "phone",
  "isActive",
  "isApproved",
  "profileImageUrl",
  "createdAt",
  "updatedAt",
] as const;

export type PublicUser = Pick<User, (typeof PUBLIC_USER_FIELDS)[number]>;

export function toPublicUser<T extends Partial<User>>(u: T): PublicUser {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_USER_FIELDS) {
    if (k in u) out[k] = (u as Record<string, unknown>)[k];
  }
  return out as PublicUser;
}
