import "dotenv/config";
import "./bootGuard";
import express from "express";
import { registerRoutes } from "./routes/index";
import { installErrorHandling } from "./http/install";
import { registerHealthRoutes } from "./http/health";
import { setupVite, serveStatic, log } from "./vite";
import { requestLogger } from "./utils/requestLogger";
import { isDevelopmentEnv, parseTrustProxyHops } from "./env";
import { describeError } from "./http/errors";
import {
  applySecurity,
  applyRouteSpecificSecurity,
} from "./security";

const app = express();

// Trust the reverse proxy chain so req.ip is the real client address (X-Forwarded-For), set here and
// nowhere else (R49). TRUST_PROXY_HOPS is the number of proxies in front of the app: 1 (default) is
// one nginx / platform router, 2 is Coolify/Traefik plus nginx. A deployment with more hops than this
// number would key every limiter on a proxy's address; fewer would trust a client-supplied entry.
app.set("trust proxy", parseTrustProxyHops());

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

    // Required configuration (ruling R34: APP_BASE_URL in production), before anything connects.
    const { assertStartupConfig } = await import("./startup/config");
    if (!assertStartupConfig()) return;

    // Ruling R32: refuse to boot (one log line, exit 1) when the database lacks a
    // schema object the code needs, e.g. after drizzle-kit push silently applied nothing.
    const { pool } = await import("./storage/db");
    const { assertSchemaReady } = await import("./startup/schemaCheck");
    if (!(await assertSchemaReady({ db: pool }))) return;

    // Required startup steps (demo-login deactivation first, the data fix-ups, the
    // system and AI users, the bootstrap admin) stop startup with one line when they
    // fail (M8); demo data (SEED_DEMO_DATA=true only) and default templates are best effort.
    const { runSeeders, startupFailureLine } = await import("./seed/runSeeders");
    try {
      await runSeeders();
    } catch (error) {
      console.error(startupFailureLine(error));
      process.exit(1);
    }

    // R36: validate DEFAULT_TRIAGE_TEAM_ID once. A bad value is logged and ignored, never fatal.
    try {
      const { initDefaultTriageTeam } = await import("./services/tickets/triage");
      await initDefaultTriageTeam();
    } catch (error) {
      console.error(`DEFAULT_TRIAGE_TEAM_ID check failed [${describeError(error)}]; ignoring it`);
    }
  } catch (error) {
    console.error(`Startup error [${describeError(error)}]`);
    process.exit(1);
  }

  // Apply route-specific security
  applyRouteSpecificSecurity(app);

  const server = await registerRoutes(app);

  registerHealthRoutes(app);

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

  // SIGTERM (docker stop, a Coolify redeploy) and SIGINT: close sockets, the HTTP server, the
  // session stores and the pool, then exit. node is PID 1 (`exec node`, R66), where a signal with
  // no handler is ignored. See ./shutdown.
  {
    const { createShutdown } = await import("./shutdown");
    const { pool } = await import("./storage/db");
    const { closeRealtime } = await import("./realtime/ws");
    const { closeAuth } = await import("./services/auth");
    const shutdown = createShutdown({
      server,
      closeRealtime,
      closeAuth,
      closePool: () => pool.end(),
      exit: (code) => process.exit(code),
      log: (line) => console.log(line),
    });
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  }

  server
    .listen(listenOptions, () => {
      log(`serving on port ${port}`);
      // R90 backfill, after listen and not awaited (review I1): text for documents uploaded before
      // extraction existed. Every parse runs in a separate, memory-limited extractor process and each
      // row is claimed before its parse, so a hostile file can kill only that process, once.
      import("./services/documents/backfillText")
        .then(({ startDocumentTextBackfill }) => startDocumentTextBackfill())
        .catch((error) => console.error(`Document text backfill failed [${describeError(error)}]`));
    })
    .on("error", (error) => {
      console.error("Server startup error:", error);
      process.exit(1);
    });
})();
