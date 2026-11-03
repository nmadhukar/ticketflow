import { useCallback, useState } from "react";
import { CopilotChat, CopilotKitProvider, ToolCallStatus } from "@copilotkit/react-core/v2";
import type { AssistantAgentId } from "./AssistantShell";
import { AssistantErrorBanner } from "./AssistantErrorBanner";
import { describeAssistantError, type AssistantErrorView } from "./assistantErrors";
import { parseProposal, ProposalCard } from "./ProposalCard";

/**
 * The chat itself, loaded on demand by AssistantShell. The browser talks only to this app's
 * /api/copilotkit with its session cookie; the server picks the agent from the user's role and
 * refuses any other, so `agentId` here only has to match it. CopilotKit's stylesheet arrives with
 * this chunk (see copilotKitStyles in vite.config.ts).
 *
 * A proposed ticket or comment is shown as a card the user confirms (ProposalCard); nothing is
 * written until they do. A problem (session ended, spending limit, provider failure) shows as one
 * readable line above the conversation, until dismissed or the next message is sent. The model's
 * reasoning is never sent to the browser (runTracking.ts withoutReasoning).
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
  const [problem, setProblem] = useState<AssistantErrorView | null>(null);
  const onError = useCallback((event: { error: unknown; code: unknown }) => {
    const view = describeAssistantError(event);
    if (view) setProblem(view);
  }, []);
  // Sending a message (Enter, or the send button's form submit) clears an old problem.
  const clearOnSend = () => setProblem(null);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      credentials="include"
      showDevConsole={false}
      renderToolCalls={renderToolCalls}
      onError={onError}
    >
      <div className="flex h-full flex-col">
        {problem && <AssistantErrorBanner problem={problem} onDismiss={() => setProblem(null)} />}
        <div
          className="min-h-0 flex-1"
          onSubmitCapture={clearOnSend}
          onKeyDownCapture={(e) => {
            if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLTextAreaElement) clearOnSend();
          }}
        >
          <CopilotChat agentId={agentId} labels={{ chatInputPlaceholder: "Ask the assistant…", welcomeMessageText: INTRO[agentId] }} />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
