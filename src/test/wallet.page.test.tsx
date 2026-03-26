import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Wallet from "@/pages/Wallet";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";

describe("Wallet page", () => {
  beforeEach(() => {
    useUserStore.getState().login("player@arena.gg", "test");
  });

  it("renders Portfolio section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/portfolio/i)).toBeInTheDocument();
  });

  it("shows token balances (USDT, BNB, SOL)", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText(/USDT/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BNB/i).length).toBeGreaterThan(0);
  });

  it("shows Security section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText(/security/i).length).toBeGreaterThan(0);
  });

  it("shows daily betting usage vs limit", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const store = useWalletStore.getState();
    expect(screen.getByText(`$${store.dailyBettingUsed}`)).toBeInTheDocument();
  });

  it("opens deposit dialog on Deposit button click", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens withdraw dialog on Withdraw button click", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows transaction type filter (Deposits option)", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    // The tx filter SelectItems include "Deposits"
    expect(screen.getAllByText((_, el) => !!el?.textContent?.toLowerCase().includes("deposit")).length).toBeGreaterThan(0);
  });
});
