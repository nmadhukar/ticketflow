/**
 * Entry point for the standalone Mastra agent service: npm run mastra:dev
 *
 * It is deliberately separate from server/index.ts, which keeps the TicketFlow app's import
 * graph free of Mastra. With MASTRA_AGENT_ENABLED unset this exits with one line and starts
 * nothing, so an operator cannot half-enable it.
 */
import "dotenv/config";
import { describeError } from "../http/errors";

async function main(): Promise<void> {
  const { createTicketFlowAgentService } = await import("./index");
  const { createAgentApp } = await import("./serve");
  const { missingModelCredential } = await import("./config");

  const service = await createTicketFlowAgentService();
  if (!service) {
    console.log(
      "Mastra agent service is off: set MASTRA_AGENT_ENABLED=true and TICKETFLOW_MCP_KEY in .env to start it.",
    );
    return;
  }

  // Refuse to start a hosted model that has no key: every request would fail with a 401 that
  // the operator only sees later as a 502 from /agent. One line here saves that hunt.
  //
  // The remedy is in .env because that is the file this entry point loads ("dotenv/config" at
  // the top). A shell variable would be blanked by dotenv when .env leaves the line empty, so
  // naming it would send the operator to a setting that is already being ignored.
  const credentialProblem = missingModelCredential(process.env, service.config.modelId);
  if (credentialProblem) {
    console.error(`Mastra agent service cannot start: ${credentialProblem}`);
    await service.disconnect().catch(() => undefined);
    process.exit(1);
  }

  const app = createAgentApp(service);
  const server = app.listen(service.config.port, () => {
    console.log(`Mastra agent service on http://localhost:${service.config.port} (${service.toolNames.length} MCP tools)`);
  });

  // A port already in use is an operator mistake, not a crash: one line naming the port and the
  // fix, then exit. Without this the listen error is an unhandled 'error' event that dumps a
  // stack trace and hides which port was wanted.
  server.on("error", (error: NodeJS.ErrnoException) => {
    const line = error.code === "EADDRINUSE"
      ? `Mastra agent service cannot start: port ${service.config.port} is already in use. Stop the process holding it, or set MASTRA_AGENT_PORT to a free port.`
      : `Mastra agent service listen failed [${describeError(error)}]`;
    console.error(line);
    void service.disconnect().catch(() => undefined);
    process.exit(1);
  });

  const shutdown = async () => {
    server.close();
    await service.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void main().catch((error) => {
  console.error(`Mastra agent service failed to start [${describeError(error)}]`);
  process.exit(1);
});
