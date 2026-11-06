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
 *   - NODE_ENV is not "production"
 *   - EVAL_RUNS_ENABLED=true
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

export function evalRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.EVAL_RUNS_ENABLED === "true" && isAssistantEnabled(env);
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
      res.status(500).json({ error: error instanceof Error ? error.message : "error" });
    }
  });

  app.delete("/api/assistant/eval/run/:runId", async (req: Request, res: Response) => {
    const { assistantRuns } = await import("./runs");
    assistantRuns().end(req.params.runId);
    res.json({ ended: true });
  });
}
