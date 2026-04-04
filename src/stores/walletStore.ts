import { create } from "zustand";
import { parseEther } from "ethers";
import type { Transaction, TransactionType, TransactionStatus, Network } from "@/types";
import { useUserStore } from "@/stores/userStore";
import { apiGetMatchStatus, apiPatchMeWalletAddress } from "@/lib/engine-api";
import { connectMetaMaskAndSignOwnership, depositToEscrow } from "@/lib/metamaskBsc";

export type ConnectWalletResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Architecture note ──────────────────────────────────────────────────────
// Arena is NON-CUSTODIAL. The platform never holds user funds.
// Flow: User wallet → ArenaEscrow (smart contract) → Winner's wallet
//
// "Balance" shown in UI is read directly from the blockchain via wagmi:
//   DB-ready: const { data } = useBalance({ address: walletAddress, token: USDT_CONTRACT })
//
// Arena Tokens (AT) are the only platform-managed balance (for Forge store).
//   DB-ready: GET /api/users/me/at-balance
// ────────────────────────────────────────────────────────────────────────────

export const PLATFORM_BETTING_MAX = 500;

interface WalletState {
  // On-chain wallet (connected external wallet — MetaMask / WalletConnect)
  // DB-ready: address + network come from wagmi useAccount()
  connectedAddress: string | null;
  selectedNetwork: Network;

  // On-chain balance — read-only from blockchain
  // DB-ready: wagmi useBalance({ address, token: USDT_ADDRESS }) per network
  // Stored locally only for UI preview / daily-limit enforcement before tx signing
  usdtBalance: number;

  // Arena Tokens — platform currency for Forge store (NOT on-chain)
  // DB-ready: GET /api/users/me/at-balance  |  POST /api/forge/purchase deducts AT
  // Forge USDT→AT quote (live pricing): GET /api/forge/exchange-rate → ForgeExchangeRateQuote in types
  atBalance: number;

  // Daily betting safety limit (user-chosen, enforced client + server)
  platformBettingMax: number;
  dailyBettingLimit: number;
  dailyBettingUsed: number;

  // Transaction history — on-chain events + AT activity
  // DB-ready: GET /api/wallet/transactions?userId=:id
  transactions: Transaction[];

  // Actions
  // DB-ready: GET /match/:id/status + ArenaEscrow.deposit via MetaMask ({ value: stakeWei })
  lockEscrow: (amount: number, matchId: string) => Promise<Transaction | null>;
  // DB-ready: POST /api/escrow/release → emitted by ArenaEscrow.declareWinner() event
  releaseEscrow: (amount: number, matchId: string, won: boolean) => Transaction;
  // DB-ready: POST /api/escrow/cancel → wagmi writeContract(ArenaEscrow.cancelDeposit)
  cancelEscrow: (matchId: string) => boolean;
  // DB-ready: POST /api/wallet/transactions (internal log entry)
  addTransaction: (tx: Omit<Transaction, "id" | "timestamp">) => Transaction;
  // DB-ready: PATCH /api/wallet/daily-limit
  setDailyBettingLimit: (limit: number) => void;
  // DB-ready: wagmi useBalance() — returns live chain value; this is the local preview
  getAvailableBalance: () => number;
  /** MetaMask (EIP-1193) on BSC Testnet — sign ownership message, then PATCH /users/me `wallet_address`. */
  connectWallet: () => Promise<ConnectWalletResult>;
  disconnectWallet: () => void;
  /** DB-ready: POST /api/wallet/buy-at — mock deducts USDT, credits atBalance; returns false if insufficient */
  buyArenaTokens: (atAmount: number, totalUsdtCost: number) => boolean;
}

let txCounter = 100;

// Seed transactions — realistic non-custodial history
// No deposits/withdrawals: only escrow events, match results, AT activity, refunds
const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: "TX-001", userId: "user-001", type: "escrow_lock",
    amount: -50, token: "USDT", usdValue: 50, status: "completed",
    timestamp: "2026-03-08 15:30", txHash: "0xabc123...def456",
    matchId: "M-2048", note: "Escrow locked — CS2 5v5 ($50)",
  },
  {
    id: "TX-002", userId: "user-001", type: "match_win",
    amount: 95, token: "USDT", usdValue: 95, status: "completed",
    timestamp: "2026-03-08 16:10", txHash: "0xwin001...abc",
    matchId: "M-2048", note: "Victory — CS2 5v5 vs ShadowKing (×2 − 5% fee)",
  },
  {
    id: "TX-003", userId: "user-001", type: "fee",
    amount: -5, token: "USDT", usdValue: 5, status: "completed",
    timestamp: "2026-03-08 16:10", matchId: "M-2048", note: "Platform fee 5% — Match M-2048",
  },
  {
    id: "TX-004", userId: "user-001", type: "escrow_lock",
    amount: -75, token: "USDT", usdValue: 75, status: "completed",
    timestamp: "2026-03-08 11:00", txHash: "0xesc002...fed",
    matchId: "M-2045", note: "Escrow locked — Valorant 5v5 ($75)",
  },
  {
    id: "TX-005", userId: "user-001", type: "match_loss",
    amount: -75, token: "USDT", usdValue: 75, status: "completed",
    timestamp: "2026-03-08 11:50", matchId: "M-2045", note: "Defeat — Valorant 5v5 vs CyberWolf",
  },
  {
    id: "TX-006", userId: "user-001", type: "refund",
    amount: 90, token: "USDT", usdValue: 90, status: "completed",
    timestamp: "2026-03-07 18:00", txHash: "0xref001...777",
    matchId: "M-2025", note: "Refund — Match M-2025 cancelled (room expired)",
  },
  {
    id: "TX-007", userId: "user-001", type: "escrow_lock",
    amount: -50, token: "USDT", usdValue: 50, status: "completed",
    timestamp: "2026-03-06 12:00", txHash: "0xesc003...abc",
    matchId: "M-2020", note: "Escrow locked — CS2 1v1 ($50)",
  },
  {
    id: "TX-008", userId: "user-001", type: "match_win",
    amount: 95, token: "USDT", usdValue: 95, status: "completed",
    timestamp: "2026-03-06 12:30", txHash: "0xwin002...def",
    matchId: "M-2020", note: "Victory — CS2 1v1 vs StormRider (×2 − 5% fee)",
  },
  {
    id: "TX-009", userId: "user-001", type: "at_purchase",
    amount: -20, token: "USDT", usdValue: 20, status: "completed",
    timestamp: "2026-03-05 14:00", note: "Purchased 200 AT — Forge store",
  },
  {
    id: "TX-010", userId: "user-001", type: "at_spend",
    amount: -150, token: "AT", usdValue: 0, status: "completed",
    timestamp: "2026-03-05 14:05", note: "Purchased Dragon Blade skin — Forge",
  },
];

export const useWalletStore = create<WalletState>((set, get) => ({
  // DB-ready: from wagmi useAccount(); null until MetaMask link succeeds
  connectedAddress: null,
  selectedNetwork: "bsc",

  // DB-ready: from wagmi useBalance() — USDT on BSC
  usdtBalance: 1247.50,

  // DB-ready: GET /api/users/me/at-balance
  atBalance: 350,

  platformBettingMax: PLATFORM_BETTING_MAX,
  dailyBettingLimit: 500,
  dailyBettingUsed: 200,
  transactions: SEED_TRANSACTIONS,

  connectWallet: async (): Promise<ConnectWalletResult> => {
    try {
      const token = useUserStore.getState().token;
      if (!token) {
        return { ok: false as const, error: "Sign in to link your wallet." };
      }
      const { address } = await connectMetaMaskAndSignOwnership();
      const saved = await apiPatchMeWalletAddress(token, address);
      if (!saved) {
        return {
          ok: false as const,
          error:
            "Could not save wallet to your profile. The server may not accept wallet_address on PATCH /users/me yet.",
        };
      }
      set({ connectedAddress: address, selectedNetwork: "bsc" });
      return { ok: true as const };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "ACTION_REJECTED" || /user rejected|denied transaction/i.test(err.message ?? "")) {
        return { ok: false as const, error: "Request was cancelled in the wallet." };
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/wallet_switchEthereumChain|chain/i.test(msg)) {
        return {
          ok: false as const,
          error: "Switch to BNB Smart Chain Testnet (chain 97) in your wallet and try again.",
        };
      }
      return { ok: false as const, error: msg || "Could not connect wallet." };
    }
  },

  disconnectWallet: () => {
    // DB-ready: wagmi useDisconnect() + optional PATCH wallet_address null
    set({ connectedAddress: null });
  },

  setDailyBettingLimit: (limit) =>
    set({ dailyBettingLimit: Math.min(Math.max(limit, 50), PLATFORM_BETTING_MAX) }),

  getAvailableBalance: () => get().usdtBalance,

  addTransaction: (txData) => {
    const tx: Transaction = {
      ...txData,
      id: `TX-${++txCounter}`,
      timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
    set((state) => ({ transactions: [tx, ...state.transactions] }));
    return tx;
  },

  lockEscrow: async (amount, matchId) => {
    const legacyLock = (): Transaction | null => {
      const state = get();
      if (amount + state.dailyBettingUsed > state.dailyBettingLimit) return null;
      if (state.usdtBalance < amount) return null;
      set((s) => ({
        usdtBalance: s.usdtBalance - amount,
        dailyBettingUsed: s.dailyBettingUsed + amount,
      }));
      return get().addTransaction({
        userId: "user-001",
        type: "escrow_lock",
        amount: -amount,
        token: "USDT",
        usdValue: amount,
        status: "pending",
        matchId,
        note: `Escrow locked for match ${matchId}`,
      });
    };

    // Forge / mock entry fees — no on-chain match id (see forgeStore joinEvent).
    if (matchId.startsWith("forge-event-")) {
      return legacyLock();
    }

    const token = useUserStore.getState().token;
    const status = await apiGetMatchStatus(matchId, token ?? undefined);
    if (status == null || status.on_chain_match_id == null || status.your_team == null) {
      return null;
    }

    const state = get();
    if (amount + state.dailyBettingUsed > state.dailyBettingLimit) return null;
    if (state.usdtBalance < amount) return null;

    const stakeWei = parseEther(String(status.stake_per_player ?? amount));
    let txHash: string;
    try {
      txHash = await depositToEscrow(
        BigInt(String(status.on_chain_match_id)),
        status.your_team,
        stakeWei,
      );
    } catch {
      return null;
    }

    set((s) => ({
      usdtBalance: s.usdtBalance - amount,
      dailyBettingUsed: s.dailyBettingUsed + amount,
    }));

    return get().addTransaction({
      userId: "user-001",
      type: "escrow_lock",
      amount: -amount,
      token: "USDT",
      usdValue: amount,
      status: "pending",
      matchId,
      txHash,
      note: `Escrow locked for match ${matchId}`,
    });
  },

  cancelEscrow: (matchId) => {
    const escrowTx = get().transactions.find(
      (tx) => tx.matchId === matchId && tx.type === "escrow_lock" && tx.status === "pending"
    );
    if (!escrowTx) return false;

    const amount = Math.abs(escrowTx.amount);

    // DB-ready: wagmi writeContract(ArenaEscrow.cancelDeposit, { matchId })
    //           → on MatchCancelled event: refund usdtBalance
    set((state) => ({
      usdtBalance: state.usdtBalance + amount,
      dailyBettingUsed: Math.max(0, state.dailyBettingUsed - amount),
      transactions: state.transactions.map((tx) =>
        tx.matchId === matchId && tx.type === "escrow_lock" && tx.status === "pending"
          ? { ...tx, status: "cancelled" as const }
          : tx
      ),
    }));

    get().addTransaction({
      userId: "user-001",
      type: "refund",
      amount,
      token: "USDT",
      usdValue: amount,
      status: "completed",
      matchId,
      note: `Escrow cancelled — left match ${matchId} before lock`,
    });

    return true;
  },

  releaseEscrow: (amount, matchId, won) => {
    // DB-ready: triggered by ArenaEscrow.declareWinner() event via server webhook
    //           → wagmi watches for WinnerDeclared(matchId, winner, amount) event
    if (won) {
      set((state) => ({ usdtBalance: state.usdtBalance + amount }));
    }
    set((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.matchId === matchId && tx.type === "escrow_lock"
          ? { ...tx, status: "completed" as TransactionStatus }
          : tx
      ),
    }));
    return get().addTransaction({
      userId: "user-001",
      type: won ? "match_win" : "match_loss",
      amount: won ? amount : -amount,
      token: "USDT",
      usdValue: amount,
      status: "completed",
      matchId,
      note: `Match ${matchId} — ${won ? "Victory! (×2 − 5% fee)" : "Defeat"}`,
    });
  },

  buyArenaTokens: (atAmount, totalUsdtCost) => {
    const state = get();
    if (state.usdtBalance < totalUsdtCost) return false;
    set((s) => ({
      usdtBalance: s.usdtBalance - totalUsdtCost,
      atBalance: s.atBalance + atAmount,
    }));
    get().addTransaction({
      userId: "user-001",
      type: "at_purchase",
      amount: -totalUsdtCost,
      token: "USDT",
      usdValue: totalUsdtCost,
      status: "completed",
      note: `Purchased ${atAmount} AT — buy flow`,
    });
    return true;
  },
}));
