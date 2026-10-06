import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Departments from "../departments";
import Teams from "../teams";

const mockRole = { current: "manager" };
jest.mock("wouter", () => ({ Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
jest.mock("@/components/main-wrapper", () => ({
  __esModule: true,
  default: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => <main>{action}{children}</main>,
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", role: mockRole.current }, isAuthenticated: true, isLoading: false }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/queryClient", () => ({ apiRequest: async () => ({ json: async () => [] }) }));

function renderWithQueries(page: React.ReactElement, failingKey: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
      if (queryKey[0] === failingKey) throw new Error("Network failed");
      return [];
    } } },
  });
  return render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
}

it("keeps the team creation action visible when teams fail to load", async () => {
  mockRole.current = "manager";
  renderWithQueries(<Teams />, "/api/teams");
  expect(screen.getByRole("button", { name: "teams:actions.create" })).toBeInTheDocument();
  expect(await screen.findByText("Could not load teams")).toBeInTheDocument();
  expect(screen.queryByText("teams:all.emptyTitle")).not.toBeInTheDocument();
});

it("shows a department load error instead of the empty state", async () => {
  mockRole.current = "admin";
  renderWithQueries(<Departments />, "/api/departments");
  expect(screen.getByRole("button", { name: "departments:actions.add" })).toBeInTheDocument();
  expect(await screen.findByText("Could not load departments")).toBeInTheDocument();
  expect(screen.queryByText("departments:empty.title")).not.toBeInTheDocument();
});
