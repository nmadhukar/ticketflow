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
