import { appBaseUrlProblem } from "../utils/appBaseUrl";

/**
 * Configuration the server refuses to start without. Runs first at boot, before
 * the database is touched. (SESSION_SECRET / JWT_SECRET are enforced where they
 * are read, security/secrets.ts.)
 *
 *  - APP_BASE_URL (ruling R34): required in production, and well-formed whenever set.
 */
export function startupConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const baseUrl = appBaseUrlProblem(env);
  if (baseUrl) problems.push(baseUrl);
  return problems;
}

/** One log line and exit 1 when anything is wrong. `log`/`exit` are injectable for tests. */
export function assertStartupConfig(
  opts: {
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
    exit?: (code: number) => never | void;
  } = {}
): boolean {
  const problems = startupConfigProblems(opts.env ?? process.env);
  if (problems.length === 0) return true;
  (opts.log ?? ((line: string) => console.error(line)))(`Startup refused: ${problems.join("; ")}.`);
  (opts.exit ?? ((code: number) => process.exit(code)))(1);
  return false;
}
