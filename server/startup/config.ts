import { appBaseUrlProblem } from "../utils/appBaseUrl";
import { secretProblem } from "../security/secrets";

/**
 * Configuration the server refuses to start without. Runs first at boot, before
 * the database is touched, so a bad value stops the process before the seeders write anything.
 * (SESSION_SECRET / JWT_SECRET are also enforced where they are read, security/secrets.ts.)
 *
 *  - APP_BASE_URL (ruling R34): required in production, and well-formed whenever set.
 *  - SESSION_SECRET and JWT_SECRET: set, and not a placeholder, in production.
 */
export function startupConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const baseUrl = appBaseUrlProblem(env);
  if (baseUrl) problems.push(baseUrl);
  for (const name of ["SESSION_SECRET", "JWT_SECRET"] as const) {
    const problem = secretProblem(name, env);
    if (problem) problems.push(problem);
  }
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
