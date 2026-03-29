import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Settings from "@/pages/Settings";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore, PLATFORM_BETTING_MAX } from "@/stores/walletStore";

describe("Settings page", () => {
  beforeEach(() => {
    useUserStore.getState().login("player@arena.gg", "test");
  });

  it("renders Account section in sidebar", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getAllByText(/account/i).length).toBeGreaterThan(0);
  });

  it("shows Notifications section in sidebar", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getAllByText(/notifications/i).length).toBeGreaterThan(0);
  });

  it("shows Security section in sidebar", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getAllByText(/security/i).length).toBeGreaterThan(0);
  });

  it("shows Daily Betting Limit after navigating to Betting section", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /betting/i }));
    expect(screen.getByText("Daily Betting Limit")).toBeInTheDocument();
  });

  it("shows platform max of $500 after navigating to Betting section", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /betting/i }));
    expect(screen.getByText(new RegExp(`Platform max: \\$${PLATFORM_BETTING_MAX}`))).toBeInTheDocument();
  });

  it("navigates between sidebar sections", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const securityTab = screen.getAllByText(/security/i)[0];
    fireEvent.click(securityTab);
    expect(screen.getAllByText(/security/i).length).toBeGreaterThan(0);
  });

  it("shows Help & ticket section in sidebar", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /help & ticket/i })).toBeInTheDocument();
  });
});
