import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { User } from "@shared/schema";
import { agentForRole, ASSISTANT_AGENT_IDS, type AssistantAgentId } from "@shared/assistant";
import { normalizeRole } from "../permissions/roles";
import { configuredBaseUrl } from "../utils/appBaseUrl";
import { createCustomRateLimit, rateLimitingEnabled } from "../security/rateLimiting";
import { isAssistantEnabled } from "./config";
import { logAssistantSecurityEvent } from "./securityLog";
import type { AssistantRuns } from "./runAuth";

/**
 * The browser's only way to the assistant: /api/copilotkit, CopilotKit's AG-UI routes, proxied to
 * the Mastra sidecar for the signed-in user.
 *
 * The browser holds nothing but its session cookie (bearer credentials are refused on this path:
 * services/auth/bearer.ts). For each RUN the app opens a run (runAuth.ts) and sends the sidecar its
 * two tokens; the run ends when the run's response ends, after which its tokens are refused.
 * Only the caller's own agent is registered, so a customer cannot reach the staff agent by
 * changing the id in the URL.
 *
 *   GET /api/assistant/availability   whether this user has an assistant, and which
 */

export const COPILOT_BASE_PATH = "/api/copilotkit";
const INTERNAL_AGENT_TOKEN = "x-tf-internal-agent-token";
const INTERNAL_MCP_TOKEN = "x-tf-internal-mcp-token";
const DEFAULT_AGENT_URL = "http://127.0.0.1:4111";

type CopilotRoute = "info" | "connect" | "run" | "stop";
const AGENT_ID = `(?:${ASSISTANT_AGENT_IDS.join("|")})`;

/**
 * The only CopilotKit routes the panel uses. CopilotKit matches trailing path segments, so
 * "…/run/", "…//run" or "…/suggest" would otherwise run the agent past the rate limit
 * (Workforce Nexus audit A16). Everything else is refused before CopilotKit sees it.
 */
const COPILOT_ROUTES: Array<[method: string, path: RegExp, route: CopilotRoute]> = [
  ["GET", /^\/info$/, "info"],
  ["POST", new RegExp(`^/agent/${AGENT_ID}/connect$`), "connect"],
  ["POST", new RegExp(`^/agent/${AGENT_ID}/run$`), "run"],
  ["POST", new RegExp(`^/agent/${AGENT_ID}/stop/[A-Za-z0-9_-]{1,200}$`), "stop"],
];

/** Classifies the path exactly as sent (Express trims a doubled slash from req.path; CopilotKit would not). */
export function classifyCopilotRequest(req: Pick<Request, "method" | "originalUrl">): { route: CopilotRoute; agentId: string | null } | null {
  const pathname = req.originalUrl.split("?")[0];
  if (!pathname.startsWith(`${COPILOT_BASE_PATH}/`)) return null;
  const path = pathname.slice(COPILOT_BASE_PATH.length);
  const match = COPILOT_ROUTES.find(([method, pattern]) => req.method === method && pattern.test(path));
  if (!match) return null;
  return { route: match[2], agentId: /^\/agent\/([^/]+)\//.exec(path)?.[1] ?? null };
}

/** The signed-in user's agent, or null: no session, an unknown role, or no assistant for it. */
export function assistantFor(req: Request): { user: User; agentId: AssistantAgentId } | null {
  const user = req.isAuthenticated?.() ? (req.user as User | undefined) : undefined;
  if (!user) return null;
  const agentId = agentForRole(normalizeRole(user.role));
  return agentId ? { user, agentId } : null;
}

/**
 * Cross-site request check for the session-cookie routes: the Origin (or, without one, the
 * Referer) must be this site. SameSite=Lax alone would let a same-site page start a run.
 */
export function sameOrigin(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const source = req.get("origin") ?? req.get("referer");
  if (!source) return false;
  let origin: string;
  try {
    origin = new URL(source).origin;
  } catch {
    return false;
  }
  const configured = configuredBaseUrl(env);
  const expected = configured ? new URL(configured).origin : `${req.protocol}://${req.get("host")}`;
  return origin === expected;
}

function deny(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message });
}

export type CopilotHandlerFactory = (userId: string, agentId: AssistantAgentId, env: NodeJS.ProcessEnv) => Promise<RequestHandler>;

export interface BridgeDeps {
  runs: () => Promise<AssistantRuns<User>>;
  /** The CopilotKit handler for one user's agent; the default is the real runtime below. */
  createHandler?: CopilotHandlerFactory;
  env?: NodeJS.ProcessEnv;
}

const defaultDeps: BridgeDeps = {
  runs: async () => (await import("./runs")).assistantRuns(),
};

function agentUrl(env: NodeJS.ProcessEnv): string {
  return env.ASSISTANT_AGENT_URL?.trim() || DEFAULT_AGENT_URL;
}

/** Built on first use: the CopilotKit and Mastra client modules are large and unused while the assistant is off. */
const createHandler: CopilotHandlerFactory = async (userId, agentId, env) => {
  const [{ CopilotRuntime, InMemoryAgentRunner }, { createCopilotExpressHandler }, { MastraAgent }, { MastraClient }] = await Promise.all([
    import("@copilotkit/runtime/v2"),
    import("@copilotkit/runtime/v2/express"),
    import("@ag-ui/mastra"),
    import("@mastra/client-js"),
  ]);
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";
  const runtime = new CopilotRuntime({
    // One runner per user, so threads of different users never share a store.
    runner: new InMemoryAgentRunner({ maxThreads: 50, maxRunsPerThread: 20, maxBytes: 8 * 1024 * 1024 }),
    agents: ({ request }: { request: globalThis.Request }) => {
      const agentToken = request.headers.get(INTERNAL_AGENT_TOKEN);
      const mcpToken = request.headers.get(INTERNAL_MCP_TOKEN);
      // Tokens exist only on a run request (set below); anything else reaching Mastra is refused there.
      const headers: Record<string, string> = agentToken && mcpToken ? { Authorization: `Bearer ${agentToken}`, "X-TicketFlow-MCP-Session": mcpToken } : {};
      const client = new MastraClient({ baseUrl: agentUrl(env), headers });
      const agent = new MastraAgent({
        agentId,
        agent: client.getAgent(agentId),
        remoteClient: client,
        resourceId: `user:${userId}`,
        // Show each tool call as it starts. Safe while no tool suspends (no approvals yet).
        streamServerToolCalls: true,
      } as ConstructorParameters<typeof MastraAgent>[0]);
      // Exactly one agent, the caller's. The cast only tells CopilotKit's NonEmptyRecord type
      // what a computed key cannot: the record is not empty.
      return { [agentId]: agent } as Record<AssistantAgentId, typeof agent>;
    },
    // Allowlist mode: no browser header but a request id reaches the sidecar, and never ours.
    forwardHeaders: { allow: ["x-request-id"], denyPrefixes: ["x-tf-internal-"] },
  });
  return createCopilotExpressHandler({ runtime, basePath: COPILOT_BASE_PATH, mode: "multi-route", cors: false });
}

export function registerAssistantRoutes(app: Express, deps: BridgeDeps = defaultDeps): void {
  const env = deps.env ?? process.env;

  app.get("/api/assistant/availability", (req, res) => {
    const found = assistantFor(req);
    if (!req.isAuthenticated?.() || !req.user) return deny(res, 401, "unauthorized", "Sign in to use the assistant.");
    res.json({ enabled: isAssistantEnabled(env) && !!found, agentId: found?.agentId ?? null });
  });

  const runLimit: RequestHandler = rateLimitingEnabled()
    ? createCustomRateLimit({ windowMs: 15 * 60 * 1000, max: (req) => (assistantFor(req)?.agentId === "support-assistant" ? 30 : 60), message: "Too many assistant requests. Please wait a few minutes." })
    : (_req, _res, next) => next();

  const handlers = new Map<string, Promise<RequestHandler>>();
  const MAX_CACHED_HANDLERS = 500;
  const makeHandler = deps.createHandler ?? createHandler;

  app.use(COPILOT_BASE_PATH, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Browser-supplied copies of the internal headers are never trusted.
      delete req.headers[INTERNAL_AGENT_TOKEN];
      delete req.headers[INTERNAL_MCP_TOKEN];

      if (!req.isAuthenticated?.() || !req.user) return deny(res, 401, "unauthorized", "Sign in to use the assistant.");
      if (!isAssistantEnabled(env)) return deny(res, 503, "assistant_disabled", "The assistant is not enabled.");
      const found = assistantFor(req);
      if (!found) return deny(res, 403, "assistant_unavailable", "The assistant is not available for your account.");

      const classified = classifyCopilotRequest(req);
      if (!classified || (classified.agentId && classified.agentId !== found.agentId)) {
        return deny(res, 404, "not_found", "Not found.");
      }
      if (req.method !== "GET" && !sameOrigin(req, env)) {
        logAssistantSecurityEvent({ event: "run_refused", reason: "cross_origin", userId: found.user.id, agentId: found.agentId, ip: req.ip });
        return deny(res, 403, "forbidden", "Cross-site request refused.");
      }

      const proceed = async () => {
        if (classified.route === "run") {
          const run = (await deps.runs()).start(found.user.id, found.agentId);
          req.headers[INTERNAL_AGENT_TOKEN] = run.agentToken;
          req.headers[INTERNAL_MCP_TOKEN] = run.mcpToken;
          // The run's tokens die with its response: a tool call after that is refused.
          res.on("close", () => void deps.runs().then((runs) => runs.end(run.runId)));
        }
        const key = `${found.user.id}:${found.agentId}`;
        let handler = handlers.get(key);
        if (!handler) {
          if (handlers.size >= MAX_CACHED_HANDLERS) handlers.delete(handlers.keys().next().value!);
          handler = makeHandler(found.user.id, found.agentId, env);
          // A failed build is not kept: the next request tries again.
          handler.catch(() => handlers.delete(key));
          handlers.set(key, handler);
        }
        // The handler routes on the full path (it was built with the base path).
        req.url = req.originalUrl;
        (await handler)(req, res, next);
      };

      if (classified.route === "run") return runLimit(req, res, () => void proceed().catch(next));
      await proceed();
    } catch (error) {
      next(error);
    }
  });
}
