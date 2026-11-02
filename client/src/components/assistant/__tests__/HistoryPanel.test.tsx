import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HistoryPanel } from "../HistoryPanel";

// As the app's default query function (lib/queryClient): the key joined with "/" is the URL.
function setup(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const hit = routes[`${init?.method ?? "GET"} ${url}`] ?? { status: 404, body: {} };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const res = await fetch(queryKey.join("/"), { credentials: "include" });
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        },
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <HistoryPanel />
    </QueryClientProvider>,
  );
  return calls;
}

describe("HistoryPanel", () => {
  it("lists saved conversations and opens one read-only", async () => {
    setup({
      "GET /api/assistant/history": { status: 200, body: { threads: [{ threadId: "t1", title: null, updatedAt: "2026-11-02T09:00:00Z" }] } },
      "GET /api/assistant/history/t1": {
        status: 200,
        body: { available: true, messages: [{ role: "user", text: "Queue status?", createdAt: "2026-11-02T09:00:00Z" }, { role: "assistant", text: "Three open.", createdAt: "2026-11-02T09:00:05Z" }] },
      },
    });
    fireEvent.click(await screen.findByText("Conversation"));
    expect(await screen.findByText("Queue status?")).toBeInTheDocument();
    expect(screen.getByText("Three open.")).toBeInTheDocument();
  });

  it("says when a conversation was withheld, and deletes one", async () => {
    const calls = setup({
      "GET /api/assistant/history": { status: 200, body: { threads: [{ threadId: "t2", title: "Old", updatedAt: "2026-11-01T09:00:00Z" }] } },
      "GET /api/assistant/history/t2": { status: 200, body: { available: false, reason: "access_changed" } },
      "DELETE /api/assistant/history/t2": { status: 204 },
    });
    fireEvent.click(await screen.findByText("Old"));
    expect(await screen.findByText(/mentions a ticket you can no longer see/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete this conversation" }));
    await waitFor(() => expect(calls).toContain("DELETE /api/assistant/history/t2"));
  });

  it("says when there is nothing saved", async () => {
    setup({ "GET /api/assistant/history": { status: 200, body: { threads: [] } } });
    expect(await screen.findByText(/No saved conversations/)).toBeInTheDocument();
  });
});
