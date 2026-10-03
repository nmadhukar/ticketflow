/**
 * The role a NEW single sign-on account gets (R42). `SSO_DEFAULT_ROLE` is
 * `customer` (the default) or `agent`. Anything else, `admin` included, is
 * logged once and read as `customer`: SSO must never be a way to mint a more
 * powerful account than the owner asked for. The account stays pending
 * approval (isApproved=false) whatever the role, and the role is applied only
 * when the account is created, never on a later sign-in.
 *
 * Environment: SSO_DEFAULT_ROLE (documented in .env.example and passed through by
 * docker-compose.yml).
 */
export type SsoDefaultRole = "customer" | "agent";

const loggedInvalid = new Set<string>();

export function resolveSsoDefaultRole(env: NodeJS.ProcessEnv = process.env): SsoDefaultRole {
  const raw = env.SSO_DEFAULT_ROLE?.trim();
  if (!raw) return "customer";
  const value = raw.toLowerCase();
  if (value === "customer" || value === "agent") return value;
  // One line per distinct bad value, however many sign-ups follow. The value is
  // not echoed: it is a configuration string, not data the log needs.
  if (!loggedInvalid.has(raw)) {
    loggedInvalid.add(raw);
    console.error('SSO_DEFAULT_ROLE must be "customer" or "agent"; using "customer".');
  }
  return "customer";
}
