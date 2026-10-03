/**
 * Secrets that must be configured in production. In production a missing
 * value throws (the process must not start signing sessions or tokens with a
 * literal that is in the source tree), and so does a value that is one of the
 * placeholders the example env files and docs ship with. Elsewhere a development
 * fallback is used and a warning is logged; the warning never contains a secret value.
 */
export type RequiredSecret = "SESSION_SECRET" | "JWT_SECRET";

/**
 * A word that only appears in a copied-and-never-edited example value
 * ("your-super-secret-session-key", "...change-this-in-production",
 * "dev-only-session-secret-not-for-production"). A generated secret contains
 * none of these as a standalone word.
 */
const PLACEHOLDER_WORD = /(^|[^a-z])(your|change[-_ ]?me|changeme|replace[-_ ]?me|placeholder|dev-only|not-for-production|example)([^a-z]|$)/i;

export function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_WORD.test(value);
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
