/**
 * ARENA Engine API — HTTP client for the local desktop capture engine.
 *
 * Base URL:   VITE_ENGINE_API_URL env var (default: /api for proxied dev)
 * Auth:       Bearer token from VITE_ENGINE_API_TOKEN (optional in dev)
 *
 * Endpoints used (all served by the Arena Engine desktop process):
 *   GET  /health            → EngineHealth        (poll ~15s default + burst on focus)
 *   GET  /ready             → { ready: boolean }  (poll every 10s when connected)
 *   GET  /match/:id/status  → EngineMatchStatus   (poll during active match)
 *
 * WebSocket (future — WS-ready):
 *   ws://localhost:PORT/ws
 *   Events emitted by client:
 *     "client:ready"    → { version, uptime }          maps to ClientStatus "ready"
 *     "client:busy"     → { matchId }                  maps to ClientStatus "in_match"
 *     "client:idle"     → {}                           maps to ClientStatus "connected"
 *     "match:completed" → { matchId, winnerId }        triggers declareWinner()
 *     "match:disputed"  → { matchId, reason }          opens admin dispute ticket
 *   Events emitted by server to client:
 *     "match:start"     → { matchId, players, game }   tells client to begin capture
 *     "match:cancel"    → { matchId }                  tells client to stop capture
 *
 * DB-ready (Vision Engine side):
 *   Each heartbeat: UPSERT client_sessions SET status=?, last_heartbeat_at=NOW()
 *   On match start:  UPDATE client_sessions SET status='in_match', active_match_id=?
 *   On match end:    UPDATE client_sessions SET status='ready', active_match_id=NULL
 */

export interface EngineHealth {
  status:       "ok" | "offline" | "error";
  db?:          "connected" | "disconnected";   // sourced from GET /health
  environment?: string;                          // "development" | "production" | ...
  version?:     string;
  uptime?:      number;
}

export interface EngineReadiness {
  ready:   boolean;
  reason?: string;   // human-readable if not ready, e.g. "capture device not found"
}

export interface EngineMatchStatus {
  id:        string;
  status:    "waiting" | "in_progress" | "completed" | "cancelled" | "disputed";
  winnerId?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────
const ENGINE_BASE =
  (import.meta.env.VITE_ENGINE_API_URL as string | undefined)?.trim() ?? "/api";

const ENGINE_TOKEN =
  (import.meta.env.VITE_ENGINE_API_TOKEN as string | undefined)?.trim();

// ── Internal fetch helper ─────────────────────────────────────────────────────
async function safeFetch<T>(path: string, timeoutMs = 5000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const headers: HeadersInit = ENGINE_TOKEN
      ? { Authorization: `Bearer ${ENGINE_TOKEN}` }
      : {};
    const res = await fetch(`${ENGINE_BASE}${path}`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Primary connectivity check — called every 30s by useEngineStatus.
 * If this returns offline/null, the client is not running.
 */
export async function getEngineHealth(): Promise<EngineHealth> {
  const data = await safeFetch<{
    status?:      string;
    db?:          string;
    environment?: string;
    version?:     string;
    uptime?:      number;
  }>("/health");
  if (!data) return { status: "offline" };
  return {
    status:      data.status === "ok" ? "ok" : "error",
    db:          data.db === "connected" ? "connected" : data.db === "disconnected" ? "disconnected" : undefined,
    environment: data.environment,
    version:     data.version,
    uptime:      data.uptime,
  };
}

/**
 * GET /ready
 * Secondary check — called when health is "ok" to confirm capture subsystem is ready.
 * DB-ready: maps to client_sessions.status = 'ready' | 'connected'
 */
export async function getEngineReadiness(): Promise<EngineReadiness> {
  const data = await safeFetch<{ ready?: boolean; reason?: string }>("/ready");
  if (!data) return { ready: false, reason: "No response" };
  return { ready: !!data.ready, reason: data.reason };
}

export async function isEngineOnline(): Promise<boolean> {
  return (await getEngineHealth()).status === "ok";
}

/**
 * GET /match/:id/status
 * Called by useMatchPolling during an active match to check for results.
 * DB-ready: Vision Engine writes result → triggers declareWinner() on smart contract.
 */
export async function getMatchStatus(matchId: string): Promise<EngineMatchStatus> {
  const data = await safeFetch<{
    status?:    EngineMatchStatus["status"];
    winner_id?: string;
  }>(`/match/${encodeURIComponent(matchId)}/status`);
  if (!data?.status) return { id: matchId, status: "in_progress" };
  return { id: matchId, status: data.status, winnerId: data.winner_id };
}
