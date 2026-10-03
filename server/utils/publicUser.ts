import type { User } from "@shared/schema";
import { normalizeRole } from "../permissions/roles";

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

/**
 * What a customer may learn about any other user (a staff member who commented
 * or changed their ticket): a name and a picture, never contact details or role.
 */
export const CUSTOMER_VISIBLE_USER_FIELDS = ["id", "firstName", "lastName", "profileImageUrl"] as const;

export type CustomerVisibleUser = Pick<User, (typeof CUSTOMER_VISIBLE_USER_FIELDS)[number]>;

export function toPublicUser<T extends Partial<User>>(u: T): PublicUser {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_USER_FIELDS) {
    if (k in u) out[k] = (u as Record<string, unknown>)[k];
  }
  return out as PublicUser;
}

/** Who is looking: their id (to recognise their own row) and role. */
export interface Viewer {
  id?: string | null;
  role?: unknown;
}

/**
 * The one projection of "another user" for a response, chosen by who is
 * looking (R41):
 * - admin and manager get the public projection, `phone` included;
 * - a staff member sees their OWN row with `phone`;
 * - an agent sees every other user's public projection without `phone`;
 * - anyone else, a customer or an unknown role, gets only the
 *   customer-visible fields.
 */
export function projectUserForViewer<T extends Partial<User>>(
  viewer: Viewer | null | undefined,
  u: T
): PublicUser | CustomerVisibleUser {
  const role = normalizeRole(viewer?.role);
  if (role === "admin" || role === "manager") return toPublicUser(u);
  if (role === "agent") {
    const full = toPublicUser(u);
    if (viewer?.id != null && u.id === viewer.id) return full;
    const { phone: _phone, ...withoutPhone } = full;
    return withoutPhone as PublicUser;
  }
  const out: Record<string, unknown> = {};
  for (const k of CUSTOMER_VISIBLE_USER_FIELDS) {
    if (k in u) out[k] = (u as Record<string, unknown>)[k];
  }
  return out as CustomerVisibleUser;
}
