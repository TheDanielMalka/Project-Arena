/**
 * ARENA — Live match score polling hook.
 *
 * Polls GET /matches/:id/live-state every 5 seconds while the match is
 * in_progress and returns the latest CT/T round score.
 *
 * Returns null until the first successful response (warmup / pre-round).
 * Automatically stops polling when the match is no longer in_progress.
 */

import { useState, useEffect, useRef } from "react";
import { apiGetLiveState } from "@/lib/engine-api";
import type { MatchLiveState } from "@/lib/engine-api";

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

  useEffect(() => {
    if (!enabled || !matchId || !token) {
      setLiveState(null);
      return;
    }

    const poll = async () => {
      const data = await apiGetLiveState(token, matchId);
      if (data !== null) {
        setLiveState(data);
      }
    };

    poll();
    timerRef.current = setInterval(poll, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [matchId, token, interval, enabled]);

  return liveState;
}
