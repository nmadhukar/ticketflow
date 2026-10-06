import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Notifications from "../notifications";

const navigate = jest.fn();
jest.mock("wouter", () => ({ useLocation: () => ["/notifications", navigate] }));
jest.mock("@/components/main-wrapper", () => ({
  __esModule: true,
  default: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <main>{action}{children}</main>
  ),
}));

const notes = [
  { id: 1, title: "New assignment", content: "Review ticket", type: "task_assigned", isRead: false, actionUrl: "/my-tasks" },
  { id: 2, title: "Team update", content: "Read update", type: "team_invite", isRead: true, actionUrl: "/teams/7" },
  { id: 3, title: "Unsafe link", content: "Do not follow", type: "system", isRead: true, actionUrl: "https://evil.example/phish" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><Notifications /></QueryClientProvider>);
}

describe("Notifications", () => {
  beforeEach(() => {
    navigate.mockReset();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => notes })) as jest.Mock;
  });

  it("requests full history and shows both unread and read notifications", async () => {
    renderPage();
    expect(await screen.findByText("New assignment")).toBeInTheDocument();
    expect(screen.getByText("Team update")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/notifications?limit=50&read=all", expect.objectContaining({ credentials: "include" }));
  });

  it("opens valid internal action URLs, normalizes legacy ticket links, and ignores external URLs", async () => {
    renderPage();
    await screen.findByText("Team update");
    fireEvent.click(screen.getByRole("link", { name: /New assignment/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/tickets"));
    fireEvent.click(screen.getByRole("link", { name: /Team update/i }));
    expect(navigate).toHaveBeenCalledWith("/teams/7");
    expect(screen.queryByRole("link", { name: /Unsafe link/i })).not.toBeInTheDocument();
  });

  it("shows a retry action when history fails to load", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    renderPage();
    expect(await screen.findByText(/couldn't load notifications/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("New assignment")).toBeInTheDocument());
  });
});
