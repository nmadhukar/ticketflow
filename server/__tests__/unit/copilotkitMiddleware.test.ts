import express from "express";
import request from "supertest";
import { createCopilotKitMiddleware } from "../../copilot/runtime";
import { DEFAULT_COPILOTKIT_BASE_PATH, type CopilotKitRuntimeConfig } from "../../copilot/config";

/**
 * The copilot middleware gates before it ever builds the agent: a signed-in user
 * first, then the Mastra layer it borrows. These checks pin that order and the
 * "inert on every other path" behaviour without needing the network (the agent
 * build lists MCP tools over HTTP and is never reached here).
 */
const config: CopilotKitRuntimeConfig = {
  basePath: DEFAULT_COPILOTKIT_BASE_PATH,
  resourceId: "test-copilot",
};

function appWithAuth(authenticated: boolean) {
  const app = express();
  app.use((req, _res, next) => {
    // A real signed-in request always carries the session's user; the middleware needs its id
    // and role to build an agent that acts for that person.
    const fake = req as never as { isAuthenticated: () => boolean; user?: { id: string; role: string } };
    fake.isAuthenticated = () => authenticated;
    if (authenticated) fake.user = { id: "customer-1", role: "customer" };
    next();
  });
  app.use(createCopilotKitMiddleware(config, {
    // Mastra off: TICKETFLOW_MCP_KEY is absent, so readMastraAgentConfig is null.
    MASTRA_AGENT_ENABLED: "true",
  } as NodeJS.ProcessEnv));
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found", message: "no route" }));
  return app;
}

describe("copilot middleware gating", () => {
  it("answers 401 on its own config path when nobody is signed in", async () => {
    const res = await request(appWithAuth(false)).get(`${DEFAULT_COPILOTKIT_BASE_PATH}/config`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("answers 503 when signed in but the Mastra agent layer is off", async () => {
    const res = await request(appWithAuth(true)).get(`${DEFAULT_COPILOTKIT_BASE_PATH}/config`);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("copilot_disabled");
  });

  it("is inert on every other path: it falls through to the next handler", async () => {
    const res = await request(appWithAuth(true)).get("/api/tasks");
    expect(res.status).toBe(404); // the downstream /api 404, not the copilot
    expect(res.body).toEqual({ error: "not_found", message: "no route" });
  });
});
