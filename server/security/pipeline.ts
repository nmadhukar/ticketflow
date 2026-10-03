import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { preventXSS, sanitizeInput } from "./validation";
import { isDevelopmentEnv } from "../env";

/**
 * Content-Security-Policy. `script-src 'self'` only: no inline scripts, so an
 * injected `<script>` or handler attribute does not run. Inline styles stay
 * (the UI library sets style attributes). In development Vite injects an inline
 * React-refresh preamble, so only there is `'unsafe-inline'` added to scripts;
 * production and test never get it.
 */
export function contentSecurityDirectives(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"],
    scriptSrc: isDevelopmentEnv(nodeEnv) ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    connectSrc: ["'self'", "https:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    manifestSrc: ["'self'"],
  };
}

export interface RequestPipelineOptions {
  /** express body-parser size limit, e.g. "50mb". */
  bodyLimit: string;
  /** Run the input sanitiser on parsed bodies and queries. */
  sanitize: boolean;
  /** Mounted on /api before the body is read. */
  rateLimit?: RequestHandler;
}

/**
 * Security headers, then body parsing, then input sanitising. The order is the
 * point: the sanitiser must run AFTER the parsers or `req.body` is still
 * undefined and nothing is ever sanitised.
 */
export function installRequestPipeline(app: Express, options: RequestPipelineOptions) {
  app.use(
    helmet({
      contentSecurityPolicy: { directives: contentSecurityDirectives() },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginEmbedderPolicy: false,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(preventXSS);
  if (options.rateLimit) app.use("/api", options.rateLimit);

  app.use(express.json({ limit: options.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: options.bodyLimit }));

  if (options.sanitize) app.use(sanitizeInput);
}
