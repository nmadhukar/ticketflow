import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The card for a write the assistant proposed (server/assistant/proposals.ts). Nothing has been
 * written when it appears: Confirm posts it, once, as the signed-in user; Discard drops it. The
 * user may edit the text first. The server re-checks access and validates again on Confirm.
 */
export interface ProposalView {
  proposalId: string;
  action: "create_ticket" | "add_comment" | "close_ticket";
  expiresAt: string;
  ticket?: { ticketNumber: string; title: string };
  draft: { title?: string; description?: string; category?: string; priority?: string; content?: string };
}

/** Finds the proposal in a tool result, however the MCP and agent layers wrapped it. */
export function parseProposal(result: unknown, depth = 0): ProposalView | null {
  if (depth > 8 || result == null) return null;
  if (typeof result === "string") {
    try {
      return parseProposal(JSON.parse(result), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const found = parseProposal(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  if (
    typeof obj.proposalId === "string" &&
    (obj.action === "create_ticket" || obj.action === "add_comment" || obj.action === "close_ticket")
  ) {
    return obj as unknown as ProposalView;
  }
  for (const key of ["structuredContent", "content", "text", "result"]) {
    const found = parseProposal(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

type Outcome =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; message: string }
  | { state: "error"; message: string };

async function decide(proposalId: string, decision: "confirm" | "reject", edits?: Record<string, string>) {
  const res = await fetch(`/api/assistant/proposals/${proposalId}/${decision}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(edits ? { edits } : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export function ProposalCard({ proposal }: { proposal: ProposalView }) {
  const isComment = proposal.action === "add_comment";
  const isClose = proposal.action === "close_ticket";
  const [text, setText] = useState(isComment ? proposal.draft.content ?? "" : proposal.draft.description ?? "");
  const [title, setTitle] = useState(proposal.draft.title ?? "");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const settled = outcome.state === "done";

  const run = async (decision: "confirm" | "reject") => {
    setOutcome({ state: "busy" });
    const edits: Record<string, string> | undefined =
      decision === "confirm" && !isClose ? (isComment ? { content: text } : { title, description: text }) : undefined;
    try {
      const { ok, status, body } = await decide(proposal.proposalId, decision, edits);
      if (ok) {
        const message =
          decision === "reject"
            ? isClose
              ? "Left open. Nothing was changed."
              : "Discarded. Nothing was posted."
            : isClose
              ? `${proposal.ticket?.ticketNumber ?? "The ticket"} is now closed.`
              : isComment
                ? `Comment posted on ${proposal.ticket?.ticketNumber ?? "the ticket"}.`
                : `Ticket ${body.ticketNumber} created.`;
        return setOutcome({ state: "done", message });
      }
      if (status === 409) return setOutcome({ state: "done", message: "This was already handled." });
      if (status === 410) return setOutcome({ state: "done", message: "This proposal has expired. Ask the assistant again." });
      if (status === 401) return setOutcome({ state: "error", message: "Your session has expired. Sign in again." });
      // 400: the text was refused and the proposal is still open, so it can be fixed and retried.
      // Anything else (no access any more, an error) closed it on the server: say so, no retry.
      if (status === 400 || status === 422) return setOutcome({ state: "error", message: body?.message ?? "Please check the text and try again." });
      setOutcome({ state: "done", message: body?.message ?? "That could not be done. Ask the assistant again if you still need it." });
    } catch {
      setOutcome({ state: "error", message: "Could not reach TicketFlow. Please try again." });
    }
  };

  return (
    <div className="my-2 rounded-lg border bg-card p-3 text-sm" data-testid="assistant-proposal">
      <p className="font-medium">
        {isClose
          ? `Is ${proposal.ticket?.ticketNumber ?? "your ticket"} sorted?`
          : isComment
            ? `Comment on ${proposal.ticket?.ticketNumber}: ${proposal.ticket?.title ?? ""}`
            : "New ticket"}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {isClose
          ? `${proposal.ticket?.title ?? "Your issue"} — close it if nothing is left to do.`
          : isComment
            ? "Visible to everyone on the ticket, the customer included."
            : `Category: ${proposal.draft.category ?? "-"} · Priority: ${proposal.draft.priority ?? "medium"}`}
      </p>
      {!isComment && !isClose && (
        <input
          aria-label="Ticket title"
          className="mb-2 w-full rounded-md border bg-background px-2 py-1"
          value={title}
          maxLength={255}
          disabled={settled || outcome.state === "busy"}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}
      {!isClose && (
        <Textarea
          aria-label={isComment ? "Comment text" : "Ticket description"}
          value={text}
          rows={4}
          disabled={settled || outcome.state === "busy"}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {settled ? (
        <p className="mt-2 text-muted-foreground" role="status">{outcome.message}</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            disabled={outcome.state === "busy" || (!isClose && (!text.trim() || (!isComment && !title.trim())))}
            onClick={() => run("confirm")}
          >
            {isClose ? "Yes, close it" : isComment ? "Confirm and post" : "Confirm and create"}
          </Button>
          <Button size="sm" variant="ghost" disabled={outcome.state === "busy"} onClick={() => run("reject")}>
            {isClose ? "No, keep it open" : "Discard"}
          </Button>
          {outcome.state === "error" && <span className="text-destructive" role="alert">{outcome.message}</span>}
        </div>
      )}
    </div>
  );
}
