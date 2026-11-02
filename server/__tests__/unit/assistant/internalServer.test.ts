import request from "supertest";
import type { AddressInfo } from "net";
import { closeServer, createInternalApp, readInternalPort, startInternalServer } from "../../../assistant/internalServer";
import { assistantConfigProblems } from "../../../assistant/config";

const ENABLED = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: "1Kq7v2Zr9Wm4Xp1Ln8Bt5Yc3Hs6Jd0Fg-1",
  ASSISTANT_AGENT_SECRET: "2Kq7v2Zr9Wm4Xp1Ln8Bt5Yc3Hs6Jd0Fg-2",
};

describe("assistant internal listener", () => {
  it("answers its health check and nothing else", async () => {
    const app = createInternalApp();
    await request(app).get("/internal/health").expect(200, { status: "ok" });
    await request(app).post("/api/mcp").expect(404, { error: "not_found" });
    await request(app).get("/").expect(404);
    const res = await request(app).get("/internal/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("starts only when the assistant is enabled", async () => {
    expect(startInternalServer({ env: {} })).toBeNull();
    const server = startInternalServer({ env: { ...ENABLED, ASSISTANT_INTERNAL_PORT: "0" }, log: () => {} });
    expect(server).not.toBeNull();
    await new Promise((resolve) => server!.once("listening", resolve));
    const { port } = server!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/internal/health`);
    expect(res.status).toBe(200);
    await closeServer(server);
    expect(server!.listening).toBe(false);
  });

  it("listens on ASSISTANT_INTERNAL_PORT, 5100 by default, never on PORT", () => {
    expect(readInternalPort({})).toBe(5100);
    expect(readInternalPort({ ASSISTANT_INTERNAL_PORT: "5200" })).toBe(5200);
    expect(assistantConfigProblems({ ...ENABLED, ASSISTANT_INTERNAL_PORT: "5000" })).toEqual([
      "ASSISTANT_INTERNAL_PORT must differ from PORT: the internal listener is never public.",
    ]);
    expect(assistantConfigProblems({ ...ENABLED, PORT: "8080", ASSISTANT_INTERNAL_PORT: "8080" })).toHaveLength(1);
    for (const bad of ["0x10", "70000", "-1", "abc"]) {
      expect(assistantConfigProblems({ ...ENABLED, ASSISTANT_INTERNAL_PORT: bad })).toEqual([
        "ASSISTANT_INTERNAL_PORT must be an integer from 1 to 65535.",
      ]);
    }
  });
});
