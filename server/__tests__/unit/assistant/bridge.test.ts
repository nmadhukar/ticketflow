import type { Request } from "express";
import { assistantFor, classifyCopilotRequest, sameOrigin } from "../../../assistant/bridge";

const req = (over: Partial<Record<string, unknown>> & { headers?: Record<string, string> } = {}) =>
  ({
    method: "POST",
    originalUrl: "/api/copilotkit/info",
    protocol: "http",
    get: (name: string) => ({ host: "tickets.local", ...over.headers })[name.toLowerCase()],
    isAuthenticated: () => true,
    ...over,
  }) as unknown as Request;

describe("assistant bridge", () => {
  it("lets through only the routes the panel uses, and reports the agent in the path", () => {
    expect(classifyCopilotRequest({ method: "GET", originalUrl: "/api/copilotkit/info" })).toEqual({ route: "info", agentId: null });
    expect(classifyCopilotRequest({ method: "POST", originalUrl: "/api/copilotkit/agent/support-assistant/run" })).toEqual({
      route: "run",
      agentId: "support-assistant",
    });
    expect(classifyCopilotRequest({ method: "POST", originalUrl: "/api/copilotkit/agent/ticket-assistant/stop/abc_1" })?.route).toBe("stop");
    for (const [method, url] of [
      ["POST", "/api/copilotkit/agent/support-assistant/run/"],
      ["POST", "/api/copilotkit//agent/support-assistant/run"],
      ["POST", "/api/copilotkit/agent/support-assistant/suggest"],
      ["POST", "/api/copilotkit/agent/other-agent/run"],
      ["GET", "/api/copilotkit/agent/support-assistant/run"],
      ["POST", "/api/copilotkit"],
      ["POST", "/api/copilotkitx/info"],
    ]) {
      expect(classifyCopilotRequest({ method, originalUrl: url })).toBeNull();
    }
  });

  it("maps a signed-in user's role to their agent, and nothing for anything else", () => {
    expect(assistantFor(req({ user: { id: "c", role: "customer" } }))?.agentId).toBe("support-assistant");
    for (const role of ["agent", "manager", "admin", "user"]) {
      expect(assistantFor(req({ user: { id: "s", role } }))?.agentId).toBe("ticket-assistant");
    }
    expect(assistantFor(req({ user: { id: "x", role: "superuser" } }))).toBeNull();
    expect(assistantFor(req({ user: undefined }))).toBeNull();
    expect(assistantFor(req({ user: { id: "c", role: "customer" }, isAuthenticated: () => false }))).toBeNull();
  });

  it("accepts only this site's origin, from APP_BASE_URL when set", () => {
    const env = { APP_BASE_URL: "https://tickets.example.com" };
    expect(sameOrigin(req({ headers: { origin: "https://tickets.example.com" } }), env)).toBe(true);
    expect(sameOrigin(req({ headers: { referer: "https://tickets.example.com/tickets/1" } }), env)).toBe(true);
    expect(sameOrigin(req({ headers: { origin: "https://evil.example.com" } }), env)).toBe(false);
    expect(sameOrigin(req({ headers: { origin: "http://tickets.example.com" } }), env)).toBe(false);
    expect(sameOrigin(req({ headers: {} }), env)).toBe(false);
    expect(sameOrigin(req({ headers: { origin: "null" } }), env)).toBe(false);
    // Without APP_BASE_URL: the request's own host.
    expect(sameOrigin(req({ headers: { origin: "http://tickets.local" } }), {})).toBe(true);
    expect(sameOrigin(req({ headers: { origin: "http://elsewhere.local" } }), {})).toBe(false);
  });
});
