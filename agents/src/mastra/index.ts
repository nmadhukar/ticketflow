// Before anything that opens storage or builds agents: a bad configuration must stop the service
// with its own reason. Imported by name, and read below, so the production bundle cannot drop it.
import { startupConfigChecked } from './startup-check.ts';
import { Mastra } from '@mastra/core';
import { supportAssistant } from './agents/support-assistant.ts';
import { ticketAssistant } from './agents/ticket-assistant.ts';
import { startRetentionSweep } from './retention.ts';
import { createServerConfig } from './server-config.ts';
import { retentionStore, storage } from './storage.ts';

if (startupConfigChecked !== true) throw new Error('[ticketflow-agents] Agents configuration was not checked.');

// Registered under their ids, which are also what the auth route allowlist and the app use.
export const mastra = new Mastra({
  agents: { 'support-assistant': supportAssistant, 'ticket-assistant': ticketAssistant },
  // PostgreSQL (the `mastra` schema) only while staff history is on; otherwise Mastra keeps its
  // working state in memory and nothing is saved.
  ...(storage ? { storage } : {}),
  server: createServerConfig(),
});

// Whenever saved conversations may exist, including after staff history was switched off: the
// 30-day deletion must not depend on the feature still being on. A store not given to Mastra is
// initialised here (Mastra initialises its own).
if (retentionStore) {
  const { memory, store } = retentionStore;
  const ready = storage ? Promise.resolve() : store.init();
  ready
    .then(() => startRetentionSweep(memory))
    .catch((error) => console.warn(`[ticketflow-agents] conversation retention could not start [${error instanceof Error ? error.name : 'error'}]`));
}
