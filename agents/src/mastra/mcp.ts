import { AsyncLocalStorage } from 'node:async_hooks';
import { MCPClient } from '@mastra/mcp';
import type { RequestContext } from '@mastra/core/request-context';
import { isTicketFlowUser, MASTRA_USER_CONTEXT_KEY, MCP_SESSION_HEADER, type AssistantUser } from './auth.ts';
import { readMcpUrl } from './config.ts';

/**
 * The MCP client for TicketFlow's internal endpoint (/internal/mcp).
 *
 * One client serves every run. Each HTTP request carries the MCP-hop token of the run it belongs
 * to, attached in `fetch`, so concurrent users never share a credential. A request with no run
 * token is refused here: this service holds no standing credential to fall back on. The app
 * reloads the user and checks the token on every call, so this client is only a courier.
 *
 * MCPClient passes the request context to fetch for tool calls but not for discovery, so
 * discovery carries the user in an AsyncLocalStorage instead (Workforce Nexus' pattern).
 */

type TicketFlowUser = Extract<AssistantUser, { kind: 'ticketflow' }>;
export const SERVER_NAME = 'ticketflow';

const discoveryUser = new AsyncLocalStorage<TicketFlowUser>();

export function userFrom(requestContext: RequestContext | null | undefined): TicketFlowUser | undefined {
  const user = requestContext?.getRaw(MASTRA_USER_CONTEXT_KEY);
  return isTicketFlowUser(user) ? user : undefined;
}

/** Renew when a token has less than this left, so no tool call starts on a nearly expired one. */
export const RENEW_BEFORE_SECONDS = 60;

/** `exp` of an MCP-hop token, read without verifying: only to decide when to renew. */
export function tokenExpiry(token: string): number | null {
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')).exp;
    return Number.isSafeInteger(exp) ? exp : null;
  } catch {
    return null;
  }
}

const renewing = new WeakMap<TicketFlowUser['mcp'], Promise<void>>();

/**
 * Swaps the run's MCP token for a fresh one when it is close to expiry. The app decides: it
 * renews once per token, in its last two minutes, while the run is open and the user still
 * allowed. On any refusal the current token is kept, and the app refuses the next call if the
 * run has really ended. Concurrent tool calls of one run share a single renewal.
 */
export async function ensureFreshToken(
  user: TicketFlowUser,
  { fetchImpl = fetch, now = Date.now, renewUrl = new URL('/internal/assistant/renew', readMcpUrl()) } = {},
): Promise<void> {
  const exp = tokenExpiry(user.mcp.token);
  if (exp === null || exp - Math.floor(now() / 1000) > RENEW_BEFORE_SECONDS) return;
  const pending = renewing.get(user.mcp);
  if (pending) return pending;
  const attempt = (async () => {
    try {
      const response = await fetchImpl(renewUrl, { method: 'POST', headers: { [MCP_SESSION_HEADER]: user.mcp.token } });
      if (response.ok) {
        const body = (await response.json()) as { token?: unknown };
        if (typeof body.token === 'string' && body.token) user.mcp.token = body.token;
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Unreachable: keep the current token; the call that follows reports the failure.
    } finally {
      renewing.delete(user.mcp);
    }
  })();
  renewing.set(user.mcp, attempt);
  return attempt;
}

/** Attaches the run's MCP token to every request, renewing it first when needed. */
export function sessionFetch(fetchImpl: typeof fetch = fetch) {
  return async (url: string | URL, init?: RequestInit, requestContext?: RequestContext | null) => {
    // Studio has no request context on tool execution, so the run opened for it is the fallback.
    // discoveryUser carries the Studio run for the duration of a tool listing/call (loadRunTools).
    const user = userFrom(requestContext) ?? discoveryUser.getStore() ?? (await studioRunUser(pendingAgent));
    if (!user) throw new Error('No assistant run on this request; refusing to call TicketFlow without one.');
    await ensureFreshToken(user, { fetchImpl });
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.set(MCP_SESSION_HEADER, user.mcp.token);
    return fetchImpl(url, { ...init, headers });
  };
}

export function createTicketFlowClient(env: NodeJS.ProcessEnv = process.env): MCPClient {
  const url = new URL(readMcpUrl(env));
  return new MCPClient({
    id: 'ticketflow',
    servers: {
      [SERVER_NAME]: {
        url,
        // TicketFlow's MCP SDK answers the classic initialize handshake.
        protocolVersion: 'legacy',
        timeout: 55_000,
        enableServerLogs: false,
        fetch: sessionFetch(),
      },
    },
  });
}

type JsonSchema = { type?: unknown; nullable?: unknown; anyOf?: unknown; oneOf?: unknown; properties?: unknown; required?: unknown };

function permitsNull(schema: unknown): boolean {
  const s = schema && typeof schema === 'object' ? (schema as JsonSchema) : undefined;
  if (!s) return false;
  if (s.nullable === true || s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null'))) return true;
  return [...(Array.isArray(s.anyOf) ? s.anyOf : []), ...(Array.isArray(s.oneOf) ? s.oneOf : [])].some(permitsNull);
}

/**
 * Drops top-level nulls the tool's schema does not allow. Models often send `null` for an
 * optional input; TicketFlow's tools reject it. From Workforce Nexus' MCP client.
 */
export function sanitizeOptionalToolArguments(input: unknown, inputSchema: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const schema = inputSchema && typeof inputSchema === 'object' ? (inputSchema as JsonSchema) : undefined;
  const properties = (schema?.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== null || required.has(key) || permitsNull(properties[key])),
  );
}

type McpTool = Awaited<ReturnType<MCPClient['toolFromDefinition']>>;

function withSanitizedInput(tool: McpTool, inputSchema: unknown): McpTool {
  const baseExecute = tool.execute;
  if (!baseExecute) return tool;
  const standardSchema = tool.inputSchema as { '~standard'?: { validate?: (value: unknown) => unknown } };
  const standard = standardSchema?.['~standard'];
  const inputSchemaWrapped = standard?.validate
    ? { ...standardSchema, '~standard': { ...standard, validate: (value: unknown) => standard.validate!(sanitizeOptionalToolArguments(value, inputSchema)) } }
    : tool.inputSchema;
  return {
    ...tool,
    inputSchema: inputSchemaWrapped,
    execute: (input: unknown, context: Parameters<typeof baseExecute>[1]) => baseExecute(sanitizeOptionalToolArguments(input, inputSchema), context),
  } as McpTool;
}

let client: MCPClient | undefined;

/**
 * Tools that only PROPOSE a write: TicketFlow records a draft and the user confirms it in the
 * chat. They are the only tools not marked read-only that this service passes to a model.
 */
export const PROPOSAL_TOOL_NAMES = new Set(['propose_ticket', 'propose_comment', 'propose_close_ticket']);

/** Read-only tools, and the named proposal tools; never any other tool, whatever the server lists. */
export function isPermittedTool(definition: { name: string; annotations?: { readOnlyHint?: boolean } }): boolean {
  return definition.annotations?.readOnlyHint === true || PROPOSAL_TOOL_NAMES.has(definition.name);
}

/**
 * Local Studio only: a run opened on demand so Studio's chat can load TicketFlow tools.
 *
 * Studio has no signed-in TicketFlow user, so `loadRunTools` would refuse every chat. When
 * MASTRA_STUDIO_NO_AUTH=true (local Studio only; refused in production by config-issues.ts) this
 * asks the app's dev-only eval route for a run as the seeded eval user, and caches it until it
 * expires. The app still authorises every tool call as that user, so nothing is widened: the
 * Studio chat sees exactly what the eval user sees.
 */
const STUDIO_RUN_USER = 'eval-staff';
const STUDIO_CUSTOMER_USER = 'eval-customer';
/** One run per seeded account: the staff tools and the customer tools are different runs. */
const studioRuns = new Map<string, { user: TicketFlowUser; expiresAt: number }>();

async function studioRunUser(agentId: 'ticket-assistant' | 'support-assistant' | undefined): Promise<TicketFlowUser | undefined> {
  if (process.env.MASTRA_STUDIO_NO_AUTH !== 'true') return undefined;
  const account =
    agentId === 'support-assistant'
      ? { userId: STUDIO_CUSTOMER_USER, agentId: 'support-assistant' as const }
      : { userId: STUDIO_RUN_USER, agentId: 'ticket-assistant' as const };
  const cached = studioRuns.get(account.userId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const appUrl = process.env.STUDIO_APP_URL?.trim() || 'http://app:5000';
  try {
    const response = await fetch(`${appUrl}/api/assistant/eval/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { runId: string; userId: string; mcpToken: string };
    const user: TicketFlowUser = {
      kind: 'ticketflow',
      id: `user:${body.userId}`,
      userId: body.userId,
      agentId: account.agentId,
      runId: body.runId,
      mcp: { token: body.mcpToken },
    };
    // The app's run lasts five minutes; renew a little early.
    studioRuns.set(account.userId, { user, expiresAt: Date.now() + 4 * 60 * 1000 });
    return user;
  } catch {
    return undefined;
  }
}

/**
 * The agent whose tools are being loaded right now, while Studio lists them.
 *
 * `loadRunTools` is handed to each Agent as its tool SOURCE, so Mastra calls it with NO request and
 * NO agent argument (the stack trace: formatAgentList -> Agent.loadRunTools). The Studio fallback
 * therefore has to know who is asking; this marks it for the duration of the call, and `pendingAgent`
 * falls back to the staff account for any call that arrives outside it (a real run always carries
 * its own RequestContext, so this never applies to production).
 */
let pendingAgent: 'ticket-assistant' | 'support-assistant' | undefined;

/** Wraps a loadRunTools result so the Studio account matches the agent being listed. */
export function toolsForAgent<T>(agentId: 'ticket-assistant' | 'support-assistant', load: () => Promise<T>): Promise<T> {
  pendingAgent = agentId;
  return load().finally(() => {
    pendingAgent = undefined;
  });
}

/**
 * The run's tools, discovered AS the run's user: TicketFlow lists only what that user's agent may
 * call. Anything that is neither read-only nor a proposal is dropped here as well, so a direct
 * write can only ever reach a model through a deliberate change on both sides.
 */
export async function loadRunTools({ requestContext }: { requestContext?: RequestContext } = {}) {
  // A real run always carries its context; only Studio's tool listing arrives without one, and it
  // names the agent through toolsForAgent.
  const user = userFrom(requestContext) ?? (await studioRunUser(pendingAgent));
  if (!user) throw new Error('No assistant run on this request; refusing to load TicketFlow tools without one.');
  client ??= createTicketFlowClient();
  const { definitions, errors } = await discoveryUser.run(user, () => client!.listToolDefinitionsWithErrors());
  if (errors[SERVER_NAME]) throw new Error(`TicketFlow MCP discovery failed: ${errors[SERVER_NAME]}`);
  const permitted = Object.values(definitions[SERVER_NAME] ?? {}).filter(isPermittedTool);
  const tools = Object.fromEntries(
    await Promise.all(
      permitted.map(async (definition) => {
        const tool = await client!.toolFromDefinition({ serverName: SERVER_NAME, definition });
        return [`ticketflow_${definition.name}`, withSanitizedInput(tool, definition.inputSchema)] as const;
      }),
    ),
  );
  if (Object.keys(tools).length === 0) throw new Error('No TicketFlow tools were discovered for this run.');
  return tools;
}

export async function disconnectTicketFlowClient(): Promise<void> {
  const connected = client;
  client = undefined;
  await connected?.disconnect();
}
