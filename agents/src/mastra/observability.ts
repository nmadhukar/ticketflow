/**
 * Traces, logs and metrics for Studio's Observability pages.
 *
 * Every run becomes a trace: the agent, each tool call, the model call, tokens, cost and
 * duration. Without this, those pages stay empty because nothing records a run.
 *
 * `SensitiveDataFilter` matters here: a trace holds tool inputs and outputs, and for this app that
 * means ticket text, comments and customer names. The filter masks the fields below before a span
 * is stored, so Studio never shows that data to anyone with the port.
 */
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';

export const observability = new Observability({
  configs: {
    default: {
      serviceName: 'ticketflow-agents',
      // Storage is the only exporter: MastraStorageExporter writes spans and log lines into the
      // `mastra` schema, which is what Studio's Traces and Logs pages read.
      exporters: [new MastraStorageExporter()],
      // Ticket text, comments and customer names are in tool inputs and outputs. Masked before
      // anything is stored, so Studio never shows them to whoever has the port.
      spanOutputProcessors: [new SensitiveDataFilter()],
      // Store log lines next to the trace they belong to (Studio's Logs page filters by trace).
      logging: { enabled: true },
    },
  },
});
