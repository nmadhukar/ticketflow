import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { User } from "@shared/schema";
import type { AssistantAgentId } from "@shared/assistant";
import { createInternalApp } from "../../assistant/internalServer";
import { assistantRuns } from "../../assistant/runs";
import { createAssistantMcpServer } from "../../assistant/mcpServer";
import { storage } from "../../storage";

/**
 * The harness the dataset evaluations run against.
 *
 * Why it exists: a run's MCP token is only accepted while the run is open in the app's in-memory
 * registry (runAuth.ts, `run_not_open`). That registry is filled by `runs.start()`, which the
 * bridge calls when a signed-in user sends a chat request. A token minted by a script is
 * cryptographically valid but refused at the first tool call, so the evaluations cannot simply
 * mint one.
 *
 * Instead this starts the app's own internal listener in-process and opens a run through the same
 * registry the bridge uses. Every check then runs for real: the user is reloaded from the database,
 * `keyOwnerBlockReason` applies, and the role must still map to the agent. Nothing is stubbed and
 * no new endpoint is added.
 *
 * It must run in the APP process, not in the agents sidecar: the MCP-hop secret never leaves the
 * app, and the sidecar refuses to start if it is given one (agents/src/mastra/config-issues.ts).
 */

export interface EvalRun {
  /** The MCP-hop token: what the sidecar forwards on every tool call. */
  mcpToken: string;
  /** The agent-hop token: what the sidecar verifies on the run request. */
  agentToken: string;
  runId: string;
  userId: string;
  agentId: AssistantAgentId;
  /** Ends the run, so its tokens are refused from now on. */
  end(): void;
}

export interface EvalHarness {
  /** The internal listener's base URL, e.g. http://127.0.0.1:54321. */
  url: string;
  /** Opens a run for a seeded user, as the bridge would. Throws if the user cannot run that agent. */
  openRun(userId: string, agentId: AssistantAgentId): Promise<EvalRun>;
  close(): Promise<void>;
}

/** The two accounts scripts/db/seed-eval-users.mjs creates. */
export const EVAL_CUSTOMER_ID = "eval-customer";
export const EVAL_STAFF_ID = "eval-staff";

async function loadUser(id: string): Promise<User> {
  const user = await storage.getUser(id);
  if (!user) {
    throw new Error(`Eval user "${id}" was not found. Run: node scripts/db/seed-eval-users.mjs`);
  }
  return user;
}

/**
 * The harness as a small HTTP server, so the agents package can open runs without importing app
 * code (it is its own build context). Loopback only, and it opens runs for the two seeded eval
 * accounts and nothing else.
 *
 *   POST   /run            { userId, agentId } -> { runId, userId, agentId, mcpToken, agentToken }
 *   DELETE /run/:runId     ends the run
 *   GET    /health
 */
export async function startEvalHarnessServer(port = 0): Promise<{ url: string; close(): Promise<void> }> {
  const harness = await startEvalHarness();
  const allowed = new Set<string>([EVAL_CUSTOMER_ID, EVAL_STAFF_ID]);

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok' });

      if (req.method === 'POST' && url.pathname === '/run') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { userId?: string; agentId?: string };
        if (!body.userId || !allowed.has(body.userId)) return send(403, { error: 'not_an_eval_user' });
        if (body.agentId !== 'ticket-assistant' && body.agentId !== 'support-assistant') return send(400, { error: 'unknown_agent' });
        const run = await harness.openRun(body.userId, body.agentId);
        return send(200, { runId: run.runId, userId: run.userId, agentId: run.agentId, mcpToken: run.mcpToken, agentToken: run.agentToken });
      }

      const ended = /^\/run\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'DELETE' && ended) {
        // The registry is keyed by run id; ending an unknown one is a no-op.
        (await import('../../assistant/runs')).assistantRuns().end(ended[1]);
        return send(200, { ended: true });
      }

      send(404, { error: 'not_found' });
    } catch (error) {
      send(500, { error: error instanceof Error ? error.message : 'error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => resolve());
  });
  const { port: bound } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${bound}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await harness.close();
    },
  };
}

export async function startEvalHarness(): Promise<EvalHarness> {
  const app = createInternalApp({
    runs: async () => assistantRuns(),
    createMcpServer: async (user, agentId, ip, runId) => createAssistantMcpServer(user, agentId, ip, runId),
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Port 0: the OS picks a free one, so two runs never collide.
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,

    async openRun(userId, agentId) {
      // Reloaded first, so a missing or blocked account fails here with a clear message rather
      // than as a 401 on the first tool call.
      await loadUser(userId);
      const runs = assistantRuns();
      const run = runs.start(userId, agentId);
      // The same check the MCP endpoint applies, so a role/agent mismatch is caught now.
      const auth = await runs.authenticate(run.mcpToken);
      if (!auth.ok) {
        runs.end(run.runId);
        throw new Error(`Eval run refused for "${userId}" on "${agentId}": ${auth.reason}`);
      }
      return {
        mcpToken: run.mcpToken,
        agentToken: run.agentToken,
        runId: run.runId,
        userId,
        agentId,
        end: () => runs.end(run.runId),
      };
    },

    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
