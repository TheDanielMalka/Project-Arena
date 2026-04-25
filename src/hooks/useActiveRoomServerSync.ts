import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import {
  apiGetActiveMatch,
  apiMatchHeartbeat,
  mapApiMatchRowToMatch,
} from "@/lib/engine-api";
import { useMatchStore } from "@/stores/matchStore";
import { looksLikeServerMatchId } from "@/lib/gameAccounts";
import { useWsEvent } from "@/lib/ws-client";
import type { Game, MatchMode, MatchStatus } from "@/types";

/** Heartbeat interval while status is "waiting". */
const HEARTBEAT_POLL_MS = 4_000;

/** Legacy fallback poll interval when status is "in_progress". */
const ACTIVE_ROOM_POLL_MS = 3_000;

/**
 * Polls the room while the user is in it:
 *  - status "waiting"               -> POST /matches/{id}/heartbeat  (every 4s)
 *  - status "in_progress"           -> GET  /match/active             (every 3s, legacy)
 *
 * When hb.in_match === false: clears activeRoomId + shows toast.
 * Roster + your_team always come from server truth.
 */
export function useActiveRoomServerSync(
  token: string | null | undefined,
  activeRoomId: string | null | undefined,
): void {
  const missesRef = useRef(0);

  // ── WS fast-path: match:status_changed ───────────────────────────────────
  // When the server pushes a status change we apply it immediately so the UI
  // reacts in <100ms instead of waiting up to 4s for the next poll tick.
  useWsEvent("match:status_changed", (data) => {
    const d = data as { match_id?: string; status?: MatchStatus; winner_id?: string };
    if (!d.match_id || d.match_id !== activeRoomId) return;
    if (d.status) {
      useMatchStore.getState().updateMatchStatus(d.match_id, d.status, d.winner_id);
      if (d.status === "cancelled") {
        useMatchStore.getState().setActiveRoomId(null);
        toast.error("Match ended");
      }
    }
  });

  // ── WS fast-path: match:roster_updated ───────────────────────────────────
  // Server pushes this when a player joins or leaves; we trigger an immediate
  // heartbeat poll instead of waiting for the next interval so the roster UI
  // stays accurate without a separate WS roster payload.
  const triggerRef = useRef<(() => void) | null>(null);
  useWsEvent("match:roster_updated", (data) => {
    const d = data as { match_id?: string };
    if (d.match_id === activeRoomId && triggerRef.current) {
      void triggerRef.current();
    }
  });

  useEffect(() => {
    if (!token || !activeRoomId) return;

    let intervalId = 0;
    let cancelled = false;

    triggerRef.current = () => void tick();

    const tick = async () => {
      if (cancelled) return;

      const currentMatch = useMatchStore
        .getState()
        .matches.find((m) => m.id === activeRoomId);
      const status = currentMatch?.status ?? "waiting";

      // ── Heartbeat path (waiting) ──────────────────────────────────────────
      if (status === "waiting") {
        const hb = await apiMatchHeartbeat(token, activeRoomId, {
          game: currentMatch?.game ?? "CS2",
          mode: currentMatch?.mode ?? "1v1",
          code: currentMatch?.code ?? "",
        });
        if (cancelled) return;

        if (!hb || hb.in_match === false) {
          if (!looksLikeServerMatchId(activeRoomId)) return;
          // User already cleared the room locally (leave/cancel) — do not show kick toast.
          if (useMatchStore.getState().activeRoomId !== activeRoomId) return;
          toast.error("You were removed from the room by the host");
          useMatchStore.getState().setActiveRoomId(null);
          return;
        }

        missesRef.current = 0;

        const teamA = hb.players
          .filter((p) => p.team === "A")
          .map((p) => p.username);
        const teamB = hb.players
          .filter((p) => p.team === "B")
          .map((p) => p.username);
        const playerIds = hb.players.map((p) => p.user_id);
        const playersRoster = hb.players.map((p) => ({
          userId: p.user_id,
          username: p.username,
          team: p.team,
        }));

        useMatchStore.getState().addMatch({
          id: hb.match_id,
          type: (hb.type as "public" | "custom") ?? "custom",
          host: currentMatch?.host ?? "",
          hostId: hb.host_id,
          game: hb.game as Game,
          mode: hb.mode as MatchMode,
          betAmount: hb.bet_amount,
          stakeCurrency: (hb.stake_currency as "AT" | "CRYPTO") ?? "CRYPTO",
          players: playerIds,
          maxPlayers: hb.max_players,
          maxPerTeam: hb.max_per_team,
          teamSize: hb.max_per_team,
          status: hb.status as MatchStatus,
          code: hb.code,
          yourTeam: hb.your_team,
          playersRoster,
          ...(teamA.length > 0 || teamB.length > 0 ? { teamA, teamB } : {}),
        });

        if (hb.match_id !== activeRoomId) {
          useMatchStore.getState().setActiveRoomId(hb.match_id);
        }
        return;
      }

      // ── Legacy GET /match/active path (in_progress) ───────────────────────
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

    const getPollMs = (): number => {
      const s = useMatchStore
        .getState()
        .matches.find((m) => m.id === activeRoomId)?.status;
      return s === "waiting"
        ? HEARTBEAT_POLL_MS
        : ACTIVE_ROOM_POLL_MS;
    };

    const scheduleInterval = () => {
      clearPoll();
      intervalId = window.setInterval(() => void tick(), getPollMs());
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== "visible") {
        clearPoll();
        return;
      }
      void tick();
      scheduleInterval();
    };

    onVisibilityOrFocus();
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      cancelled = true;
      triggerRef.current = null;
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [token, activeRoomId]);
}
