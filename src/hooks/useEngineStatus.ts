/**
 * ARENA — Engine Connection Status Hook
 *
 * Polls the local Engine API for health and syncs results into clientStore.
 * All components read status from clientStore — this hook is the only poller.
 *
 * Poll intervals:
 *   30s  — health check (default, configurable)
 *   10s  — when status is "connected" (faster to detect when capture becomes ready)
 *
 * WS-ready: when WebSocket is connected this hook can be replaced with
 *   a WS listener that calls clientStore.setStatus() directly on "client:*" events.
 *   The HTTP polling stays as fallback if WS is not available.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getEngineHealth, type EngineHealth } from "@/lib/engine-api";
import { useClientStore } from "@/stores/clientStore";

export function useEngineStatus(pollInterval = 30_000) {
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
