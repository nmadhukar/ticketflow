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
 */
import { MastraModelGateway } from "@mastra/core/llm";
import type { GatewayLanguageModel, ProviderConfig } from "@mastra/core/llm";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { readOpenRouterApiKey } from "../env";
import { DEFAULT_MASTRA_MODEL_ID } from "./model";

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
    return readOpenRouterApiKey(this.env) ?? "";
  }

  resolveLanguageModel({ modelId, apiKey }: { modelId: string; apiKey: string }): GatewayLanguageModel {
    const openrouter = createOpenRouter({ apiKey });
    return openrouter.chat(modelId) as unknown as GatewayLanguageModel;
  }
}
