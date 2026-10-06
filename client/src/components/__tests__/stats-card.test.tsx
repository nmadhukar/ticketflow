import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import StatsCard from "../stats-card";

it("opens an actionable metric with keyboard and shows a stable numeric value", () => {
  const open = jest.fn();
  render(<StatsCard title="Pending articles" value={12} icon={<span />} onClick={open} />);
  const card = screen.getByRole("button", { name: /Pending articles/i });
  card.focus();
  fireEvent.keyDown(card, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("12")).toHaveClass("tabular-nums");
});

it("does not present zero as a loaded metric after a request fails", () => {
  render(<StatsCard title="Open tickets" value={0} icon={<span />} error />);
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});
