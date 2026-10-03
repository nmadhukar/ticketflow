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
 * FU5: the built server (`node dist/index.js`, i.e. `npm start`) with NODE_ENV unset
 * would run in development mode, including the permissive CSP. Returns the one line to
 * log when that is the case, or null. `npm run dev` runs `server/index.ts` through tsx,
 * which is not inside `dist`, so it keeps defaulting to development.
 */
export function unsetNodeEnvBootProblem(
  nodeEnv: string | undefined,
  entryFile: string | undefined,
  distDir: string,
): string | null {
  if (nodeEnv) return null;
  if (!entryFile) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const dist = norm(distDir);
  const entry = norm(entryFile);
  if (entry !== dist && !entry.startsWith(`${dist}/`)) return null;
  return `Refusing to start: NODE_ENV is not set but the built server (${entry}) is running. Set NODE_ENV=production (or development or test explicitly).`;
}
