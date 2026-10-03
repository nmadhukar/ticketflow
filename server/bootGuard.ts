// FU5: imported first by server/index.ts (after dotenv), so it runs before any other
// module is evaluated. The built server must not silently run as development
// (permissive CSP) when NODE_ENV is unset; see unsetNodeEnvBootProblem in ./env.
import path from "path";
import { unsetNodeEnvBootProblem } from "./env";

const problem = unsetNodeEnvBootProblem(
  process.env.NODE_ENV,
  process.argv[1] ? path.resolve(process.argv[1]) : undefined,
  path.resolve(process.cwd(), "dist"),
);
if (problem) {
  console.error(problem);
  process.exit(1);
}
