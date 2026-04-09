import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Leaderboard from "@/pages/Leaderboard";

// PlayerActionPopover uses useNavigate → tests must wrap in MemoryRouter


vi.mock("@/lib/engine-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-api")>();
  return {
    ...actual,
    apiGetLeaderboard: vi.fn().mockResolvedValue([
      { id: "u1", arenaId: "ARENA-001", rank: 1, username: "ShadowKing", wins: 120, losses: 20, winRate: 85.7, earnings: 5000, streak: 10, change: "up",   game: "CS2" },
      { id: "u2", arenaId: "ARENA-002", rank: 2, username: "PixelStorm",  wins: 100, losses: 30, winRate: 76.9, earnings: 3800, streak:  5, change: "same", game: "CS2" },
      { id: "u3", arenaId: "ARENA-003", rank: 3, username: "BlazeFury",   wins:  90, losses: 40, winRate: 69.2, earnings: 3000, streak:  3, change: "down", game: "CS2" },
    ]),
  };
});

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
