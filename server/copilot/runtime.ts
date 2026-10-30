/**
 * The CopilotKit runtime, wired to the TicketFlow triage agent.
 *
 * CopilotKit speaks the AG-UI protocol to an agent; @ag-ui/mastra bridges a Mastra
 * agent into that protocol. So the popup in the browser talks to the SAME triage
 * agent the standalone Mastra service exposes, which drives the SAME MCP tools the
 * DeepSeek Harness uses. There is one brain and one tool surface; CopilotKit is
 * only another way to reach them.
 *
 * Everything here is loaded lazily, on the first request, and only while
 * COPILOTKIT_ENABLED is true. Two reasons: building the agent lists the MCP tools
 * over HTTP, and the server is not listening yet while routes are being
 * registered; and a deployment that never enables the copilot never pays for
 * importing these packages.
 */
import type { RequestHandler } from "express";
import { describeError } from "../http/errors";
import { readMastraAgentConfig, type MastraAgentConfig } from "../mastra/config";
import type { CopilotActor } from "../mastra/agents/ticket-agent";
import type { CopilotKitRuntimeConfig } from "./config";

interface BuiltCopilotKit {
  handler: RequestHandler;
  /** Releases the MCP connection the agent holds. */
  dispose: () => Promise<void>;
}

/** One built runtime per signed-in user (see buildOnce). */
const perUser = new Map<string, Promise<BuiltCopilotKit>>();

/**
 * Builds the runtime handler once. Subsequent callers share the first promise, so
 * concurrent first requests start one agent, not several.
 *
 * `actor` is the signed-in user the copilot is speaking for. The agent is built to act as that
 * person (see server/mcp/actAs.ts), so a ticket it creates belongs to the customer rather than
 * to the API key's owner, and every tool call is limited to what that person may do.
 */
function buildOnce(
  config: CopilotKitRuntimeConfig,
  _mastraConfig: MastraAgentConfig,
  actor: CopilotActor,
): Promise<BuiltCopilotKit> {
  // The agent is per-user: sharing one build across users would give every later visitor the
  // first visitor's identity. Cached per user, so a returning user does not rebuild the agent.
  const cached = perUser.get(actor.id);
  if (cached) return cached;

  const building = (async () => {
    // CopilotKit ships opt-out telemetry: its runtime sends anonymous usage events to a
    // vendor endpoint. This project makes no outbound call it was not asked to make (the e2e
    // no-egress guard enforces it), so telemetry is off unless the operator explicitly turns
    // it on. Set before the runtime is imported, because it reads the switch at load time.
    process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

    // One run at a time per agent: the run's identity is what its MCP calls act for.
    const { createTicketFlowAgentService } = await import("../mastra/index");
    const { getLocalAgents } = await import("@ag-ui/mastra");
    const { CopilotRuntime } = await import("@copilotkit/runtime/v2");
    const { createCopilotExpressHandler } = await import("@copilotkit/runtime/v2/express");

    // The same agent service the standalone Mastra process builds, but scoped to this person:
    // identical model and key, the tools their role may use, and their identity on every call.
    // The copilot builds its agent on the TicketFlow origin itself, so the agent reaches MCP at
    // the LOCAL port. TICKETFLOW_MCP_URL is left for the standalone service (Docker/localhost).
    const port = process.env.PORT?.trim() || "5000";
    const localMcpUrl = `http://127.0.0.1:${port}/api/mcp`;
    const service = await createTicketFlowAgentService(
      { ...process.env, TICKETFLOW_MCP_URL: localMcpUrl },
      actor,
    );
    if (!service) throw new Error("mastra agent service is unavailable");

    // One agent, registered as "default" so the client needs no agentId.
    const discovered = getLocalAgents({ mastra: service.mastra, resourceId: config.resourceId });
    const agent = Object.values(discovered)[0];
    if (!agent) throw new Error("mastra agent was not found");

    // @ag-ui/mastra builds the agent against the root @ag-ui/client copy, while
    // @copilotkit/runtime resolves its own nested copy. The two are the same
    // protocol classes but TypeScript treats them as distinct (a private field
    // differs), so the record is cast across the boundary.
    const runtime = new CopilotRuntime({ agents: { default: agent } as never });
    const handler = createCopilotExpressHandler({
      runtime,
      basePath: config.basePath,
      mode: "multi-route",
      // No managed channels here; skipping them avoids opening sockets a route
      // mounted on an existing app does not own.
      activateChannels: false,
    }) as unknown as RequestHandler;

    return { handler, dispose: () => service.disconnect() };
  })().catch((error) => {
    // A failed build must not be cached: a later request (after the operator fixes
    // the key, say) should be able to try again.
    perUser.delete(actor.id);
    throw error;
  });
  perUser.set(actor.id, building);
  return building;
}

/** True when path is the base path itself or a child of it. */
function isUnderBasePath(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}

/**
 * The single middleware mounted on the app root. It acts only on the copilot base
 * path and returns next() for everything else, so it can sit in the route table
 * without touching any other endpoint. On its own path: a signed-in user, then a
 * cheap enablement probe (no agent build), then the lazy build and delegate. A
 * build failure answers 503 with the error contract, never a stack trace.
 */
export function createCopilotKitMiddleware(
  config: CopilotKitRuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  return (req, res, next) => {
    if (!isUnderBasePath(req.path, config.basePath)) return next();

    const user = req.user as { id?: string; role?: string } | undefined;
    if (!req.isAuthenticated() || !user?.id || !user.role) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Sign in to use the copilot.",
      });
    }

    // The agent layer the copilot borrows. Checked on every path, including the
    // probe below, so the client never renders a popup that cannot answer.
    const mastraConfig = readMastraAgentConfig(env);
    if (!mastraConfig) {
      return res.status(503).json({
        error: "copilot_disabled",
        message: "The copilot needs the Mastra agent layer: set MASTRA_AGENT_ENABLED=true.",
      });
    }

    // A cheap probe the client calls to decide whether to render the popup. It must
    // not build the agent, so it answers here. The role lets the popup greet a customer
    // differently from staff, without a second request.
    if (req.method === "GET" && req.path === `${config.basePath}/config`) {
      return res.json({ enabled: true, basePath: config.basePath, role: user.role });
    }

    const actor: CopilotActor = { id: user.id, role: user.role };

    buildOnce(config, mastraConfig, actor).then(
      ({ handler }) => {
        // The agent built for this user records each run's identity itself (see
        // createTicketFlowAgentService and server/mcp/actAs.ts), so the agent's MCP calls act as
        // this person rather than as the API key's owner.
        handler(req, res, next);
      },
      (error) => {
        console.error(`CopilotKit runtime failed to start [${describeError(error)}]`);
        if (!res.headersSent) {
          res.status(503).json({
            error: "copilot_unavailable",
            message: "The copilot runtime could not start. Check the server log.",
          });
        }
      },
    );
  };
}

/** Closes every built agent connection (one per user), on shutdown. */
export async function disposeCopilotKit(): Promise<void> {
  const pending = Array.from(perUser.values());
  perUser.clear();
  await Promise.all(
    pending.map(async (build) => {
      try {
        const { dispose } = await build;
        await dispose();
      } catch {
        // A build that already failed has nothing to close.
      }
    }),
  );
}
