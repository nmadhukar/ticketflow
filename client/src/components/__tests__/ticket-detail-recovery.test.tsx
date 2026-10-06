import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TicketDetail from "../ticket-detail";

const mockApiRequest = jest.fn();
const mockToast = jest.fn();
jest.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner", role: "customer" } }) }));
jest.mock("@/components/ai-response-feedback", () => ({ AiResponseFeedback: () => null }));
jest.mock("@/components/comments/comment-item", () => ({ CommentItem: () => null }));

const ticket = {
  id: 7, title: "Printer jam", ticketNumber: "TKT-7", status: "open",
  priority: "medium", category: "support", createdBy: "owner", createdAt: "2026-01-01T09:00:00Z",
};

function renderDetail(failPath?: string) {
  let failed = false;
  const queryFn = jest.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const path = String(queryKey[0]);
    if (path === failPath && !failed) { failed = true; throw new Error("Offline"); }
    return path === "/api/tasks/7" ? ticket : path.endsWith("auto-response") ? null : [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn } } });
  render(<QueryClientProvider client={client}><TicketDetail ticketId={7} onClose={jest.fn()} /></QueryClientProvider>);
  return { client, queryFn };
}

beforeEach(() => jest.clearAllMocks());

it("keeps a rejected comment draft and enables Send Comment for a successful retry", async () => {
  mockApiRequest.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ json: async () => ({ id: 1 }) });
  renderDetail();
  const input = await screen.findByRole("textbox", { name: "Add a comment" });
  fireEvent.change(input, { target: { value: "Please check tray two." } });
  fireEvent.click(screen.getByRole("button", { name: "Send Comment" }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to add comment" })));
  expect(input).toHaveValue("Please check tray two.");
  expect(screen.getByRole("button", { name: "Send Comment" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Send Comment" }));
  await waitFor(() => expect(input).toHaveValue(""));
  expect(mockApiRequest).toHaveBeenCalledTimes(2);
});

it("offers retry when ticket details fail instead of reporting not found", async () => {
  renderDetail("/api/tasks/7");
  fireEvent.click(await screen.findByRole("button", { name: "Retry ticket" }));
  expect(await screen.findByText("Printer jam")).toBeInTheDocument();
  expect(screen.queryByText("Ticket not found")).not.toBeInTheDocument();
});

it("offers comments retry and customer attachment upload on an accessible ticket", async () => {
  renderDetail("/api/tasks/7/comments");
  const retry = await screen.findByRole("button", { name: "Retry comments" });
  expect(screen.queryByText("No comments yet")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close ticket details" })).toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByText("No comments yet")).toBeInTheDocument();
});
