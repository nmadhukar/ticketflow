/**
 * CopilotKit's runtime reads its telemetry opt-out once, when first imported, so the bridge must
 * set it as soon as the app loads it, before anything imports CopilotKit, and whatever the
 * environment said.
 */
describe("CopilotKit telemetry", () => {
  it("is switched off by loading the bridge, even when the environment tried to switch it on", async () => {
    const before = process.env.COPILOTKIT_TELEMETRY_DISABLED;
    process.env.COPILOTKIT_TELEMETRY_DISABLED = "false";
    try {
      await jest.isolateModulesAsync(async () => {
        await import("../../../assistant/bridge");
      });
      expect(process.env.COPILOTKIT_TELEMETRY_DISABLED).toBe("true");
    } finally {
      if (before === undefined) delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
      else process.env.COPILOTKIT_TELEMETRY_DISABLED = before;
    }
  });
});
