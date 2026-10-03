import { existsSync, readFileSync, rmSync } from "node:fs";

/**
 * Fails the run if the app server tried to reach a non-loopback host (see
 * e2e/no-egress.cjs, which blocks and records each attempt).
 */
export default async function globalTeardown(): Promise<void> {
  const log = process.env.E2E_EGRESS_LOG;
  if (!log || !existsSync(log)) return;
  const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  rmSync(log, { force: true });
  if (lines.length > 0) {
    throw new Error(`The e2e app server made outbound connections:\n${Array.from(new Set(lines)).join("\n")}`);
  }
}
