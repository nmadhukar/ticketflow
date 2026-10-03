import express, { type Express } from "express";
import { installRequestPipeline } from "../../../security/pipeline";
import { registerRoutes } from "../../../routes/index";
import { closeAuth } from "../../../services/auth";
import { closeDb } from "./testDb";
import { recordJsonResponses } from "./noSecrets";
import { installErrorHandling } from "../../../http/install";

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

  // Test-only: record every JSON body so the integration-wide afterEach hook
  // (helpers/secretsHook.ts) can fail on password/token fields in any response.
  app.use(recordJsonResponses);

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

  // Same /api 404 + JSON error handler production installs in server/index.ts.
  installErrorHandling(app);

  return {
    app,
    async close() {
      server.close();
      await closeAuth();
      await closeDb();
    },
  };
}
