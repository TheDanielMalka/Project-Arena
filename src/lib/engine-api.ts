export interface EngineHealth {
  status: "ok" | "offline" | "error";
  version?: string;
  uptime?: number;
}

export interface EngineMatchStatus {
  id: string;
  status: "waiting" | "in_progress" | "completed" | "cancelled" | "disputed";
  winnerId?: string;
}

const ENGINE_API_BASE = (import.meta.env.VITE_ENGINE_API_URL as string | undefined)?.trim() || "/api";

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${ENGINE_API_BASE}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getEngineHealth(): Promise<EngineHealth> {
  const data = await safeFetch<{ status?: string; version?: string; uptime?: number }>("/health");
  if (!data) return { status: "offline" };
  return {
    status: data.status === "ok" ? "ok" : "error",
    version: data.version,
    uptime: data.uptime,
  };
}

export async function isEngineOnline(): Promise<boolean> {
  const health = await getEngineHealth();
  return health.status === "ok";
}

export async function getMatchStatus(matchId: string): Promise<EngineMatchStatus> {
  const data = await safeFetch<{ status?: EngineMatchStatus["status"]; winner_id?: string }>(
    `/match/${encodeURIComponent(matchId)}/status`
  );
  if (!data?.status) {
    return { id: matchId, status: "in_progress" };
  }
  return {
    id: matchId,
    status: data.status,
    winnerId: data.winner_id,
  };
}
