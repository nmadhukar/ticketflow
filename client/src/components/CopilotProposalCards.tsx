/**
 * One-click cards inside the Ask AI (CopilotKit) copilot chat.
 *
 * The copilot's tools are the read-only customer set plus the proposal tools (propose_ticket,
 * propose_comment, propose_close_ticket). A proposal writes nothing by itself: it returns a pending
 * proposal, and this card is the user's decision on it - Confirm (create / post / close) or Discard.
 * The Confirm request goes to the same server route the older assistant panel used, which re-checks
 * access and runs the write as the signed-in user through the normal ticket service.
 *
 * Rendering here, in the copilot's own chat, is what makes the proposals usable: without a card the
 * customer saw "shall I raise a ticket?" with nothing to click.
 */
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { ProposalCard, parseProposal } from "./assistant/ProposalCard";

/** A tool call whose status the copilot reports for it. */
interface ToolRender {
  status: ToolCallStatus;
  result?: string;
}

export function ProposalRender({ status, result }: ToolRender) {
  if (status !== ToolCallStatus.Complete) return <p className="my-2 text-sm text-muted-foreground">Preparing a draft…</p>;
  const proposal = parseProposal(result);
  // A refused proposal (no access, invalid input, already closed) has no card; the assistant explains it.
  if (proposal) return <ProposalCard proposal={proposal} />;
  return (
    <p className="my-2 text-sm text-muted-foreground">Nothing was prepared (the draft was refused or could not be read). Nothing was written.</p>
  );
}

/** The tool names the copilot's MCP client namespaces; all three render the same decision card. */
export const copilotToolRenderers = ["propose_ticket", "propose_comment", "propose_close_ticket"].map((name) => ({
  name: `ticketflow_${name}`,
  render: ProposalRender as never,
}));
