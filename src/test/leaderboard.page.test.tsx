import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Leaderboard from "@/pages/Leaderboard";

// PlayerActionPopover uses useNavigate → tests must wrap in MemoryRouter

describe("Leaderboard page", () => {
  it("updates top quick stats when a different podium player is clicked", async () => {
    render(<MemoryRouter><Leaderboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/ShadowKing - Quick Stats \(Top 3\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("podium-card-PixelStorm"));

    expect(screen.getByText("PixelStorm - Quick Stats (Top 3)")).toBeInTheDocument();
  });

  it("expands and collapses inline table details per player row", async () => {
    render(<MemoryRouter><Leaderboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByTestId("table-row-BlazeFury")).toBeInTheDocument();
    });

    const avgLabelsBefore = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsBefore).toBe(1);

    // Click the row element (not the username button which stops propagation for the popover)
    fireEvent.click(screen.getByTestId("table-row-BlazeFury"));

    const avgLabelsAfterExpand = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsAfterExpand).toBe(2);

    fireEvent.click(screen.getByTestId("table-row-BlazeFury"));

    const avgLabelsAfterCollapse = screen.getAllByText("Avg $ / Match").length;
    expect(avgLabelsAfterCollapse).toBe(1);
  });
});
