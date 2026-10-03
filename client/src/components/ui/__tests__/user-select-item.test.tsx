import React from "react";
import { render, screen } from "@testing-library/react";
import { UserSelectItem } from "../user-select-item";

// Radix SelectItem needs a Select around it; render the item's content only.
jest.mock("@/components/ui/select", () => ({
  SelectItem: ({ children }: { children: React.ReactNode }) => children,
}));

describe("UserSelectItem", () => {
  it("shows the displayName a customer's ticket meta carries (no email, no role)", () => {
    render(<UserSelectItem user={{ displayName: "Sam Support" }} value="s1" showEmail={false} />);
    expect(screen.getByText("Sam Support")).toBeInTheDocument();
    expect(screen.queryByText("Unknown User")).not.toBeInTheDocument();
  });

  it("still builds the name from a staff row's first and last name, with the role badge", () => {
    render(<UserSelectItem user={{ firstName: "Ada", lastName: "Admin", role: "admin" }} value="a1" showEmail={false} />);
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });
});
