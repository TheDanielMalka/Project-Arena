import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Wallet from "@/pages/Wallet";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";

// Non-custodial wallet — no deposit/withdraw dialogs, only on-chain balance + activity

describe("Wallet page — non-custodial", () => {
  beforeEach(() => {
    useUserStore.getState().login("player@arena.gg", "test");
    useWalletStore.setState({
      usdtBalance: 1247.50,
      atBalance: 350,
      transactions: [],
      dailyBettingLimit: 500,
      dailyBettingUsed: 200,
      connectedAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
      selectedNetwork: "bsc",
    });
  });

  it("renders Wallet heading", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /^wallet$/i })).toBeInTheDocument();
  });

  it("shows connected wallet address (truncated)", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/0x7a3F9c/i)).toBeInTheDocument();
  });

  it("shows USDT on-chain balance", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/1,247\.50/)).toBeInTheDocument();
  });

  it("shows Arena Tokens (AT) section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText(/arena tokens/i).length).toBeGreaterThan(0);
  });

  it("shows Daily Betting Limit section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText(/daily betting limit/i).length).toBeGreaterThan(0);
  });

  it("shows daily betting used vs limit", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/\$200 \/ \$500/)).toBeInTheDocument();
  });

  it("shows On-Chain Activity section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/on-chain activity/i)).toBeInTheDocument();
  });

  it("shows Buy Arena Tokens button in AT section", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /buy arena tokens/i })).toBeInTheDocument();
  });

  it("does NOT show a Deposit button — non-custodial model", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const depositBtn = screen.queryByRole("button", { name: /^deposit$/i });
    expect(depositBtn).toBeNull();
  });

  it("does NOT show a Withdraw button — funds go contract → wallet directly", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const withdrawBtn = screen.queryByRole("button", { name: /^withdraw$/i });
    expect(withdrawBtn).toBeNull();
  });

  it("shows 'no transactions found' when activity is empty", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/no transactions found/i)).toBeInTheDocument();
  });

  it("shows ArenaEscrow explanation text", () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/ArenaEscrow/)).toBeInTheDocument();
  });
});
