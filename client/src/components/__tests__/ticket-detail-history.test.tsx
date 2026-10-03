import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TicketDetail from "../ticket-detail";
import { describeHistoryItem } from "@/lib/ticketHistory";

const TICKET = {
  id: 7,
  ticketNumber: "TKT-7",
  title: "Printer jam",
  description: "d",
  status: "open",
  priority: "medium",
  category: "support",
  createdBy: "u1",
  tags: [],
  createdAt: "2026-01-01T09:00:00Z",
  updatedAt: "2026-01-01T09:00:00Z",
};
const ACTOR = { firstName: "Ada", lastName: "Admin" };
const HISTORY = [
  { id: 1, action: "created", field: null, oldValue: null, newValue: null, createdAt: "2026-01-01T10:00:00Z", user: ACTOR },
  { id: 2, action: "updated", field: "status", oldValue: "open", newValue: "in_progress", createdAt: "2026-01-01T11:00:00Z", user: ACTOR },
  { id: 3, action: "updated", field: "estimatedHours", oldValue: null, newValue: "0", createdAt: "2026-01-01T12:00:00Z", user: ACTOR },
  { id: 4, action: "updated", field: "assigneeId", oldValue: "abc", newValue: null, createdAt: "2026-01-01T13:00:00Z", user: ACTOR },
];

const mockApiRequest = jest.fn();
jest.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", role: "admin" }, isAuthenticated: true }),
}));
jest.mock("@/components/ai-response-feedback", () => ({ AiResponseFeedback: () => null }));
jest.mock("@/components/comments/comment-item", () => ({ CommentItem: () => null }));

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          if (url === "/api/tasks/7") return TICKET;
          if (url === "/api/tasks/7/history") return HISTORY;
          return [];
        },
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <TicketDetail ticketId={7} />
    </QueryClientProvider>
  );
}

describe("describeHistoryItem", () => {
  it("renders updates as label: old -> new with a dash for null, create as 'created', raw field name when unmapped", () => {
    expect(describeHistoryItem(HISTORY[0])).toBe("created");
    expect(describeHistoryItem(HISTORY[1])).toBe("Status: open → in_progress");
    expect(describeHistoryItem(HISTORY[2])).toBe("estimatedHours: — → 0");
    expect(describeHistoryItem(HISTORY[3])).toBe("Assignee: abc → —");
  });
});

describe("TicketDetail activity history", () => {
  it("shows the structured entries and never an undefined/details text", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("Status: open → in_progress")).toBeInTheDocument());
    expect(screen.getByText("created")).toBeInTheDocument();
    expect(screen.getByText("estimatedHours: — → 0")).toBeInTheDocument();
    expect(screen.getByText("Assignee: abc → —")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
