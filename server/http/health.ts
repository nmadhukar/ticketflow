import type { Express } from "express";
import { securityHealthCheck } from "../security";

/**
 * Registers the health endpoints (`/health`, `/api/security/health`). They live
 * here, not inline in server/index.ts, so the test app registers the same
 * routes and the route-table test (noDuplicateRoutes) can see them.
 */
export function registerHealthRoutes(app: Express): void {
  // Simple health check endpoint (no database required)
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      port: process.env.PORT,
    });
  });

  // Security health check endpoint
  app.get("/api/security/health", (req, res) => {
    res.json(securityHealthCheck());
  });
}
