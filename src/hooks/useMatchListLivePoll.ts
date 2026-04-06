import { useEffect } from "react";
import { useMatchStore } from "@/stores/matchStore";

/** Target ≤3–5s without WebSocket (lobby live sync). */
const OPEN_MATCHES_POLL_MS = 4000;

/**
 * Refetch open (+ history when token present) on mount, on an interval, and when the tab regains focus.
 * DB-ready: GET /matches + GET /matches/history
 */
export function useMatchListLivePoll(token: string | null | undefined): void {
  const refreshMatchesFromServer = useMatchStore((s) => s.refreshMatchesFromServer);

  useEffect(() => {
    void refreshMatchesFromServer(token ?? null);
  }, [token, refreshMatchesFromServer]);

  useEffect(() => {
    const tick = () => void refreshMatchesFromServer(token ?? null);
    const id = window.setInterval(tick, OPEN_MATCHES_POLL_MS);
    return () => window.clearInterval(id);
  }, [token, refreshMatchesFromServer]);

  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") {
        void refreshMatchesFromServer(token ?? null);
      }
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [token, refreshMatchesFromServer]);
}
