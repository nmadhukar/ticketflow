/**
 * The OpenRouter gateway for the Mastra agent's Llama.
 *
 * Why this file exists: @mastra/core resolves "openrouter/..." through its models.dev
 * registry, and that registry entry (url + OPENROUTER_API_KEY) has no `gateway` field. The
 * gateway chain therefore never claims the id, so nothing supplies the key and every call
 * reaches OpenRouter with no Authorization header. OpenRouter answers 401 "Missing
 * Authentication header", which the service reports as AI_APICallError. The app's own AI path
 * was unaffected because it attaches the key itself in openRouterClient.ts.
 *
 * This gateway claims the id before the registry fallback and hands back a real OpenRouter
 * language model built with the key from the environment. The key is never logged and never
 * returned: /health names the layer, not the credential.
 *
 * The model id decides the provider, exactly as the app's own AI path does
 * (server/services/ai/modelProvider.ts):
 *
 *   gpt-* / o1* / o3* / o4* / chatgpt-*  -> OpenAI   (OPENAI_API_KEY, api.openai.com)
 *   vendor/model (e.g. meta-llama/…)     -> OpenRouter (OPENROUTER_API_KEY, openrouter.ai)
 *
 * Building every id through OpenRouter was the bug behind the copilot's "API key expired" error:
 * MASTRA_MODEL_ID=gpt-4o-mini went to openrouter.ai carrying OPENAI_API_KEY, which OpenRouter
 * rejects (401 "this is not an OpenRouter API key"). The agent now asks api.openai.com instead.
 */
import { MastraModelGateway } from "@mastra/core/llm";
import type { GatewayLanguageModel, ProviderConfig } from "@mastra/core/llm";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { readOpenRouterApiKey } from "../env";
import { apiKeyFor, providerForModel } from "../services/ai/modelProvider";
import { DEFAULT_MASTRA_MODEL_ID } from "./model";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export type AgentModelProvider = "openai" | "openrouter";

/** The provider the configured model id belongs to (server/services/ai/modelProvider.ts). */
export function agentProviderFor(modelId: string): AgentModelProvider {
  return providerForModel(modelId);
}

/** The key for that provider, or undefined. One pasted key still works for the other provider. */
export function agentApiKey(env: NodeJS.ProcessEnv, modelId: string): string | undefined {
  return apiKeyFor(agentProviderFor(modelId), env);
}

export const OPENROUTER_GATEWAY_ID = "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** The provider configuration this gateway advertises, in the same shape the registry uses. */
export function openRouterProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const modelId = (env.MASTRA_MODEL_ID ?? DEFAULT_MASTRA_MODEL_ID).trim();
  // Strip the router prefix if the operator wrote the full id: the gateway sees bare model ids.
  const bare = modelId.startsWith(`${OPENROUTER_GATEWAY_ID}/`)
    ? modelId.slice(OPENROUTER_GATEWAY_ID.length + 1)
    : modelId;

  return {
    url: OPENROUTER_BASE_URL,
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    name: "OpenRouter",
    // Only the configured model is advertised: this gateway is for one agent, not a catalog.
    models: [bare],
    gateway: OPENROUTER_GATEWAY_ID,
  };
}

/**
 * The model the copilot and the standalone service talk to. Built here with the key from the
 * environment, so the agent never depends on Mastra's router attaching the key at call time.
 */
export function openRouterModel(env: NodeJS.ProcessEnv, modelId: string): unknown {
  const bare = modelId.startsWith(`${OPENROUTER_GATEWAY_ID}/`)
    ? modelId.slice(OPENROUTER_GATEWAY_ID.length + 1)
    : modelId;
  const apiKey = readOpenRouterApiKey(env);
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return createOpenRouter({ apiKey }).chat(bare);
}

/**
 * The model the agent is built with, whichever provider the id names. This is what
 * createTicketFlowAgentService hands to the agent: with MASTRA_MODEL_ID=gpt-4o-mini it is an OpenAI
 * model on api.openai.com, never an OpenRouter call carrying the OpenAI key.
 */
export function agentModel(env: NodeJS.ProcessEnv, modelId: string): unknown {
  const provider = agentProviderFor(modelId);
  const apiKey = agentApiKey(env, modelId);
  if (!apiKey) {
    throw new Error(
      provider === "openai"
        ? `model ${modelId} is served by OpenAI, but OPENAI_API_KEY is not set`
        : `model ${modelId} is served by OpenRouter, but OPENROUTER_API_KEY is not set`,
    );
  }
  if (provider === "openai") {
    // A bare id: createOpenAI's `chat` never prefixes, and gpt-4o-mini is not an "openrouter/..." id.
    return createOpenAI({ apiKey, baseURL: OPENAI_BASE_URL }).chat(modelId);
  }
  const bare = modelId.startsWith(`${OPENROUTER_GATEWAY_ID}/`)
    ? modelId.slice(OPENROUTER_GATEWAY_ID.length + 1)
    : modelId;
  return createOpenRouter({ apiKey }).chat(bare);
}
export class OpenRouterGateway extends MastraModelGateway {
  readonly id = OPENROUTER_GATEWAY_ID;
  readonly name = "OpenRouter";

  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    super();
    this.env = env;
  }

  /** Enabled only when there is a key to send, so a keyless deployment fails loudly at call time. */
  shouldEnable(): boolean {
    return readOpenRouterApiKey(this.env) !== undefined;
  }

  /** Claims the "openrouter/..." prefix before the models.dev registry fallback is consulted. */
  handlesModel(modelId: string): boolean {
    return modelId.toLowerCase().startsWith(`${OPENROUTER_GATEWAY_ID}/`);
  }

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return { [OPENROUTER_GATEWAY_ID]: openRouterProviderConfig(this.env) };
  }

  buildUrl(): string {
    return OPENROUTER_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    // OpenRouter keys only. Handing it OPENAI_API_KEY as a fallback is what sent sk-proj-… to
    // openrouter.ai, which answers 401 "API key expired" and is what the copilot used to report.
    return readOpenRouterApiKey(this.env) ?? "";
  }

  resolveLanguageModel({ modelId, apiKey }: { modelId: string; apiKey: string }): GatewayLanguageModel {
    const openrouter = createOpenRouter({ apiKey });
    return openrouter.chat(modelId) as unknown as GatewayLanguageModel;
  }
}
