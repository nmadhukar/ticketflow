/**
 * The plain-HTTP face of the agent service, on its own port.
 *
 * It is a separate Express app, not a route mounted on the TicketFlow app: the main app's
 * middleware order (security headers, session, rate limits, the catch-all Vite handler) is
 * sensitive, and an agent service must not be able to disturb it. The two processes share
 * nothing but the MCP endpoint.
 */
import express, { type Express } from "express";
import type { TicketFlowAgentService } from "./index";
import { describeError } from "../http/errors";
import { isLlamaModel, isLocalModel } from "./model";

interface AssistBody {
  message?: string;
}

/**
 * The MCP calls the agent made, in a shape a demo can print. Only the name and arguments are
 * surfaced: the payload is a provider object and is not part of this service's contract.
 */
function summarizeToolCalls(calls: unknown): Array<{ name: string; args: unknown }> {
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    const payload = (call as { payload?: { toolName?: unknown; args?: unknown } }).payload;
    return typeof payload?.toolName === "string"
      ? [{ name: payload.toolName, args: payload.args }]
      : [];
  });
}

export function createAgentApp(service: TicketFlowAgentService): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      // The layers of the agent path, named as the architecture draws them.
      agent: "mastra",
      model: {
        id: service.config.modelId,
        isLlama: isLlamaModel(service.config.modelId),
        // Local means the request never leaves this machine; hosted means it goes to OpenRouter.
        runsLocally: isLocalModel(service.config.modelId),
      },
      mcp: { url: service.config.mcpUrl, tools: service.toolNames.length },
    });
  });

  /** The tool list, so a demo can prove the agent sees the same tools the harness does. */
  app.get("/tools", (_req, res) => {
    res.json({ tools: service.toolNames });
  });

  /**
   * Ask the agent about one ticket. `prompt` is the operator's instruction; the agent decides
   * which MCP tools to call. The default prompt is read-and-draft only, which is the safe
   * shape for a demo.
   */
  app.post("/agent/tickets/:id/assist", async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid_ticket_id" });
    }

    const body = (req.body ?? {}) as AssistBody;
    const prompt = body.message?.trim()
      || `Read ticket ${id} with its comments, search the knowledge base for its problem, and tell me whether a known fix exists. If it does, draft the reply. If it does not, name the team that should own it.`;

    try {
      const agent = service.mastra.getAgent("ticketAgent");
      const result = await agent.generate(prompt);
      return res.json({
        ticketId: id,
        model: service.config.modelId,
        text: result.text,
        toolCalls: summarizeToolCalls(result.toolCalls),
      });
    } catch (error) {
      console.error(`Mastra agent call failed [${describeError(error)}]`);
      return res.status(502).json({ error: "agent_failed", message: describeError(error) });
    }
  });

  return app;
}
