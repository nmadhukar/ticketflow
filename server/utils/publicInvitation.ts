import type { UserInvitation } from "@shared/schema";

/**
 * An invitation as the API may return it: everything but the token. The token
 * is a credential (with it anyone can register as the invited role, admin
 * included), so it travels only in the emailed link (ruling R33).
 */
export type PublicInvitation = Omit<UserInvitation, "invitationToken">;

export function toPublicInvitation(invitation: UserInvitation): PublicInvitation {
  const { invitationToken: _token, ...rest } = invitation;
  return rest;
}
