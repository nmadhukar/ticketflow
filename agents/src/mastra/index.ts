// Before anything that opens storage or builds agents: a bad configuration must stop the service
// with its own reason. Imported by name, and read below, so the production bundle cannot drop it.
import { startupConfigChecked } from './startup-check.ts';
import { Mastra } from '@mastra/core';
import { ConsoleLogger } from '@mastra/core/logger';
import { supportAssistant } from './agents/support-assistant.ts';
import { ticketAssistant } from './agents/ticket-assistant.ts';
import { startRetentionSweep } from './retention.ts';
import { createServerConfig } from './server-config.ts';
import { retentionStore, storage } from './storage.ts';
import { staffHistoryEnabled } from './config.ts';
import { scorers } from './evaluation/scorers.ts';
import { attachDatasetScorers } from './evaluation/register-dataset-scorers.ts';
import { workspace } from './workspace.ts';
import { helpdeskWorkflow } from './workflows/helpdesk-workflow.ts';
import { observability } from './observability.ts';

if (startupConfigChecked !== true) throw new Error('[ticketflow-agents] Agents configuration was not checked.');

// Registered under their ids, which are also what the auth route allowlist and the app use.
export const mastra = new Mastra({
  agents: { 'support-assistant': supportAssistant, 'ticket-assistant': ticketAssistant },
  // Studio's Scorers and Experiments pages. Deterministic rules, no model call to grade.
  scorers,
  // Studio's MCP page lists the MCP servers given to the instance. This service exposes none of its
  // own: the TicketFlow endpoint its agents CALL is a client (mcp.ts), and each run carries its own
  // MCP-hop token, so there is no stored server for the page to show. The page reads this list from
  // Mastra, so it is left empty on purpose.
  mcpServers: {},
  // Studio's Workflows page: the helpdesk process, step by step.
  workflows: { 'helpdesk-resolution': helpdeskWorkflow },
  // Studio's Workspaces page: the skills and reference notes the agent works from.
  workspace,
  // Studio's Traces / Logs / Metrics pages. Stored in the same schema as datasets.
  observability,
  // ConsoleLogger, not PinoLogger: it is the one that attaches to Observability, so log lines
  // are stored next to the trace and appear on Studio's Logs page. PinoLogger writes to stdout
  // only, which leaves that page empty.
  logger: new ConsoleLogger({ name: 'ticketflow-agents', level: 'info' }),
  // PostgreSQL (the `mastra` schema) only while staff history is on; otherwise Mastra keeps its
  // working state in memory and nothing is saved.
  ...(storage ? { storage } : {}),
  server: createServerConfig(),
});

// An experiment started from Studio's Experiments page scores with the DATASET's attached scorers,
// not with the instance registry alone. Without this the runs were recorded with no scores at all.
// Deferred: the dataset may not exist yet (the first eval run creates it), and a failure must never
// stop the service.
void attachDatasetScorers(mastra.datasets)
  .then((id) => {
    if (id) console.log(`[ticketflow-agents] experiment scorers ready on dataset ${id}`);
  })
  .catch((error) =>
    console.warn(`[ticketflow-agents] experiment scorers not attached [${error instanceof Error ? error.name : 'error'}]`),
  );

// Whenever saved conversations may exist, including after staff history was switched off: the
// 30-day deletion must not depend on the feature still being on. A store not given to Mastra is
// initialised here (Mastra initialises its own).
//
// Only while staff history is on: with it off no conversation is ever saved, so there is nothing
// to delete, and the memory tables may not exist yet (the store is now created for datasets too).
if (retentionStore && staffHistoryEnabled()) {
  const { memory, store } = retentionStore;
  const ready = storage ? Promise.resolve() : store.init();
  ready
    .then(() => startRetentionSweep(memory))
    .catch((error) => console.warn(`[ticketflow-agents] conversation retention could not start [${error instanceof Error ? error.name : 'error'}]`));
}
