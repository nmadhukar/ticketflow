import { Router, type RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { User } from "@shared/schema";
import { createMcpServer } from "./server";
import { createMcpRateLimit, rateLimitingEnabled } from "../security/rateLimiting";

export const MCP_PERMISSION = "mcp:tickets";

/**
 * MCP accepts only an API key that carries `mcp:tickets`. A session cookie or a
 * JWT is refused even when valid: this endpoint is for agents holding a key.
 * (An invalid bearer was already answered 401 by the bearer middleware that
 * runs before this router; this covers "no bearer" and the wrong kind.)
 */
export const requireMcpKey: RequestHandler = (req, res, next) => {
  if (req.authMethod !== "api_key" || !req.user) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json({
      error: "unauthorized",
      message: "An API key is required: send Authorization: Bearer <key>.",
    });
  }
  if (!req.apiKeyPermissions?.includes(MCP_PERMISSION)) {
    res.setHeader("WWW-Authenticate", 'Bearer error="insufficient_scope"');
    return res.status(403).json({
      error: "forbidden",
      message: `This API key does not carry the ${MCP_PERMISSION} permission.`,
    });
  }
  return next();
};

const mcpPost: RequestHandler = async (req, res, next) => {
  // Stateless: a new server and transport per request, no session id.
  const server = createMcpServer(req.user as User);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`MCP request failed: ${error instanceof Error ? error.name : "error"}`);
    if (!res.headersSent) {
      return next(error);
    }
  }
};

const methodNotAllowed: RequestHandler = (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: "method_not_allowed",
    message: "This MCP endpoint is stateless: use POST.",
  });
};

const passThrough: RequestHandler = (_req, _res, next) => next();

/**
 * Mounted at /api/mcp. The limiter (per API key, M4) is on where the general
 * /api limit is on (production unless RATE_LIMITING_ENABLED=false), which skips
 * this path; `opts.rateLimit` replaces it (tests).
 */
export function createMcpRouter(opts: { rateLimit?: RequestHandler } = {}): Router {
  const limiter = opts.rateLimit ?? (rateLimitingEnabled() ? createMcpRateLimit() : passThrough);
  const router = Router();
  router.post("/", limiter, requireMcpKey, mcpPost);
  router.all("/", methodNotAllowed);
  return router;
}
