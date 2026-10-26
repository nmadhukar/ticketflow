/**
 * The model behind the Mastra agent - the "Llama Model" box in the architecture.
 *
 * It is deliberately separate from the TicketFlow model (server/services/ai/openRouterClient.ts,
 * the DeepSeek id used by auto-response and routing). The two are different jobs: TicketFlow's
 * create-time pipeline answers customers, while this agent orchestrates tools on staff's behalf.
 * Keeping the ids apart means switching one never silently changes the other, and the agent can
 * be pointed at a Llama without touching the app's behaviour.
 *
 * Two ways to run a Llama, and the id says which one is wanted:
 *
 *   openrouter/meta-llama/llama-3.3-70b-instruct
 *       A hosted Llama through OpenRouter. Nothing to install, needs OPENROUTER_API_KEY.
 *
 *   lmstudio/<model-loaded-in-lm-studio>
 *       A Llama running inside LM Studio on this machine. Nothing leaves the laptop and there is
 *       no per-token cost, but the model must fit the hardware. On a 16GB laptop with no NVIDIA
 *       GPU, an 8B model at Q4 is the realistic ceiling; a 70B model will not run.
 *
 * MASTRA_MODEL_ID chooses between them and nothing else in the code changes.
 */
export const DEFAULT_MASTRA_MODEL_ID = "meta-llama/llama-3.3-70b-instruct";

/**
 * Known-good Llama ids on OpenRouter, offered for the operator's reference. Any
 * "provider/model" id OpenRouter serves is accepted through MASTRA_MODEL_ID; this list is
 * documentation, not a constraint.
 */
export const SUGGESTED_LLAMA_MODEL_IDS = [
  "meta-llama/llama-3.3-70b-instruct",
  "meta-llama/llama-3.1-70b-instruct",
  "meta-llama/llama-3.1-8b-instruct",
  "meta-llama/llama-4-maverick",
  "meta-llama/llama-4-scout",
] as const;

/** True when the id names a model running locally through LM Studio rather than a hosted provider. */
export function isLocalModel(modelRouterId: string): boolean {
  return modelRouterId.toLowerCase().startsWith("lmstudio/")
    || modelRouterId.toLowerCase().startsWith("ollama/");
}

/** True when the configured id names a Llama model, so /health can report the layer honestly. */
export function isLlamaModel(modelRouterId: string): boolean {
  return modelRouterId.toLowerCase().includes("llama");
}
