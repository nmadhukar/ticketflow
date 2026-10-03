/**
 * Secrets that must be configured in production. In production a missing
 * value throws (the process must not start signing sessions or tokens with a
 * literal that is in the source tree), and so does a value that is one of the
 * placeholders the example env files and docs ship with. Elsewhere a development
 * fallback is used and a warning is logged; the warning never contains a secret value.
 */
export type RequiredSecret = "SESSION_SECRET" | "JWT_SECRET";

/**
 * Known placeholder prefixes: the start of every example value this repo and its docs
 * ship ("your-super-secret-session-key", "replace-with-32b-hex",
 * "long-random-string-for-session-encryption", "dev-only-session-secret-...").
 * Case-insensitive and START-anchored on purpose: a generated secret starts with
 * random characters, so it cannot be mistaken for one by a match in its middle.
 */
const PLACEHOLDER_PREFIX =
  /^(your[-_ ]|change[-_ ]?me|replace[-_ ]?me|replace[-_ ]with|dev-only-|ticketflow-dev|long-random-string|placeholder|example|todo($|[-_ :]))/i; // "todo" needs a boundary: 4 random base64 letters spell it about once in a million
/** Whole values that are placeholders. */
const PLACEHOLDER_VALUE = /^(secret|password)$/i;

/** Production refuses a secret shorter than this (`openssl rand -base64 32` is 44 characters, hex 64). */
export const MIN_SECRET_LENGTH = 32;

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim();
  return PLACEHOLDER_PREFIX.test(v) || PLACEHOLDER_VALUE.test(v);
}

/**
 * What is wrong with a required secret in production, or null. Names the
 * variable only, never the value. Outside production nothing is wrong (the
 * development fallback applies).
 */
export function secretProblem(name: RequiredSecret, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== "production") return null;
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${name} must be set in production. Refusing to start with a default secret.`;
  }
  if (isPlaceholderSecret(value)) {
    return `${name} is still a placeholder value. Set a random secret (for example openssl rand -base64 32).`;
  }
  // New in this change: before it, any non-blank value was accepted.
  if (value.trim().length < MIN_SECRET_LENGTH) {
    return `${name} is too short: use at least ${MIN_SECRET_LENGTH} characters (for example openssl rand -base64 32).`;
  }
  return null;
}

export function requireSecret(
  name: RequiredSecret,
  opts: { env?: NodeJS.ProcessEnv; devFallback: string }
): string {
  const env = opts.env ?? process.env;
  const problem = secretProblem(name, env);
  if (problem) throw new Error(problem);
  const value = env[name];
  if (typeof value === "string" && value.trim().length > 0) return value;

  console.warn(
    `WARNING: ${name} is not set; using an insecure development default. Set ${name} before deploying.`
  );
  return opts.devFallback;
}
