import { jest } from "@jest/globals";
import {
  CUSTOMER_INSTRUCTIONS,
  TICKET_AGENT_INSTRUCTIONS,
  createTicketAgent,
  instructionsFor,
} from "../../mastra/agents/ticket-agent";
import { activeActorId, endRun } from "../../mcp/actAs";

/**
 * The agent a customer's copilot talks to.
 *
 * Two things broke the copilot for a customer before this file existed: the hosted Llama reached
 * OpenRouter with no key (AI_APICallError "Missing Authentication header"), and the agent's tool
 * calls did not carry the signed-in person, so a ticket they raised belonged to the API key's
 * owner. The model wiring is pinned in mastraGateway.test.ts; this file pins the instructions and
 * the per-run identity, with a stub agent class so no Mastra package is loaded.
 */
jest.mock("@mastra/core/agent", () => ({
  Agent: class {
    id!: string;
    name?: string;
    instructions?: string;
    model?: unknown;
    tools?: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config);
    }
    /** Runs every tool once, standing in for a model turn that calls them. */
    async generate() {
      for (const tool of Object.values(this.tools ?? {}) as Array<{ execute: () => Promise<unknown> }>) {
        await tool.execute();
      }
      return { text: "ok" };
    }
    stream() {
      return { fullStream: (async function* () { yield { type: "start" }; })() };
    }
  },
}));

type StubAgent = {
  instructions: string;
  tools: Record<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
};

const tools = () => ({
  ticketflow_create_ticket: {
    execute: async () => {
      // Read inside execute: that is where the MCP fetch happens.
      return { actorDuringTool: activeActorId() };
    },
  },
});

const drain = async (agent: { stream: (...a: unknown[]) => unknown }) => {
  const result = agent.stream("hello") as { fullStream: AsyncIterable<unknown> };
  for await (const chunk of result.fullStream) void chunk;
};

describe("the ticket agent", () => {
  afterEach(() => endRun());

  it("speaks to a customer differently from staff", () => {
    expect(instructionsFor("customer")).toBe(CUSTOMER_INSTRUCTIONS);
    expect(instructionsFor("agent")).toBe(TICKET_AGENT_INSTRUCTIONS);
    expect(instructionsFor(undefined)).toBe(TICKET_AGENT_INSTRUCTIONS);
  });

  it("tells the customer's agent to create the ticket in the same turn once it has the problem", () => {
    expect(CUSTOMER_INSTRUCTIONS).toContain("create_ticket");
    expect(CUSTOMER_INSTRUCTIONS.toLowerCase()).toContain("same turn");
    // The owning team is a suggestion the routing step confirms, never a promise.
    expect(CUSTOMER_INSTRUCTIONS).toContain("list_routing_options");
    expect(CUSTOMER_INSTRUCTIONS).toContain("routeId");
  });

  it("runs every tool call as the signed-in person, and only for that run", async () => {
    const agent = createTicketAgent(tools(), { stub: true }, "customer", { id: "customer-1" }) as unknown as StubAgent;

    const during = await agent.tools.ticketflow_create_ticket.execute();
    expect(during).toEqual({ actorDuringTool: "customer-1" });
    // The tool's own run is closed when its execute returns.
    expect(activeActorId()).toBeNull();

    // The whole stream holds the run open, because Mastra runs tools while it is consumed.
    const result = (agent as unknown as { stream: () => { fullStream: AsyncIterable<unknown> } }).stream();
    for await (const _chunk of result.fullStream) expect(activeActorId()).toBe("customer-1");
    expect(activeActorId()).toBeNull();
  });

  it("opens the run around generate() too (the standalone, non-streaming path)", async () => {
    const agent = createTicketAgent(tools(), { stub: true }, "customer", { id: "customer-1" }) as unknown as {
      generate: () => Promise<unknown>;
    };
    let seenDuringGenerate: string | null = "unset";
    const stubTool = (agent as unknown as StubAgent).tools.ticketflow_create_ticket;
    (agent as unknown as StubAgent).tools.ticketflow_create_ticket = {
      execute: async (...args: unknown[]) => {
        seenDuringGenerate = activeActorId();
        return stubTool.execute(...args);
      },
    };
    await agent.generate();
    expect(seenDuringGenerate).toBe("customer-1");
    expect(activeActorId()).toBeNull();
  });

  it("leaves the shared tool catalog untouched, and a staff agent opens no run", async () => {
    const catalog = tools();
    const original = catalog.ticketflow_create_ticket.execute;
    const agent = createTicketAgent(catalog, { stub: true }) as unknown as StubAgent;
    expect(agent.tools.ticketflow_create_ticket.execute).toBe(original);
    await expect(agent.tools.ticketflow_create_ticket.execute()).resolves.toEqual({ actorDuringTool: null });
  });

  it("drains a stream so the helper above is exercised (keeps the mock honest)", async () => {
    const agent = createTicketAgent(tools(), { stub: true }, "customer", { id: "customer-1" });
    await expect(drain(agent as unknown as { stream: (...a: unknown[]) => unknown })).resolves.toBeUndefined();
  });
});
