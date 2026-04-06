import { useEffect, useRef } from "react";
import { apiGetActiveMatch, mapApiMatchRowToMatch } from "@/lib/engine-api";
import { useMatchStore } from "@/stores/matchStore";
import { looksLikeServerMatchId } from "@/lib/gameAccounts";

/** Fast room-status sync while the user is in a room (doc 6.2). */
const ACTIVE_ROOM_POLL_MS = 3000;

/**
 * Polls GET /match/active while in a room and updates the local store from server truth.
 * This is the source of truth for status transitions (waiting → in_progress → ...),
 * independent of any optimistic countdown timers.
 */
export function useActiveRoomServerSync(
  token: string | null | undefined,
  activeRoomId: string | null | undefined,
): void {
  const missesRef = useRef(0);

  useEffect(() => {
    if (!token || !activeRoomId) return;

    let intervalId = 0;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const res = await apiGetActiveMatch(token);
      if (cancelled) return;

      const m = res?.match ?? null;
      if (!m?.match_id) {
        missesRef.current += 1;
        if (missesRef.current >= 2 && looksLikeServerMatchId(activeRoomId)) {
          useMatchStore.getState().setActiveRoomId(null);
        }
        return;
      }

      missesRef.current = 0;
      if (m.match_id !== activeRoomId) {
        useMatchStore.getState().setActiveRoomId(m.match_id);
      }

      const mapped = mapApiMatchRowToMatch({
        id: m.match_id,
        match_id: m.match_id,
        game: m.game,
        status: m.status,
        bet_amount: m.bet_amount,
        stake_currency: m.stake_currency,
        type: m.type,
        code: m.code,
        created_at: m.created_at,
        mode: m.mode,
        host_id: m.host_id,
        host_username: m.host_username,
        max_players: m.max_players,
        max_per_team: m.max_per_team,
        match_players: m.players,
      });
      if (mapped) {
        useMatchStore.getState().addMatch(mapped);
      }
    };

    const clearPoll = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = 0;
      }
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== "visible") {
        clearPoll();
        return;
      }
      void tick();
      if (!intervalId) {
        intervalId = window.setInterval(() => void tick(), ACTIVE_ROOM_POLL_MS);
      }
    };

    onVisibilityOrFocus();
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      cancelled = true;
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [token, activeRoomId]);
}

