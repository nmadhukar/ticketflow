import { readFileSync } from "node:fs";
import path from "node:path";
import { readMastraAgentConfig, missingModelCredential } from "../../mastra/config";
import {
  OpenRouterGateway,
  OPENROUTER_GATEWAY_ID,
  openRouterProviderConfig,
} from "../../mastra/gateway";

/**
 * The hosted Llama's authentication, pinned.
 *
 * Defect this guards: with a valid OPENROUTER_API_KEY the agent still reached OpenRouter with
 * no Authorization header and every call failed 401 "Missing Authentication header" (seen live
 * as a 502 from /agent). Two things must stay true for that not to come back:
 *
 *   1. A gateway claims the "openrouter/..." id, because the built-in models.dev registry entry
 *      has no `gateway` field and therefore never supplies the key.
 *   2. A hosted model with no key is refused at startup instead of at call time.
 */
const BASE_ENV = {
  MASTRA_AGENT_ENABLED: "true",
  TICKETFLOW_MCP_KEY: "tfk_test_key_value_for_wiring_check",
  MASTRA_MODEL_ID: "meta-llama/llama-3.3-70b-instruct",
  OPENROUTER_API_KEY: "sk-or-v1-test-key",
} as NodeJS.ProcessEnv;

describe("OpenRouter gateway for the Mastra agent", () => {
  it("claims the openrouter prefix the agent's model id uses", () => {
    const gateway = new OpenRouterGateway(BASE_ENV);
    expect(gateway.id).toBe(OPENROUTER_GATEWAY_ID);
    expect(gateway.handlesModel("openrouter/meta-llama/llama-3.3-70b-instruct")).toBe(true);
    // It must not swallow another provider's id.
    expect(gateway.handlesModel("lmstudio/llama-3.1-8b-instruct")).toBe(false);
  });

  it("supplies the key from the environment and nothing when it is absent", async () => {
    await expect(new OpenRouterGateway(BASE_ENV).getApiKey()).resolves.toBe("sk-or-v1-test-key");
    // A keyless deployment gets an empty string here; run.ts refuses to start before this matters.
    await expect(new OpenRouterGateway({} as NodeJS.ProcessEnv).getApiKey()).resolves.toBe("");
  });

  it("is enabled only when there is a key to send", () => {
    expect(new OpenRouterGateway(BASE_ENV).shouldEnable()).toBe(true);
    expect(new OpenRouterGateway({} as NodeJS.ProcessEnv).shouldEnable()).toBe(false);
  });

  it("advertises the configured model without the router prefix, at the OpenRouter URL", async () => {
    const providers = await new OpenRouterGateway(BASE_ENV).fetchProviders();
    expect(providers[OPENROUTER_GATEWAY_ID]).toMatchObject({
      url: "https://openrouter.ai/api/v1",
      apiKeyEnvVar: "OPENROUTER_API_KEY",
      models: ["meta-llama/llama-3.3-70b-instruct"],
    });
  });

  it("strips the prefix from a fully-qualified MASTRA_MODEL_ID", () => {
    const config = openRouterProviderConfig({
      MASTRA_MODEL_ID: "openrouter/meta-llama/llama-3.3-70b-instruct",
    } as NodeJS.ProcessEnv);
    expect(config.models).toEqual(["meta-llama/llama-3.3-70b-instruct"]);
  });
});

describe("missingModelCredential", () => {
  it("reports a hosted model with no key", () => {
    const config = readMastraAgentConfig({ ...BASE_ENV, OPENROUTER_API_KEY: undefined })!;
    const problem = missingModelCredential({} as NodeJS.ProcessEnv, config.modelId);
    expect(problem).toContain("OPENROUTER_API_KEY");
  });

  it("is satisfied when the key is present", () => {
    const config = readMastraAgentConfig(BASE_ENV)!;
    expect(missingModelCredential(BASE_ENV, config.modelId)).toBeNull();
  });

  it("does not ask a local model for an OpenRouter key", () => {
    const config = readMastraAgentConfig({ ...BASE_ENV, MASTRA_MODEL_ID: "lmstudio/llama-3.1-8b-instruct" })!;
    expect(missingModelCredential({} as NodeJS.ProcessEnv, config.modelId)).toBeNull();
  });
});

describe("the Mastra instance registers the gateway", () => {
  it("passes the gateway to new Mastra()", () => {
    // Structural check: the service must hand the gateway to Mastra, or the 401 returns.
    const source = readFileSync(path.join(__dirname, "../../mastra/index.ts"), "utf8");
    expect(source).toContain("gateways:");
    expect(source).toContain("new OpenRouterGateway(");
  });
});
