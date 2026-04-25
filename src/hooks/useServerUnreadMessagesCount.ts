import { useEffect, useState } from "react";
import { apiGetUnreadCount } from "@/lib/engine-api";
import { useWsEvent } from "@/lib/ws-client";

/**
 * Returns unread notification count.
 *
 * Primary: WS notification:new increments the counter instantly.
 * Fallback: polls GET /messages/unread/count every 10s (remains active
 *           while VITE_ENABLE_WS is unset or WS is down).
 */
export function useServerUnreadMessagesCount(token: string | null): number {
  const [count, setCount] = useState(0);

  // WS fast-path — increment on every notification:new push.
  useWsEvent("notification:new", () => {
    setCount((c) => c + 1);
  });

  // HTTP fallback poll — remains active regardless of WS state.
  useEffect(() => {
    if (!token?.trim()) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const tick = () => {
      void apiGetUnreadCount(token).then((r) => {
        if (cancelled || !r) return;
        setCount(typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 0);
      });
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  return count;
}
