import type { UserInvitation } from "@shared/schema";

/**
 * An invitation as the API may return it: everything but the token, and without
 * the department. The token is a credential (with it anyone can register as the
 * invited role, admin included), so it travels only in the emailed link (ruling
 * R33). The department does nothing (users have no department link, access is
 * team-based), so it is not returned (ruling R43); the columns stay in the table
 * and are never written.
 */
export type PublicInvitation = Omit<UserInvitation, "invitationToken" | "department" | "departmentId">;

export function toPublicInvitation(invitation: UserInvitation): PublicInvitation {
  const { invitationToken: _token, department: _department, departmentId: _departmentId, ...rest } = invitation;
  return rest;
}
