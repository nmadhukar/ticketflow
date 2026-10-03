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
