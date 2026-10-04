// FU5: imported first by server/index.ts (after dotenv), so it runs before any other
// module is evaluated. The built server must not silently run as development
// (permissive CSP) when NODE_ENV is unset; see unsetNodeEnvBootProblem in ./env.
import path from "path";
import { unsetNodeEnvBootProblem } from "./env";
import { assertStartupConfig } from "./startup/config";

// R54: the app root comes from this module's own location (esbuild bundles it into
// dist/index.js, so import.meta.dirname is `.../dist`), never from process.cwd().
const problem = unsetNodeEnvBootProblem(
  process.env.NODE_ENV,
  process.argv[1] ? path.resolve(process.argv[1]) : undefined,
  import.meta.dirname,
);
if (problem) {
  console.error(problem);
  process.exit(1);
}

// The required configuration (APP_BASE_URL, SESSION_SECRET, JWT_SECRET) is checked here too,
// before ./security/jwt is evaluated: jwt.ts resolves JWT_SECRET at module load, and a short
// or placeholder value would otherwise crash with a stack trace instead of the one-line refusal.
// (assertStartupConfig exits 1 with one line; server/index.ts checks again, which is harmless.)
assertStartupConfig();
