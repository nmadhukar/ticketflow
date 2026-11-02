import { describeError } from "./http/errors";

/**
 * Graceful shutdown for SIGTERM and SIGINT.
 *
 * The Dockerfile and compose end in `exec node dist/index.js` (R66), so node is PID 1 and gets
 * `docker stop`'s SIGTERM itself. A PID-1 process with no handler ignores the signal, so without
 * this the container waited out the grace period and was killed. Order: close the WebSockets, stop
 * accepting HTTP connections (and drop idle keep-alive ones), close the session stores, end the
 * database pool, exit 0. A step that throws is logged by type only (its text can carry a connection
 * string) and the later steps still run; the exit code is then 1. A hard timer exits 1 after
 * `timeoutMs` (10 s by default) if any step hangs, and is unref'd so it never keeps the process
 * alive by itself. Runs once: a second signal while it is running does nothing.
 */
export interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
}

/** Stops accepting connections, drops idle keep-alive ones, and resolves once the server has closed. */
export function closeHttpServer(server: ClosableServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

export interface ShutdownDeps {
  server: ClosableServer;
  closeRealtime(): Promise<void>;
  /** The assistant's internal listener (assistant/internalServer.ts), when it was started. */
  closeAssistant?(): Promise<void>;
  closeAuth(): Promise<void>;
  closePool(): Promise<void>;
  exit(code: number): void;
  log(line: string): void;
  timeoutMs?: number;
}

/**
 * `opts.failed` is for a shutdown caused by a fault (a listener that could not start): the same
 * orderly close, then exit 1 even when every step succeeds.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string, opts?: { failed?: boolean }) => Promise<void> {
  let running: Promise<void> | undefined;
  return (signal: string, opts: { failed?: boolean } = {}) => {
    if (running) return running;
    running = (async () => {
      deps.log(`${signal} received: shutting down`);
      const timer = setTimeout(() => {
        deps.log(`Shutdown did not finish in ${(deps.timeoutMs ?? 10_000) / 1000}s: forcing exit`);
        deps.exit(1);
      }, deps.timeoutMs ?? 10_000);
      timer.unref();

      let failed = opts.failed === true;
      const step = async (name: string, run: () => Promise<unknown>) => {
        try {
          await run();
        } catch (error) {
          failed = true;
          deps.log(`Shutdown step "${name}" failed [${describeError(error)}]`);
        }
      };
      await step("realtime", () => deps.closeRealtime());
      await step("http server", () => closeHttpServer(deps.server));
      if (deps.closeAssistant) await step("assistant listener", () => deps.closeAssistant!());
      await step("session stores", () => deps.closeAuth());
      await step("database pool", () => deps.closePool());

      clearTimeout(timer);
      deps.exit(failed ? 1 : 0);
    })();
    return running;
  };
}
