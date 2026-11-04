import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseProposal, ProposalCard, type ProposalView } from "../ProposalCard";

const comment: ProposalView = {
  proposalId: "3f0f8c3e-6d1a-4a8e-9a43-0f6f2f5b6c01",
  action: "add_comment",
  expiresAt: "2026-11-02T12:15:00.000Z",
  ticket: { ticketNumber: "TKT-2026-0151", title: "Printer shows E-42" },
  draft: { content: "Still broken after a restart." },
};

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

describe("parseProposal", () => {
  it("finds the proposal however the MCP and agent layers wrapped it", () => {
    expect(parseProposal(JSON.stringify(comment))?.proposalId).toBe(comment.proposalId);
    const mcp = { content: [{ type: "text", text: JSON.stringify(comment) }] };
    expect(parseProposal(JSON.stringify(mcp))?.proposalId).toBe(comment.proposalId);
    expect(parseProposal(JSON.stringify({ structuredContent: mcp }))?.action).toBe("add_comment");
  });

  it("returns nothing for a refusal or garbage, so no card is shown", () => {
    expect(parseProposal(JSON.stringify({ content: [{ type: "text", text: '{"code":"NOT_FOUND","message":"Ticket not found"}' }], isError: true }))).toBeNull();
    expect(parseProposal("not json")).toBeNull();
    expect(parseProposal(undefined)).toBeNull();
    expect(parseProposal(JSON.stringify({ proposalId: "x", action: "delete_ticket" }))).toBeNull();
  });
});

describe("ProposalCard", () => {
  it("shows the draft and its visibility, and posts the edited text on Confirm", async () => {
    const fetchMock = mockFetch(200, { status: "executed", action: "add_comment", commentId: 9 });
    render(<ProposalCard proposal={comment} />);
    expect(screen.getByText(/Visible to everyone on the ticket/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Comment text"), { target: { value: "Edited by me" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and post" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Comment posted on TKT-2026-0151."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/assistant/proposals/${comment.proposalId}/confirm`);
    expect(JSON.parse(init.body)).toEqual({ edits: { content: "Edited by me" } });
    expect(screen.queryByRole("button", { name: "Confirm and post" })).not.toBeInTheDocument();
  });

  it("Discard rejects it and says nothing was posted", async () => {
    const fetchMock = mockFetch(200, { status: "rejected" });
    render(<ProposalCard proposal={comment} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Discarded. Nothing was posted."));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/assistant/proposals/${comment.proposalId}/reject`);
  });

  it("explains an already-handled, expired or refused proposal", async () => {
    mockFetch(409, { error: "already_decided" });
    const { unmount } = render(<ProposalCard proposal={comment} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and post" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("already handled"));
    unmount();

    // 400: the text was refused, the proposal is still open, so the card stays usable.
    mockFetch(400, { message: "A comment needs 1 to 10000 characters of text." });
    const second = render(<ProposalCard proposal={comment} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and post" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("1 to 10000 characters"));
    expect(screen.getByRole("button", { name: "Confirm and post" })).toBeEnabled();
    second.unmount();

    // 403: the server closed the proposal, so the card says so and offers no retry.
    mockFetch(403, { message: "You do not have access to this ticket" });
    render(<ProposalCard proposal={comment} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and post" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You do not have access to this ticket"));
    expect(screen.queryByRole("button", { name: "Confirm and post" })).not.toBeInTheDocument();
  });

  it("cannot confirm a ticket without a title", () => {
    render(<ProposalCard proposal={{ ...comment, action: "create_ticket", ticket: undefined, draft: { title: "VPN drops", description: "x" } }} />);
    const confirm = screen.getByRole("button", { name: "Confirm and create" });
    expect(confirm).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Ticket title"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
  });

  it("a ticket proposal shows its fields and reports the new ticket number", async () => {
    mockFetch(200, { status: "executed", action: "create_ticket", ticketNumber: "TKT-2026-0152" });
    render(
      <ProposalCard
        proposal={{ ...comment, action: "create_ticket", ticket: undefined, draft: { title: "VPN drops", description: "Every 10 minutes", category: "support", priority: "high" } }}
      />,
    );
    expect(screen.getByText("New ticket")).toBeInTheDocument();
    expect(screen.getByLabelText("Ticket title")).toHaveValue("VPN drops");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and create" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ticket TKT-2026-0152 created."));
  });
});
