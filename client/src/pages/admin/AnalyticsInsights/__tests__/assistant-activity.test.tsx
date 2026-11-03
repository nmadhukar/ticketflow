import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssistantActivity from "../assistant-activity";

const requested: string[] = [];
const auditPage = (ids: number[], nextBefore: number | null) => ({
  events: ids.map((id) => ({ id, occurredAt: "2026-11-03T08:00:00Z", eventType: "write_confirmed", actorUserId: `user-${id}`, agentId: "ticket-assistant", runId: null, proposalId: null, ticketId: 42, reason: "add_comment" })),
  nextBefore,
});
jest.mock("@/lib/queryClient", () => ({
  apiRequest: async (_method: string, url: string) => {
    requested.push(url);
    if (url.startsWith("/api/admin/assistant/usage")) {
      return {
        json: async () => ({
          days: 30,
          totals: { runs: 3, byStatus: { completed: 2, failed: 0, stopped: 0, refused: 1 }, proposals: 1, inputTokens: 1000, outputTokens: 200, costUsd: 0.0026 },
          runs: [{ day: "2026-11-03", agentId: "ticket-assistant", status: "completed", runs: 2, proposals: 1, avgDurationMs: 4200 }],
          cost: [],
        }),
      };
    }
    return { json: async () => (url.includes("before=") ? auditPage([1], null) : auditPage([3, 2], 2)) };
  },
}));

beforeEach(() => {
  requested.length = 0;
});

it("shows runs, cost and the audit trail, and pages the audit trail", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AssistantActivity />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("$0.0026")).toBeInTheDocument();
  expect(screen.getByText("1,200")).toBeInTheDocument();
  expect(screen.getByText(/2 completed · 0 failed · 0 stopped · 1 refused/)).toBeInTheDocument();
  expect(await screen.findByText("user-3")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("user-1")).toBeInTheDocument();
  expect(requested).toContain("/api/admin/assistant/audit?limit=50&before=2");
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
});
