/**
 * ARENA — Engine Connection Status Hook
 *
 * Phase 4: polls GET /client/status (canonical endpoint) to sync clientStore.
 * Replaces the legacy GET /health → syncFromHealth() path as the primary gate.
 *
 * Two parallel checks:
 *   1. getClientStatus(walletAddress)  → syncFromClientStatus() — gates canPlay()
 *   2. getEngineHealth()               → syncFromHealth()       — gates engine dot in header
 *
 * Poll intervals:
 *   15s  — default
 *   10s  — when status is "connected" (detect capture readiness faster)
 *   Burst — on mount [0ms, 1.5s, 4s] + on tab focus
 *
 * WS-ready: replace polling with WS "client:*" events → setStatus() directly.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getEngineHealth, getClientStatus, type EngineHealth } from "@/lib/engine-api";
import { useClientStore } from "@/stores/clientStore";
import { useUserStore } from "@/stores/userStore";
import { useWsEvent } from "@/lib/ws-client";

const BURST_DELAYS_MS = [0, 1_500, 4_000] as const;

export function useEngineStatus(pollInterval = 15_000) {
  const syncFromHealth        = useClientStore((s) => s.syncFromHealth);
  const syncFromClientStatus  = useClientStore((s) => s.syncFromClientStatus);
  const clientStatus          = useClientStore((s) => s.status);
  const walletAddress         = useUserStore((s) => s.user?.walletAddress);
  const isAuthenticated       = useUserStore((s) => s.isAuthenticated);
  const token                 = useUserStore((s) => s.token);

  const [health, setHealth] = useState<EngineHealth | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    // ── Primary: GET /client/status (Phase 4) ────────────────────────────
    // Prefer token-based lookup (backend resolves user_id → session binding).
    // Fallback to walletAddress only when token is unavailable.
    if (isAuthenticated && (token || walletAddress)) {
      const statusData = token
        ? await getClientStatus(undefined, token)
        : await getClientStatus(walletAddress);
      syncFromClientStatus(statusData);
    } else {
      // Not logged in → client is definitely not ready
      syncFromClientStatus(null);
    }

    // ── Secondary: GET /health — engine dot in header ─────────────────────
    // Runs independently so the header can show engine connectivity regardless
    // of whether a user is logged in.
    try {
      const h = await getEngineHealth();
      setHealth(h);
      // Only apply syncFromHealth if we are NOT using the new client/status path
      // (to avoid overwriting the authoritative syncFromClientStatus result).
      if (!isAuthenticated || (!token && !walletAddress)) {
        syncFromHealth(h);
      }
    } catch {
      setHealth(null);
      if (!isAuthenticated || (!token && !walletAddress)) {
        syncFromHealth(null);
      }
    }
  }, [syncFromHealth, syncFromClientStatus, walletAddress, isAuthenticated, token]);

  // WS fast-path — re-check immediately when the desktop client changes state.
  // The polling intervals remain active as fallback (WS disabled or down).
  useWsEvent("client:status_changed", () => {
    void check();
  });

  // Burst after mount — badge updates quickly after client starts.
  useEffect(() => {
    const timers = BURST_DELAYS_MS.map((ms) =>
      window.setTimeout(() => { void check(); }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [check]);

  // Re-check on tab focus (user may have just started the client)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  // Interval polling — faster when client is online (ready/in_match) to detect
  // disconnects quickly. Slower when already disconnected (saves requests).
  useEffect(() => {
    const interval =
      clientStatus === "ready" || clientStatus === "in_match" ? 5_000  :  // detect disconnect fast
      clientStatus === "connected"                             ? 10_000 :  // detect capture-ready fast
      pollInterval;                                                        // disconnected → slow poll
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
