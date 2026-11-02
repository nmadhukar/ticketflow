// Before anything that opens storage or builds agents: a bad configuration must stop the service
// with its own reason. Imported by name, and read below, so the production bundle cannot drop it.
import { startupConfigChecked } from './startup-check.ts';
import { Mastra } from '@mastra/core';
import { supportAssistant } from './agents/support-assistant.ts';
import { ticketAssistant } from './agents/ticket-assistant.ts';
import { startRetentionSweep } from './retention.ts';
import { createServerConfig } from './server-config.ts';
import { staffMemory, storage } from './storage.ts';

if (startupConfigChecked !== true) throw new Error('[ticketflow-agents] Agents configuration was not checked.');

// Registered under their ids, which are also what the auth route allowlist and the app use.
export const mastra = new Mastra({
  agents: { 'support-assistant': supportAssistant, 'ticket-assistant': ticketAssistant },
  // PostgreSQL (the `mastra` schema) when staff history is on; otherwise Mastra keeps its
  // working state in memory and nothing is saved.
  ...(storage ? { storage } : {}),
  server: createServerConfig(),
});

if (staffMemory) startRetentionSweep(staffMemory);
