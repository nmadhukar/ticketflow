import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { User } from "@shared/schema";
import { agentForRole, ASSISTANT_AGENT_IDS, type AssistantAgentId } from "@shared/assistant";
import { normalizeRole } from "../permissions/roles";
import { configuredBaseUrl } from "../utils/appBaseUrl";
import { createCustomRateLimit, rateLimitingEnabled } from "../security/rateLimiting";
import { isAssistantEnabled, isStaffHistoryEnabled } from "./config";
import { AuditUnavailableError, logAssistantSecurityEvent } from "./securityLog";
import { assistantWritesEnabled } from "./toolPolicy";
import { ticketErrorToHttp } from "../services/tickets/ticketError";
import type { AssistantRuns } from "./runAuth";
import { LruMap, RunEndings, TrackedRunner, type RunFinish, type RunnerLike } from "./runTracking";
import { budgetExhausted, defaultUsageDeps, recordRun, type RunContext, type UsageDeps } from "./usage";
import { randomUUID } from "crypto";
import { registerAssistantAdminRoutes } from "./admin";
import { createSidecarHistoryStatus, type SidecarHistory } from "./sidecarStatus";
import { map, type Observable } from "rxjs";
import { deleteHistory, getHistory, HistoryError, isThreadId, listHistory, mastraThreadId, newestTurn, STAFF_AGENT } from "./history";

/** Per-user CopilotKit handlers kept in memory; the least recently used beyond this is dropped. */
const MAX_CACHED_HANDLERS = 500;

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
 *   GET  /api/assistant/availability                 whether this user has an assistant, and which
 *   POST /api/assistant/proposals/:proposal/confirm|reject the user's decision on a proposed write
 *   GET|DELETE /api/assistant/history[/:thread]       a staff member's saved conversations
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

export type CopilotHandlerFactory = (
  userId: string,
  agentId: AssistantAgentId,
  env: NodeJS.ProcessEnv,
  endings: RunEndings,
  /** Whether the sidecar's staff agent has memory (staff runs then send only the newest turn). */
  staffMemory: () => Promise<boolean>,
) => Promise<RequestHandler>;

export interface BridgeDeps {
  runs: () => Promise<AssistantRuns<User>>;
  /** The CopilotKit handler for one user's agent; the default is the real runtime below. */
  createHandler?: CopilotHandlerFactory;
  /** Whether the sidecar has saved conversations working; the default asks its /ready. */
  historyStatus?: () => Promise<SidecarHistory>;
  /** Whether the AI budgets are used up (a reason, or null); the default reads ai_usage. */
  budget?: () => Promise<string | null>;
  /** Where run usage and cost are recorded; the default writes assistant_usage_events and ai_usage. */
  usage?: () => Promise<UsageDeps>;
  env?: NodeJS.ProcessEnv;
}

const defaultDeps: BridgeDeps = {
  runs: async () => (await import("./runs")).assistantRuns(),
};

function agentUrl(env: NodeJS.ProcessEnv): string {
  return env.ASSISTANT_AGENT_URL?.trim() || DEFAULT_AGENT_URL;
}

type RunInput = { threadId: string; messages: Array<{ role?: string }> } & Record<string, unknown>;
interface MastraAgentLike {
  run(input: RunInput): Observable<unknown>;
  clone(): unknown;
}

/**
 * The staff agent, always:
 *   - the thread id Mastra sees is prefixed with the user's id (history.ts), so no request can name
 *     another user's thread, whatever id the browser sends, and whether or not memory is on at
 *     that moment; events carry the browser's id back;
 *   - when the sidecar's agent has memory (`memory`), only the newest turn is sent: memory supplies
 *     the earlier ones, and a browser cannot slip invented ones in (WFN M1).
 * CopilotKit clones the agent for each run, and MastraAgent.clone() builds the base class, so the
 * copy is given this class back.
 */
export function staffAgentClass<C extends new (...args: never[]) => MastraAgentLike>(Base: C, userId: string, memory: boolean): C {
  // @ts-expect-error TS2545: a mixin over a generic constructor; the shape is MastraAgentLike.
  return class StaffMastraAgent extends Base {
    run(input: RunInput) {
      const scoped = mastraThreadId(userId, input.threadId);
      return super.run({ ...input, threadId: scoped, messages: memory ? newestTurn(input.messages) : input.messages }).pipe(
        map((event) =>
          event && typeof event === "object" && (event as { threadId?: unknown }).threadId === scoped ? { ...event, threadId: input.threadId } : event,
        ),
      );
    }

    clone() {
      const copy = super.clone() as object;
      Object.setPrototypeOf(copy, Object.getPrototypeOf(this));
      return copy;
    }
  };
}

/** Built on first use: the CopilotKit and Mastra client modules are large and unused while the assistant is off. */
const createHandler: CopilotHandlerFactory = async (userId, agentId, env, endings, staffMemory) => {
  const [{ CopilotRuntime, InMemoryAgentRunner }, { createCopilotExpressHandler }, { MastraAgent }, { MastraClient }] = await Promise.all([
    import("@copilotkit/runtime/v2"),
    import("@copilotkit/runtime/v2/express"),
    import("@ag-ui/mastra"),
    import("@mastra/client-js"),
  ]);
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";
  // One runner per user, so threads of different users never share a store; small, because one is
  // held per active user (at most MAX_CACHED_HANDLERS). TrackedRunner ends each assistant run when
  // its agent run ends (runTracking.ts).
  const runner = new TrackedRunner(
    new InMemoryAgentRunner({ maxThreads: 20, maxRunsPerThread: 20, maxBytes: 2 * 1024 * 1024 }) as unknown as RunnerLike,
    endings,
    userId,
  );
  const runtime = new CopilotRuntime({
    runner: runner as unknown as InstanceType<typeof InMemoryAgentRunner>,
    agents: async ({ request }: { request: globalThis.Request }) => {
      const agentToken = request.headers.get(INTERNAL_AGENT_TOKEN);
      const mcpToken = request.headers.get(INTERNAL_MCP_TOKEN);
      // Tokens exist only on a run request (set below); anything else reaching Mastra is refused there.
      const headers: Record<string, string> = agentToken && mcpToken ? { Authorization: `Bearer ${agentToken}`, "X-TicketFlow-MCP-Session": mcpToken } : {};
      const client = new MastraClient({ baseUrl: agentUrl(env), headers });
      // Staff threads are always prefixed; only the newest turn goes when the sidecar has memory.
      const AgentClass = agentId === STAFF_AGENT ? staffAgentClass(MastraAgent, userId, await staffMemory()) : MastraAgent;
      const agent = new AgentClass({
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

  // Admin views of usage and the audit trail: available whether or not the assistant is on.
  registerAssistantAdminRoutes(app);

  // Saved conversations are SHOWN only when the app's switch is on AND the sidecar reports them
  // working now. How staff runs are BUILT follows whether the sidecar's agent has memory: its last
  // definitive answer, or the app's switch before it has given one (sidecarStatus.ts). A blip in
  // the probe never changes how runs are built.
  const historyStatus = deps.historyStatus ?? createSidecarHistoryStatus(agentUrl(env));
  const switchedOn = () => isAssistantEnabled(env) && isStaffHistoryEnabled(env);
  const historyShown = (status: SidecarHistory) => switchedOn() && status.state === "on";
  const staffMemory = async () => (await historyStatus()).memory ?? switchedOn();

  app.get("/api/assistant/availability", async (req, res, next) => {
    try {
      const found = assistantFor(req);
      if (!req.isAuthenticated?.() || !req.user) return deny(res, 401, "unauthorized", "Sign in to use the assistant.");
      // Offered to staff only; the sidecar is asked only for them, once per request.
      const status = found?.agentId === STAFF_AGENT ? await historyStatus() : null;
      const history = !!status && historyShown(status);
      res.json({
        enabled: isAssistantEnabled(env) && !!found,
        agentId: found?.agentId ?? null,
        history,
        ...(history ? { historyRetentionDays: status!.retentionDays } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The user's decision on a proposal card. Only Confirm writes, as the signed-in user (reloaded
   * by the session on this request), through the normal ticket service (proposals.ts).
   */
  // ":proposal", not ":id": every :id param is checked as a numeric id (http/install.ts), and this is a UUID.
  const PROPOSAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  app.post("/api/assistant/proposals/:proposal/:decision", async (req, res, next) => {
    try {
      const decision = req.params.decision;
      if (decision !== "confirm" && decision !== "reject") return deny(res, 404, "not_found", "Not found.");
      if (!req.isAuthenticated?.() || !req.user) return deny(res, 401, "unauthorized", "Sign in to use the assistant.");
      if (!isAssistantEnabled(env) || !assistantWritesEnabled(env)) return deny(res, 503, "assistant_writes_disabled", "Assistant changes are switched off.");
      const found = assistantFor(req);
      if (!found) return deny(res, 403, "assistant_unavailable", "The assistant is not available for your account.");
      if (!sameOrigin(req, env)) {
        logAssistantSecurityEvent({ event: "write_refused", reason: "cross_origin", userId: found.user.id, agentId: found.agentId, ip: req.ip });
        return deny(res, 403, "forbidden", "Cross-site request refused.");
      }
      if (!PROPOSAL_ID.test(req.params.proposal)) return deny(res, 404, "not_found", "That proposal was not found.");

      const proposals = await import("./proposals");
      try {
        const result =
          decision === "confirm"
            ? await proposals.confirmProposal(found.user, req.params.proposal, req.body?.edits)
            : await proposals.rejectProposal(found.user, req.params.proposal);
        res.json(result);
      } catch (error) {
        if (error instanceof AuditUnavailableError) return deny(res, 503, "audit_unavailable", "This could not be recorded, so nothing was done. Please try again.");
        if (error instanceof proposals.ProposalDecisionError) {
          if (error.code === "not_found") return deny(res, 404, "not_found", "That proposal was not found.");
          if (error.code === "expired") return deny(res, 410, "expired", "This proposal has expired. Ask the assistant again.");
          return res.status(409).json({ error: "already_decided", message: "This proposal was already handled.", ...error.current });
        }
        throw ticketErrorToHttp(error);
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * A staff member's saved conversations (history.ts): list, read (withheld if a ticket it mentions
   * is no longer visible to them) and delete. Their own only: the sidecar scopes memory to the user
   * and the thread ids are prefixed with the user's id.
   */
  const historyDeps = { runs: deps.runs, agentUrl: agentUrl(env) };
  type Found = NonNullable<ReturnType<typeof assistantFor>>;
  /** Refuses what is not allowed (before the rate limit, so refusals never use up the allowance). */
  const historyGuard: RequestHandler = async (req, res, next) => {
    try {
      if (!req.isAuthenticated?.() || !req.user) return deny(res, 401, "unauthorized", "Sign in to use the assistant.");
      const found = assistantFor(req);
      if (!found || found.agentId !== STAFF_AGENT) return deny(res, 403, "forbidden", "Saved conversations are for staff.");
      if (req.method !== "GET" && !sameOrigin(req, env)) return deny(res, 403, "forbidden", "Cross-site request refused.");
      if (!historyShown(await historyStatus())) return deny(res, 503, "history_disabled", "Saved conversations are switched off.");
      res.locals.assistant = found;
      next();
    } catch (error) {
      next(error);
    }
  };
  // Each read opens a run and calls the sidecar, so reads are limited per user, like runs.
  const historyLimit: RequestHandler = rateLimitingEnabled()
    ? createCustomRateLimit({ windowMs: 15 * 60 * 1000, max: 120, message: "Too many requests for saved conversations. Please wait a few minutes." })
    : (_req, _res, next) => next();
  const historyError = (error: unknown, res: Response, next: NextFunction) => {
    if (error instanceof HistoryError) return deny(res, error.status, error.code, error.code === "not_found" ? "That conversation was not found." : "Saved conversations are unavailable right now.");
    return next(error);
  };

  app.get("/api/assistant/history", historyGuard, historyLimit, async (req, res, next) => {
    const found = res.locals.assistant as Found;
    try {
      res.json({ threads: await listHistory(historyDeps, found.user) });
    } catch (error) {
      historyError(error, res, next);
    }
  });

  // ":thread", not ":id": every :id param is checked as a numeric id (http/install.ts).
  app.get("/api/assistant/history/:thread", historyGuard, historyLimit, async (req, res, next) => {
    const found = res.locals.assistant as Found;
    if (!isThreadId(req.params.thread)) return deny(res, 404, "not_found", "That conversation was not found.");
    try {
      const conversation = await getHistory(historyDeps, found.user, req.params.thread);
      if (!conversation.available) {
        logAssistantSecurityEvent({ event: "history_withheld", reason: conversation.reason, userId: found.user.id, agentId: found.agentId, ip: req.ip });
      }
      res.json(conversation);
    } catch (error) {
      historyError(error, res, next);
    }
  });

  app.delete("/api/assistant/history/:thread", historyGuard, historyLimit, async (req, res, next) => {
    const found = res.locals.assistant as Found;
    if (!isThreadId(req.params.thread)) return deny(res, 404, "not_found", "That conversation was not found.");
    try {
      await deleteHistory(historyDeps, found.user, req.params.thread);
      logAssistantSecurityEvent({ event: "history_deleted", reason: "user", userId: found.user.id, agentId: found.agentId });
      res.status(204).end();
    } catch (error) {
      historyError(error, res, next);
    }
  });

  const runLimit: RequestHandler = rateLimitingEnabled()
    ? createCustomRateLimit({ windowMs: 15 * 60 * 1000, max: (req) => (assistantFor(req)?.agentId === "support-assistant" ? 30 : 60), message: "Too many assistant requests. Please wait a few minutes." })
    : (_req, _res, next) => next();

  // Least recently used goes first, so an active conversation is never the one dropped.
  const handlers = new LruMap<string, Promise<RequestHandler>>(MAX_CACHED_HANDLERS);
  const budget = deps.budget ?? budgetExhausted;
  let usageDeps: Promise<UsageDeps> | undefined;
  const usage = () =>
    (usageDeps ??= (deps.usage ?? defaultUsageDeps)().catch((error) => {
      usageDeps = undefined; // a failed load is retried on the next run
      throw error;
    }));
  const makeHandler = deps.createHandler ?? createHandler;
  const endings = new RunEndings();

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
          const status = await historyStatus();
          const context = (runId: string): RunContext => ({
            runId,
            userId: found.user.id,
            agentId: found.agentId,
            provider: status.provider,
            model: status.models[found.agentId] ?? null,
            startedAt: new Date(),
          });
          // The assistant's spend counts towards the AI budgets (ai_usage); once they are used up it
          // stops. A failure to read them is logged and does not stop it.
          const blocked = await budget().catch((error) => {
            console.error(`Assistant budget check failed [${error instanceof Error ? error.name : "error"}]`);
            return null;
          });
          if (blocked) {
            const refusedRun = randomUUID();
            logAssistantSecurityEvent({ event: "run_refused", reason: blocked, userId: found.user.id, agentId: found.agentId, runId: refusedRun, ip: req.ip });
            void usage().then((d) => recordRun(d, context(refusedRun), { status: "refused", errorCategory: blocked }));
            return deny(res, 429, "assistant_budget_reached", "The assistant has reached its spending limit for now. Please try again later.");
          }

          const runs = await deps.runs();
          const run = runs.start(found.user.id, found.agentId);
          req.headers[INTERNAL_AGENT_TOKEN] = run.agentToken;
          req.headers[INTERNAL_MCP_TOKEN] = run.mcpToken;
          const runContext = context(run.runId);
          // Ends the run's tokens and records how it went, once.
          let finished = false;
          const finish: RunFinish = (summary) => {
            if (finished) return;
            finished = true;
            runs.end(run.runId);
            void usage().then((d) => recordRun(d, runContext, summary)).catch(() => undefined);
          };
          const endingKey = RunEndings.key(found.user.id, req.body?.threadId, req.body?.runId);
          if (endingKey) {
            // The run's tokens end when its agent run ends (TrackedRunner), which may outlive this
            // request; if the runner never takes the run over, they end with the request.
            endings.expect(endingKey, finish);
            res.on("close", () => endings.release(endingKey));
          } else {
            // No thread or run id to follow the agent run by: finished with the request.
            res.on("close", () =>
              finish({ status: "stopped", errorCategory: "untracked", toolNames: [], proposalCount: 0, stepCount: 0, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - runContext.startedAt.getTime() }),
            );
          }
        }
        const key = `${found.user.id}:${found.agentId}`;
        let handler = handlers.get(key);
        if (!handler) {
          handler = makeHandler(found.user.id, found.agentId, env, endings, staffMemory);
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
