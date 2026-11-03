/**
 * Talks to TicketFlow the way the browser does: a session cookie from /api/auth/login, then the
 * CopilotKit run endpoint, read as Server-Sent Events. Nothing here reaches the sidecar directly:
 * evals go through the app, its role check, its tokens and its tool filter, as a user would.
 */
export class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookie = '';
  }

  headers(extra = {}) {
    // Origin: the app refuses cross-site writes, and evals are same-site by construction.
    return { Origin: this.baseUrl, ...(this.cookie ? { Cookie: this.cookie } : {}), ...extra };
  }

  async request(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    if (cookies.length) this.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: callers look at the status.
    }
    return { status: res.status, json };
  }

  async login(email, password) {
    const res = await this.request('POST', '/api/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: HTTP ${res.status}`);
    return this;
  }

  /** One assistant run on a fresh thread. Returns the events, the answer text and the tool calls. */
  async ask(agentId, prompt, { timeoutMs = 180_000 } = {}) {
    const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/api/copilotkit/agent/${agentId}/run`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify({
        threadId: id,
        runId: `${id}-run`,
        messages: [{ id: `${id}-m1`, role: 'user', content: prompt }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    const events = raw
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => {
        try {
          return JSON.parse(line.slice(5));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const toolCalls = events
      .filter((e) => e.type === 'TOOL_CALL_START')
      .map((e) => String(e.toolCallName).replace(/^ticketflow_/, ''));
    const results = events.filter((e) => e.type === 'TOOL_CALL_RESULT').map((e) => e.content);
    return {
      status: res.status,
      events,
      answer: events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta).join(''),
      toolCalls,
      proposalIds: results.flatMap(proposalIdsIn),
      finished: events.some((e) => e.type === 'RUN_FINISHED'),
      error: events.find((e) => e.type === 'RUN_ERROR') ?? null,
      durationMs: Date.now() - started,
    };
  }
}

/** Proposal ids in a tool result, however the MCP result wraps them (text content, JSON string). */
function proposalIdsIn(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') {
    try {
      return proposalIdsIn(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((v) => proposalIdsIn(v, depth + 1));
  if (typeof value !== 'object') return [];
  if (typeof value.proposalId === 'string') return [value.proposalId];
  return ['structuredContent', 'content', 'text', 'result'].flatMap((k) => proposalIdsIn(value[k], depth + 1));
}
