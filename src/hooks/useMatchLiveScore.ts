/**
 * ARENA — Live match score hook.
 *
 * Primary: WS "match:live_score" event — updates instantly on each HUD
 *          screenshot uploaded by any player in the match.
 * Fallback: polls GET /matches/:id/live-state every 5 seconds (catches
 *           missed WS events and pre-WS clients).
 *
 * Returns null until the first successful response (warmup / pre-round).
 * Automatically stops polling when the match is no longer in_progress.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { apiGetLiveState } from "@/lib/engine-api";
import type { MatchLiveState } from "@/lib/engine-api";
import { useWsEvent } from "@/lib/ws-client";

interface UseMatchLiveScoreOptions {
  matchId: string | null | undefined;
  token: string | null | undefined;
  /** Polling interval in ms. Default: 5000 */
  interval?: number;
  /** Set to false to suspend polling (e.g. match completed). Default: true */
  enabled?: boolean;
}

export function useMatchLiveScore({
  matchId,
  token,
  interval = 5_000,
  enabled = true,
}: UseMatchLiveScoreOptions): MatchLiveState | null {
  const [liveState, setLiveState] = useState<MatchLiveState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!enabled || !matchId || !token) return;
    const data = await apiGetLiveState(token, matchId);
    if (data !== null) setLiveState(data);
  }, [enabled, matchId, token]);

  // WS fast-path — update immediately when the engine fires a live score.
  // Filter by match_id so a spectator watching two tabs doesn't cross-pollute.
  useWsEvent("match:live_score", (payload: unknown) => {
    const p = payload as { match_id?: string; ct_score?: number; t_score?: number; round_confirmed?: boolean };
    if (!matchId || p.match_id !== matchId) return;
    setLiveState((prev) => ({
      match_id:        matchId,
      ct_score:        p.ct_score        ?? prev?.ct_score        ?? 0,
      t_score:         p.t_score         ?? prev?.t_score         ?? 0,
      round_confirmed: p.round_confirmed ?? prev?.round_confirmed ?? false,
      first_round_at:  prev?.first_round_at ?? null,
      submissions:     (prev?.submissions ?? 0) + 1,
      updated_at:      new Date().toISOString(),
    }));
  });

  useEffect(() => {
    if (!enabled || !matchId || !token) {
      setLiveState(null);
      return;
    }

    poll();
    timerRef.current = setInterval(poll, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [matchId, token, interval, enabled, poll]);

  return liveState;
}
