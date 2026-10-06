import { createOpenRouterClient } from "../../services/ai/openRouterClient";

const request = {
  operation: "reply",
  messages: [{ role: "user" as const, content: "Hello" }],
  maxOutputTokens: 400,
  temperature: 0.25,
};

const price = { promptUsdPerToken: 0.000001, completionUsdPerToken: 0.000002 };

function client(fetchImpl: typeof fetch, model = "deepseek/deepseek-v4-pro") {
  return createOpenRouterClient({
    getModelId: async () => model,
    getApiKey: () => "test-key",
    fetchImpl,
    getModelPrice: async () => price,
  });
}

describe("OpenRouter client", () => {
  it("sends selected model and operation controls, then returns parsed usage and estimated cost", async () => {
    const fetchImpl = jest.fn(async (_url: string, _options: RequestInit) => ({
      ok: true,
      json: async () => ({ id: "gen-abc", model: "deepseek/deepseek-v4-pro", choices: [{ message: { content: "  Reply  " } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
    })) as unknown as typeof fetch;
    const result = await client(fetchImpl).generate(request);
    expect(result).toEqual({ text: "Reply", requestedModel: "deepseek/deepseek-v4-pro", actualModel: "deepseek/deepseek-v4-pro", promptTokens: 12, completionTokens: 8, generationId: "gen-abc", estimatedCostUsd: 0.000028 });
    const [url, options] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(options.body as string)).toEqual({ model: "deepseek/deepseek-v4-pro", messages: request.messages, max_tokens: 400, temperature: 0.25 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects blank content and malformed usage", async () => {
    const response = (usage: unknown) => jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "   " } }], usage }) })) as unknown as typeof fetch;
    await expect(client(response({ prompt_tokens: 1, completion_tokens: 1 })).generate(request)).rejects.toMatchObject({ code: "empty_output" });
    const malformed = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: -1 } }) })) as unknown as typeof fetch;
    await expect(client(malformed).generate(request)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("prices a provider-selected model using its own rates", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ model: "alternate/model", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) })) as unknown as typeof fetch;
    const getModelPrice = jest.fn(async (modelId: string) => modelId === "alternate/model"
      ? { promptUsdPerToken: 0.000003, completionUsdPerToken: 0.000004 }
      : price);
    const ai = createOpenRouterClient({ getModelId: () => "requested/model", getApiKey: () => "test-key", fetchImpl, getModelPrice });
    const result = await ai.generate(request);
    expect(result.actualModel).toBe("alternate/model");
    expect(result.estimatedCostUsd).toBeCloseTo(0.00005, 12);
    expect(getModelPrice).toHaveBeenCalledWith("alternate/model");
  });

  it("fails closed when a returned model has no usable price", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ model: "unknown/model", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) })) as unknown as typeof fetch;
    const ai = createOpenRouterClient({ getModelId: () => "requested/model", getApiKey: () => "test-key", fetchImpl, getModelPrice: async (modelId) => modelId === "requested/model" ? price : null });
    await expect(ai.generate(request)).rejects.toMatchObject({ code: "price_unavailable" });
  });

  it.each([[401, "auth"], [403, "auth"], [402, "credits"], [408, "timeout"], [429, "rate_limit"], [500, "provider_failure"], [502, "provider_failure"]] as const)("maps status %i without exposing response text", async (status, code) => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status, text: async () => "private prompt and token" })) as unknown as typeof fetch;
    const error = await client(fetchImpl).generate(request).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected provider error");
    expect(error).toMatchObject({ code, status });
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain("test-key");
  });

  it("maps abort to timeout without exposing fetch error text", async () => {
    const fetchImpl = jest.fn(async () => { throw new DOMException("private prompt", "TimeoutError"); }) as unknown as typeof fetch;
    const error = await client(fetchImpl).generate(request).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected timeout error");
    expect(error).toMatchObject({ code: "timeout" });
    expect(error.message).not.toContain("private");
  });

  it("sends a caller-approved response schema to OpenRouter", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) })) as unknown as typeof fetch;
    await client(fetchImpl).generate({ ...request, responseSchema: { type: "object", properties: { answer: { type: "string" } } } });
    const [, options] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string).response_format).toEqual({ type: "json_schema", json_schema: { name: "response", strict: true, schema: { type: "object", properties: { answer: { type: "string" } } } } });
  });
});
