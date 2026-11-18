/**
 * Which provider answers a model call, and with which key.
 *
 * Why this file exists: every AI call used to go to OpenRouter with OPENROUTER_API_KEY, while the
 * deployment only had an OpenAI key (stored, by mistake, under OPENAI_API_KEY because the comment in
 * .env said "OpenRouter"). AI generation then looked disabled, or failed with a 401 that the create
 * path swallows by design, so a new ticket got no reply and no confidence at all.
 *
 * One rule: the model id decides the provider.
 *
 *   gpt-* / o1* / o3* / o4* / chatgpt-*   -> OpenAI   (OPENAI_API_KEY, api.openai.com)
 *   anything else (vendor/model, e.g.     -> OpenRouter (OPENROUTER_API_KEY, openrouter.ai)
 *   deepseek/deepseek-v4-pro, meta-llama/…)
 *
 * The key falls back to the other variable when the provider's own is unset: a single key pasted
 * into either variable still works, which is exactly the state this deployment was in.
 */

export type ModelProvider = "openai" | "openrouter";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenAI model families served on api.openai.com (no vendor prefix). */
const OPENAI_MODEL = /^(gpt-|chatgpt-|o[1-9]([-.]|$)|text-embedding-|davinci|babbage)/i;

/** The provider a model id belongs to. A vendor-prefixed id is always OpenRouter. */
export function providerForModel(modelId: string | undefined | null): ModelProvider {
  const id = (modelId ?? "").trim();
  if (!id) return "openrouter";
  // A slash means a vendor route ("deepseek/…", "meta-llama/…"), which OpenAI's own ids never use
  // except for fine-tunes ("ft:gpt-4o-mini:org::id"), which carry a colon instead.
  if (!id.includes("/") && OPENAI_MODEL.test(id)) return "openai";
  return "openrouter";
}

/**
 * The key for a provider, or undefined. The provider's own variable wins; the other one is used
 * when it is the only key set, so one pasted key never leaves AI silently off.
 */
export function apiKeyFor(provider: ModelProvider, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const own = provider === "openai" ? env.OPENAI_API_KEY : env.OPENROUTER_API_KEY;
  const other = provider === "openai" ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
  return own?.trim() || other?.trim() || undefined;
}

/** True when some key would answer a call to this model. Never returns the key itself. */
export function isProviderConfigured(
  modelId: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return apiKeyFor(providerForModel(modelId), env) !== undefined;
}

/** The chat-completions URL and headers for a provider. */
export function providerRequest(
  provider: ModelProvider,
  apiKey: string
): { url: string; headers: Record<string, string> } {
  return {
    url: `${provider === "openai" ? OPENAI_BASE_URL : OPENROUTER_BASE_URL}/chat/completions`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
}
