/**
 * Why an account may not start a session, or null when it may. deserializeUser
 * rejects the same accounts on every request, so a session created for one of
 * them would just 401 everywhere.
 */
export function loginBlockReason(user: {
  isActive?: boolean | null;
  isApproved?: boolean | null;
}): "account_inactive" | "pending_approval" | null {
  if (!user.isActive) return "account_inactive";
  if (!user.isApproved) return "pending_approval";
  return null;
}
