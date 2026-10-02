import express, { type Express } from "express";
import { registerRoutes } from "../../../routes/index";
import { closeAuth } from "../../../services/auth";
import { closeDb } from "./testDb";

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
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

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

  return {
    app,
    async close() {
      server.close();
      await closeAuth();
      await closeDb();
    },
  };
}
