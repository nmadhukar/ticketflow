import { readOpenRouterApiKey } from "../../env";
import { providerForModel } from "./modelProvider";

export type ModelPrice = { promptUsdPerToken: number; completionUsdPerToken: number };
export type GenerationCost = { generationId: string; totalCostUsd: number; actualModel?: string };

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const CACHE_TTL_MS = 15 * 60 * 1000;

export function estimateCostUsd(input: number, output: number, price: ModelPrice): number {
  return input * price.promptUsdPerToken + output * price.completionUsdPerToken;
}

/**
 * List prices for a model served by OpenAI, which has no public price endpoint. Not needed for a
 * call to go through: a price is only used for the cost limit and the usage log. A model that is
 * missing simply gets no preflight ceiling, rather than the "price_unavailable" refusal that made
 * a valid OpenAI key look broken.
 */
const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { promptUsdPerToken: 0.15e-6, completionUsdPerToken: 0.6e-6 },
  "gpt-4o": { promptUsdPerToken: 2.5e-6, completionUsdPerToken: 10e-6 },
  "gpt-4.1-mini": { promptUsdPerToken: 0.4e-6, completionUsdPerToken: 1.6e-6 },
  "gpt-4.1": { promptUsdPerToken: 2e-6, completionUsdPerToken: 8e-6 },
  "gpt-5-mini": { promptUsdPerToken: 0.25e-6, completionUsdPerToken: 2e-6 },
  "gpt-5": { promptUsdPerToken: 1.25e-6, completionUsdPerToken: 10e-6 },
};

/** A price for any provider: the table for OpenAI, the fetched catalog for OpenRouter. */
export function priceForModel(modelId: string): ModelPrice {
  if (providerForModel(modelId) === "openai") {
    const known = OPENAI_PRICES[modelId.trim()];
    if (known) return known;
    // An unknown OpenAI model is priced like the family it belongs to (the mini tier for the
    // cheap ones), so the limit is a sane estimate instead of a refusal.
    return /mini/i.test(modelId)
      ? OPENAI_PRICES["gpt-4o-mini"]
      : OPENAI_PRICES["gpt-4o"];
  }
  return { promptUsdPerToken: 0, completionUsdPerToken: 0 };
}

function nonnegativeFinite(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createOpenRouterPricing(options: {
  getApiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
} = {}) {
  const getApiKey = options.getApiKey ?? readOpenRouterApiKey;
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  let cache = new Map<string, ModelPrice>();
  let expiresAt = 0;

  async function getModelPrice(modelId: string): Promise<ModelPrice | null> {
    if (!modelId.trim()) return null;
    if (Date.now() < expiresAt) return cache.get(modelId) ?? null;
    const apiKey = getApiKey();
    if (!apiKey) return null;
    try {
      const response = await fetchImpl(MODELS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const body = record(await response.json());
      if (!Array.isArray(body?.data)) return null;
      const next = new Map<string, ModelPrice>();
      for (const item of body.data) {
        const model = record(item);
        const pricing = record(model?.pricing);
        if (typeof model?.id !== "string" || !pricing) continue;
        const promptUsdPerToken = nonnegativeFinite(pricing.prompt);
        const completionUsdPerToken = nonnegativeFinite(pricing.completion);
        if (promptUsdPerToken === null || completionUsdPerToken === null) continue;
        next.set(model.id, { promptUsdPerToken, completionUsdPerToken });
      }
      cache = next;
      expiresAt = Date.now() + CACHE_TTL_MS;
      return cache.get(modelId) ?? null;
    } catch {
      return null;
    }
  }

  async function getGenerationCost(generationId: string): Promise<GenerationCost | null> {
    if (!/^gen-[0-9A-Za-z-]{1,124}$/.test(generationId)) return null;
    const apiKey = getApiKey();
    if (!apiKey) return null;
    try {
      const response = await fetchImpl(`${GENERATION_URL}?id=${encodeURIComponent(generationId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const body = record(await response.json());
      const data = record(body?.data);
      if (!data || data.id !== generationId) return null;
      const totalCostUsd = nonnegativeFinite(data.total_cost);
      if (totalCostUsd === null) return null;
      return {
        generationId,
        totalCostUsd,
        ...(typeof data.model === "string" && data.model ? { actualModel: data.model } : {}),
      };
    } catch {
      return null;
    }
  }

  return { getModelPrice, getGenerationCost };
}
