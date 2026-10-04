import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Tickets from "../pages/tickets";

const mockToast = jest.fn();
const mockQuery = jest.fn();
const mockApiRequest = jest.fn();
jest.mock("wouter", () => ({ useSearch: () => window.location.search }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", role: "admin" }, isAuthenticated: true }) }));
jest.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => mockApiRequest(...args) }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/main-wrapper", () => ({ __esModule: true, default: ({ children, action }: any) => <main>{action}{children}</main> }));
jest.mock("@/components/task-modal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ticket-detail", () => ({ __esModule: true, default: ({ ticketId, onClose }: any) => <section>Detail {ticketId}<button onClick={onClose}>Close detail</button><input aria-label="Draft" /></section> }));
jest.mock("@/components/ui/select", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- JSX in a hoisted Jest factory.
  const React = require("react");
  const SelectTrigger = () => null;
  return {
    Select: ({ value, onValueChange, children }: any) => {
      const trigger = React.Children.toArray(children).find((child: any) => child.type === SelectTrigger);
      return <select aria-label={trigger?.props["aria-label"]} value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>;
    },
    SelectTrigger, SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  };
});

const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Ticket ${i + 1}`, ticketNumber: `TKT-${i + 1}`, status: "open", category: "support", priority: "medium", createdAt: "2026-01-01" }));
function renderTickets() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: ({ queryKey }) => mockQuery(String(queryKey[0])) } } });
  render(<QueryClientProvider client={client}><Tickets /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/tickets");
  mockQuery.mockResolvedValue(rows);
  mockApiRequest.mockResolvedValue({ json: async () => [] });
});
afterEach(() => jest.restoreAllMocks());

it("sends urgent priority to the server and resets pagination", async () => {
  renderTickets();
  await screen.findByRole("button", { name: "Ticket 1" });
  fireEvent.click(screen.getByRole("button", { name: "tickets:filters.next" }));
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("offset=20")));
  fireEvent.change(screen.getByRole("combobox", { name: "tickets:filters.priority" }), { target: { value: "urgent" } });
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/priority=urgent.*offset=0/)));
});

it("clears the visible search and keeps New Ticket available on empty filtered results", async () => {
  mockQuery.mockResolvedValue([]);
  renderTickets();
  const input = screen.getByRole("textbox", { name: "tickets:filters.search" });
  fireEvent.change(input, { target: { value: "missing" } });
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("search=missing")));
  expect(screen.getByRole("button", { name: "tickets:newTicket" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "tickets:filters.clearFilters" }));
  expect(input).toHaveValue("");
  await waitFor(() => expect(mockQuery).toHaveBeenLastCalledWith("/api/tasks?limit=20&offset=0"));
});

it("opens a deep linked ticket outside the current page and clears the link when closed", async () => {
  window.history.replaceState({}, "", "/tickets?ticket=77");
  renderTickets();
  expect(await screen.findByText("Detail 77")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close detail" }));
  expect(window.location.search).toBe("");
});

it("keeps linked detail and its draft open after repeated View ticket and title actions", async () => {
  window.history.replaceState({}, "", "/tickets?ticket=1");
  renderTickets();
  const title = await screen.findByRole("button", { name: "Ticket 1" });
  const row = title.closest("tr")!;
  const draft = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Do not lose this reply" } });
  fireEvent.click(within(row).getByRole("button", { name: "View ticket" }));
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  fireEvent.click(title);
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Do not lose this reply");
  expect(window.location.search).toBe("?ticket=1");
});

it("closes selected detail and clears its URL and cache after successful deletion", async () => {
  window.history.replaceState({}, "", "/tickets?ticket=1");
  jest.spyOn(window, "confirm").mockReturnValue(true);
  mockApiRequest.mockImplementation(async (method: string) => {
    if (method === "DELETE") mockQuery.mockResolvedValue(rows.slice(1));
    return { json: async () => [] };
  });
  const client = renderTickets();
  client.setQueryData(["/api/tasks/1"], rows[0]);
  const title = await screen.findByRole("button", { name: "Ticket 1" });
  fireEvent.keyDown(within(title.closest("tr")!).getByRole("button", { name: "Ticket actions" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "tickets:deleteTicket" }));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/tasks/1"));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Selected ticket" })).not.toBeInTheDocument());
  expect(window.location.search).toBe("");
  expect(client.getQueryData(["/api/tasks/1"])).toBeUndefined();
});

it("refetches a previously visited filter despite the global infinite stale time", async () => {
  renderTickets();
  await screen.findByRole("button", { name: "Ticket 1" });
  const status = screen.getByRole("combobox", { name: "tickets:filters.status" });
  fireEvent.change(status, { target: { value: "open" } });
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith("/api/tasks?status=open&limit=20&offset=0"));
  fireEvent.change(status, { target: { value: "all" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "tickets:filters.next" })).toBeEnabled());
  mockQuery.mockResolvedValue([]);
  fireEvent.change(status, { target: { value: "open" } });
  await waitFor(() => expect(mockQuery.mock.calls.filter(([url]) => url === "/api/tasks?status=open&limit=20&offset=0")).toHaveLength(2));
  expect(await screen.findByText("No tickets found")).toBeInTheDocument();
});

it("applies the same server filters to Only My Tickets", async () => {
  renderTickets();
  await screen.findByRole("button", { name: "Ticket 1" });
  fireEvent.change(screen.getByRole("combobox", { name: "tickets:filters.priority" }), { target: { value: "urgent" } });
  fireEvent.click(screen.getByRole("switch", { name: "tickets:filters.onlyMyTickets" }));
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith("/api/tasks/my?priority=urgent&limit=20&offset=0"));
});

it.each(["-1", "0", "abc", "1.5", "9007199254740993"])("ignores invalid ticket link %s", async (id) => {
  window.history.replaceState({}, "", `/tickets?ticket=${id}`);
  renderTickets();
  await screen.findByRole("button", { name: "Ticket 1" });
  expect(screen.queryByRole("region", { name: "Selected ticket" })).not.toBeInTheDocument();
});

it("keeps an expanded draft mounted while the list refreshes and shows retry on failure", async () => {
  const client = renderTickets();
  fireEvent.click(await screen.findByRole("button", { name: "Ticket 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "Keep this" } });
  let reject!: (reason: Error) => void;
  mockQuery.mockImplementationOnce(() => new Promise((_, rejectQuery) => { reject = rejectQuery; }));
  await act(async () => { void client.invalidateQueries({ queryKey: ["/api/tasks?limit=20&offset=0"] }); });
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this");
  await act(async () => reject(new Error("Offline")));
  expect(await screen.findByRole("button", { name: "Retry tickets" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this");
});
