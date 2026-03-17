import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Leaderboard from "@/pages/Leaderboard";

describe("Leaderboard page", () => {
  it("updates top quick stats when a different podium player is clicked", () => {
    render(<Leaderboard />);

    expect(screen.getByText("ShadowKing - Quick Stats (Top 3)")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("PixelStorm")[0]);

    expect(screen.getByText("PixelStorm - Quick Stats (Top 3)")).toBeInTheDocument();
  });

  it("expands and collapses inline table details per player row", () => {
    render(<Leaderboard />);

    const avgLabelsBefore = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsBefore).toBe(1);

    fireEvent.click(screen.getByText("BlazeFury"));

    const avgLabelsAfterExpand = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsAfterExpand).toBe(2);

    fireEvent.click(screen.getByText("BlazeFury"));

    const avgLabelsAfterCollapse = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsAfterCollapse).toBe(1);
  });
});
