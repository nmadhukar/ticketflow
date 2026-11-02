/**
 * Registers the CopilotKit runtime middleware.
 *
 * It is mounted at the app root but acts only on its own base path: every other
 * request returns next() immediately. That shape is deliberate. CopilotKit's own
 * Express handler is a router with a wildcard path, and mounting a wildcard router
 * on this app would leak its internal `:id`-style parameters into the app's shared
 * id-validation and duplicate-route checks. Invoking it from inside one narrow
 * middleware keeps it invisible to those checks and harmless to every other route.
 */
import type { Express } from "express";
import { readMastraAgentConfig } from "../mastra/config";
import { readCopilotKitConfig } from "./config";
import { createCopilotKitMiddleware } from "./runtime";

/**
 * Mounts the copilot when it is enabled. With COPILOTKIT_ENABLED unset this is a
 * no-op and nothing CopilotKit-related is imported or executed.
 */
export function registerCopilotKit(app: Express, env: NodeJS.ProcessEnv = process.env): void {
  const config = readCopilotKitConfig(env, readMastraAgentConfig(env));
  if (!config) return;
  app.use(createCopilotKitMiddleware(config, env));
}
