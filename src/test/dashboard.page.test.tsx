import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import { useUserStore } from "@/stores/userStore";

async function loginAs(role: "user" | "admin" = "user") {
  await useUserStore.getState().login(
    role === "admin" ? "admin@arena.gg" : "player@arena.gg",
    "test"
  );
}

describe("Dashboard page", () => {
  beforeEach(async () => {
    localStorage.clear();
    useUserStore.getState().logout();
    vi.useFakeTimers();
    await loginAs("user");
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("renders Command Center hero section", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText(/command center/i)).toBeInTheDocument();
  });

  it("shows logged-in username in hero", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getAllByText(/ArenaPlayer_01/i).length).toBeGreaterThan(0);
  });

  it("shows XP level badge", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    // user has 840 xp → Silver tier — text may be split across elements
    expect(screen.getAllByText((_, el) => !!el?.textContent?.toLowerCase().includes("silver")).length).toBeGreaterThan(0);
  });

  it("shows Find Match and Wallet quick action buttons", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getAllByRole("button", { name: /find match/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^wallet$/i })).toBeInTheDocument();
  });

  it("shows Daily Challenges section", () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getAllByText((_, el) => !!el?.textContent?.toLowerCase().includes("daily challenges")).length).toBeGreaterThan(0);
  });

  it("shows login greeting banner after login and auto-dismisses", async () => {
    useUserStore.getState().logout();
    await useUserStore.getState().login("player@arena.gg", "test");

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4500); });

    expect(useUserStore.getState().showLoginGreeting).toBe(false);
  });

  it("shows correct greeting type for new signup", async () => {
    useUserStore.getState().logout();
    await useUserStore.getState().signup("NewPlayer", "new@arena.gg", "password123", {
      steamId: "76561198000000001",
    });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByText(/welcome to arena/i)).toBeInTheDocument();
    expect(screen.getByText(/next: arena client/i)).toBeInTheDocument();
  });

  it("does not show greeting banner when already cleared", () => {
    useUserStore.getState().clearLoginGreeting();

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/welcome to arena/i)).not.toBeInTheDocument();
  });
});
