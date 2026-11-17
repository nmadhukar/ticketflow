import type { Express, Request, Response } from "express";
import type { AssistantAgentId } from "@shared/assistant";
import { isAssistantEnabled } from "./config";

/**
 * Dev-only routes that open an assistant run for the dataset evaluations.
 *
 * Why this exists: a run's MCP token is only accepted while the run is open in THIS process's
 * registry (runAuth.ts, `run_not_open`). The evaluations run in the agents sidecar, a different
 * process, so it cannot open a run itself. These routes let it ask the app to.
 *
 * Off unless BOTH hold:
 *   - EVAL_RUNS_ENABLED=true
 *   - MASTRA_STUDIO_RUNS=true (only docker-compose.studio.yml sets it), or NODE_ENV is
 *     "development" / "test"
 *
 * And even then only the two seeded evaluation accounts may be used (scripts/db/seed-eval-users.mjs),
 * so this can never open a run for a real user. The MCP-hop secret stays in this process: the
 * response carries a token, never a secret.
 *
 *   POST   /api/assistant/eval/run   { userId, agentId } -> { runId, userId, agentId, mcpToken, agentToken }
 *   DELETE /api/assistant/eval/run/:runId
 */

const EVAL_USER_IDS = new Set(["eval-customer", "eval-staff"]);
const AGENT_IDS = new Set<AssistantAgentId>(["support-assistant", "ticket-assistant"]);

/**
 * Local development only, decided by an explicit switch rather than by NODE_ENV.
 *
 * The app container that serves local Studio runs the BUILT bundle (Dockerfile: `npm run build`,
 * then `node dist/index.js`), so it is correctly NODE_ENV=production: that is what serves
 * dist/public and enforces the production secret and APP_BASE_URL checks. A NODE_ENV test here
 * therefore left the route unregistered in that container and Studio could never open a run
 * ("No assistant run on this request").
 *
 * MASTRA_STUDIO_RUNS is set only by docker-compose.studio.yml, and the same guard that protects
 * MASTRA_STUDIO_NO_AUTH (agents/src/mastra/config-issues.ts) refuses it when the sidecar runs in
 * production outside that file. Development and test keep working without the switch, so
 * `npm run dev` and the test suite are unchanged.
 */
export function evalRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const local =
    env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.MASTRA_STUDIO_RUNS === "true";
  return local && env.EVAL_RUNS_ENABLED === "true" && isAssistantEnabled(env);
}

export function registerEvalRunRoutes(app: Express, env: NodeJS.ProcessEnv = process.env): void {
  if (!evalRunsEnabled(env)) return;

  app.post("/api/assistant/eval/run", async (req: Request, res: Response) => {
    const { userId, agentId } = (req.body ?? {}) as { userId?: unknown; agentId?: unknown };
    if (typeof userId !== "string" || !EVAL_USER_IDS.has(userId)) {
      return res.status(403).json({ error: "not_an_eval_user" });
    }
    if (typeof agentId !== "string" || !AGENT_IDS.has(agentId as AssistantAgentId)) {
      return res.status(400).json({ error: "unknown_agent" });
    }
    try {
      const { assistantRuns } = await import("./runs");
      const runs = assistantRuns();
      const run = runs.start(userId, agentId as AssistantAgentId);
      // The same check the MCP endpoint applies, so a role/agent mismatch fails here, not later.
      const auth = await runs.authenticate(run.mcpToken);
      if (!auth.ok) {
        runs.end(run.runId);
        return res.status(403).json({ error: "run_refused", reason: auth.reason });
      }
      res.json({ runId: run.runId, userId, agentId, mcpToken: run.mcpToken, agentToken: run.agentToken });
    } catch (error) {
      // Never the exception's text: it can carry a connection string or a token. The name only.
      console.error(`Eval run failed [${error instanceof Error ? error.name : "error"}]`);
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.delete("/api/assistant/eval/run/:runId", async (req: Request, res: Response) => {
    const { assistantRuns } = await import("./runs");
    assistantRuns().end(req.params.runId);
    res.json({ ended: true });
  });
}
