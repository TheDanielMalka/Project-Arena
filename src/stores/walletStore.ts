import { create } from "zustand";
import type { Transaction, TransactionType, TransactionStatus, Token, Network } from "@/types";

interface WalletState {
  tokens: Token[];
  transactions: Transaction[];
  dailyLimit: number;
  dailyUsed: number;
  selectedNetwork: Network;
  addresses: Record<Network, string>;

  // Actions
  deposit: (amount: number, token: string, network: Network) => Transaction;
  withdraw: (amount: number, token: string, toAddress: string) => Transaction | null;
  lockEscrow: (amount: number, matchId: string) => Transaction;
  releaseEscrow: (amount: number, matchId: string, won: boolean) => Transaction;
  addTransaction: (tx: Omit<Transaction, "id" | "timestamp">) => Transaction;
  setNetwork: (network: Network) => void;
  getTotalBalance: () => number;
  getAvailableBalance: () => number;
}

let txCounter = 100;

const SEED_TOKENS: Token[] = [
  { symbol: "USDT", name: "Tether USD", balance: 1247.50, usdValue: 1247.50, change24h: 0.01, icon: "💵", network: "bsc" },
  { symbol: "BNB", name: "BNB", balance: 2.847, usdValue: 1708.20, change24h: 3.42, icon: "🟡", network: "bsc" },
  { symbol: "SOL", name: "Solana", balance: 12.5, usdValue: 2187.50, change24h: -1.8, icon: "🟣", network: "solana" },
  { symbol: "USDC", name: "USD Coin", balance: 530.00, usdValue: 530.00, change24h: 0.00, icon: "🔵", network: "ethereum" },
  { symbol: "ETH", name: "Ethereum", balance: 0.45, usdValue: 1575.00, change24h: 2.15, icon: "💎", network: "ethereum" },
];

const SEED_TRANSACTIONS: Transaction[] = [
  { id: "TX-001", userId: "user-001", type: "deposit", amount: 500, token: "USDT", usdValue: 500, status: "completed", timestamp: "2026-03-08 15:30", txHash: "0xabc123...def456", from: "0x9e2...bb07", note: "Deposit from external wallet" },
  { id: "TX-002", userId: "user-001", type: "match_win", amount: 120, token: "USDT", usdValue: 120, status: "completed", timestamp: "2026-03-08 14:22", note: "Match M-2048 vs ShadowKing" },
  { id: "TX-003", userId: "user-001", type: "fee", amount: -12, token: "USDT", usdValue: 12, status: "completed", timestamp: "2026-03-08 14:22", note: "Platform fee (10%)" },
  { id: "TX-004", userId: "user-001", type: "match_loss", amount: -75, token: "USDT", usdValue: 75, status: "completed", timestamp: "2026-03-08 11:05", note: "Match M-2045 vs CyberWolf" },
  { id: "TX-005", userId: "user-001", type: "withdrawal", amount: -200, token: "USDT", usdValue: 200, status: "completed", timestamp: "2026-03-07 20:15", txHash: "0xfed987...cba654", to: "0x3c4...d5e8" },
  { id: "TX-006", userId: "user-001", type: "deposit", amount: 1.5, token: "SOL", usdValue: 262.50, status: "completed", timestamp: "2026-03-07 18:00", txHash: "5Xk8mN...pQ2rS" },
  { id: "TX-007", userId: "user-001", type: "refund", amount: 90, token: "USDT", usdValue: 90, status: "completed", timestamp: "2026-03-06 18:00", note: "Refund — Match M-2025 voided" },
  { id: "TX-008", userId: "user-001", type: "withdrawal", amount: -0.3, token: "ETH", usdValue: 1050, status: "pending", timestamp: "2026-03-08 16:00", txHash: "0x111aaa...222bbb", to: "0x7a3...f9c2" },
  { id: "TX-009", userId: "user-001", type: "match_win", amount: 50, token: "USDT", usdValue: 50, status: "completed", timestamp: "2026-03-06 12:30", note: "Match M-2020 vs StormRider" },
  { id: "TX-010", userId: "user-001", type: "deposit", amount: 0.5, token: "BNB", usdValue: 300, status: "failed", timestamp: "2026-03-05 09:45", txHash: "0xfail...123", note: "Insufficient gas" },
];

const ADDRESSES: Record<Network, string> = {
  bsc: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
  solana: "7Xf9Qk2LmN3pR4sT5uV6wX8yZ1aB2cD3eF4gH5iJ6kL",
  ethereum: "0x1b8E44a1C9d2F3e4A5b6C7d8E9f0A1B2C3D4E5F6",
};

export const useWalletStore = create<WalletState>((set, get) => ({
  tokens: SEED_TOKENS,
  transactions: SEED_TRANSACTIONS,
  dailyLimit: 500,
  dailyUsed: 200,
  selectedNetwork: "bsc",
  addresses: ADDRESSES,

  setNetwork: (network) => set({ selectedNetwork: network }),

  getTotalBalance: () => get().tokens.reduce((sum, t) => sum + t.usdValue, 0),

  getAvailableBalance: () => {
    const total = get().tokens.reduce((sum, t) => sum + t.usdValue, 0);
    // Subtract pending escrow from transactions
    const pendingEscrow = get().transactions
      .filter((tx) => tx.type === "escrow_lock" && tx.status === "pending")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    return total - pendingEscrow;
  },

  addTransaction: (txData) => {
    const tx: Transaction = {
      ...txData,
      id: `TX-${++txCounter}`,
      timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
    set((state) => ({ transactions: [tx, ...state.transactions] }));
    return tx;
  },

  deposit: (amount, token, network) => {
    // Update token balance
    set((state) => ({
      tokens: state.tokens.map((t) =>
        t.symbol === token && t.network === network
          ? { ...t, balance: t.balance + amount, usdValue: t.usdValue + amount }
          : t
      ),
    }));
    return get().addTransaction({
      userId: "user-001",
      type: "deposit",
      amount,
      token,
      usdValue: amount,
      status: "completed",
      note: `Deposit to ${network}`,
    });
  },

  withdraw: (amount, token, toAddress) => {
    const state = get();
    if (amount + state.dailyUsed > state.dailyLimit) return null;

    const tokenObj = state.tokens.find((t) => t.symbol === token);
    if (!tokenObj || tokenObj.balance < amount) return null;

    set((s) => ({
      tokens: s.tokens.map((t) =>
        t.symbol === token && t.network === s.selectedNetwork
          ? { ...t, balance: t.balance - amount, usdValue: t.usdValue - amount }
          : t
      ),
      dailyUsed: s.dailyUsed + amount,
    }));

    return get().addTransaction({
      userId: "user-001",
      type: "withdrawal",
      amount: -amount,
      token,
      usdValue: amount,
      status: "pending",
      to: toAddress,
      note: `Withdrawal to ${toAddress.slice(0, 12)}...`,
    });
  },

  lockEscrow: (amount, matchId) => {
    set((state) => ({
      tokens: state.tokens.map((t) =>
        t.symbol === "USDT" && t.network === "bsc"
          ? { ...t, balance: t.balance - amount, usdValue: t.usdValue - amount }
          : t
      ),
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
  },

  releaseEscrow: (amount, matchId, won) => {
    if (won) {
      set((state) => ({
        tokens: state.tokens.map((t) =>
          t.symbol === "USDT" && t.network === "bsc"
            ? { ...t, balance: t.balance + amount, usdValue: t.usdValue + amount }
            : t
        ),
      }));
    }
    // Mark the escrow_lock as completed
    set((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.matchId === matchId && tx.type === "escrow_lock" ? { ...tx, status: "completed" as TransactionStatus } : tx
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
      note: `Match ${matchId} — ${won ? "Victory!" : "Defeat"}`,
    });
  },
}));
