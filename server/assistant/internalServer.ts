import express, { type ErrorRequestHandler, type Express } from "express";
import { createServer, type Server } from "http";
import { describeError } from "../http/errors";
import { isAssistantEnabled } from "./config";

/**
 * The app's second, internal HTTP listener: the only place assistant tokens are accepted.
 *
 * The Mastra sidecar reaches it at http://app:<ASSISTANT_INTERNAL_PORT> over the private
 * `assistant` Docker network. nginx proxies only the public port (PORT), so nothing here is
 * reachable from the internet, and the public /api/mcp contract (API keys, used by DSH) stays
 * exactly as it is. Every route still checks its own token: other containers on the app's
 * networks can open this port.
 *
 * Routes are added by later stages: the assistant MCP endpoint and token renewal.
 */

export const DEFAULT_INTERNAL_PORT = 5100;

export function readInternalPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ASSISTANT_INTERNAL_PORT?.trim();
  return raw ? Number(raw) : DEFAULT_INTERNAL_PORT;
}

export function createInternalApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/internal/health", (_req, res) => {
    res.json({ status: "ok" });
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

/** Starts the listener when the assistant is enabled; null otherwise. */
export function startInternalServer(
  opts: { env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {},
): Server | null {
  const env = opts.env ?? process.env;
  if (!isAssistantEnabled(env)) return null;
  const port = readInternalPort(env);
  const server = createServer(createInternalApp());
  server
    .listen({ port, host: "0.0.0.0" }, () => (opts.log ?? console.log)(`assistant internal listener on port ${port}`))
    .on("error", (error) => {
      console.error(`Assistant internal listener failed [${describeError(error)}]`);
      process.exit(1);
    });
  return server;
}

export function closeServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}
