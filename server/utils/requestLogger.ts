import type { NextFunction, Request, Response } from "express";

/**
 * Keeps secrets out of the request log: token path segments are replaced,
 * /api/auth and /api/invitations bodies are never logged, and secret-looking
 * keys in any other logged body are masked.
 */

const TOKEN_PATH = /^(\/api\/invitations\/)[^/]+/;
const NO_BODY_PATH = /^\/api\/(auth|invitations)(\/|$)/;
const SECRET_KEY = /pass(word)?|token|secret|key|hash|authorization|credential/i;

export function redactLogPath(path: string): string {
  return path.replace(TOKEN_PATH, "$1[redacted]");
}

export function maskSecrets(_key: string, value: unknown): unknown {
  return SECRET_KEY.test(_key) ? "[redacted]" : value;
}

export function requestLogger(log: (line: string) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const path = req.path;
    let captured: unknown;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      captured = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const duration = Date.now() - start;
      let line = `${req.method} ${redactLogPath(path)} ${res.statusCode} in ${duration}ms`;
      if (captured && !NO_BODY_PATH.test(path)) {
        line += ` :: ${JSON.stringify(captured, maskSecrets)}`;
      }
      if (line.length > 80) line = line.slice(0, 79) + "…";
      log(line);
    });

    next();
  };
}
