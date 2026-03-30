/**
 * ARENA — Engine Connection Status Hook
 *
 * Polls the local Engine API for health and syncs results into clientStore.
 * All components read status from clientStore — this hook is the only poller.
 *
 * Poll intervals:
 *   15s  — health check (default, configurable; faster sync than legacy 30s)
 *   10s  — when status is "connected" (faster to detect when capture becomes ready)
 *   Burst — on hook mount + tab focus, runs extra checks so badge updates quickly after client starts.
 *
 * WS-ready: when WebSocket is connected this hook can be replaced with
 *   a WS listener that calls clientStore.setStatus() directly on "client:*" events.
 *   The HTTP polling stays as fallback if WS is not available.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getEngineHealth, type EngineHealth } from "@/lib/engine-api";
import { useClientStore } from "@/stores/clientStore";

const BURST_DELAYS_MS = [0, 1_500, 4_000] as const;

export function useEngineStatus(pollInterval = 15_000) {
  const syncFromHealth = useClientStore((s) => s.syncFromHealth);
  const clientStatus   = useClientStore((s) => s.status);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const h = await getEngineHealth();
      setHealth(h);
      syncFromHealth(h);
    } catch {
      setHealth(null);
      syncFromHealth(null);
    }
  }, [syncFromHealth]);

  // Burst after mount so "client just started" reflects in UI within seconds, not one full interval.
  useEffect(() => {
    const timers = BURST_DELAYS_MS.map((ms) =>
      window.setTimeout(() => {
        void check();
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [check]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  useEffect(() => {
    // Poll faster when "connected" to detect when capture subsystem becomes ready
    const interval = clientStatus === "connected" ? 10_000 : pollInterval;

    check();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(check, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check, pollInterval, clientStatus]);

  return {
    online: clientStatus === "ready" || clientStatus === "in_match",
    health,
    status: clientStatus,
    check,
  };
}
