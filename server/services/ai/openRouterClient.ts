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

/**
 * Whether a failed status is likely the provider refusing the reasoning field rather than a real
 * problem with the request: a validation rejection (400/422) is the shape that takes. The retry is
 * a single extra attempt that drops the field, so a genuine bad request simply fails as before.
 */
function rejectsReasoningField(status: number): boolean {
  return status === 400 || status === 422;
}

/**
 * Tokens added to the retry's visible allowance when a model refuses the reasoning switch. Such a
 * model reasons by default, and hidden reasoning is drawn from max_tokens, so a small structured
 * cap (analyzeTicket asks for 500) could be spent thinking and the answer would come back cut off.
 * The bump never takes the retry past the caller's per-request ceiling, which the caller has already
 * had checked against the request and cost limits, so the larger retry is within budget.
 */
const REASONING_RETRY_HEADROOM_TOKENS = 1000;

function reasoningRetryTokens(maxOutputTokens: number, ceiling: number | undefined): number {
  // Without a usable ceiling the retry keeps the first attempt's allowance: a larger number here
  // would be output nobody budgeted for. The caller (invokeBedrockModel) always passes one.
  if (typeof ceiling !== "number" || !Number.isSafeInteger(ceiling) || ceiling <= 0) return maxOutputTokens;
  const bumped = maxOutputTokens + REASONING_RETRY_HEADROOM_TOKENS;
  // The original allowance is a floor: the retry never asks for less than the first attempt did.
  return Math.min(bumped, Math.max(maxOutputTokens, ceiling));
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
      const requestBody = (includeReasoning: boolean, maxTokens: number) => JSON.stringify({
        model: requestedModel,
        messages: request.messages,
        max_tokens: maxTokens,
        temperature: request.temperature,
        ...(request.responseSchema ? {
          response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: request.responseSchema } },
        } : {}),
        // A reasoning model spends max_tokens on hidden reasoning before it writes the answer, so a
        // small structured output can come back empty or cut off. Callers that need parseable JSON
        // set reasoning=false to turn that off.
        ...(includeReasoning && request.reasoning !== undefined
          ? { reasoning: { enabled: request.reasoning } }
          : {}),
      });

      const send = async (includeReasoning: boolean, maxTokens: number): Promise<Response> => {
        try {
          return await fetchImpl(CHAT_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: requestBody(includeReasoning, maxTokens),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (error) {
          const name = record(error)?.name;
          throw new AiModelError(name === "AbortError" || name === "TimeoutError" ? "timeout" : "provider_failure");
        }
      };

      let response = await send(true, request.maxOutputTokens);
      // Not every model accepts the reasoning switch, and some providers reject the field outright,
      // which fails the whole call. Retry once without it and let the model's own default apply,
      // with headroom for the hidden reasoning that default turns on, rather than leave a
      // structured call with an answer the reasoning tokens have eaten.
      if (!response.ok && request.reasoning !== undefined && rejectsReasoningField(response.status)) {
        response = await send(
          false,
          reasoningRetryTokens(request.maxOutputTokens, request.maxOutputTokensCeiling)
        );
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
      // "length" means the provider stopped at max_tokens. For a structured (JSON) call the
      // visible text is a fragment that cannot be trusted, so it fails as unusable. A free-text
      // call (the help chat, the connection test) sets no such flag: its answer is shorter than
      // asked for, not broken, and throwing here made a working key look misconfigured.
      if (request.requireCompleteOutput === true && choice?.finish_reason === "length") {
        throw new AiModelError("invalid_output");
      }
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
