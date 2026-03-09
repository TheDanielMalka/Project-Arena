/**
 * ARENA — Engine Connection Status Hook
 * Shows if the desktop capture client / Engine API is connected.
 * Used in the header and dashboard to show live status.
 */

import { useState, useEffect, useCallback } from "react";
import { isEngineOnline, getEngineHealth, type EngineHealth } from "@/lib/engine-api";

export function useEngineStatus(pollInterval = 30000) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);

  const check = useCallback(async () => {
    try {
      const h = await getEngineHealth();
      setHealth(h);
      setOnline(h.status === "ok");
    } catch {
      setOnline(false);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, pollInterval);
    return () => clearInterval(id);
  }, [check, pollInterval]);

  return { online, health, check };
}
