export type Role = "admin" | "manager" | "agent" | "customer";

/**
 * The one place a stored role string becomes a Role. Owner decision
 * 2026-10-01: the legacy role "user" means agent. Rows are converted by the
 * startup fix-up (seed/legacyRoleFixup.ts) and migrations/0011_role_agent.sql;
 * this keeps an unconverted row working as agent, never as anything more.
 * Anything unknown is null and every caller must treat that as no access.
 */
export function normalizeRole(role: unknown): Role | null {
  if (role === "admin" || role === "manager" || role === "agent" || role === "customer") return role;
  if (role === "user") return "agent";
  return null;
}
