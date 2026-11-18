import { apiKeyFor, isProviderConfigured, providerForModel, providerRequest } from "../../services/ai/modelProvider";

describe("model provider routing", () => {
  it("sends an OpenAI model id to OpenAI and a vendor route to OpenRouter", () => {
    expect(providerForModel("gpt-4o-mini")).toBe("openai");
    expect(providerForModel("gpt-5-mini")).toBe("openai");
    expect(providerForModel("o3-mini")).toBe("openai");
    expect(providerForModel("deepseek/deepseek-v4-pro")).toBe("openrouter");
    expect(providerForModel("meta-llama/llama-3.3-70b-instruct")).toBe("openrouter");
    // An unset model falls back to the historical default route.
    expect(providerForModel("")).toBe("openrouter");
  });

  it("uses the provider's own key, and the other one when it is the only key set", () => {
    expect(apiKeyFor("openai", { OPENAI_API_KEY: "sk-openai" })).toBe("sk-openai");
    expect(apiKeyFor("openrouter", { OPENROUTER_API_KEY: "sk-or" })).toBe("sk-or");
    // The deployment had one key pasted under the other variable: it must still answer.
    expect(apiKeyFor("openrouter", { OPENAI_API_KEY: "sk-openai" })).toBe("sk-openai");
    expect(apiKeyFor("openai", { OPENROUTER_API_KEY: "sk-or" })).toBe("sk-or");
    expect(apiKeyFor("openai", {})).toBeUndefined();
  });

  it("reports a key as configured for the model's provider", () => {
    const env = { OPENAI_API_KEY: "sk-openai" };
    expect(isProviderConfigured("gpt-4o-mini", env)).toBe(true);
    expect(isProviderConfigured("deepseek/deepseek-v4-pro", env)).toBe(true);
    expect(isProviderConfigured("gpt-4o-mini", {})).toBe(false);
  });

  it("builds the right endpoint without leaking the key anywhere else", () => {
    expect(providerRequest("openai", "k").url).toBe("https://api.openai.com/v1/chat/completions");
    expect(providerRequest("openrouter", "k").url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(providerRequest("openai", "k").headers.Authorization).toBe("Bearer k");
  });
});
