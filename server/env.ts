/**
 * The one definition of "development". It is Express's own rule
 * (`app.get("env")` is `process.env.NODE_ENV || "development"`), so the server
 * entry (Vite dev server vs static build) and the CSP switch cannot disagree.
 * `npm run dev` sets no NODE_ENV (no cross-env, Ruling R1), so unset means
 * development; production (the Dockerfile sets it) and test are strict.
 */
export function isDevelopmentEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return (nodeEnv || "development") === "development";
}

/**
 * R49: how many reverse proxies sit in front of the app (Express "trust proxy" as a hop count).
 * TRUST_PROXY_HOPS is an integer from 0 to 10; unset means 1 (nginx alone); 2 is Coolify/Traefik
 * in front of nginx; 0 trusts no proxy header at all (a Dockerfile-only deploy with nothing in
 * front). Junk, a negative value or one above 10 logs one line and uses 1: a huge number would
 * mean "trust every X-Forwarded-For entry", so a client could choose its own address.
 * The one place `trust proxy` is set is server/index.ts.
 */
export const MAX_TRUST_PROXY_HOPS = 10;

export function parseTrustProxyHops(
  raw: string | undefined = process.env.TRUST_PROXY_HOPS,
  warn: (line: string) => void = (line) => console.warn(line),
): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = raw.trim();
  if (/^\d+$/.test(value) && Number(value) <= MAX_TRUST_PROXY_HOPS) return Number(value);
  warn(`TRUST_PROXY_HOPS must be an integer from 0 to ${MAX_TRUST_PROXY_HOPS}; using 1.`);
  return 1;
}

/**
 * FU5/R54: the built server (`node dist/index.js`, i.e. `npm start`) with NODE_ENV unset
 * would run in development mode, including the permissive CSP. Returns the one line to
 * log when that is the case, or null.
 *
 * "Built" is decided by where the running MODULE lives, not by the process's cwd: the bundle
 * is one file, `<root>/dist/index.js`, so its own directory (`import.meta.dirname`) is named
 * `dist`. `npm run dev` runs `server/index.ts` through tsx, where that directory is `server`,
 * so it keeps defaulting to development. A cwd other than the app root (`docker run -w /`)
 * therefore no longer skips the guard.
 */
export function unsetNodeEnvBootProblem(
  nodeEnv: string | undefined,
  entryFile: string | undefined,
  moduleDir: string | undefined,
): string | null {
  if (nodeEnv) return null;
  if (!moduleDir) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (norm(moduleDir).split("/").pop() !== "dist") return null;
  const where = entryFile ? norm(entryFile) : `${norm(moduleDir)}/index.js`;
  return `Refusing to start: NODE_ENV is not set but the built server (${where}) is running. Set NODE_ENV=production (or development or test explicitly).`;
}
