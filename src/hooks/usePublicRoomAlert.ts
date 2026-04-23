import { useEffect, useRef } from "react";
import { useMatchStore } from "@/stores/matchStore";
import { useNotificationStore } from "@/stores/notificationStore";

/**
 * Detects newly-opened public rooms via the match store and shows an
 * in-site toast notification for each one that appears after initial load.
 *
 * No DB writes — purely client-side ephemeral toast.
 * Wire up once inside MatchLobby (or any page that keeps the lobby visible).
 */
export function usePublicRoomAlert(): void {
  const seenIds       = useRef<Set<string>>(new Set());
  const isInitialLoad = useRef(true);
  const matches       = useMatchStore((s) => s.matches);
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    const openRooms = matches.filter(
      (m) => m.type === "public" && m.status === "waiting"
    );

    if (isInitialLoad.current) {
      openRooms.forEach((m) => seenIds.current.add(m.id));
      isInitialLoad.current = false;
      return;
    }

    const newRooms = openRooms.filter((m) => !seenIds.current.has(m.id));
    newRooms.forEach((m) => {
      seenIds.current.add(m.id);
      const currency = m.stakeCurrency ?? "AT";
      addNotification({
        type:    "system",
        title:   "🎮 New room open",
        message: `${m.game} ${m.mode} · ${m.betAmount} ${currency} — join now`,
        metadata: { matchId: m.id },
      });
    });
  }, [matches, addNotification]);
}
