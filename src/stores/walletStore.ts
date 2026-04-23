import { create } from "zustand";
import { parseEther } from "viem";
import { disconnect as wagmiCoreDisconnect } from "@wagmi/core";
import type { Transaction, TransactionType, TransactionStatus, Network } from "@/types";
import { useUserStore } from "@/stores/userStore";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { apiGetMatchStatus, apiPatchMeWalletAddress, apiUnlinkWallet } from "@/lib/engine-api";
import { friendlyChainErrorMessage } from "@/lib/friendlyChainError";
import { connectMetaMaskAndSignOwnership, depositToEscrow } from "@/lib/metamaskBsc";
import { publishAtToWalletAndForge } from "@/lib/sessionAtSync";

let lastLockEscrowFailureMessage: string | null = null;

/** After `lockEscrow` returns null, call once for a user-readable chain error (then cleared). */
export function consumeLastLockEscrowFailureMessage(): string | null {
  const m = lastLockEscrowFailureMessage;
  lastLockEscrowFailureMessage = null;
  return m;
}

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
  /** Unlink wallet from account (PATCH /users/me { unlink_wallet: true }). */
  disconnectWallet: () => Promise<ConnectWalletResult>;
  /** Disconnect current wallet then immediately re-connect with a new MetaMask address. */
  switchWallet: () => Promise<ConnectWalletResult>;
  /** Until POST /wallet/buy-at: local mock only; then refreshProfileFromServer */
  buyArenaTokens: (atAmount: number, totalUsdtCost: number) => boolean;
  /** Called by WagmiAutoSync when wagmi reconnects on page reload. */
  setConnectedAddress: (address: string | null) => void;
}

let txCounter = 100;

export const useWalletStore = create<WalletState>((set, get) => ({
  // DB-ready: from wagmi useAccount(); null until MetaMask link succeeds
  connectedAddress: null,
  selectedNetwork: "bsc",

  usdtBalance: 0,

  atBalance: 0,

  platformBettingMax: PLATFORM_BETTING_MAX,
  dailyBettingLimit: 500,
  dailyBettingUsed: 0,
  transactions: [],

  connectWallet: async (): Promise<ConnectWalletResult> => {
    try {
      const token = useUserStore.getState().token;
      if (!token) {
        return { ok: false as const, error: "Sign in to link your wallet." };
      }
      const { address } = await connectMetaMaskAndSignOwnership();
      const result = await apiPatchMeWalletAddress(token, address);
      if (result.ok === false) {
        return { ok: false as const, error: result.error };
      }
      set({ connectedAddress: address, selectedNetwork: "bsc" });
      useUserStore.getState().setLinkedWalletAddress(address);
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
      return { ok: false as const, error: friendlyChainErrorMessage(e) };
    }
  },

  disconnectWallet: async (): Promise<ConnectWalletResult> => {
    try {
      wagmiCoreDisconnect(wagmiConfig).catch(() => {});
      const token = useUserStore.getState().token;
      if (!token) return { ok: false as const, error: "Sign in to manage your wallet." };
      const result = await apiUnlinkWallet(token);
      if (result.ok === false) return { ok: false as const, error: result.error };
      set({ connectedAddress: null });
      useUserStore.getState().unlinkWalletFromProfile();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: "Could not disconnect wallet." };
    }
  },

  switchWallet: async (): Promise<ConnectWalletResult> => {
    const disconnectResult = await get().disconnectWallet();
    if (disconnectResult.ok === false) return disconnectResult;
    return get().connectWallet();
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
    lastLockEscrowFailureMessage = null;

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
    // on_chain_match_id may be null if EscrowClient hasn't processed MatchCreated yet.
    // Retry up to 3x with 5s apart before giving up.
    let status = await apiGetMatchStatus(matchId, token ?? undefined);
    if (status?.on_chain_match_id == null) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        status = await apiGetMatchStatus(matchId, token ?? undefined);
        if (status?.on_chain_match_id != null) break;
      }
    }
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
    } catch (e) {
      lastLockEscrowFailureMessage = friendlyChainErrorMessage(e);
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

  setConnectedAddress: (address) => {
    set({ connectedAddress: address });
    if (address) useUserStore.getState().setLinkedWalletAddress(address);
    else useUserStore.getState().unlinkWalletFromProfile();
  },

  buyArenaTokens: (atAmount, totalUsdtCost) => {
    const state = get();
    if (state.usdtBalance < totalUsdtCost) return false;
    const uid = useUserStore.getState().user?.id ?? "user";
    const nextAt = state.atBalance + atAmount;
    set((s) => ({
      usdtBalance: s.usdtBalance - totalUsdtCost,
      atBalance: nextAt,
    }));
    publishAtToWalletAndForge(nextAt);
    useUserStore.setState((s) => (s.user ? { user: { ...s.user, atBalance: nextAt } } : {}));
    get().addTransaction({
      userId: uid,
      type: "at_purchase",
      amount: -totalUsdtCost,
      token: "USDT",
      usdValue: totalUsdtCost,
      status: "completed",
      note: `Purchased ${atAmount} AT — buy flow (mock until POST /wallet/buy-at)`,
    });
    return true;
  },
}));
