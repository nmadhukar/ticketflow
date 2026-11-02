import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The chat itself (CopilotKit) is not under test: a stand-in that counts its mounts.
let mounts = 0;
jest.mock("../AssistantPanel", () => ({
  __esModule: true,
  default: function Panel() {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <div>chat panel</div>;
  },
}));

import { AssistantShell } from "../AssistantShell";

function renderShell(availability: { enabled: boolean; agentId: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/assistant/availability"], availability);
  return render(
    <QueryClientProvider client={client}>
      <AssistantShell />
    </QueryClientProvider>,
  );
}

describe("AssistantShell", () => {
  beforeEach(() => {
    mounts = 0;
  });

  it("renders nothing for a user without an assistant", () => {
    renderShell({ enabled: false, agentId: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the conversation mounted when closed and reopened", async () => {
    renderShell({ enabled: true, agentId: "support-assistant" });
    fireEvent.click(screen.getByRole("button", { name: /Support assistant/ }));
    expect(await screen.findByText("chat panel")).toBeInTheDocument();
    expect(mounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveClass("hidden");
    expect(screen.getByText("chat panel")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Support assistant/ }));
    });
    expect(dialog).toHaveClass("flex");
    expect(mounts).toBe(1);
  });
});
