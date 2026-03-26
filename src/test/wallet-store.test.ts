import { beforeEach, describe, expect, it } from "vitest";
import { useWalletStore, PLATFORM_BETTING_MAX } from "@/stores/walletStore";

const SEED_TOKENS = useWalletStore.getState().tokens;
const SEED_TXS   = useWalletStore.getState().transactions;

describe("walletStore", () => {
  beforeEach(() => {
    useWalletStore.setState({
      tokens: SEED_TOKENS.map(t => ({ ...t })),
      transactions: [...SEED_TXS],
      dailyBettingLimit: 500,
      dailyBettingUsed: 0,
    });
  });

  // ── Platform constants ────────────────────────────────────────────────────
  it("PLATFORM_BETTING_MAX is 500", () => {
    expect(PLATFORM_BETTING_MAX).toBe(500);
  });

  it("platformBettingMax in store equals PLATFORM_BETTING_MAX", () => {
    expect(useWalletStore.getState().platformBettingMax).toBe(500);
  });

  // ── getAvailableBalance ───────────────────────────────────────────────────
  it("getAvailableBalance returns sum of all token usdValues", () => {
    const state = useWalletStore.getState();
    const expected = state.tokens.reduce((s, t) => s + t.usdValue, 0);
    expect(state.getAvailableBalance()).toBe(expected);
  });

  it("getAvailableBalance decreases after lockEscrow", () => {
    const state = useWalletStore.getState();
    const before = state.getAvailableBalance();
    state.lockEscrow(50, "MATCH-TEST");
    expect(useWalletStore.getState().getAvailableBalance()).toBe(before - 50);
  });

  // ── lockEscrow ────────────────────────────────────────────────────────────
  it("lockEscrow returns a transaction on success", () => {
    const tx = useWalletStore.getState().lockEscrow(50, "MATCH-001");
    expect(tx).not.toBeNull();
    expect(tx?.type).toBe("escrow_lock");
    expect(tx?.amount).toBe(-50);
  });

  it("lockEscrow deducts from USDT token balance", () => {
    const before = useWalletStore.getState().tokens.find(t => t.symbol === "USDT")!.balance;
    useWalletStore.getState().lockEscrow(100, "MATCH-002");
    const after  = useWalletStore.getState().tokens.find(t => t.symbol === "USDT")!.balance;
    expect(after).toBe(before - 100);
  });

  it("lockEscrow increments dailyBettingUsed", () => {
    useWalletStore.getState().lockEscrow(75, "MATCH-003");
    expect(useWalletStore.getState().dailyBettingUsed).toBe(75);
  });

  it("lockEscrow returns null when daily limit exceeded", () => {
    useWalletStore.setState({ dailyBettingUsed: 450 });
    const tx = useWalletStore.getState().lockEscrow(100, "MATCH-OVER");
    expect(tx).toBeNull();
  });

  it("lockEscrow returns null when balance insufficient", () => {
    const state = useWalletStore.getState();
    const tx = state.lockEscrow(999999, "MATCH-BIG");
    expect(tx).toBeNull();
  });

  // ── setDailyBettingLimit ──────────────────────────────────────────────────
  it("setDailyBettingLimit clamps to [50, 500]", () => {
    const store = useWalletStore.getState();
    store.setDailyBettingLimit(10);
    expect(useWalletStore.getState().dailyBettingLimit).toBe(50);

    store.setDailyBettingLimit(999);
    expect(useWalletStore.getState().dailyBettingLimit).toBe(500);

    store.setDailyBettingLimit(200);
    expect(useWalletStore.getState().dailyBettingLimit).toBe(200);
  });

  // ── fee consistency — 5% ─────────────────────────────────────────────────
  it("seed transactions contain no 10% fee note", () => {
    const feeTxs = useWalletStore.getState().transactions.filter(tx => tx.type === "fee");
    feeTxs.forEach(tx => {
      expect(tx.note).not.toMatch(/10%/);
    });
  });

  it("seed fee transaction reflects 5% of match win", () => {
    // TX-002 match_win = 120, TX-003 fee = 6 (5%)
    const win = useWalletStore.getState().transactions.find(tx => tx.id === "TX-002");
    const fee = useWalletStore.getState().transactions.find(tx => tx.id === "TX-003");
    expect(win).toBeDefined();
    expect(fee).toBeDefined();
    expect(Math.abs(fee!.amount)).toBe(win!.amount * 0.05);
  });

  // ── withdraw ──────────────────────────────────────────────────────────────
  it("withdraw returns null if balance insufficient", () => {
    const tx = useWalletStore.getState().withdraw(999999, "USDT", "0xABCD");
    expect(tx).toBeNull();
  });

  it("withdraw deducts from token balance on success", () => {
    const before = useWalletStore.getState().tokens.find(t => t.symbol === "USDT")!.balance;
    useWalletStore.getState().withdraw(100, "USDT", "0xABCD");
    const after  = useWalletStore.getState().tokens.find(t => t.symbol === "USDT")!.balance;
    expect(after).toBe(before - 100);
  });
});
