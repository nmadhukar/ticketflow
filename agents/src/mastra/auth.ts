import {
  CompositeAuth,
  MastraAuthProvider,
  SimpleAuth,
  type IMastraAuthProvider,
} from '@mastra/core/server';
import { readAgentSecrets } from './config.ts';
import { verifyAgentToken, type AgentId } from './session-token.ts';

/**
 * Authentication for the Mastra server.
 *
 * TicketFlow's app calls this sidecar for a signed-in user with two headers:
 *
 *   Authorization: Bearer <agent-hop token>   verified here (session-token.ts)
 *   X-TicketFlow-MCP-Session: <MCP-hop token> opaque here: forwarded on every MCP call
 *
 * The user is then the token's subject, for the token's agent and run only. Studio (local
 * development) uses its own static token. Anything else is refused, so reaching this port
 * grants nothing.
 */

/** Mastra's reserved request-context key for the authenticated user. */
export const MASTRA_USER_CONTEXT_KEY = 'mastra__user';
export const MCP_SESSION_HEADER = 'x-ticketflow-mcp-session';
/** Generous for an opaque base64url token; anything longer is not one of ours. */
const MAX_MCP_TOKEN_LENGTH = 2048;

export type AssistantUser =
  | {
      kind: 'ticketflow';
      id: string;
      userId: string;
      agentId: AgentId;
      runId: string;
      /** The MCP-hop token for this request. Replaced in place when renewed. */
      mcp: { token: string };
    }
  | { kind: 'studio'; id: 'studio' };

export function isTicketFlowUser(user: unknown): user is Extract<AssistantUser, { kind: 'ticketflow' }> {
  return !!user && typeof user === 'object' && (user as { kind?: unknown }).kind === 'ticketflow';
}

function rawRequest(request: unknown): Request | undefined {
  if (request instanceof Request) return request;
  const raw = (request as { raw?: unknown } | null)?.raw;
  return raw instanceof Request ? raw : undefined;
}

/** The only agent with saved conversations (staff history). */
export const HISTORY_AGENT_ID: AgentId = 'ticket-assistant';
const THREAD_ID = '[A-Za-z0-9_:.-]{1,200}';

/**
 * The memory routes a staff user's own History needs, and no others: list, read and delete their
 * threads, and read their messages. Mastra scopes each to the caller (mapUserToResourceId) and
 * refuses another user's thread; creating, renaming or cloning threads stays closed. The app
 * calls these on the user's behalf; the browser never reaches this service.
 */
const HISTORY_ROUTES: Array<[method: string, path: RegExp]> = [
  ['GET', /^\/api\/memory\/threads$/],
  ['GET', new RegExp(`^/api/memory/threads/${THREAD_ID}$`)],
  ['GET', new RegExp(`^/api/memory/threads/${THREAD_ID}/messages$`)],
  ['DELETE', new RegExp(`^/api/memory/threads/${THREAD_ID}$`)],
];

export function isHistoryRoute(method: string, url: URL): boolean {
  if (url.searchParams.get('agentId') !== HISTORY_AGENT_ID) return false;
  return HISTORY_ROUTES.some(([m, path]) => m === method.toUpperCase() && path.test(url.pathname));
}

/**
 * A run of the user's own agent and nothing else under it: POST …/model would change the model
 * for every user, …/tools/:id/execute would skip the agent, and so on.
 */
const RUN_ROUTES = ['stream', 'generate'];

export class TicketFlowSessionAuth extends MastraAuthProvider<AssistantUser> {
  private readonly secrets: string[];

  constructor(secrets: string[]) {
    super({
      name: 'ticketflow-assistant-session',
      // Passed as an option: the base constructor assigns this from its options, which would
      // shadow a subclass method. Memory is scoped to this resource, so it is the isolation.
      mapUserToResourceId: (user: AssistantUser) => (isTicketFlowUser(user) ? `user:${user.userId}` : undefined),
    });
    this.secrets = secrets.filter(Boolean);
  }

  async authenticateToken(token: string, request: Parameters<MastraAuthProvider['authenticateToken']>[1]): Promise<AssistantUser | null> {
    const verified = verifyAgentToken(token, this.secrets);
    if (!verified.ok) return null;
    const mcpToken = rawRequest(request)?.headers.get(MCP_SESSION_HEADER)?.trim();
    // Without its MCP token the run could not call a single tool as this user.
    if (!mcpToken || mcpToken.length > MAX_MCP_TOKEN_LENGTH) return null;
    return {
      kind: 'ticketflow',
      id: `user:${verified.claims.sub}`,
      userId: verified.claims.sub,
      agentId: verified.agentId,
      runId: verified.claims.jti,
      mcp: { token: mcpToken },
    };
  }

  authorizeUser(user: AssistantUser, request: Parameters<MastraAuthProvider['authorizeUser']>[1]): boolean {
    if (!isTicketFlowUser(user)) return false;
    const raw = rawRequest(request);
    if (!raw) return false;
    const url = new URL(raw.url);
    const agentRoot = `/api/agents/${user.agentId}`;
    if (raw.method.toUpperCase() === 'POST' && RUN_ROUTES.some((route) => url.pathname === `${agentRoot}/${route}`)) {
      return true;
    }
    return user.agentId === HISTORY_AGENT_ID && isHistoryRoute(raw.method, url);
  }
}

export function createAssistantAuth(env: NodeJS.ProcessEnv = process.env): CompositeAuth {
  const providers: IMastraAuthProvider[] = [new TicketFlowSessionAuth(readAgentSecrets(env))];
  const studioToken = env.MASTRA_STUDIO_TOKEN?.trim();
  // server-config.ts refuses a Studio token in production and a weak one anywhere.
  if (studioToken && env.NODE_ENV !== 'production') {
    providers.push(
      new SimpleAuth<AssistantUser>({
        tokens: { [studioToken]: { kind: 'studio', id: 'studio' } },
        // Without a resource Mastra leaves memory unfiltered, so the Studio token could list,
        // read and delete every user's saved conversations. Its own resource limits it.
        mapUserToResourceId: () => 'studio',
      }),
    );
  }
  return new CompositeAuth(providers);
}
