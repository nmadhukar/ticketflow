import "dotenv/config";
import express from "express";
import { registerRoutes } from "./routes/index";
import { installErrorHandling } from "./http/install";
import { setupVite, serveStatic, log } from "./vite";
import { requestLogger } from "./utils/requestLogger";
import { isDevelopmentEnv } from "./env";
import {
  applySecurity,
  applyRouteSpecificSecurity,
  securityHealthCheck,
} from "./security";

const app = express();

// Trust Nginx/reverse proxy so req.ip uses the real client IP via X-Forwarded-For
app.set("trust proxy", 1);

// Security headers, rate limit, body parsers (MAX_REQUEST_SIZE_MB, default
// 50MB, for base64 uploads) and then the input sanitiser: the sanitiser must
// run after the parsers, so all of it is installed together, in order.
applySecurity(app);

// Request log: token path segments redacted, no auth/invitation bodies.
app.use(requestLogger(log));

(async () => {
  try {
    // Log environment info for debugging
    console.log("Starting TicketFlow application...");
    console.log("NODE_ENV:", process.env.NODE_ENV);
    console.log("PORT:", process.env.PORT);
    console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

    // Ruling R32: refuse to boot (one log line, exit 1) when the database lacks a
    // schema object the code needs, e.g. after drizzle-kit push silently applied nothing.
    const { pool } = await import("./storage/db");
    const { assertSchemaReady } = await import("./startup/schemaCheck");
    if (!(await assertSchemaReady({ db: pool }))) return;

    // Required seed data always; demo data only with SEED_DEMO_DATA=true
    try {
      const { runSeeders } = await import("./seed/runSeeders");
      await runSeeders();
    } catch (error) {
      console.error("Failed to run seeders:", error);
    }
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }

  // Apply route-specific security
  applyRouteSpecificSecurity(app);

  const server = await registerRoutes(app);

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

  installErrorHandling(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (isDevelopmentEnv()) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const isWindows = process.platform === "win32";
  const listenOptions: any = { port, host: "0.0.0.0" };
  if (!isWindows) listenOptions.reusePort = true;

  server
    .listen(listenOptions, () => {
      log(`serving on port ${port}`);
    })
    .on("error", (error) => {
      console.error("Server startup error:", error);
      process.exit(1);
    });
})();
