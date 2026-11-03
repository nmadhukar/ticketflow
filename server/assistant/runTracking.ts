import { filter, finalize, map, tap, type Observable } from "rxjs";

/**
 * Ends each assistant run when its AGENT run ends, not when the browser's request does, and
 * reports how it went.
 *
 * CopilotKit's runner executes the agent apart from the HTTP request that started it (a client
 * can drop and reconnect), so the run's tokens must live exactly as long as that execution: the
 * bridge registers "finish this run" under the CopilotKit thread and run ids, and the runner below
 * calls it, with a summary of the run, when the agent's event stream completes, fails or is
 * dropped. A run the runner never picks up (refused before it started) is finished when its
 * request closes; the run registry's maximum length (runAuth.ts) is the backstop for anything else.
 */

export interface RunSummary {
  /** completed: RUN_FINISHED; failed: RUN_ERROR or an error; stopped: dropped before either. */
  status: "completed" | "failed" | "stopped";
  errorCategory: string | null;
  /** Tool names in call order (repeats kept), as the model called them. */
  toolNames: string[];
  proposalCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** The model and provider the run reported in its usage, when it did (a local agent does). */
  model?: string;
  provider?: string;
}

export type RunFinish = (summary: RunSummary) => void;

export class RunEndings {
  private readonly pending = new Map<string, RunFinish>();

  static key(userId: string, threadId: unknown, runId: unknown): string | null {
    return typeof threadId === "string" && threadId && typeof runId === "string" && runId ? `${userId}\0${threadId}\0${runId}` : null;
  }

  expect(key: string, finish: RunFinish): void {
    this.pending.set(key, finish);
  }

  /** The finish callback for an agent run starting now; it is then the runner's to call. */
  take(key: string): RunFinish | undefined {
    const finish = this.pending.get(key);
    this.pending.delete(key);
    return finish;
  }

  /** For a request that closed: finishes its run (never started) unless the runner took it over. */
  release(key: string): void {
    this.take(key)?.({ ...emptySummary(), status: "stopped", errorCategory: "not_started" });
  }
}

function emptySummary(): RunSummary {
  return { status: "stopped", errorCategory: null, toolNames: [], proposalCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
}

type AgUiEvent = { type?: string; toolCallName?: unknown; code?: unknown; usage?: unknown; outcome?: { type?: unknown } };

/** Folds one AG-UI event into the summary. Content is never read: only names, codes and counts. */
export function observe(summary: RunSummary, event: unknown): void {
  const e = (event && typeof event === "object" ? event : {}) as AgUiEvent;
  if (e.type === "TOOL_CALL_START" && typeof e.toolCallName === "string") {
    const name = e.toolCallName.replace(/^ticketflow_/, "");
    summary.toolNames.push(name);
    if (name.startsWith("propose_")) summary.proposalCount += 1;
  } else if (e.type === "RUN_ERROR") {
    summary.status = "failed";
    summary.errorCategory = typeof e.code === "string" && /^[a-z0-9_.-]{1,40}$/i.test(e.code) ? e.code : "run_error";
  } else if (e.type === "RUN_FINISHED") {
    // RUN_FINISHED also ends a cancelled (Stop) or interrupted run: its outcome says which.
    const outcome = e.outcome?.type;
    if (summary.status !== "failed") {
      if (outcome === "cancelled" || outcome === "interrupt") {
        summary.status = "stopped";
        summary.errorCategory = outcome === "cancelled" ? "cancelled" : "interrupted";
      } else {
        summary.status = "completed";
      }
    }
    const entries = Array.isArray(e.usage) ? e.usage : e.usage && typeof e.usage === "object" ? [e.usage] : [];
    for (const entry of entries as Array<{ inputTokens?: unknown; outputTokens?: unknown; model?: unknown; provider?: unknown }>) {
      summary.inputTokens += Number.isFinite(entry?.inputTokens) ? Number(entry.inputTokens) : 0;
      summary.outputTokens += Number.isFinite(entry?.outputTokens) ? Number(entry.outputTokens) : 0;
      if (typeof entry?.model === "string" && entry.model) summary.model = entry.model;
      if (typeof entry?.provider === "string" && entry.provider) summary.provider = entry.provider;
    }
  }
}

/**
 * The model's reasoning is not shown to users: it is working notes, not an answer, and can quote
 * tool results the answer itself leaves out. Its events (and any reasoning message in a snapshot,
 * as a reconnect replays) never leave the server. The agent keeps its own copy where it needs one.
 */
export function withoutReasoning(events: Observable<unknown>): Observable<unknown> {
  return events.pipe(
    filter((event) => {
      const type = (event as { type?: unknown } | null)?.type;
      return !(typeof type === "string" && (type.startsWith("REASONING_") || type.startsWith("THINKING_")));
    }),
    map((event) => {
      const e = event as { type?: unknown; messages?: unknown };
      if (e?.type !== "MESSAGES_SNAPSHOT" || !Array.isArray(e.messages)) return event;
      return { ...e, messages: e.messages.filter((m) => (m as { role?: unknown } | null)?.role !== "reasoning") };
    }),
  );
}

/** The part of CopilotKit's AgentRunner this wraps (kept structural: the runtime is ESM-only). */
export interface RunnerLike {
  run(request: { threadId: string; input: { threadId?: string; runId?: string } }): Observable<unknown>;
  connect(request: unknown): Observable<unknown>;
  isRunning(request: unknown): Promise<boolean>;
  stop(request: unknown): Promise<boolean | undefined>;
}

/**
 * One user's runner: CopilotKit's, plus the finish (end and report) of that user's runs, with the
 * model's reasoning taken out of what the browser receives.
 */
export class TrackedRunner implements RunnerLike {
  constructor(
    private readonly delegate: RunnerLike,
    private readonly endings: RunEndings,
    private readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  run(request: Parameters<RunnerLike["run"]>[0]): Observable<unknown> {
    const key = RunEndings.key(this.userId, request.input?.threadId ?? request.threadId, request.input?.runId);
    const finish = key ? this.endings.take(key) : undefined;
    const events = this.delegate.run(request);
    if (!finish) return withoutReasoning(events);
    const started = this.now();
    const summary = emptySummary();
    return events.pipe(
      tap({
        next: (event) => observe(summary, event),
        error: () => {
          summary.status = "failed";
          summary.errorCategory ??= "stream_error";
        },
      }),
      finalize(() => finish({ ...summary, durationMs: this.now() - started })),
      // After the tap: the summary still sees every event (RUN_FINISHED usage included).
      withoutReasoning,
    );
  }

  connect(request: unknown) {
    return withoutReasoning(this.delegate.connect(request));
  }

  isRunning(request: unknown) {
    return this.delegate.isRunning(request);
  }

  stop(request: unknown) {
    return this.delegate.stop(request);
  }
}

/** A map that drops its least recently used entry beyond `max` (get refreshes, set inserts). */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
