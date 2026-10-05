import { createOpenRouterPricing, estimateCostUsd } from "../../services/ai/openRouterPricing";

describe("OpenRouter pricing", () => {
  it("normalizes prices per token and caches one model snapshot", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "test/model", pricing: { prompt: "0.000002", completion: "0.000004" } }] }) })) as unknown as typeof fetch;
    const pricing = createOpenRouterPricing({ getApiKey: () => "test-key", fetchImpl });
    expect(await pricing.getModelPrice("test/model")).toEqual({ promptUsdPerToken: 0.000002, completionUsdPerToken: 0.000004 });
    expect(await pricing.getModelPrice("test/model")).toEqual({ promptUsdPerToken: 0.000002, completionUsdPerToken: 0.000004 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(estimateCostUsd(10, 5, { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.000004 })).toBeCloseTo(0.00004, 12);
  });

  it("returns unavailable for missing, malformed, or failed metadata", async () => {
    const bad = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "test/model", pricing: { prompt: "-1", completion: "n/a" } }] }) })) as unknown as typeof fetch;
    expect(await createOpenRouterPricing({ getApiKey: () => "key", fetchImpl: bad }).getModelPrice("test/model")).toBeNull();
    const failed = jest.fn(async () => { throw new Error("secret response"); }) as unknown as typeof fetch;
    expect(await createOpenRouterPricing({ getApiKey: () => "key", fetchImpl: failed }).getModelPrice("test/model")).toBeNull();
  });

  it("retains valid models beyond the first 500 entries for the cache lifetime", async () => {
    const data = Array.from({ length: 600 }, (_, index) => ({ id: `test/model-${index}`, pricing: { prompt: "0.000002", completion: "0.000004" } }));
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ data }) })) as unknown as typeof fetch;
    const pricing = createOpenRouterPricing({ getApiKey: () => "key", fetchImpl });
    expect(await pricing.getModelPrice("test/model-0")).not.toBeNull();
    expect(await pricing.getModelPrice("test/model-599")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads billed total only when generation metadata supplies it", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ data: { id: "gen-123", model: "test/model", total_cost: 0.0015 } }) })) as unknown as typeof fetch;
    const pricing = createOpenRouterPricing({ getApiKey: () => "key", fetchImpl });
    expect(await pricing.getGenerationCost("gen-123")).toEqual({ generationId: "gen-123", totalCostUsd: 0.0015, actualModel: "test/model" });
    const [url] = (fetchImpl as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/generation?id=gen-123");
  });

  it("leaves missing billed cost unavailable", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ data: { id: "gen-123", total_cost: null } }) })) as unknown as typeof fetch;
    expect(await createOpenRouterPricing({ getApiKey: () => "key", fetchImpl }).getGenerationCost("gen-123")).toBeNull();
  });
});
