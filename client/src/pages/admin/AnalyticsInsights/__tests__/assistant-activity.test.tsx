import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssistantActivity from "../assistant-activity";

const requested: string[] = [];
const auditPage = (ids: number[], nextBefore: number | null) => ({
  events: ids.map((id) => ({ id, occurredAt: "2026-11-03T08:00:00Z", eventType: "write_confirmed", actorUserId: `user-${id}`, agentId: "ticket-assistant", runId: null, proposalId: null, ticketId: 42, reason: "add_comment" })),
  nextBefore,
});

// One stand-in server for both paths: the app's default query function (usage) and apiRequest (audit).
function mockRespond(url: string): unknown {
  requested.push(url);
  if (url.startsWith("/api/admin/assistant/usage")) {
    return {
      days: 30,
      totals: { runs: 3, byStatus: { completed: 2, failed: 0, stopped: 0, refused: 1 }, proposals: 1, inputTokens: 1000, outputTokens: 200, costUsd: 0.0026 },
      runs: [{ day: "2026-11-03", agentId: "ticket-assistant", status: "completed", runs: 2, proposals: 1, avgDurationMs: 4200 }],
      cost: [{ day: "2026-11-03", operation: "assistant.staff", model: "openai/gpt-5-mini", inputTokens: 1000, outputTokens: 200, costUsd: 0.0026 }],
    };
  }
  return url.includes("before=") ? auditPage([1], null) : auditPage([3, 2], 2);
}
jest.mock("@/lib/queryClient", () => ({
  apiRequest: async (_method: string, url: string) => ({ json: async () => mockRespond(url) }),
}));

beforeEach(() => {
  requested.length = 0;
});

it("shows runs, cost by day and model, and the audit trail, and pages the audit trail", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => mockRespond(String(queryKey[0])) } } });
  render(
    <QueryClientProvider client={client}>
      <AssistantActivity />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("1,200")).toBeInTheDocument();
  expect(screen.getAllByText("$0.0026")).toHaveLength(2); // the total, and its one cost row
  expect(screen.getByText("openai/gpt-5-mini")).toBeInTheDocument();
  expect(screen.getByText(/2 completed · 0 failed · 0 stopped · 1 refused/)).toBeInTheDocument();
  expect(requested).toContain("/api/admin/assistant/usage?days=30");
  expect(await screen.findByText("user-3")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("user-1")).toBeInTheDocument();
  expect(requested).toContain("/api/admin/assistant/audit?limit=50&before=2");
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
});
