import { useEffect } from "react";
import { useMatchStore } from "@/stores/matchStore";

/** 3–5s target while tab is visible (doc 2.2); pauses when tab is in background. */
export const OPEN_MATCHES_POLL_MS = 4000;

/**
 * Open-match list sync until SSE/WebSocket exists (doc 2.2): refetch on mount, on an interval
 * only while the document is visible, and on visibility restore / window focus (RQ refetchOnWindowFocus equivalent).
 * When Claude adds SSE/WebSocket for lobby, prefer that channel and keep this hook only as fallback.
 * DB-ready: GET /matches + GET /matches/history
 */
export function useMatchListLivePoll(token: string | null | undefined): void {
  const refreshMatchesFromServer = useMatchStore((s) => s.refreshMatchesFromServer);

  useEffect(() => {
    let intervalId = 0;

    const refresh = () => void refreshMatchesFromServer(token ?? null);

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
      refresh();
      if (!intervalId) {
        intervalId = window.setInterval(() => {
          if (document.visibilityState === "visible") refresh();
        }, OPEN_MATCHES_POLL_MS);
      }
    };

    onVisibilityOrFocus();
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [token, refreshMatchesFromServer]);
}
