import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler } from "express";
import { createServer, type Server } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { User } from "@shared/schema";
import type { AssistantAgentId } from "@shared/assistant";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeError } from "../http/errors";
import { isAssistantEnabled, readInternalHost, readInternalPort } from "./config";
import type { AssistantRuns } from "./runAuth";
import { logAssistantSecurityEvent } from "./securityLog";

/**
 * The app's second, internal HTTP listener: the only place assistant tokens are accepted.
 *
 * It binds ASSISTANT_INTERNAL_HOST (loopback by default). In Docker Compose it binds 0.0.0.0 and
 * the Mastra sidecar reaches it at http://app:<ASSISTANT_INTERNAL_PORT> over the private
 * `assistant` network; nginx proxies only the public port (PORT). The public /api/mcp contract
 * (API keys, used by DSH) stays exactly as it is. Every route still checks its own token: other
 * containers on the app's networks can open this port.
 *
 *   POST /internal/mcp               MCP for one assistant run, as its signed-in user
 *   POST /internal/assistant/renew   a fresh MCP token for a run nearing its token's expiry
 *
 * Both take the run's MCP-hop token in X-TicketFlow-MCP-Session (runAuth.ts).
 */

export const MCP_SESSION_HEADER = "x-ticketflow-mcp-session";

export interface InternalAppDeps {
  runs: () => Promise<AssistantRuns<User>>;
  createMcpServer: (user: User, agentId: AssistantAgentId, ip?: string) => Promise<McpServer>;
}

// Loaded on first use: both reach the database, which modules describing the app must not.
const defaultDeps: InternalAppDeps = {
  runs: async () => (await import("./runs")).assistantRuns(),
  createMcpServer: async (user, agentId, ip) => (await import("./mcpServer")).createAssistantMcpServer(user, agentId, ip),
};

function sessionToken(req: Request): string | null {
  const value = req.get(MCP_SESSION_HEADER)?.trim();
  return value ? value : null;
}

function refuse(res: express.Response, status: 401 | 403, error: string) {
  res.status(status).json({ error });
}

export function createInternalApp(deps: InternalAppDeps = defaultDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/internal/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const mcpPost: RequestHandler = async (req, res, next) => {
    try {
      const token = sessionToken(req);
      if (!token) return refuse(res, 401, "missing_session");
      // One credential per request: an API key belongs on the public /api/mcp, never here.
      if (req.get("authorization")) return refuse(res, 401, "unexpected_credentials");

      const auth = await (await deps.runs()).authenticate(token);
      if (!auth.ok) {
        logAssistantSecurityEvent({ event: "mcp_auth_refused", reason: auth.reason, userId: auth.userId, runId: auth.runId, ip: req.ip });
        return refuse(res, 401, "invalid_session");
      }

      // Stateless, as the public endpoint: a new server and transport per request.
      const server = await deps.createMcpServer(auth.user, auth.agentId, req.ip);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) return next(error);
      console.error(`Assistant MCP request failed [${describeError(error)}]`);
    }
  };
  app.post("/internal/mcp", mcpPost);
  app.all("/internal/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
  });

  app.post("/internal/assistant/renew", async (req, res, next) => {
    try {
      const token = sessionToken(req);
      if (!token) return refuse(res, 401, "missing_session");
      const renewed = await (await deps.runs()).renew(token);
      if (!renewed.ok || !renewed.mcpToken) {
        const reason = renewed.ok ? "not_renewed" : renewed.reason;
        logAssistantSecurityEvent({ event: "renew_refused", reason, userId: renewed.ok ? renewed.user.id : renewed.userId, runId: renewed.runId, ip: req.ip });
        // The sidecar acts on the reason: too early means "keep the current token".
        return res.status(reason === "renew_too_early" ? 409 : 401).json({ error: "not_renewed", reason });
      }
      res.json({ token: renewed.mcpToken });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(`Assistant internal request failed [${describeError(error)}]`);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return app;
}

/**
 * Starts the listener when the assistant is enabled; null otherwise. A listener error (the port is
 * taken) is logged and handed to `onError`, which the server entry turns into its orderly shutdown:
 * the app must not run with half its listeners, nor drop the public one's requests mid-flight.
 */
export function startInternalServer(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  onError: (error: Error) => void;
}): Server | null {
  const env = opts.env ?? process.env;
  if (!isAssistantEnabled(env)) return null;
  const port = readInternalPort(env);
  const host = readInternalHost(env);
  const server = createServer(createInternalApp());
  server.on("error", (error) => {
    console.error(`Assistant internal listener failed [${describeError(error)}]`);
    opts.onError(error);
  });
  server.listen({ port, host }, () => (opts.log ?? console.log)(`assistant internal listener on ${host}:${port}`));
  return server;
}
