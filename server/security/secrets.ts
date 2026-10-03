/**
 * Secrets that must be configured in production. In production a missing
 * value throws (the process must not start signing sessions or tokens with a
 * literal that is in the source tree). Elsewhere a development fallback is
 * used and a warning is logged; the warning never contains a secret value.
 */
export type RequiredSecret = "SESSION_SECRET" | "JWT_SECRET";

export function requireSecret(
  name: RequiredSecret,
  opts: { env?: NodeJS.ProcessEnv; devFallback: string }
): string {
  const env = opts.env ?? process.env;
  const value = env[name];
  if (typeof value === "string" && value.trim().length > 0) return value;

  if (env.NODE_ENV === "production") {
    throw new Error(
      `${name} must be set in production. Refusing to start with a default secret.`
    );
  }
  console.warn(
    `WARNING: ${name} is not set; using an insecure development default. Set ${name} before deploying.`
  );
  return opts.devFallback;
}
