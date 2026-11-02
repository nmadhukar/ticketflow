import { agentsConfigProblems } from './config-issues.ts';

/**
 * Refuse to start rather than refuse every chat. index.ts imports this first, so it runs before
 * storage or agents are set up and the reason given is the configuration, not a symptom of it.
 * Names settings only; values are never printed.
 */
function assertAgentsConfig(): true {
  const problems = agentsConfigProblems();
  if (problems.length > 0) {
    throw new Error(`[ticketflow-agents] Invalid agents configuration: ${problems.join(' ')}`);
  }
  return true;
}

/**
 * Exported and read by index.ts: `mastra build` drops a module imported only for its side
 * effects, which silently removed this check from Workforce Nexus' production bundle.
 */
export const startupConfigChecked = assertAgentsConfig();
