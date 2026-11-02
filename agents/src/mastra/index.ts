// Before anything that opens storage or builds agents: a bad configuration must stop the service
// with its own reason. Imported by name, and read below, so the production bundle cannot drop it.
import { startupConfigChecked } from './startup-check.ts';
import { Mastra } from '@mastra/core';
import { createServerConfig } from './server-config.ts';

if (startupConfigChecked !== true) throw new Error('[ticketflow-agents] Agents configuration was not checked.');

// The agents (support-assistant, ticket-assistant) are registered in a later stage; until then
// this service authenticates, reports readiness and serves no runs.
export const mastra = new Mastra({
  agents: {},
  server: createServerConfig(),
});
