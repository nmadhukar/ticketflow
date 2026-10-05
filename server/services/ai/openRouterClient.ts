import { readOpenRouterApiKey } from "../../env";
import { AiModelError, mapOpenRouterStatus } from "./aiErrors";
import type { AiModelClient, GenerateRequest, GenerateResult } from "./aiModelClient";
import { createOpenRouterPricing, estimateCostUsd, type ModelPrice } from "./openRouterPricing";

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-pro";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createOpenRouterClient(options: {
  getModelId?: () => string | undefined | Promise<string | undefined>;
  getApiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
  getModelPrice?: (modelId: string) => Promise<ModelPrice | null>;
} = {}): AiModelClient {
  const getApiKey = options.getApiKey ?? readOpenRouterApiKey;
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const getModelPrice = options.getModelPrice ?? createOpenRouterPricing({ getApiKey, fetchImpl }).getModelPrice;

  return {
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const apiKey = getApiKey();
      if (!apiKey) throw new AiModelError("not_configured");
      const requestedModel = (await options.getModelId?.())?.trim() || DEFAULT_OPENROUTER_MODEL;
      const price = await getModelPrice(requestedModel);
      if (!price) throw new AiModelError("price_unavailable");
      if (!request.operation.trim() || !request.messages.length || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || !Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2) {
        throw new AiModelError("invalid_output");
      }
      let response: Response;
      try {
        response = await fetchImpl(CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: requestedModel,
            messages: request.messages,
            max_tokens: request.maxOutputTokens,
            temperature: request.temperature,
            ...(request.responseSchema ? {
              response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: request.responseSchema } },
            } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        const name = record(error)?.name;
        throw new AiModelError(name === "AbortError" || name === "TimeoutError" ? "timeout" : "provider_failure");
      }
      if (!response.ok) throw mapOpenRouterStatus(response.status);
      let body: Record<string, unknown> | null;
      try {
        body = record(await response.json());
      } catch {
        throw new AiModelError("invalid_output");
      }
      const choices = body?.choices;
      const choice = Array.isArray(choices) ? record(choices[0]) : null;
      const message = record(choice?.message);
      if (typeof message?.content !== "string") throw new AiModelError("invalid_output");
      const text = message.content.trim();
      if (!text) throw new AiModelError("empty_output");
      const usage = record(body?.usage);
      const promptTokens = tokenCount(usage?.prompt_tokens);
      const completionTokens = tokenCount(usage?.completion_tokens);
      if (promptTokens === null || completionTokens === null) throw new AiModelError("invalid_output");
      const actualModel = typeof body?.model === "string" && body.model.trim() ? body.model : requestedModel;
      const actualPrice = actualModel === requestedModel ? price : await getModelPrice(actualModel);
      if (!actualPrice) throw new AiModelError("price_unavailable");
      return {
        text,
        requestedModel,
        actualModel,
        promptTokens,
        completionTokens,
        ...(typeof body?.id === "string" && body.id ? { generationId: body.id } : {}),
        estimatedCostUsd: estimateCostUsd(promptTokens, completionTokens, actualPrice),
      };
    },
  };
}
