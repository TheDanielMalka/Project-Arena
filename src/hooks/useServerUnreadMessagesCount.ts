import { useEffect, useState } from "react";
import { apiGetUnreadCount } from "@/lib/engine-api";

/** Polls GET /messages/unread/count every 10s while token is set. */
export function useServerUnreadMessagesCount(token: string | null): number {
  const [count, setCount] = useState(0);

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
