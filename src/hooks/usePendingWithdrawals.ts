import { useState, useEffect, useCallback, useRef } from "react";
import { useUserStore } from "@/stores/userStore";
import { apiGetPendingWithdrawals } from "@/lib/engine-api";
import { withdrawPendingOnChain } from "@/lib/metamaskBsc";
import type { PendingWithdrawalResponse } from "@/types";

const POLL_INTERVAL_MS = 30_000;

export interface UsePendingWithdrawalsResult {
  pendingWei: bigint;
  hasPending: boolean;
  loading: boolean;
  withdrawing: boolean;
  error: string | null;
  withdraw: () => Promise<void>;
  refresh: () => void;
}

export function usePendingWithdrawals(): UsePendingWithdrawalsResult {
  const token = useUserStore((s) => s.token);
  const [data, setData] = useState<PendingWithdrawalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await apiGetPendingWithdrawals(token);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetch();
    intervalRef.current = setInterval(() => void fetch(), POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetch]);

  const withdraw = useCallback(async () => {
    setError(null);
    setWithdrawing(true);
    try {
      await withdrawPendingOnChain();
      await fetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Withdrawal failed";
      setError(msg);
    } finally {
      setWithdrawing(false);
    }
  }, [fetch]);

  const onChainWei = BigInt(data?.on_chain_wei ?? "0");
  const dbWei      = BigInt(data?.db_tracked_wei ?? "0");
  const pendingWei = onChainWei > dbWei ? onChainWei : dbWei;

  return {
    pendingWei,
    hasPending: pendingWei > 0n,
    loading,
    withdrawing,
    error,
    withdraw,
    refresh: () => void fetch(),
  };
}
