import request from "supertest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createInternalApp, startInternalServer } from "../../../assistant/internalServer";
import { assistantConfigProblems, readInternalHost, readInternalPort } from "../../../assistant/config";
import { closeHttpServer } from "../../../shutdown";

const ENABLED = {
  ASSISTANT_ENABLED: "true",
  ASSISTANT_SESSION_SECRET: "1Kq7v2Zr9Wm4Xp1Ln8Bt5Yc3Hs6Jd0Fg-1",
  ASSISTANT_AGENT_SECRET: "2Kq7v2Zr9Wm4Xp1Ln8Bt5Yc3Hs6Jd0Fg-2",
};

const listening = (server: Server) => new Promise((resolve) => server.once("listening", resolve));

describe("assistant internal listener", () => {
  it("answers its health check and nothing else", async () => {
    const app = createInternalApp();
    await request(app).get("/internal/health").expect(200, { status: "ok" });
    await request(app).post("/api/mcp").expect(404, { error: "not_found" });
    await request(app).get("/").expect(404);
    const res = await request(app).get("/internal/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("starts only when the assistant is enabled, on loopback unless told otherwise", async () => {
    const onError = jest.fn();
    expect(startInternalServer({ env: {}, onError })).toBeNull();
    const server = startInternalServer({ env: { ...ENABLED, ASSISTANT_INTERNAL_PORT: "0" }, log: () => {}, onError })!;
    await listening(server);
    const { address, port } = server.address() as AddressInfo;
    expect(address).toBe("127.0.0.1");
    expect((await fetch(`http://127.0.0.1:${port}/internal/health`)).status).toBe(200);
    await closeHttpServer(server);
    expect(server.listening).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands a listen error to the caller instead of exiting the process", async () => {
    const first = startInternalServer({ env: { ...ENABLED, ASSISTANT_INTERNAL_PORT: "0" }, log: () => {}, onError: () => {} })!;
    await listening(first);
    const { port } = first.address() as AddressInfo;
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = new Promise<Error>((resolve) => {
        startInternalServer({ env: { ...ENABLED, ASSISTANT_INTERNAL_PORT: String(port) }, log: () => {}, onError: resolve });
      });
      await expect(failed).resolves.toMatchObject({ code: "EADDRINUSE" });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      errorLog.mockRestore();
      await closeHttpServer(first);
    }
  });

  it("listens on ASSISTANT_INTERNAL_PORT (default 5100) and ASSISTANT_INTERNAL_HOST (default loopback)", () => {
    expect(readInternalPort({})).toBe(5100);
    expect(readInternalPort({ ASSISTANT_INTERNAL_PORT: "5200" })).toBe(5200);
    expect(readInternalHost({})).toBe("127.0.0.1");
    expect(readInternalHost({ ASSISTANT_INTERNAL_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("refuses an internal port equal to PORT, the default included", () => {
    const clash = "ASSISTANT_INTERNAL_PORT must differ from PORT: the internal listener is never public.";
    expect(assistantConfigProblems({ ...ENABLED, ASSISTANT_INTERNAL_PORT: "5000" })).toEqual([clash]);
    expect(assistantConfigProblems({ ...ENABLED, PORT: "8080", ASSISTANT_INTERNAL_PORT: "8080" })).toEqual([clash]);
    expect(assistantConfigProblems({ ...ENABLED, PORT: "5100" })).toEqual([clash]);
    expect(assistantConfigProblems({ ...ENABLED, PORT: "5000" })).toEqual([]);
    for (const bad of ["0x10", "70000", "-1", "abc", "0"]) {
      expect(assistantConfigProblems({ ...ENABLED, ASSISTANT_INTERNAL_PORT: bad })).toEqual([
        "ASSISTANT_INTERNAL_PORT must be an integer from 1 to 65535.",
      ]);
    }
  });
});
