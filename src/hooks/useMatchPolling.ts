/**
 * ARENA — Match Polling Hook
 * Polls the Engine API for live match status updates.
 * When the desktop client (capture app) validates a result,
 * this hook picks up the change and updates the UI in real-time.
 */

import { useEffect, useRef, useCallback } from "react";
import { useMatchStore } from "@/stores/matchStore";
import { useWalletStore } from "@/stores/walletStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { getMatchStatus, isEngineOnline } from "@/lib/engine-api";
import { resolveUserWonFromEngineWinner } from "@/lib/match-engine-sync";
import { useWsEvent } from "@/lib/ws-client";
import type { MatchStatus } from "@/types";

interface UseMatchPollingOptions {
  /** Polling interval in ms (default: 5000) */
  interval?: number;
  /** Only poll these specific match IDs (default: all in_progress) */
  matchIds?: string[];
  /** Enable/disable polling */
  enabled?: boolean;
}

/**
 * Hook that polls the Engine for match status changes.
 * When the desktop capture client sends a result → Engine validates →
 * this hook detects the status change → updates stores → triggers notifications.
 */
export function useMatchPolling({
  interval = 5000,
  matchIds,
  enabled = true,
}: UseMatchPollingOptions = {}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const engineOnlineRef = useRef<boolean | null>(null);

  const matches = useMatchStore((s) => s.matches);
  const updateMatchStatus = useMatchStore((s) => s.updateMatchStatus);
  const releaseEscrow = useWalletStore((s) => s.releaseEscrow);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const user = useUserStore((s) => s.user);

  // ── WS fast-path ─────────────────────────────────────────────────────────
  // match:status_changed replaces the 5s poll for matches we are watching.
  // The poll remains active as a fallback (VITE_ENABLE_WS unset or WS down).
  useWsEvent("match:status_changed", (raw) => {
    const d = raw as { match_id?: string; status?: MatchStatus; winner_id?: string };
    if (!d.match_id || !d.status) return;

    const match = matches.find((m) => m.id === d.match_id);
    if (!match) return;
    if (d.status === match.status) return;

    updateMatchStatus(d.match_id, d.status, d.winner_id);

    if (d.status === "completed") {
      const outcome = resolveUserWonFromEngineWinner(d.winner_id, user);
      if (outcome === null) {
        addNotification({
          type: "match_result",
          title: "Match completed",
          message: `Match finished. Confirming result…`,
        });
      } else {
        releaseEscrow(match.betAmount, d.match_id, outcome);
        addNotification({
          type: "match_result",
          title: outcome ? "🏆 Victory!" : "❌ Defeat",
          message: outcome ? `You won $${match.betAmount * 2}!` : `You lost $${match.betAmount}.`,
        });
      }
    }
    if (d.status === "disputed") {
      addNotification({
        type: "dispute",
        title: "⚠️ Match Disputed",
        message: `Match has been flagged for admin review.`,
      });
    }
  });

  const pollMatches = useCallback(async () => {
    // Check engine connectivity (only once per session)
    if (engineOnlineRef.current === null) {
      engineOnlineRef.current = await isEngineOnline();
      if (!engineOnlineRef.current) {
        console.warn("[Arena] Engine offline — using local mock data");
        return;
      }
      console.log("[Arena] Engine online — live polling active");
    }

    if (!engineOnlineRef.current) return;

    // Get active matches to poll
    const activeMatches = matchIds
      ? matches.filter((m) => matchIds.includes(m.id))
      : matches.filter((m) => m.status === "in_progress");

    for (const match of activeMatches) {
      try {
        const engineStatus = await getMatchStatus(match.id);

        // Map engine status to frontend MatchStatus
        const newStatus = engineStatus.status as MatchStatus;

        // If status changed — update everything
        if (newStatus !== match.status) {
          updateMatchStatus(
            match.id,
            newStatus,
            newStatus === "completed" ? engineStatus.winnerId : undefined,
          );

          if (newStatus === "completed") {
            // CONTRACT-ready: releaseEscrow only when engine supplies winner_id (or user logged in for comparison)
            const outcome = resolveUserWonFromEngineWinner(engineStatus.winnerId, user);
            if (outcome === null) {
              addNotification({
                type: "match_result",
                title: "Match completed",
                message: `Match ${match.id} finished. Winner not synced from engine yet — escrow release waits for API/on-chain confirmation.`,
              });
            } else {
              releaseEscrow(match.betAmount, match.id, outcome);
              addNotification({
                type: "match_result",
                title: outcome ? "🏆 Victory!" : "❌ Defeat",
                message: `Match ${match.id} completed. ${
                  outcome
                    ? `You won $${match.betAmount * 2}!`
                    : `You lost $${match.betAmount}.`
                }`,
              });
            }
          }

          if (newStatus === "disputed") {
            addNotification({
              type: "dispute",
              title: "⚠️ Match Disputed",
              message: `Match ${match.id} has been flagged for review.`,
            });
          }
        }
      } catch (err) {
        console.warn(`[Arena] Failed to poll match ${match.id}:`, err);
      }
    }
  }, [matches, matchIds, user, updateMatchStatus, releaseEscrow, addNotification]);

  useEffect(() => {
    if (!enabled) return;

    // Initial poll
    pollMatches();

    // Start interval
    intervalRef.current = setInterval(pollMatches, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, interval, pollMatches]);

  return {
    /** Force a poll right now */
    pollNow: pollMatches,
    /** Reset engine status check */
    resetEngineCheck: () => {
      engineOnlineRef.current = null;
    },
  };
}
