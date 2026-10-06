import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";

let mockLocation = "/departments/7";
let mockRole = "admin";
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
jest.mock("wouter", () => ({
  useLocation: () => [mockLocation, jest.fn()],
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

beforeEach(() => { mockLocation = "/departments/7"; mockRole = "admin"; });

it("marks the parent destination active when viewing a detail page", () => {
  render(<Sidebar />);
  expect(screen.getByRole("link", { name: "departments" })).toHaveAttribute("aria-current", "page");
});

it("keeps admin destinations grouped and reveals the selected group", () => {
  mockLocation = "/admin/developer-resources";
  render(<Sidebar />);
  expect(screen.getByRole("button", { name: /integrations_title/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "developer-resources" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: /configuration_title/ }));
  expect(screen.getByRole("link", { name: "company-console" })).toBeVisible();
});

it("offers customer navigation without administration and closes mobile navigation on a link", () => {
  mockRole = "customer";
  mockLocation = "/";
  const onNavigate = jest.fn();
  render(<Sidebar onNavigate={onNavigate} />);
  expect(screen.queryByRole("button", { name: /management_title/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "tickets" }));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
});
