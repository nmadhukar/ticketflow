import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { AssistantAgentId } from "./AssistantShell";

/**
 * The chat itself, loaded on demand by AssistantShell. The browser talks only to this app's
 * /api/copilotkit with its session cookie; the server picks the agent from the user's role and
 * refuses any other, so `agentId` here only has to match it. CopilotKit's stylesheet arrives with
 * this chunk (see copilotKitStyles in vite.config.ts).
 *
 * Minimal for now: the full panel (confirmation cards, history, error handling) comes later.
 */
const INTRO: Record<AssistantAgentId, string> = {
  "support-assistant": "Ask about your tickets, or describe a problem and I'll look for an answer.",
  "ticket-assistant": "Ask about a ticket, the queue, or a fix. I can read and draft, but I don't post anything.",
};

export default function AssistantPanel({ agentId }: { agentId: AssistantAgentId }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint={false} credentials="include" showDevConsole={false}>
      <CopilotChat agentId={agentId} labels={{ chatInputPlaceholder: "Ask the assistant…", welcomeMessageText: INTRO[agentId] }} />
    </CopilotKitProvider>
  );
}
