import express, { type Express } from "express";
import { installRequestPipeline } from "../../../security/pipeline";
import { registerRoutes } from "../../../routes/index";
import { closeAuth } from "../../../services/auth";
import { closeDb, resetDb, trackBackgroundWork } from "./testDb";
import { recordResponse } from "./noSecrets";
import { installErrorHandling } from "../../../http/install";
import { registerHealthRoutes } from "../../../http/health";

/**
 * Builds the real application (the production `registerRoutes`) without
 * starting Vite, seeding data or listening on a port. Use with supertest.
 */
export async function createTestApp(): Promise<{
  app: Express;
  close(): Promise<void>;
}> {
  const app = express();
  app.set("trust proxy", 1);
  // The production pipeline (helmet + CSP, body parsers, input sanitiser), so
  // integration tests see exactly what production requests see. The general
  // rate limit is not installed: production enables it only with NODE_ENV=production.
  installRequestPipeline(app, { bodyLimit: "50mb", sanitize: true });

  // Test-only, replacing recordJsonResponses (same recording, see noSecrets.ts) so that the work
  // still running when the response is sent holds the resetDb barrier open. A create kicks off its
  // AI hooks and the realtime learning path on chains that outlive the response; truncating then
  // made the NEXT test fail with a foreign key or a deadlock (see testDb.ts).
  app.use((req, res, next) => {
    const realJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      recordResponse(`${req.method} ${req.originalUrl}`, body);
      return realJson(body);
    }) as typeof res.json;
    next();
  });
  app.use((_req, _res, next) => {
    // From here to the end of the request, anything the handler leaves running is tracked.
    trackBackgroundWork(
      new Promise<void>((resolve) => _res.once("close", resolve)),
    );
    next();
  });

  // registerRoutes starts a daily cleanup setInterval that would keep Jest
  // alive; unref any timer created while the routes are being registered.
  const realSetInterval = global.setInterval;
  global.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = realSetInterval(...args);
    timer.unref?.();
    return timer;
  }) as typeof setInterval;

  let server;
  try {
    server = await registerRoutes(app);
  } finally {
    global.setInterval = realSetInterval;
  }

  // The health routes production registers after registerRoutes (server/index.ts).
  registerHealthRoutes(app);

  // Same /api 404 + JSON error handler production installs in server/index.ts.
  installErrorHandling(app);

  return {
    app,
    async close() {
      server.close();
      await closeAuth();
      // Leave the shared test DB empty: tests write fake Bedrock/email/Teams
      // settings, and e2e runs against the same database.
      await resetDb();
      await closeDb();
    },
  };
}
