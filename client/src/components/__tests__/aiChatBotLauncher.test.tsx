import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiChatBot } from "../AiChatBot";

/**
 * The app shows exactly one assistant button. When the copilot is enabled it owns that corner
 * (CopilotAssistant publishes its config on this query key), so the help chatbot must not draw its
 * own "Ask AI" launcher underneath it. When the copilot is off, the chatbot is the launcher.
 */
function clientWithConfig(config: { enabled: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/copilotkit", "config"], config);
  return client;
}

describe("AiChatBot launcher", () => {
  it("yields the corner to the copilot when the copilot is enabled", async () => {
    render(
      <QueryClientProvider client={clientWithConfig({ enabled: true })}>
        <AiChatBot />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /open help assistant/i })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Ask AI")).not.toBeInTheDocument();
  });

  it("shows its own Ask AI launcher when the copilot is off", async () => {
    render(
      <QueryClientProvider client={clientWithConfig({ enabled: false })}>
        <AiChatBot />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /open help assistant/i })).toBeInTheDocument();
    expect(screen.getByText("Ask AI")).toBeInTheDocument();
  });
});
