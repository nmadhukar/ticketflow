import { finalize, type Observable } from "rxjs";

/**
 * Ends each assistant run when its AGENT run ends, not when the browser's request does.
 *
 * CopilotKit's runner executes the agent apart from the HTTP request that started it (a client
 * can drop and reconnect), so the run's tokens must live exactly as long as that execution: the
 * bridge registers "end this run" under the CopilotKit thread and run ids, and the runner below
 * calls it when the agent's event stream completes, fails or is stopped. A run the runner never
 * picks up (refused before it started) is ended when its request closes; the run registry's
 * maximum length (runAuth.ts) is the backstop for anything else.
 */
export class RunEndings {
  private readonly pending = new Map<string, () => void>();

  static key(userId: string, threadId: unknown, runId: unknown): string | null {
    return typeof threadId === "string" && threadId && typeof runId === "string" && runId ? `${userId}\0${threadId}\0${runId}` : null;
  }

  expect(key: string, end: () => void): void {
    this.pending.set(key, end);
  }

  /** The end callback for an agent run starting now; it is then the runner's to call. */
  take(key: string): (() => void) | undefined {
    const end = this.pending.get(key);
    this.pending.delete(key);
    return end;
  }

  /** For a request that closed: ends its run unless the runner took it over. */
  release(key: string): void {
    this.take(key)?.();
  }
}

/** The part of CopilotKit's AgentRunner this wraps (kept structural: the runtime is ESM-only). */
export interface RunnerLike {
  run(request: { threadId: string; input: { threadId?: string; runId?: string } }): Observable<unknown>;
  connect(request: unknown): Observable<unknown>;
  isRunning(request: unknown): Promise<boolean>;
  stop(request: unknown): Promise<boolean | undefined>;
}

/** One user's runner: CopilotKit's, plus the run endings for that user's runs. */
export class TrackedRunner implements RunnerLike {
  constructor(
    private readonly delegate: RunnerLike,
    private readonly endings: RunEndings,
    private readonly userId: string,
  ) {}

  run(request: Parameters<RunnerLike["run"]>[0]): Observable<unknown> {
    const key = RunEndings.key(this.userId, request.input?.threadId ?? request.threadId, request.input?.runId);
    const end = key ? this.endings.take(key) : undefined;
    const events = this.delegate.run(request);
    return end ? events.pipe(finalize(end)) : events;
  }

  connect(request: unknown) {
    return this.delegate.connect(request);
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
