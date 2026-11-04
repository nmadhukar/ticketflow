import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Both assistants as stand-ins: what is under test is which one a user gets.
jest.mock("@/components/AiChatBot", () => ({ AiChatBot: () => <button>Ask AI</button> }));
jest.mock("../AssistantPanel", () => ({ __esModule: true, default: () => <div>chat panel</div> }));

import { AppAssistant } from "../AppAssistant";

function renderWith(setup: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  setup(client);
  return render(
    <QueryClientProvider client={client}>
      <AppAssistant />
    </QueryClientProvider>,
  );
}
const KEY = ["/api/assistant/availability"];

describe("AppAssistant: one assistant per user", () => {
  it("a user with the in-app assistant gets only it; Ask AI is retired for them", () => {
    renderWith((c) => c.setQueryData(KEY, { enabled: true, agentId: "ticket-assistant", history: false }));
    expect(screen.getByRole("button", { name: "Ticket assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask AI" })).not.toBeInTheDocument();
  });

  it("a user without it (switched off, or a customer while staff-only) keeps Ask AI", () => {
    renderWith((c) => c.setQueryData(KEY, { enabled: false, agentId: null, history: false }));
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assistant/i })).not.toBeInTheDocument();
  });

  it("shows neither while the server has not answered, so Ask AI never flashes up and away", () => {
    renderWith((c) => c.setQueryDefaults(KEY, { queryFn: () => new Promise(() => {}) }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps Ask AI when the availability check fails", async () => {
    renderWith((c) => c.setQueryDefaults(KEY, { queryFn: async () => { throw new Error("503"); } }));
    expect(await screen.findByRole("button", { name: "Ask AI" })).toBeInTheDocument();
  });
});
