import fs from "fs";
import path from "path";
import { readCopilotKitConfig, DEFAULT_COPILOTKIT_BASE_PATH } from "../../copilot/config";
import { readMastraAgentConfig } from "../../mastra/config";

/**
 * The CopilotKit copilot wiring. CopilotKit is a second, user-facing driver of
 * the same ticket tools, mounted as one narrow middleware on the existing app.
 * These checks keep that wiring honest: the feature is off unless both switches
 * say on, the middleware is reachable from the route table, and the client and
 * server agree on the runtime path.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const ENABLED_ENV = {
  COPILOTKIT_ENABLED: "true",
  MASTRA_AGENT_ENABLED: "true",
  TICKETFLOW_MCP_KEY: "tfk_test_key_value_for_wiring_check",
} as NodeJS.ProcessEnv;

describe("CopilotKit copilot wiring", () => {
  it("is off unless COPILOTKIT_ENABLED is exactly \"true\"", () => {
    const mastra = readMastraAgentConfig(ENABLED_ENV);
    expect(readCopilotKitConfig({ ...ENABLED_ENV, COPILOTKIT_ENABLED: "false" }, mastra)).toBeNull();
    expect(readCopilotKitConfig({ ...ENABLED_ENV, COPILOTKIT_ENABLED: undefined }, mastra)).toBeNull();
    expect(readCopilotKitConfig(ENABLED_ENV, mastra)).not.toBeNull();
  });

  it("stays off without the Mastra agent layer, whose model and MCP key it borrows", () => {
    // No MASTRA_AGENT_ENABLED: readMastraAgentConfig returns null, so the copilot must too.
    const noMastra = readMastraAgentConfig({ COPILOTKIT_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(readCopilotKitConfig(ENABLED_ENV, noMastra)).toBeNull();
  });

  it("defaults its base path and normalises a missing leading slash", () => {
    const mastra = readMastraAgentConfig(ENABLED_ENV);
    expect(readCopilotKitConfig(ENABLED_ENV, mastra)!.basePath).toBe(DEFAULT_COPILOTKIT_BASE_PATH);
    const bare = readCopilotKitConfig({ ...ENABLED_ENV, COPILOTKIT_BASE_PATH: "api/copilotkit" }, mastra)!;
    expect(bare.basePath).toBe("/api/copilotkit");
  });

  it("registerRoutes mounts the copilot middleware before the MCP router", () => {
    const routes = read("server/routes/index.ts");
    expect(routes).toContain("registerCopilotKit(app)");
    expect(routes.indexOf("registerCopilotKit(app)")).toBeLessThan(routes.indexOf('app.use("/api/mcp"'));
  });

  it("the mount is a single narrow middleware, not the CopilotKit router in the route table", () => {
    // A wildcard router in the stack would leak its :params into the app's shared
    // id-validation and duplicate-route checks; the mount uses app.use(middleware).
    const mount = read("server/copilot/mount.ts");
    expect(mount).toContain("createCopilotKitMiddleware");
    expect(mount).toContain("app.use(");
    expect(mount).not.toContain("createCopilotExpressHandler");
  });

  it("the client component and the server agree on the runtime path", () => {
    const component = read("client/src/components/CopilotAssistant.tsx");
    expect(component).toContain("CopilotKit");
    expect(component).toContain("CopilotPopup");
    expect(component).toContain('"/api/copilotkit"');
  });

  it("the runtime gates on a signed-in user and answers a cheap enablement probe", () => {
    const runtime = read("server/copilot/runtime.ts");
    expect(runtime).toContain("req.isAuthenticated()");
    expect(runtime).toContain("/config");
    expect(runtime).toContain("copilot_unavailable");
  });
});
