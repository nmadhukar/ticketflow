import "dotenv/config";
import { startEvalHarnessServer } from "./harness";

/**
 * Runs the eval harness as a small loopback HTTP server, so the agents package can open runs.
 *
 *   npm run eval:harness
 *
 * It opens runs for the two seeded eval accounts only (eval-customer, eval-staff) and nothing else.
 * The MCP-hop secret stays in this process: the agents sidecar never sees it.
 */
const port = Number(process.env.EVAL_HARNESS_PORT ?? 5199);

startEvalHarnessServer(port)
  .then(({ url }) => {
    console.log(`eval harness on ${url}`);
    console.log("  POST /run { userId, agentId }   DELETE /run/:runId   GET /health");
  })
  .catch((error) => {
    console.error(`eval harness: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
