import { agentModelWithFallback } from "../src/mastra/config.ts";

describe("agent model fallbacks", () => {
  const base = { ASSISTANT_MODEL_PROVIDER: "openai", ASSISTANT_MODEL: "gpt-4o-mini" };

  it("returns a plain id when no fallback is configured", () => {
    expect(agentModelWithFallback("ticket-assistant", base)).toBe("openai/gpt-4o-mini");
  });

  it("adds configured fallbacks, completing a bare vendor model with the provider", () => {
    const model = agentModelWithFallback("ticket-assistant", {
      ...base,
      ASSISTANT_MODEL_FALLBACK: "gpt-4.1-mini, openrouter/deepseek/deepseek-chat",
    });
    expect(model).toEqual({
      id: "openai/gpt-4o-mini",
      fallback: ["openai/gpt-4.1-mini", "openrouter/deepseek/deepseek-chat"],
    });
  });

  it("lets an agent override the global list and drops a duplicate of the primary", () => {
    const model = agentModelWithFallback("support-assistant", {
      ...base,
      ASSISTANT_MODEL_FALLBACK: "openai/gpt-4.1-mini",
      ASSISTANT_SUPPORT_MODEL_FALLBACK: "gpt-4o-mini, gpt-4.1",
    });
    expect(model).toEqual({ id: "openai/gpt-4o-mini", fallback: ["openai/gpt-4.1"] });
  });
});
