import { CopilotChat, CopilotKitProvider, ToolCallStatus } from "@copilotkit/react-core/v2";
import type { AssistantAgentId } from "./AssistantShell";
import { parseProposal, ProposalCard } from "./ProposalCard";

/**
 * The chat itself, loaded on demand by AssistantShell. The browser talks only to this app's
 * /api/copilotkit with its session cookie; the server picks the agent from the user's role and
 * refuses any other, so `agentId` here only has to match it. CopilotKit's stylesheet arrives with
 * this chunk (see copilotKitStyles in vite.config.ts).
 *
 * A proposed ticket or comment is shown as a card the user confirms (ProposalCard); nothing is
 * written until they do. The full panel (history, error handling) comes later.
 */
const INTRO: Record<AssistantAgentId, string> = {
  "support-assistant": "Ask about your tickets, or describe a problem and I'll look for an answer or prepare a ticket for you.",
  "ticket-assistant": "Ask about a ticket, the queue, or a fix. I can draft comments for you to confirm; I never post on my own.",
};

type ToolRender = { status: ToolCallStatus; result?: string };

function ProposalRender({ status, result }: ToolRender) {
  if (status !== ToolCallStatus.Complete) return <p className="my-2 text-sm text-muted-foreground">Preparing a draft…</p>;
  const proposal = parseProposal(result);
  // A refused proposal (no access, invalid input) has no card; the assistant explains it.
  return proposal ? <ProposalCard proposal={proposal} /> : null;
}

const renderToolCalls = ["ticketflow_propose_ticket", "ticketflow_propose_comment"].map((name) => ({
  name,
  render: ProposalRender as never,
}));

export default function AssistantPanel({ agentId }: { agentId: AssistantAgentId }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      credentials="include"
      showDevConsole={false}
      renderToolCalls={renderToolCalls}
    >
      <CopilotChat agentId={agentId} labels={{ chatInputPlaceholder: "Ask the assistant…", welcomeMessageText: INTRO[agentId] }} />
    </CopilotKitProvider>
  );
}
