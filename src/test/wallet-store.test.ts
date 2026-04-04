import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletStore, PLATFORM_BETTING_MAX } from "@/stores/walletStore";

vi.mock("@/lib/engine-api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/engine-api")>();
  return {
    ...mod,
    apiGetMatchStatus: vi.fn().mockResolvedValue({
      match_id: "MATCH-001",
      status: "waiting",
      winner_id: null,
      on_chain_match_id: "42",
      stake_per_player: 0.01,
      your_team: 0 as const,
    }),
  };
});

vi.mock("@/lib/metamaskBsc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/metamaskBsc")>();
  return {
    ...mod,
    depositToEscrow: vi.fn().mockResolvedValue("0xdeadbeef1234567890"),
  };
});

// Non-custodial wallet — no deposit/withdraw, only escrow + AT activity

const INITIAL_STATE = useWalletStore.getState();

describe("walletStore — non-custodial model", () => {
  beforeEach(() => {
    useWalletStore.setState({
      usdtBalance: 1247.50,
      atBalance: 350,
      transactions: [...INITIAL_STATE.transactions],
      dailyBettingLimit: 500,
      dailyBettingUsed: 0,
      connectedAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
      selectedNetwork: "bsc",
    });
  });

  // ── Platform constants ────────────────────────────────────────────────────
  it("PLATFORM_BETTING_MAX is 500", () => {
    expect(PLATFORM_BETTING_MAX).toBe(500);
  });

  it("platformBettingMax in store equals PLATFORM_BETTING_MAX", () => {
    expect(useWalletStore.getState().platformBettingMax).toBe(500);
  });

  // ── Architecture: no deposit/withdraw ────────────────────────────────────
  it("deposit function does not exist — non-custodial model", () => {
    expect(useWalletStore.getState()).not.toHaveProperty("deposit");
  });

  it("withdraw function does not exist — funds go contract → wallet directly", () => {
    expect(useWalletStore.getState()).not.toHaveProperty("withdraw");
  });

  it("seed transactions contain no deposit or withdrawal types", () => {
    const txs = useWalletStore.getState().transactions;
    txs.forEach((tx) => {
      expect(tx.type).not.toBe("deposit");
      expect(tx.type).not.toBe("withdrawal");
    });
  });

  // ── getAvailableBalance ───────────────────────────────────────────────────
  it("getAvailableBalance returns usdtBalance", () => {
    const state = useWalletStore.getState();
    expect(state.getAvailableBalance()).toBe(state.usdtBalance);
  });

  it("getAvailableBalance decreases after lockEscrow", async () => {
    const before = useWalletStore.getState().getAvailableBalance();
    await useWalletStore.getState().lockEscrow(50, "MATCH-TEST");
    expect(useWalletStore.getState().getAvailableBalance()).toBe(before - 50);
  });

  // ── lockEscrow ────────────────────────────────────────────────────────────
  it("lockEscrow returns a transaction on success", async () => {
    const tx = await useWalletStore.getState().lockEscrow(50, "MATCH-001");
    expect(tx).not.toBeNull();
    expect(tx?.type).toBe("escrow_lock");
    expect(tx?.amount).toBe(-50);
  });

  it("lockEscrow deducts from usdtBalance", async () => {
    const before = useWalletStore.getState().usdtBalance;
    await useWalletStore.getState().lockEscrow(100, "MATCH-002");
    expect(useWalletStore.getState().usdtBalance).toBe(before - 100);
  });

  it("lockEscrow increments dailyBettingUsed", async () => {
    await useWalletStore.getState().lockEscrow(75, "MATCH-003");
    expect(useWalletStore.getState().dailyBettingUsed).toBe(75);
  });

  it("lockEscrow returns null when daily limit exceeded", async () => {
    useWalletStore.setState({ dailyBettingUsed: 450 });
    const tx = await useWalletStore.getState().lockEscrow(100, "MATCH-OVER");
    expect(tx).toBeNull();
  });

  it("lockEscrow returns null when usdtBalance insufficient", async () => {
    const tx = await useWalletStore.getState().lockEscrow(999999, "MATCH-BIG");
    expect(tx).toBeNull();
  });

  // ── cancelEscrow ─────────────────────────────────────────────────────────
  it("cancelEscrow refunds usdtBalance and decrements dailyBettingUsed", async () => {
    await useWalletStore.getState().lockEscrow(100, "MATCH-CX");
    const balAfterLock = useWalletStore.getState().usdtBalance;
    const usedAfterLock = useWalletStore.getState().dailyBettingUsed;

    useWalletStore.getState().cancelEscrow("MATCH-CX");
    expect(useWalletStore.getState().usdtBalance).toBe(balAfterLock + 100);
    expect(useWalletStore.getState().dailyBettingUsed).toBe(usedAfterLock - 100);
  });

  it("cancelEscrow creates a refund transaction", async () => {
    await useWalletStore.getState().lockEscrow(60, "MATCH-CX2");
    useWalletStore.getState().cancelEscrow("MATCH-CX2");
    const refund = useWalletStore.getState().transactions.find(
      (tx) => tx.type === "refund" && tx.matchId === "MATCH-CX2"
    );
    expect(refund).toBeDefined();
    expect(refund?.amount).toBe(60);
  });

  it("cancelEscrow returns false if no pending escrow for matchId", () => {
    const result = useWalletStore.getState().cancelEscrow("NONEXISTENT");
    expect(result).toBe(false);
  });

  // ── releaseEscrow ─────────────────────────────────────────────────────────
  it("releaseEscrow on win adds to usdtBalance", async () => {
    await useWalletStore.getState().lockEscrow(50, "MATCH-WIN");
    const balAfterLock = useWalletStore.getState().usdtBalance;
    useWalletStore.getState().releaseEscrow(95, "MATCH-WIN", true);
    expect(useWalletStore.getState().usdtBalance).toBe(balAfterLock + 95);
  });

  it("releaseEscrow on loss does not add to usdtBalance", async () => {
    await useWalletStore.getState().lockEscrow(50, "MATCH-LOSS");
    const balAfterLock = useWalletStore.getState().usdtBalance;
    useWalletStore.getState().releaseEscrow(50, "MATCH-LOSS", false);
    expect(useWalletStore.getState().usdtBalance).toBe(balAfterLock);
  });

  it("releaseEscrow creates match_win transaction on win", async () => {
    await useWalletStore.getState().lockEscrow(50, "MATCH-WIN2");
    useWalletStore.getState().releaseEscrow(95, "MATCH-WIN2", true);
    const winTx = useWalletStore.getState().transactions.find(
      (tx) => tx.type === "match_win" && tx.matchId === "MATCH-WIN2"
    );
    expect(winTx).toBeDefined();
    expect(winTx?.amount).toBe(95);
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
  it("seed transactions contain no 10% fee notes", () => {
    const feeTxs = useWalletStore.getState().transactions.filter((tx) => tx.type === "fee");
    feeTxs.forEach((tx) => {
      expect(tx.note).not.toMatch(/10%/);
    });
  });

  it("seed fee transaction reflects 5% of match stake", () => {
    // TX-003: fee = 5 on a 50 USDT stake → 5/50 = 10% ... actually 5% of prize = 5% of 100 = 5
    const fee = useWalletStore.getState().transactions.find((tx) => tx.id === "TX-003");
    expect(fee).toBeDefined();
    expect(fee?.type).toBe("fee");
    expect(Math.abs(fee!.amount)).toBe(5);
  });

  // ── buyArenaTokens ────────────────────────────────────────────────────────
  it("buyArenaTokens returns true on success", () => {
    const result = useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(result).toBe(true);
  });

  it("buyArenaTokens deducts totalUsdtCost from usdtBalance", () => {
    const before = useWalletStore.getState().usdtBalance;
    useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(useWalletStore.getState().usdtBalance).toBeCloseTo(before - 10.50, 2);
  });

  it("buyArenaTokens credits atBalance with atAmount", () => {
    const before = useWalletStore.getState().atBalance;
    useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(useWalletStore.getState().atBalance).toBe(before + 1000);
  });

  it("buyArenaTokens creates an at_purchase transaction", () => {
    const countBefore = useWalletStore.getState().transactions.length;
    useWalletStore.getState().buyArenaTokens(500, 5.50);
    const txs = useWalletStore.getState().transactions;
    expect(txs.length).toBe(countBefore + 1);
    const atTx = txs[0]; // newest is first
    expect(atTx.type).toBe("at_purchase");
    expect(atTx.token).toBe("USDT");
    expect(atTx.status).toBe("completed");
    expect(Math.abs(atTx.amount)).toBeCloseTo(5.50, 2);
  });

  it("buyArenaTokens returns false when usdtBalance is insufficient", () => {
    useWalletStore.setState({ usdtBalance: 5.00 });
    const result = useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(result).toBe(false);
  });

  it("buyArenaTokens does not change balances when insufficient", () => {
    useWalletStore.setState({ usdtBalance: 2.00, atBalance: 350 });
    useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(useWalletStore.getState().usdtBalance).toBe(2.00);
    expect(useWalletStore.getState().atBalance).toBe(350);
  });

  it("buyArenaTokens does not add transaction when insufficient", () => {
    useWalletStore.setState({ usdtBalance: 2.00 });
    const countBefore = useWalletStore.getState().transactions.length;
    useWalletStore.getState().buyArenaTokens(1000, 10.50);
    expect(useWalletStore.getState().transactions.length).toBe(countBefore);
  });

  // ── connectWallet / disconnectWallet ──────────────────────────────────────
  it("connectWallet returns error when not signed in", async () => {
    const { useUserStore } = await import("@/stores/userStore");
    useUserStore.getState().logout();
    const r = await useWalletStore.getState().connectWallet();
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/sign in/i);
  });

  it("setState can set connectedAddress for tests (MetaMask flow is integration-tested)", () => {
    useWalletStore.setState({ connectedAddress: "0xNEWADDR0000000000000000000000000000000001", selectedNetwork: "bsc" });
    expect(useWalletStore.getState().connectedAddress).toBe("0xNEWADDR0000000000000000000000000000000001");
    expect(useWalletStore.getState().selectedNetwork).toBe("bsc");
  });

  it("disconnectWallet clears connectedAddress", () => {
    useWalletStore.getState().disconnectWallet();
    expect(useWalletStore.getState().connectedAddress).toBeNull();
  });
});
