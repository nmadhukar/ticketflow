import express, { type ErrorRequestHandler, type Express } from "express";
import { createServer, type Server } from "http";
import { describeError } from "../http/errors";
import { isAssistantEnabled, readInternalHost, readInternalPort } from "./config";

/**
 * The app's second, internal HTTP listener: the only place assistant tokens are accepted.
 *
 * It binds ASSISTANT_INTERNAL_HOST (loopback by default). In Docker Compose it binds 0.0.0.0 and
 * the Mastra sidecar reaches it at http://app:<ASSISTANT_INTERNAL_PORT> over the private
 * `assistant` network; nginx proxies only the public port (PORT). The public /api/mcp contract
 * (API keys, used by DSH) stays exactly as it is. Every route still checks its own token: other
 * containers on the app's networks can open this port.
 *
 * Routes are added by later stages: the assistant MCP endpoint and token renewal.
 */

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

/**
 * Starts the listener when the assistant is enabled; null otherwise. A listener error (the port is
 * taken) is logged and handed to `onError`, which the server entry turns into its orderly shutdown:
 * the app must not run with half its listeners, nor drop the public one's requests mid-flight.
 */
export function startInternalServer(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  onError: (error: Error) => void;
}): Server | null {
  const env = opts.env ?? process.env;
  if (!isAssistantEnabled(env)) return null;
  const port = readInternalPort(env);
  const host = readInternalHost(env);
  const server = createServer(createInternalApp());
  server.on("error", (error) => {
    console.error(`Assistant internal listener failed [${describeError(error)}]`);
    opts.onError(error);
  });
  server.listen({ port, host }, () => (opts.log ?? console.log)(`assistant internal listener on ${host}:${port}`));
  return server;
}
