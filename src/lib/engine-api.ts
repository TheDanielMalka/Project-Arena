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

import type {
  ArenaId,
  DisputeHolding,
  Game,
  InboxMessage,
  LeaderboardPlayerRow,
  Match,
  MatchStatus,
  PendingWithdrawalResponse,
  LeaveStatusResponse,
  PublicPlayerProfile,
  UserSettingsRegion,
  UserStatus,
} from "@/types";
import { notifyAuth401 } from "@/lib/authSession";
import { MATCH_JOIN_PASSWORD_FIELD } from "@/lib/matchRoomPassword";

export interface EngineHealth {
  status:       "ok" | "offline" | "error";
  db?:          "connected" | "disconnected";   // sourced from GET /health
  environment?: string;                          // "development" | "production" | ...
  version?:     string;
  uptime?:      number;
}

/**
 * Canonical client status shape — matches GET /client/status response exactly.
 * Phase 4 contract: UI gates Join / Escrow / Match on online && version_ok.
 */
export interface ClientStatusResponse {
  online:         boolean;
  status:         "disconnected" | "idle" | "in_game" | "in_match";
  session_id:     string | null;
  user_id:        string | null;
  wallet_address: string;
  match_id:       string | null;
  version:        string | null;
  version_ok:     boolean;
  last_seen:      string;
  game:           string | null;
}

export interface EngineReadiness {
  ready:   boolean;
  reason?: string;   // human-readable if not ready, e.g. "capture device not found"
}

export interface EngineMatchStatus {
  id:        string;
  status:    "waiting" | "in_progress" | "completed" | "cancelled" | "disputed" | "tied";
  winnerId?: string;
}

/** Raw GET /match/:id/status — includes escrow fields for MetaMask deposit. */
export interface MatchStatusApiResponse {
  match_id:            string;
  status:              string;
  winner_id?:          string | null;
  on_chain_match_id:   string | number | null;
  stake_per_player:    number | null;
  your_team:           0 | 1 | null;
  /** OCR consensus pipeline state */
  consensus_status?:   "pending" | "reached" | "failed" | null;
  /** How many players have submitted a screenshot so far */
  submissions_count?:  number;
  /** Total players in the match (submissions target) */
  submissions_needed?: number;
  /** End-screen score string e.g. "13-11" once consensus reached */
  score?:              string | null;
  /** "victory" | "defeat" from the calling user's perspective */
  result?:             string | null;
  /** In-game room password — only returned while match is in_progress */
  game_password?:      string | null;
}

// ── Config ────────────────────────────────────────────────────────────────────
export const ENGINE_BASE =
  (import.meta.env.VITE_ENGINE_API_URL as string | undefined)?.trim() ?? "/api";

const ENGINE_TOKEN =
  (import.meta.env.VITE_ENGINE_API_TOKEN as string | undefined)?.trim();

// ── Network error telemetry ───────────────────────────────────────────────────
/**
 * Surface fetch/network errors caught by engine-api wrappers.
 *
 * Historically every catch in this file was empty (`} catch { return null; }`)
 * which made real network outages indistinguishable from deliberate "not ok"
 * API responses. That hid production issues behind a silent `null`.
 *
 * This helper keeps the stable return-type contract every caller depends on
 * (we still return the fallback value), but also:
 *   1. Logs the error in dev (dev console only — never in production bundles).
 *   2. Dispatches a `engine-api-network-error` CustomEvent on `window` in any
 *      environment, so a top-level listener (e.g. the ConnectionBanner / toast
 *      manager) can inform the user without every caller needing try/catch.
 *
 * The helper is wrapped in its own try/catch — telemetry must never throw
 * back into the API call site.
 */
export type EngineApiNetworkErrorDetail = {
  error: unknown;
  at: number;
};

function reportEngineApiError(err: unknown): void {
  try {
    // Don't report user-triggered cancellations.
    if (err instanceof DOMException && err.name === "AbortError") return;
    // Don't spam the console in the vitest test environment.
    const isTest =
      typeof import.meta !== "undefined" &&
      (import.meta as { env?: { MODE?: string } }).env?.MODE === "test";
    if (!isTest) {
      const isDev =
        typeof import.meta !== "undefined" &&
        (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
      if (isDev) {
        // eslint-disable-next-line no-console
        console.warn("[engine-api] network error:", err);
      }
    }
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      const detail: EngineApiNetworkErrorDetail = { error: err, at: Date.now() };
      window.dispatchEvent(new CustomEvent("engine-api-network-error", { detail }));
    }
  } catch (err) {
    reportEngineApiError(err);
    /* telemetry must never throw */
  }
}

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
  } catch (err) {
    reportEngineApiError(err);
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
 * GET /client/status
 * Phase 4: canonical status check — used by the website to gate Join/Escrow/Match.
 *
 * Pass ONE of:
 *   walletAddress — direct lookup (desktop client / when wallet is known)
 *   token         — Bearer JWT (website: backend resolves user_id → wallet_address)
 *
 * Returns null on network error (treat as disconnected).
 */
export async function getClientStatus(
  walletAddress?: string | null,
  token?: string,
): Promise<ClientStatusResponse | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);

    const url = walletAddress
      ? `${ENGINE_BASE}/client/status?wallet_address=${encodeURIComponent(walletAddress)}`
      : `${ENGINE_BASE}/client/status`;

    const res = token
      ? await arenaUserFetch(url, token, { signal: controller.signal })
      : await fetch(url, { signal: controller.signal, headers: engineAuthHeaders(null) });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as ClientStatusResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

function engineAuthHeaders(userToken?: string | null): HeadersInit {
  const headers: HeadersInit = {};
  if (userToken) headers["Authorization"] = `Bearer ${userToken}`;
  else if (ENGINE_TOKEN) headers["Authorization"] = `Bearer ${ENGINE_TOKEN}`;
  return headers;
}

/** Website user JWT — on 401 clears persisted session via registerAuth401Handler. */
async function arenaUserFetch(input: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) notifyAuth401();
  return res;
}

/** If userToken set — arenaUserFetch; else static ENGINE_TOKEN only (401 does not clear user session). */
async function fetchWithOptionalUserAuth(
  input: string,
  userToken: string | null | undefined,
  init: RequestInit = {},
): Promise<Response> {
  if (userToken) {
    return arenaUserFetch(input, userToken, init);
  }
  const headers = new Headers(init.headers as HeadersInit);
  const extra = engineAuthHeaders(null);
  if (extra && typeof extra === "object" && "Authorization" in extra) {
    headers.set("Authorization", (extra as { Authorization: string }).Authorization);
  }
  return fetch(input, { ...init, headers });
}

/**
 * GET /match/:id/status — full JSON (optional Bearer for `your_team`).
 * DB-ready: matches + match_players; CONTRACT-ready: on_chain_match_id → deposit().
 */
export async function apiGetMatchStatus(
  matchId: string,
  token?: string | null,
): Promise<MatchStatusApiResponse | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const url = `${ENGINE_BASE}/match/${encodeURIComponent(matchId)}/status`;
    const res = token
      ? await arenaUserFetch(url, token, { signal: controller.signal })
      : await fetch(url, { signal: controller.signal, headers: engineAuthHeaders(null) });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as MatchStatusApiResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** Shape returned by GET /match/:id/refund-status */
export interface RefundStatusResponse {
  canRefund:       boolean;
  reason:          string;
  amount:          string;
  onChainMatchId:  number | string | null;
}

/**
 * GET /match/:id/refund-status — check if the calling user can claim an on-chain refund.
 * CONTRACT-ready: canRefund=true → UI calls ArenaEscrow.claimRefund(onChainMatchId).
 * DB-ready: matches + match_players (refund_claimed column).
 */
export async function apiGetMatchRefundStatus(
  matchId: string,
  token: string | null | undefined,
): Promise<RefundStatusResponse | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const url = `${ENGINE_BASE}/match/${encodeURIComponent(matchId)}/refund-status`;
    const res = await fetchWithOptionalUserAuth(url, token, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as RefundStatusResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** Shape returned by GET /match/active */
export type ActiveMatchPlayer = {
  user_id: string;
  username: string;
  avatar: string | null;
  arena_id: string | null;
  team: number; // 0 = Team A, 1 = Team B
};
export type ActiveMatchResponse = {
  match: {
    match_id:       string;
    game:           string;
    status:         "waiting" | "in_progress";
    bet_amount:     string | null;
    stake_currency: "CRYPTO" | "AT";
    type:           string;
    code:           string | null;
    created_at:     string | null;
    players:        ActiveMatchPlayer[];
    // Added in get_active_match v2 — lobby persistence fix
    mode:           string | null;
    host_id:        string | null;
    host_username:  string | null;
    max_players:    number | null;
    max_per_team:   number | null;
    your_user_id:        string | null;
    your_team:           "A" | "B" | null;
    your_has_deposited:  boolean;
  } | null;
};

/**
 * GET /match/active — returns caller's current active match (waiting or in_progress).
 * Used by MatchLobby to restore lobby state after page navigation.
 * DB-ready: matches JOIN match_players WHERE status IN ('waiting','in_progress')
 */
export async function apiGetActiveMatch(
  token: string,
): Promise<ActiveMatchResponse | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/match/active`, token, {});
    if (!res.ok) return null;
    return (await res.json()) as ActiveMatchResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/**
 * DELETE /matches/{matchId} — host cancels the match room.
 * Sets status → cancelled; refunds AT for all players.
 * DB-ready: UPDATE matches SET status='cancelled'; at_transactions refund rows.
 */
export async function apiCancelMatch(
  token: string,
  matchId: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}`,
      token,
      { method: "DELETE", signal: controller.signal },
    );
    clearTimeout(tid);
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) ?? "Cancel failed" };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/**
 * POST /matches/{matchId}/leave — non-host player leaves a waiting match.
 * Removes player from match_players; refunds their AT stake.
 * DB-ready: DELETE FROM match_players; at_transactions refund row.
 */
export async function apiLeaveMatch(
  token: string,
  matchId: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/leave`,
      token,
      { method: "POST", signal: controller.signal },
    );
    clearTimeout(tid);
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) ?? "Leave failed" };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/**
 * GET /wallet/pending-withdrawals — check on-chain pendingWithdrawals balance.
 * Returns on_chain_wei (bigint string) and db_tracked_wei for the caller's wallet.
 * Only non-zero when a direct ETH transfer failed inside a payout loop (rare).
 * CONTRACT-ready: reads ArenaEscrow.pendingWithdrawals(wallet) view.
 */
export async function apiGetPendingWithdrawals(
  token: string,
): Promise<PendingWithdrawalResponse | null> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/wallet/pending-withdrawals`,
      token,
    );
    if (!res.ok) return null;
    return (await res.json()) as PendingWithdrawalResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/**
 * GET /matches/{matchId}/leave-status — check leave/cancel eligibility.
 * Returns can_leave_now, requires_cancel, rescue_available, has_deposited.
 * Used by MatchLobby to decide which leave/rescue button to show.
 */
export async function apiGetLeaveStatus(
  token: string,
  matchId: string,
): Promise<LeaveStatusResponse | null> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/leave-status`,
      token,
    );
    if (!res.ok) return null;
    return (await res.json()) as LeaveStatusResponse;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/**
 * POST /matches/{matchId}/invite — sends match_invite notification to an accepted friend.
 * DB-ready: inserts into notifications with type='match_invite' and metadata.
 */
export async function apiInviteToMatch(
  token: string,
  matchId: string,
  friendId: string,
): Promise<{ ok: true } | { ok: false; status: number; detail: string | null }> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/invite`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friend_id: friendId }),
      },
    );
    if (res.status === 429) {
      return { ok: false as const, status: 429, detail: "Too many requests — please wait a moment and try again" };
    }
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: null };
  }
}

function normalizeEngineMatchStatus(status: string): EngineMatchStatus["status"] {
  if (status === "pending") return "in_progress";
  const allowed: EngineMatchStatus["status"][] = [
    "waiting",
    "in_progress",
    "completed",
    "cancelled",
    "disputed",
    "tied",
  ];
  return (allowed.includes(status as EngineMatchStatus["status"])
    ? status
    : "in_progress") as EngineMatchStatus["status"];
}

/**
 * GET /match/:id/status
 * Called by useMatchPolling during an active match to check for results.
 * DB-ready: Vision Engine writes result → triggers declareWinner() on smart contract.
 */
export async function getMatchStatus(matchId: string): Promise<EngineMatchStatus> {
  const data = await apiGetMatchStatus(matchId, null);
  if (!data?.status) return { id: matchId, status: "in_progress" };
  return {
    id:       matchId,
    status:   normalizeEngineMatchStatus(data.status),
    winnerId: data.winner_id ?? undefined,
  };
}

// ── Auth / Identity (Phase 3: real website auth) ──────────────────────────────

export type ApiLoginSuccess = {
  access_token: string;
  user_id: string;
  username: string;
  email: string;
  arena_id: string | null;
  wallet_address: string | null;
};

export type ApiLoginResult =
  | ApiLoginSuccess
  | { requires_2fa: true; temp_token: string }
  | { _rate_limited: true }
  | { _email_not_verified: true; email: string }
  | null;

// POST /auth/google — Google Identity Services id_token (same response shape as login)
export async function apiAuthGoogle(idToken: string): Promise<ApiLoginResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (res.status === 429) return { _rate_limited: true };
    const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return null;
    if (!raw) return null;
    if (raw.requires_2fa === true && typeof raw.temp_token === "string") {
      return { requires_2fa: true, temp_token: raw.temp_token };
    }
    if (typeof raw.access_token === "string") {
      return raw as ApiLoginSuccess;
    }
    return null;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

// POST /auth/login
export async function apiLogin(identifier: string, password: string): Promise<ApiLoginResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (res.status === 429) return { _rate_limited: true };
    const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 403 && typeof raw?.detail === "string" && raw.detail === "email_not_verified") {
      const emailGuess = identifier.includes("@") ? identifier.trim() : "";
      return { _email_not_verified: true, email: emailGuess };
    }
    if (!res.ok) return null;
    if (!raw) return null;
    if (raw.requires_2fa === true && typeof raw.temp_token === "string") {
      return { requires_2fa: true, temp_token: raw.temp_token };
    }
    if (typeof raw.access_token === "string") {
      return raw as ApiLoginSuccess;
    }
    return null;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** POST /auth/resend-verification — resend account verification email */
export async function apiResendVerification(email: string): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** POST /auth/request-email-change — send confirmation to new email address */
export async function apiRequestEmailChange(
  token: string,
  newEmail: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/request-email-change`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_email: newEmail, password }),
    });
    if (res.ok) return { success: true };
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { success: false, error: (body.detail as string) ?? "Failed to send confirmation" };
  } catch (err) {
    reportEngineApiError(err);
    return { success: false, error: "Network error" };
  }
}

/** POST /auth/forgot-password — send reset link (always succeeds to avoid user enumeration) */
export async function apiForgotPassword(email: string): Promise<boolean> {
  try {
    await fetch(`${ENGINE_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return true;
  } catch {
    return true;
  }
}

/** POST /auth/reset-password — set new password using reset token */
export async function apiResetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    if (res.ok) return { success: true };
    const body = await res.json().catch(() => ({})) as { detail?: unknown };
    if (body.detail === "invalid_or_expired_token") return { success: false, error: "invalid_or_expired_token" };
    return { success: false, error: (body.detail as string) ?? "Failed to reset password" };
  } catch (err) {
    reportEngineApiError(err);
    return { success: false, error: "Network error" };
  }
}

function parseFastApiDetail(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "object" && item !== null && "msg" in item) {
        const msg = (item as { msg: unknown }).msg;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
  }
  return null;
}

/** Maps backend `detail` text (e.g. 409 "Email already registered") to a signup field. */
export type RegisterConflictField = "email" | "username" | "steam" | "riot";

export function registerConflictFieldFromDetail(detail: string | null): RegisterConflictField | null {
  if (!detail) return null;
  const d = detail.toLowerCase();
  if (d.includes("email")) return "email";
  if (d.includes("username") || d.includes("user name")) return "username";
  if (d.includes("steam")) return "steam";
  if (d.includes("riot")) return "riot";
  return null;
}

export type ApiRegisterSuccess = {
  access_token?: string;
  verification_required?: boolean;
  user_id: string;
  username: string;
  email: string;
  arena_id: string | null;
  wallet_address?: string | null;
};

export type ApiRegisterResult =
  | { ok: true; data: ApiRegisterSuccess }
  | { ok: false; status: number; detail: string | null; field: RegisterConflictField | null };

export type ApiRegisterOptions = {
  steam_id?: string | null;
  riot_id?: string | null;
};

// POST /auth/register — requires at least one of steam_id / riot_id (validated on server)
export async function apiRegister(
  username: string,
  email: string,
  password: string,
  opts?: ApiRegisterOptions,
): Promise<ApiRegisterResult> {
  const body: Record<string, string> = {
    username,
    email,
    password,
  };
  const steam = opts?.steam_id?.trim();
  const riot = opts?.riot_id?.trim();
  if (steam) body.steam_id = steam;
  if (riot) body.riot_id = riot;
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown } & Partial<ApiRegisterSuccess>;
    if (res.status === 429) {
      return { ok: false as const, status: 429, detail: "Too many requests — please wait a moment and try again", field: null };
    }
    if (!res.ok) {
      const detail = parseFastApiDetail(raw.detail);
      return {
        ok: false as const,
        status: res.status,
        detail,
        field: registerConflictFieldFromDetail(detail),
      };
    }
    return { ok: true as const, data: raw as ApiRegisterSuccess };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: null, field: null };
  }
}

// GET /auth/me — returns full profile including rank, xp, avatar, badge, game accounts
export async function apiGetMe(token: string): Promise<{
  user_id: string;
  username: string;
  email: string;
  arena_id: string | null;
  rank: string | null;
  wallet_address: string | null;
  steam_id: string | null;
  riot_id: string | null;
  steam_verified: boolean;
  riot_verified: boolean;
  discord_id: string | null;
  discord_username: string | null;
  discord_verified: boolean;
  faceit_id: string | null;
  faceit_nickname: string | null;
  faceit_elo: number | null;
  faceit_level: number | null;
  faceit_verified: boolean;
  xp: number;
  wins: number;
  losses: number;
  avatar: string | null;
  avatar_bg: string | null;
  equipped_badge_icon: string | null;
  forge_unlocked_item_ids: string[];
  vip_expires_at: string | null;
  at_balance: number;
  /** From user_roles via GET /auth/me (admin > moderator > user) */
  role?: string;
  /** Daily AT staking usage — from _check_daily_stake_limit in engine */
  daily_staked_at?: number;
  daily_limit_at?: number;
  /** Daily USDT (CRYPTO) staking — completed matches last 24h */
  daily_staked_usdt?: number;
  daily_limit_usdt?: number;
  region?: string | null;
  two_factor_enabled?: boolean;
  /** users.auth_provider — 'email' | 'google' */
  auth_provider?: string | null;
  country?: string | null;
} | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/me`, token, {});
    if (!res.ok) return null;
    return (await res.json()) as {
      user_id: string;
      username: string;
      email: string;
      arena_id: string | null;
      rank: string | null;
      wallet_address: string | null;
      steam_id: string | null;
      riot_id: string | null;
      steam_verified: boolean;
      riot_verified: boolean;
      discord_id: string | null;
      discord_username: string | null;
      discord_verified: boolean;
      faceit_id: string | null;
      faceit_nickname: string | null;
      faceit_elo: number | null;
      faceit_level: number | null;
      faceit_verified: boolean;
      xp: number;
      wins: number;
      losses: number;
      avatar: string | null;
      avatar_bg: string | null;
      equipped_badge_icon: string | null;
      forge_unlocked_item_ids: string[];
      vip_expires_at: string | null;
      at_balance: number;
      role?: string;
      daily_staked_at?: number;
      daily_limit_at?: number;
      daily_staked_usdt?: number;
      daily_limit_usdt?: number;
      region?: string | null;
      two_factor_enabled?: boolean;
      auth_provider?: string | null;
      country?: string | null;
    };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

const USER_SETTINGS_REGIONS = new Set<string>(["EU", "NA", "ASIA", "SA", "OCE", "ME"]);

function normalizeUserSettingsRegion(raw: string | null | undefined): UserSettingsRegion | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const u = raw.trim().toUpperCase();
  return USER_SETTINGS_REGIONS.has(u) ? (u as UserSettingsRegion) : undefined;
}

/** POST /auth/2fa/confirm — exchange temp_token + TOTP for access_token */
export async function apiAuth2faConfirm(
  temp_token: string,
  code: string,
): Promise<ApiLoginSuccess | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/2fa/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp_token, code: code.trim() }),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    if (typeof raw.access_token !== "string") return null;
    return raw as ApiLoginSuccess;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** DELETE /users/me — body { confirm_text } */
export async function apiDeleteMyAccount(
  token: string,
  confirm_text: string,
): Promise<{ ok: true } | { ok: false; detail: string | null }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/me`, token, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm_text }),
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/** PATCH /users/settings — { region } */
export async function apiPatchUserSettings(
  token: string,
  region: UserSettingsRegion,
): Promise<{ ok: true; region: UserSettingsRegion } | { ok: false; detail: string | null }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/settings`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region }),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown; region?: string };
    if (!res.ok) {
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    const nr = normalizeUserSettingsRegion(raw.region ?? region);
    return { ok: true, region: nr ?? region };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

export async function apiPatchCountry(
  token: string,
  country: string,
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/settings`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country }),
    });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export async function apiPatchPreferredGame(
  token: string,
  preferredGame: string,
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/settings`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_game: preferredGame }),
    });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** POST /auth/2fa/setup */
export async function apiAuth2faSetup(
  token: string,
): Promise<
  | { ok: true; secret: string; qr_uri: string }
  | { ok: false; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/2fa/setup`, token, { method: "POST" });
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      secret?: string;
      qr_uri?: string;
    };
    if (!res.ok) {
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    const secret = typeof raw.secret === "string" ? raw.secret : "";
    const qr_uri = typeof raw.qr_uri === "string" ? raw.qr_uri : "";
    if (!secret || !qr_uri) return { ok: false, detail: "Invalid setup response" };
    return { ok: true, secret, qr_uri };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/** POST /auth/2fa/verify — { code } */
export async function apiAuth2faVerify(
  token: string,
  code: string,
): Promise<{ ok: true } | { ok: false; detail: string | null }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/2fa/verify`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/** DELETE /auth/2fa — { password, code } */
export async function apiAuth2faDisable(
  token: string,
  password: string,
  code: string,
): Promise<{ ok: true } | { ok: false; detail: string | null }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/2fa`, token, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, code: code.trim() }),
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

/** GET /messages/unread/count */
export async function apiGetUnreadCount(token: string): Promise<{ count: number } | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/messages/unread/count`, token, {});
    if (!res.ok) return null;
    const raw = (await res.json()) as { count?: unknown };
    const c = raw.count;
    return { count: typeof c === "number" ? c : Number(c) || 0 };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export type VerifyPlatformResult = {
  valid: boolean;
  unique?: boolean;
  verified_by?: string;
};

/** GET /verify/steam?steam_id= */
export async function apiVerifySteam(steamId: string): Promise<VerifyPlatformResult> {
  const q = encodeURIComponent(steamId.trim());
  try {
    const res = await fetch(`${ENGINE_BASE}/verify/steam?steam_id=${q}`);
    if (!res.ok) return { valid: false, unique: true };
    return (await res.json()) as VerifyPlatformResult;
  } catch (err) {
    reportEngineApiError(err);
    return { valid: false };
  }
}

/** GET /verify/riot?riot_id= */
export async function apiVerifyRiot(riotId: string): Promise<VerifyPlatformResult> {
  const q = encodeURIComponent(riotId.trim());
  try {
    const res = await fetch(`${ENGINE_BASE}/verify/riot?riot_id=${q}`);
    if (!res.ok) return { valid: false, unique: true };
    return (await res.json()) as VerifyPlatformResult;
  } catch (err) {
    reportEngineApiError(err);
    return { valid: false };
  }
}

/** GET /verify/discord?discord_id= */
export async function apiVerifyDiscord(discordId: string): Promise<VerifyPlatformResult> {
  const q = encodeURIComponent(discordId.trim());
  try {
    const res = await fetch(`${ENGINE_BASE}/verify/discord?discord_id=${q}`);
    if (!res.ok) return { valid: false, unique: true };
    return (await res.json()) as VerifyPlatformResult;
  } catch (err) {
    reportEngineApiError(err);
    return { valid: false };
  }
}

/** DELETE /auth/discord — removes Discord link from authenticated account */
export async function apiDisconnectDiscord(token: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/discord`, token, { method: "DELETE" });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** DELETE /auth/faceit — removes FACEIT link from authenticated account */
export async function apiDisconnectFaceit(token: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/faceit`, token, { method: "DELETE" });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** POST /auth/riot — save manual Riot ID (Name#TAG) for authenticated account */
export async function apiSaveRiotId(
  token: string,
  riotId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/riot`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riot_id: riotId }),
    });
    if (res.ok) return { success: true };
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { success: false, error: (body.detail as string) ?? "Failed to save Riot ID" };
  } catch (err) {
    reportEngineApiError(err);
    return { success: false, error: "Network error" };
  }
}

/** DELETE /auth/riot — removes Riot ID link from authenticated account */
export async function apiDisconnectRiot(token: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/riot`, token, { method: "DELETE" });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export interface FaceitStats {
  nickname: string;
  avatar: string | null;
  country: string | null;
  elo: number | null;
  level: number | null;
  matches: string | null;
  win_rate: string | null;
  kd_ratio: string | null;
  headshots: string | null;
  faceit_url: string | null;
}

/** GET /users/me/faceit-stats — live FACEIT stats from Data API */
export async function apiFaceitStats(token: string): Promise<FaceitStats | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/me/faceit-stats`, token, {});
    if (!res.ok) return null;
    return (await res.json()) as FaceitStats;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export type AdminTicketAttachmentMeta = {
  id: string;
  content_type: string;
  filename?: string;
  file_size?: number;
};

/** GET /support/tickets/{id}/attachments */
export async function apiAdminListSupportTicketAttachments(
  token: string,
  ticketId: string,
): Promise<AdminTicketAttachmentMeta[]> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/support/tickets/${encodeURIComponent(ticketId)}/attachments`,
      token,
      {},
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row): AdminTicketAttachmentMeta | null => {
        const o = row as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : null;
        const content_type = typeof o.content_type === "string" ? o.content_type : "application/octet-stream";
        if (!id) return null;
        return {
          id,
          content_type,
          filename: typeof o.filename === "string" ? o.filename : undefined,
          file_size: typeof o.file_size === "number" ? o.file_size : undefined,
        };
      })
      .filter((x): x is AdminTicketAttachmentMeta => x !== null);
  } catch (err) {
    reportEngineApiError(err);
    return [];
  }
}

/** GET blob for attachment preview (path aligned with DELETE /attachments/{id}) */
export async function apiGetAttachmentBlob(token: string, attachmentId: string): Promise<Blob | null> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/attachments/${encodeURIComponent(attachmentId)}`,
      token,
      {},
    );
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** DELETE /attachments/{id} */
export async function apiDeleteAttachment(token: string, attachmentId: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/attachments/${encodeURIComponent(attachmentId)}`,
      token,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** POST /support/tickets/{id}/attachments — multipart file */
export async function apiPostSupportTicketAttachment(
  token: string,
  ticketId: string,
  file: File,
): Promise<
  | { ok: true; id: string; filename: string; content_type: string; file_size: number }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/support/tickets/${encodeURIComponent(ticketId)}/attachments`,
      token,
      { method: "POST", body: fd },
    );
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      id?: string;
      filename?: string;
      content_type?: string;
      file_size?: number;
    };
    if (!res.ok) {
      return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return {
      ok: true,
      id: String(raw.id ?? ""),
      filename: String(raw.filename ?? file.name),
      content_type: String(raw.content_type ?? file.type ?? "application/octet-stream"),
      file_size: typeof raw.file_size === "number" ? raw.file_size : file.size,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

export type ApiForgePurchaseResult =
  | { ok: true; data: { at_balance: number; item_slug: string } }
  | { ok: false; status: number; detail: string | null };

/** POST /forge/purchase — spend AT; body matches engine `ForgePurchaseRequest` */
export async function apiForgePurchase(
  token: string,
  item_slug: string,
): Promise<ApiForgePurchaseResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/forge/purchase`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_slug }),
    });
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      at_balance?: number;
      item_slug?: string;
    };
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        detail: parseFastApiDetail(raw.detail),
      };
    }
    return {
      ok: true as const,
      data: {
        at_balance: typeof raw.at_balance === "number" ? raw.at_balance : 0,
        item_slug: String(raw.item_slug ?? item_slug),
      },
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export type ApiCreateMatchSuccess = {
  match_id:     string;
  game:         string;
  status:       string;
  stake_amount: number;
  stake_currency: "CRYPTO" | "AT";
  // Fields added in create_match v2 — critical for lobby display after navigation
  code:         string | null;   // server-generated room code (e.g. "ARENA-HT59")
  mode:         string | null;   // "1v1" | "2v2" | "4v4" | "5v5"
  max_players:  number | null;
  max_per_team: number | null;
  match_type:   string | null;
};

export type ApiMatchMutationResult =
  | { ok: true; data: ApiCreateMatchSuccess }
  | { ok: false; status: number; detail: string | null };

/**
 * POST /matches — create a new match lobby.
 * Bearer auth; CS2 needs steam_id on user, Valorant needs riot_id.
 *
 * IMPORTANT: mode and match_type MUST be sent to the server or the backend
 * defaults to "1v1" and "custom" respectively, causing the room to show the
 * wrong mode after navigation when the server response replaces the local state.
 */
export async function apiCreateMatch(
  token: string,
  body: {
    game:               string;
    stake_amount:       number;
    stake_currency?:    "CRYPTO" | "AT";
    mode?:              string;        // "1v1" | "2v2" | "4v4" | "5v5" — MUST be sent
    match_type?:        string;        // "public" | "custom" — MUST be sent
    /** Optional room password; engine stores and verifies — never echo in GET /matches. */
    password?:          string;
    /** on_chain_match_id from ArenaEscrow.createMatch — set immediately so server doesn't rely on EscrowClient event lag. */
    on_chain_match_id?: string;
  },
): Promise<ApiMatchMutationResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/matches`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as {
      detail?:        unknown;
      match_id?:      string;
      game?:          string;
      status?:        string;
      stake_amount?:  number;
      stake_currency?: unknown;
      code?:          string;       // server-generated room code
      mode?:          string;       // echoed back so client can trust server value
      max_players?:   number;
      max_per_team?:  number;
      match_type?:    string;
    };
    if (res.status === 429) {
      const d = parseFastApiDetail(raw.detail);
      return {
        ok: false as const,
        status: 429,
        detail: d ?? "Too many requests — please wait a moment and try again",
      };
    }
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        detail: parseFastApiDetail(raw.detail),
      };
    }
    const scRaw = String(raw.stake_currency ?? body.stake_currency ?? "CRYPTO").toUpperCase();
    const stake_currency: "CRYPTO" | "AT" = scRaw === "AT" ? "AT" : "CRYPTO";
    return {
      ok: true as const,
      data: {
        match_id:     String(raw.match_id ?? ""),
        game:         String(raw.game ?? body.game),
        status:       String(raw.status ?? "waiting"),
        stake_amount: typeof raw.stake_amount === "number" ? raw.stake_amount : body.stake_amount,
        stake_currency,
        code:         raw.code         ?? null,
        mode:         raw.mode         ?? body.mode         ?? null,
        max_players:  raw.max_players  ?? null,
        max_per_team: raw.max_per_team ?? null,
        match_type:   raw.match_type   ?? body.match_type   ?? null,
      },
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: null };
  }
}

export type AtPackageRow = {
  at_amount: number;
  usdt_price: number;
  discount_pct: number;
  final_price: number;
};

/** GET /wallet/at-packages */
export async function apiGetAtPackages(): Promise<{ packages: AtPackageRow[] } | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/wallet/at-packages`);
    if (!res.ok) return null;
    const raw = (await res.json()) as { packages?: unknown };
    const rows = Array.isArray(raw.packages) ? raw.packages : [];
    const packages: AtPackageRow[] = rows
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .map((p) => ({
        at_amount: asNum(p.at_amount) ?? 0,
        usdt_price: asNum(p.usdt_price) ?? 0,
        discount_pct: asNum(p.discount_pct) ?? 0,
        final_price: asNum(p.final_price) ?? 0,
      }))
      .filter((p) => p.at_amount > 0);
    return { packages };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** POST /wallet/buy-at-package */
export async function apiBuyAtPackage(
  token: string,
  body: { tx_hash: string; at_amount: number },
): Promise<
  | { ok: true; at_balance: number; at_credited: number; usdt_spent: number; discount_pct: number }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/wallet/buy-at-package`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 429) {
      return { ok: false as const, status: 429, detail: "Too many requests — please wait a moment and try again" };
    }
    if (res.status === 409) {
      return { ok: false as const, status: 409, detail: "This transaction has already been processed" };
    }
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        detail: parseFastApiDetail(raw.detail),
      };
    }
    return {
      ok: true as const,
      at_balance: asNum(raw.at_balance) ?? 0,
      at_credited: asNum(raw.at_credited) ?? 0,
      usdt_spent: asNum(raw.usdt_spent) ?? 0,
      discount_pct: asNum(raw.discount_pct) ?? 0,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

/**
 * POST /wallet/withdraw-at — burn AT and receive BNB equivalent to user's linked wallet.
 *
 * Rate: 1050 AT = $10 USDT. Amounts must be multiples of 1050.
 * Daily limit: 10,000 AT per user.
 * CONTRACT-ready: platform wallet sends BNB to user wallet.
 */
export async function apiWithdrawAT(
  token: string,
  body: { at_amount: number },
): Promise<
  | { ok: true; at_burned: number; usdt_value: number; wallet_address: string; at_balance: number; daily_remaining: number; rate: string }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/wallet/withdraw-at`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return {
      ok: true as const,
      at_burned:       asNum(raw.at_burned)       ?? 0,
      usdt_value:      asNum(raw.usdt_value)       ?? 0,
      wallet_address:  String(raw.wallet_address   ?? ""),
      at_balance:      asNum(raw.at_balance)       ?? 0,
      daily_remaining: asNum(raw.daily_remaining)  ?? 0,
      rate:            String(raw.rate             ?? ""),
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export type ApiJoinMatchSuccess = {
  joined: boolean;
  match_id: string;
  game: string;
  stake_currency?: string;
  team?: "A" | "B" | null;
  started?: boolean;
  /** Set when this join triggered match start — the CS2/Valorant room password to share with players. */
  game_password?: string | null;
};

/** POST /matches/{match_id}/join — Bearer auth */
export async function apiJoinMatch(
  token: string,
  matchId: string,
  opts?: { password?: string; team?: "A" | "B"; on_chain_match_id?: string },
): Promise<{ ok: true; data: ApiJoinMatchSuccess } | { ok: false; status: number; detail: string | null }> {
  try {
    const password = opts?.password?.trim();
    const team = opts?.team;
    const bodyFields: Record<string, unknown> = {};
    if (password) bodyFields[MATCH_JOIN_PASSWORD_FIELD] = password;
    if (team) bodyFields.team = team;
    if (opts?.on_chain_match_id !== undefined) bodyFields.on_chain_match_id = Number(opts.on_chain_match_id);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/join`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyFields),
      },
    );
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      joined?: boolean;
      match_id?: string;
      game?: string;
      stake_currency?: string;
      team?: unknown;
      started?: boolean;
      game_password?: string | null;
    };
    if (res.status === 429) {
      const d = parseFastApiDetail(raw.detail);
      return {
        ok: false as const,
        status: 429,
        detail: d ?? "Too many requests — please wait a moment and try again",
      };
    }
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        detail: parseFastApiDetail(raw.detail),
      };
    }
    const rawTeam = String(raw.team ?? "").toUpperCase();
    const serverTeam: "A" | "B" | null = rawTeam === "A" ? "A" : rawTeam === "B" ? "B" : null;
    return {
      ok: true as const,
      data: {
        joined: !!raw.joined,
        match_id: String(raw.match_id ?? matchId),
        game: String(raw.game ?? ""),
        stake_currency: raw.stake_currency ? String(raw.stake_currency) : undefined,
        team: serverTeam,
        started: !!raw.started,
        game_password: raw.game_password ?? null,
      },
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: null };
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export type HeartbeatPlayer = {
  user_id: string;
  username: string;
  team: "A" | "B" | null;
  joined_at: string;
};

export type HeartbeatResponse = {
  in_match: boolean;
  match_id: string;
  status: string;
  game: string;
  mode: string;
  code: string;
  max_players: number;
  max_per_team: number;
  host_id: string;
  type: string;
  bet_amount: number;
  stake_currency: string;
  created_at: string;
  your_user_id: string;
  your_team: "A" | "B" | null;
  stale_removed: boolean;
  players: HeartbeatPlayer[];
};

/**
 * POST /matches/{matchId}/heartbeat
 * Returns HeartbeatResponse or null (network error / non-2xx).
 */
export async function apiMatchHeartbeat(
  token: string,
  matchId: string,
  body: { game: string; mode: string; code: string },
): Promise<HeartbeatResponse | null> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/heartbeat`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return null;
    const raw = (await res.json().catch(() => null)) as HeartbeatResponse | null;
    if (!raw) return null;
    // Normalise team strings to strict "A" | "B" | null
    const normaliseTeam = (t: unknown): "A" | "B" | null => {
      const s = String(t ?? "").toUpperCase();
      return s === "A" ? "A" : s === "B" ? "B" : null;
    };
    return {
      ...raw,
      your_team: normaliseTeam(raw.your_team),
      players: (Array.isArray(raw.players) ? raw.players : []).map((p) => ({
        ...p,
        team: normaliseTeam(p.team),
      })),
    };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

// ── Kick player ───────────────────────────────────────────────────────────────

export async function apiKickPlayer(
  token: string,
  matchId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/kick`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      },
    );
    if (res.status === 429) {
      return { ok: false as const, status: 429, detail: "Too many requests — please wait a moment and try again" };
    }
    if (res.status === 403) {
      return { ok: false as const, status: 403, detail: "Only the host can kick players" };
    }
    if (res.status === 409) {
      return { ok: false as const, status: 409, detail: "Cannot kick from an active match" };
    }
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false as const, status: res.status, detail: String(parseFastApiDetail(raw.detail) ?? "Kick failed") };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationRespondResult = {
  action: "accept" | "decline";
  match_id?: string;
  game?: string;
  mode?: string;
  your_team?: "A" | "B" | null;
  inviter_username?: string | null;
} | null;

export async function apiRespondToNotification(
  token: string,
  notificationId: string,
  action: "accept" | "decline",
): Promise<NotificationRespondResult> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/notifications/${encodeURIComponent(notificationId)}/respond`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    if (!res.ok) return null;
    const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) return null;
    const rawAction = String(raw.action ?? action);
    const resolvedAction: "accept" | "decline" = rawAction === "decline" ? "decline" : "accept";
    const rawTeam = String(raw.your_team ?? "").toUpperCase();
    const matchId = raw.match_id ? String(raw.match_id) : undefined;
    return {
      action: resolvedAction,
      ...(matchId ? { match_id: matchId } : {}),
      game: raw.game ? String(raw.game) : undefined,
      mode: String(raw.mode ?? ""),
      your_team: rawTeam === "A" ? "A" : rawTeam === "B" ? "B" : null,
      inviter_username: raw.inviter_username ? String(raw.inviter_username) : null,
    };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// PATCH /users/me — persist avatar, badge, forge, username changes to DB
// Note: steam_id and riot_id are server-controlled (OpenID/OAuth only) and cannot be sent here.
export async function apiPatchMe(
  token: string,
  patch: {
    avatar?: string | null;
    avatar_bg?: string | null;
    equipped_badge_icon?: string | null;
    forge_unlocked_item_ids?: string[];
    username?: string | null;
  },
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/me`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export type ApiPatchWalletResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * PATCH /users/me — write-once wallet_address after client-side ownership signature.
 * Returns a discriminated union so callers can surface specific errors:
 *   400 → already linked to this account or empty address rejected
 *   409 → this wallet address is in a 24h post-deletion cooldown
 */
export async function apiPatchMeWalletAddress(token: string, wallet_address: string): Promise<ApiPatchWalletResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/me`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address }),
    });
    if (res.ok) return { ok: true };
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const detail = parseFastApiDetail(raw.detail) ?? "";
    if (res.status === 400) {
      return { ok: false, error: detail || "Wallet address could not be saved. You may already have a wallet linked." };
    }
    if (res.status === 409) {
      return { ok: false, error: detail || "This wallet address is in a 24-hour cooldown. Try another address or wait." };
    }
    return { ok: false, error: detail || "Could not save wallet to your profile." };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, error: "Network error — could not reach the server." };
  }
}

/** PATCH /users/me { unlink_wallet: true } — remove wallet from profile. */
export async function apiUnlinkWallet(token: string): Promise<ApiPatchWalletResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/users/me`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlink_wallet: true }),
    });
    if (res.ok) return { ok: true };
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const detail = parseFastApiDetail(raw.detail) ?? "";
    return { ok: false, error: detail || "Could not unlink wallet." };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, error: "Network error — could not reach the server." };
  }
}

// ── Auth: change password ────────────────────────────────────────────────────

export type ApiChangePasswordResult =
  | { ok: true }
  | { ok: false; status: number; detail: string | null };

export async function apiChangePassword(
  token: string,
  current_password: string,
  new_password: string,
): Promise<ApiChangePasswordResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/auth/change-password`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, new_password }),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

// ── Friends ─────────────────────────────────────────────────────────────────

export type ApiFriendRow = {
  user_id: string;
  username: string;
  arena_id: string | null;
  avatar: string | null;
  equipped_badge_icon: string | null;
};

export type ApiFriendRequestRow = {
  request_id: string;
  user_id: string;
  username: string;
  arena_id: string | null;
  avatar: string | null;
  message: string | null;
  created_at: string | null;
};

export async function apiListFriends(token: string): Promise<ApiFriendRow[] | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/friends`, token, {});
    if (!res.ok) return null;
    const raw = (await res.json()) as { friends?: ApiFriendRow[] };
    return Array.isArray(raw.friends) ? raw.friends : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiListFriendRequests(token: string): Promise<{
  incoming: ApiFriendRequestRow[];
  outgoing: ApiFriendRequestRow[];
} | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/friends/requests`, token, {});
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      incoming?: ApiFriendRequestRow[];
      outgoing?: ApiFriendRequestRow[];
    };
    return {
      incoming: Array.isArray(raw.incoming) ? raw.incoming : [],
      outgoing: Array.isArray(raw.outgoing) ? raw.outgoing : [],
    };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export type ApiFriendMutationResult =
  | { ok: true }
  | { ok: false; status: number; detail: string | null };

export async function apiSendFriendRequest(
  token: string,
  user_id: string,
  message?: string | null,
): Promise<ApiFriendMutationResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/friends/request`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id, message: message ?? null }),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiAcceptFriendRequest(token: string, from_user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/friends/${encodeURIComponent(from_user_id)}/accept`,
      token,
      { method: "POST" },
    );
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiRejectFriendRequest(token: string, from_user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/friends/${encodeURIComponent(from_user_id)}/reject`,
      token,
      { method: "POST" },
    );
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiRemoveFriend(token: string, user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/friends/${encodeURIComponent(user_id)}`,
      token,
      { method: "DELETE" },
    );
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiBlockUser(token: string, user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/friends/${encodeURIComponent(user_id)}/block`,
      token,
      { method: "POST" },
    );
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

// ── Direct messages ───────────────────────────────────────────────────────────

export type ApiDmRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string | null;
};

export async function apiGetMessages(
  token: string,
  friend_id: string,
  limit = 50,
): Promise<ApiDmRow[] | null> {
  try {
    const q = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, limit))) });
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/messages/${encodeURIComponent(friend_id)}?${q}`,
      token,
      {},
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as { messages?: ApiDmRow[] };
    return Array.isArray(raw.messages) ? raw.messages : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export type ApiSendMessageResult =
  | { ok: true; id: string; created_at: string | null }
  | { ok: false; status: number; detail: string | null };

export async function apiSendMessage(
  token: string,
  receiver_id: string,
  content: string,
): Promise<ApiSendMessageResult> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/messages`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_id, content }),
    });
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      id?: string;
      created_at?: string | null;
    };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return {
      ok: true as const,
      id: String(raw.id ?? ""),
      created_at: raw.created_at ?? null,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiMarkMessagesRead(token: string, friend_id: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/messages/${encodeURIComponent(friend_id)}/read`,
      token,
      { method: "POST" },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

// ── Matches list / history (GET /matches, GET /matches/history) ─────────────
// DB-ready: open lobby + per-user history; shapes normalized from FastAPI JSON.

function asStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

const VALID_GAMES: ReadonlySet<string> = new Set([
  "CS2",
  "Valorant",
  "Fortnite",
  "Apex Legends",
  "PUBG",
  "COD",
  "League of Legends",
]);

function normalizeClientGame(g: string | undefined): Game {
  const s = (g ?? "CS2").trim();
  return (VALID_GAMES.has(s) ? s : "CS2") as Game;
}

function normalizeMatchListStatus(s: string | undefined): MatchStatus {
  const x = (s ?? "waiting").toLowerCase();
  if (x === "pending") return "in_progress";
  const allowed: MatchStatus[] = ["waiting", "in_progress", "completed", "cancelled", "disputed", "tied"];
  return (allowed.includes(x as MatchStatus) ? x : "waiting") as MatchStatus;
}

function parseMatchPlayerRows(raw: unknown): { userId: string; username?: string; team?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { userId: string; username?: string; team?: string }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const userId = asStr(o.user_id ?? o.userId);
    if (!userId) continue;
    // Backend stores team as integer (0=TeamA, 1=TeamB) — normalize to "A"/"B"
    const rawTeam = asStr(o.team)?.toUpperCase();
    const team =
      rawTeam === "A" ? "A" :
      rawTeam === "B" ? "B" :
      rawTeam === "0" ? "A" :
      rawTeam === "1" ? "B" :
      undefined;
    out.push({
      userId,
      username: asStr(o.username ?? o.display_name),
      team,
    });
  }
  return out;
}

function parseOptionalBool(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

/** Maps one engine match row → UI Match (snake_case or camelCase). */
export function mapApiMatchRowToMatch(row: Record<string, unknown>): Match | null {
  const id = asStr(row.id ?? row.match_id);
  if (!id) return null;

  const hostId = asStr(row.host_id) ?? "";
  const host =
    asStr(row.host_username ?? row.host_name ?? row.host_display_name) ??
    asStr(row.host) ??
    "Unknown";

  const game = normalizeClientGame(asStr(row.game));
  const mode = (asStr(row.mode) ?? "1v1") as Match["mode"];
  const bet =
    asNum(row.bet_amount) ??
    asNum(row.stake_amount) ??
    asNum(row.stake_per_player) ??
    0;

  const scRaw = asStr(row.stake_currency ?? row.stakeCurrency)?.toUpperCase();
  const stakeCurrency: Match["stakeCurrency"] | undefined =
    scRaw === "AT" ? "AT" : scRaw === "CRYPTO" ? "CRYPTO" : undefined;

  const status = normalizeMatchListStatus(asStr(row.status));
  const typeRaw = (asStr(row.type ?? row.match_type) ?? "public").toLowerCase();
  const type = typeRaw === "custom" ? "custom" : "public";

  const createdAt =
    asStr(row.created_at ?? row.createdAt) ?? new Date().toISOString();
  const startedAt = asStr(row.started_at ?? row.startedAt);
  const endedAt = asStr(row.ended_at ?? row.endedAt);
  const winnerId = asStr(row.winner_id ?? row.winnerId);
  const code = asStr(row.code) ?? undefined;
  const hasPassword = parseOptionalBool(row.has_password ?? row.hasPassword);
  const filledPlayerCount = asNum(row.player_count ?? row.playerCount);
  const maxPlayers = asNum(row.max_players ?? row.maxPlayers) ?? 2;
  const maxPerTeam = asNum(row.max_per_team ?? row.maxPerTeam) ?? undefined;
  const teamSize = maxPerTeam ?? (asNum(row.team_size ?? row.teamSize) ?? undefined);
  const depositsReceived = asNum(row.deposits_received ?? row.depositsReceived) ?? undefined;
  const timeLeft = asStr(row.time_left ?? row.timeLeft) ?? undefined;
  const lockCountdownStart = asStr(row.lock_countdown_start ?? row.lockCountdownStart) ?? undefined;
  const expiresAt = asStr(row.expires_at ?? row.expiresAt) ?? undefined;

  const mPlayers = parseMatchPlayerRows(
    row.match_players ?? row.matchPlayers ?? row.players
  );
  let teamA: string[] | undefined;
  let teamB: string[] | undefined;
  if (mPlayers.length > 0) {
    // Use username for display (room slot renders these values directly).
    // Fall back to userId only when username is unavailable.
    teamA = mPlayers.filter((p) => p.team === "A").map((p) => p.username ?? p.userId);
    teamB = mPlayers.filter((p) => p.team === "B").map((p) => p.username ?? p.userId);

    // Some engine responses may not include team assignments yet (team is NULL in DB).
    // In that case, still prefer stable display names over raw UUIDs by splitting the
    // joined_at order into Team A then Team B.
    if (teamA.length === 0 && teamB.length === 0) {
      const maxPerSide = maxPerTeam ?? teamSize ?? Math.max(1, Math.ceil(maxPlayers / 2));
      const names = mPlayers.map((p) => p.username ?? p.userId);
      teamA = names.slice(0, maxPerSide);
      teamB = names.slice(maxPerSide, maxPerSide * 2);
    }
  }
  const teamAraw = row.team_a ?? row.teamA;
  const teamBraw = row.team_b ?? row.teamB;
  if (Array.isArray(teamAraw)) teamA = teamAraw.map((x) => String(x));
  if (Array.isArray(teamBraw)) teamB = teamBraw.map((x) => String(x));

  let players: string[] = [];
  if (Array.isArray(row.players)) {
    players = (row.players as unknown[]).map((x) => {
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        // Prefer username for display; fall back to user_id only if username is absent
        const name = asStr(o.username ?? o.display_name);
        if (name) return name;
        const uid = asStr(o.user_id ?? o.userId);
        if (uid) return uid;
      }
      return String(x);
    });
  } else if (mPlayers.length > 0) {
    players = mPlayers.map((p) => p.userId);
  }

  const base: Match = {
    id,
    type,
    host,
    hostId,
    game,
    mode,
    betAmount: bet,
    players,
    ...(filledPlayerCount !== undefined && filledPlayerCount !== null
      ? { filledPlayerCount }
      : {}),
    maxPlayers,
    status,
    createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(winnerId ? { winnerId } : {}),
    ...(code ? { code } : {}),
    ...(hasPassword !== undefined ? { hasPassword } : {}),
    ...(teamA?.length ? { teamA } : {}),
    ...(teamB?.length ? { teamB } : {}),
    ...(teamSize !== undefined ? { teamSize, maxPerTeam: teamSize } : {}),
    ...(depositsReceived !== undefined ? { depositsReceived } : {}),
    ...(timeLeft ? { timeLeft } : {}),
    ...(lockCountdownStart ? { lockCountdownStart } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(stakeCurrency ? { stakeCurrency } : {}),
    ...(row.your_has_deposited !== undefined
      ? { yourHasDeposited: Boolean(row.your_has_deposited) }
      : {}),
  };

  return base;
}

async function fetchJsonMatches(path: string, token?: string | null): Promise<Match[] | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetchWithOptionalUserAuth(`${ENGINE_BASE}${path}`, token ?? null, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown;
    let rows: unknown[] = [];
    if (Array.isArray(raw)) rows = raw;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { matches?: unknown[] }).matches)) {
      rows = (raw as { matches: unknown[] }).matches;
    }
    const matches: Match[] = [];
    for (const r of rows) {
      if (r && typeof r === "object") {
        const m = mapApiMatchRowToMatch(r as Record<string, unknown>);
        if (m) matches.push(m);
      }
    }
    return matches;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** GET /matches — open / lobby matches (optional Bearer). */
export async function apiListMatchesOpen(token?: string | null): Promise<Match[] | null> {
  return fetchJsonMatches("/matches", token ?? null);
}

export type ApiMatchesHistoryOpts = {
  limit?: number;
  range?: "weekly" | "monthly" | "alltime";
};

/** GET /matches/history — authenticated user's history. */
export async function apiListMatchesHistory(
  token: string,
  opts?: ApiMatchesHistoryOpts,
): Promise<Match[] | null> {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.range) q.set("range", opts.range);
  const suffix = q.toString() ? `?${q}` : "";
  return fetchJsonMatches(`/matches/history${suffix}`, token);
}

function initialsFromUsername(name: string): string {
  const t = name.trim();
  if (t.length < 2) return (t || "??").toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function tierHintFromRank(rank: string): string {
  const first = rank.split(/\s+/)[0] ?? rank;
  return ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Unranked"].includes(first)
    ? first
    : rank;
}

/** Maps GET /players row or GET /players/{id} → PublicPlayerProfile. */
export function mapApiPlayerRowToPublic(row: Record<string, unknown>): PublicPlayerProfile | null {
  const id = asStr(row.user_id ?? row.id);
  if (!id) return null;
  const username = asStr(row.username) ?? "Unknown";
  const wins = asNum(row.wins) ?? 0;
  const losses = asNum(row.losses) ?? 0;
  const matchesPlayed = asNum(row.matches) ?? wins + losses;
  const winRate =
    asNum(row.win_rate) ??
    (matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 1000) / 10 : 0);
  const rankStr = asStr(row.rank) ?? "Unranked";
  const pref = normalizeClientGame(asStr(row.preferred_game ?? row.preferredGame));
  const statusRaw = (asStr(row.status) ?? "active").toLowerCase();
  const status: UserStatus =
    statusRaw === "banned" || statusRaw === "flagged" || statusRaw === "suspended" || statusRaw === "active"
      ? (statusRaw as UserStatus)
      : "active";
  const arenaRaw = asStr(row.arena_id ?? row.arenaId);
  const arenaId = (arenaRaw ?? `ARENA-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`) as ArenaId;
  const created = asStr(row.created_at ?? row.member_since);
  let memberSince = "—";
  if (created) {
    try {
      memberSince = new Date(created).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } catch {
      memberSince = created;
    }
  }

  return {
    id,
    username,
    avatarInitials: asStr(row.avatar_initials) ?? initialsFromUsername(username),
    avatar: asStr(row.avatar) ?? undefined,
    avatarBg: asStr(row.avatar_bg ?? row.avatarBg) ?? undefined,
    equippedBadgeIcon: asStr(row.equipped_badge_icon ?? row.equippedBadgeIcon) ?? undefined,
    rank: rankStr,
    tier: asStr(row.tier) ?? tierHintFromRank(rankStr),
    preferredGame: pref,
    arenaId,
    memberSince,
    status,
    leaderboardRank: asNum(row.leaderboard_rank ?? row.leaderboardRank),
    stats: {
      matches: matchesPlayed,
      wins,
      losses,
      winRate,
      totalEarnings: asNum(row.total_earnings ?? row.totalEarnings) ?? 0,
    },
  };
}

/** GET /players?q=&game= — directory search (Bearer recommended). */
export async function apiSearchPlayers(
  token: string | null,
  q: string,
  game?: string,
): Promise<PublicPlayerProfile[]> {
  try {
    const params = new URLSearchParams();
    params.set("q", q);
    if (game) params.set("game", game);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetchWithOptionalUserAuth(`${ENGINE_BASE}/players?${params}`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return [];
    const raw = (await res.json()) as { players?: unknown[] };
    const rows = Array.isArray(raw.players) ? raw.players : [];
    const out: PublicPlayerProfile[] = [];
    for (const r of rows) {
      if (r && typeof r === "object") {
        const p = mapApiPlayerRowToPublic(r as Record<string, unknown>);
        if (p) out.push(p);
      }
    }
    return out;
  } catch (err) {
    reportEngineApiError(err);
    return [];
  }
}

/** GET /players/{user_id} — public profile card. */
export async function apiGetPublicPlayer(
  userId: string,
  token?: string | null,
): Promise<PublicPlayerProfile | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetchWithOptionalUserAuth(
      `${ENGINE_BASE}/players/${encodeURIComponent(userId)}`,
      token,
      { signal: controller.signal },
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return mapApiPlayerRowToPublic(raw);
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

function mapLeaderboardApiRow(
  row: Record<string, unknown>,
  index: number,
  gameFallback: string,
): LeaderboardPlayerRow {
  const wins = asNum(row.wins) ?? 0;
  const losses = asNum(row.losses) ?? 0;
  const played = wins + losses;
  const winRate =
    asNum(row.win_rate ?? row.winRate) ??
    (played > 0 ? Math.round((wins / played) * 1000) / 10 : 0);
  const ch = asStr(row.change)?.toLowerCase();
  const change: LeaderboardPlayerRow["change"] =
    ch === "up" || ch === "down" ? ch : "same";
  return {
    id: asStr(row.user_id ?? row.id) ?? `lb-${index}`,
    arenaId: asStr(row.arena_id ?? row.arenaId) ?? "—",
    rank: asNum(row.rank) ?? index + 1,
    username: asStr(row.username) ?? "Unknown",
    wins,
    losses,
    winRate,
    earnings: asNum(row.total_earnings ?? row.earnings) ?? 0,
    streak: asNum(row.streak) ?? 0,
    change,
    game: asStr(row.game) ?? gameFallback,
    avatar: asStr(row.avatar) ?? undefined,
    equippedBadgeIcon: asStr(row.equipped_badge_icon ?? row.equippedBadgeIcon) ?? undefined,
  };
}

export type ApiLeaderboardOpts = {
  game?: string;
  limit?: number;
  range?: "weekly" | "monthly" | "alltime";
  token?: string | null;
};

/** GET /leaderboard?game=&limit=&range= */
export async function apiGetLeaderboard(opts?: ApiLeaderboardOpts): Promise<LeaderboardPlayerRow[] | null> {
  try {
    const q = new URLSearchParams();
    if (opts?.game) q.set("game", opts.game);
    if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
    if (opts?.range) q.set("range", opts.range);
    const suffix = q.toString() ? `?${q}` : "";
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetchWithOptionalUserAuth(`${ENGINE_BASE}/leaderboard${suffix}`, opts?.token ?? null, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { leaderboard?: unknown[] };
    const rows = Array.isArray(raw.leaderboard) ? raw.leaderboard : [];
    const gameFb = opts?.game ?? "CS2";
    return rows.map((r, i) =>
      r && typeof r === "object"
        ? mapLeaderboardApiRow(r as Record<string, unknown>, i, gameFb)
        : mapLeaderboardApiRow({}, i, gameFb),
    );
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

// ── Inbox (GET /inbox, POST /inbox, PATCH read, DELETE) ───────────────────────
// DB-ready: inbox_messages; shapes match FastAPI in engine/main.py.

function mapInboxApiRow(row: Record<string, unknown>, receiverId: string): InboxMessage {
  const arena = asStr(row.sender_arena_id ?? row.senderArenaId) ?? "—";
  return {
    id: asStr(row.id) ?? "",
    senderId: asStr(row.sender_id ?? row.senderId) ?? "",
    senderName: asStr(row.sender_username ?? row.senderName) ?? "Unknown",
    senderArenaId: arena as ArenaId,
    receiverId,
    subject: asStr(row.subject) ?? "",
    content: asStr(row.content) ?? "",
    read: Boolean(row.read),
    deleted: false,
    createdAt: asStr(row.created_at ?? row.createdAt) ?? new Date().toISOString(),
  };
}

export type ApiListInboxOpts = {
  unreadOnly?: boolean;
  limit?: number;
  /** Current user id (receiver); API omits it per row. */
  receiverId: string;
  token?: string | null;
};

/** GET /inbox?unread_only=&limit= */
export async function apiListInbox(opts: ApiListInboxOpts): Promise<InboxMessage[] | null> {
  const token = opts.token ?? null;
  if (!token) return null;
  try {
    const q = new URLSearchParams();
    q.set("unread_only", opts.unreadOnly ? "true" : "false");
    if (opts.limit !== undefined) q.set("limit", String(opts.limit));
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/inbox?${q}`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { messages?: unknown[] };
    const rows = Array.isArray(raw.messages) ? raw.messages : [];
    return rows.map((r) =>
      r && typeof r === "object"
        ? mapInboxApiRow(r as Record<string, unknown>, opts.receiverId)
        : mapInboxApiRow({}, opts.receiverId),
    );
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** GET /inbox/unread-count → sidebar / tab badge */
export async function apiGetInboxUnreadCount(token: string | null | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/inbox/unread-count`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { unread_count?: unknown };
    const n = asNum(raw.unread_count);
    return n ?? 0;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export type ApiPostInboxBody = { receiver_id: string; subject: string; content: string };

/** POST /inbox — formal message to another user (receiver_id = UUID). */
export async function apiPostInbox(
  token: string,
  body: ApiPostInboxBody,
): Promise<
  | { ok: true; id: string; sender_id: string; receiver_id: string; subject: string; created_at: string | null }
  | { ok: false; error: string; status: number }
> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/inbox`, token, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiver_id: body.receiver_id,
        subject: body.subject,
        content: body.content,
      }),
    });
    clearTimeout(tid);
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      const detail = parseFastApiDetail(raw.detail) ?? `Send failed (${res.status})`;
      return { ok: false as const, error: detail, status: res.status };
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      ok: true as const,
      id: asStr(raw.id) ?? "",
      sender_id: asStr(raw.sender_id) ?? "",
      receiver_id: asStr(raw.receiver_id) ?? "",
      subject: asStr(raw.subject) ?? "",
      created_at: asStr(raw.created_at) ?? null,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, error: "Network error", status: 0 };
  }
}

/** PATCH /inbox/:id/read */
export async function apiPatchInboxRead(token: string, messageId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/inbox/${encodeURIComponent(messageId)}/read`,
      token,
      { method: "PATCH", signal: controller.signal },
    );
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** PATCH /inbox/read-all */
export async function apiPatchInboxReadAll(token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/inbox/read-all`, token, {
      method: "PATCH",
      signal: controller.signal,
    });
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** DELETE /inbox/:id (soft delete) */
export async function apiDeleteInbox(token: string, messageId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/inbox/${encodeURIComponent(messageId)}`,
      token,
      { method: "DELETE", signal: controller.signal },
    );
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────
// DB-ready: notifications table; shapes match GET /notifications response.

export type ApiNotificationRow = {
  id:         string;
  type:       string;
  title:      string;
  message:    string;
  read:       boolean;
  metadata:   Record<string, unknown> | null;
  created_at: string | null;
};

/**
 * GET /notifications — authenticated user's notifications, newest first.
 * ?unread_only=true&limit=N
 * DB-ready: SELECT from notifications WHERE user_id = :me ORDER BY created_at DESC.
 */
export async function apiGetNotifications(
  token: string,
  opts?: { unreadOnly?: boolean; limit?: number },
): Promise<ApiNotificationRow[] | null> {
  try {
    const q = new URLSearchParams();
    if (opts?.unreadOnly) q.set("unread_only", "true");
    if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/notifications?${q}`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { notifications?: ApiNotificationRow[] };
    return Array.isArray(raw.notifications) ? raw.notifications : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** PATCH /notifications/:id/read — mark single notification as read. */
export async function apiMarkNotificationRead(token: string, notificationId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/notifications/${encodeURIComponent(notificationId)}/read`,
      token,
      { method: "PATCH", signal: controller.signal },
    );
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** PATCH /notifications/read-all — mark all as read for the authenticated user. */
export async function apiMarkAllNotificationsRead(token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/notifications/read-all`, token, {
      method: "PATCH",
      signal: controller.signal,
    });
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

/** DELETE /notifications/:id — remove a single notification for the authenticated user. */
export async function apiDeleteNotification(token: string, notificationId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/notifications/${encodeURIComponent(notificationId)}`,
      token,
      { method: "DELETE", signal: controller.signal },
    );
    clearTimeout(tid);
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

// ── Disputes ──────────────────────────────────────────────────────────────────
// DB-ready: disputes table; shapes match GET /disputes and POST /disputes.

export type ApiDisputeRow = {
  id:                string;
  match_id:          string;
  player_a:          string;
  player_b:          string;
  player_a_username: string;
  player_b_username: string;
  reason:            string;
  status:            string;
  resolution:        string;
  evidence:          string | null;
  admin_notes:       string | null;
  resolved_by:       string | null;
  created_at:        string | null;
  resolved_at:       string | null;
  game:              string;
  stake:             number;
};

/**
 * POST /disputes — open a dispute on a completed or disputed match.
 * Marks match status → 'disputed'.
 * DB-ready: INSERT into disputes; UPDATE matches SET status='disputed'.
 */
export async function apiCreateDispute(
  token: string,
  body: { match_id: string; reason: string; evidence?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; status: number; detail: string | null }> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/disputes`, token, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    clearTimeout(tid);
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown; id?: string };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const, id: String(raw.id ?? "") };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

/**
 * GET /disputes — list disputes where caller is player_a or player_b.
 * DB-ready: disputes JOIN matches JOIN users.
 */
export async function apiGetDisputes(token: string): Promise<ApiDisputeRow[] | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/disputes`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { disputes?: ApiDisputeRow[] };
    return Array.isArray(raw.disputes) ? raw.disputes : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

// ── Support Tickets ───────────────────────────────────────────────────────────
// DB-ready: support_tickets table; shapes match GET/POST /support/tickets.

export type ApiSupportTicketRow = {
  id:                string;
  reason:            string;
  description:       string;
  status:            string;
  category:          string;
  match_id:          string | null;
  topic:             string | null;
  admin_note:        string | null;
  created_at:        string | null;
  updated_at:        string | null;
  reported_id:       string | null;
  reported_username: string | null;
};

/**
 * POST /support/tickets — file a support ticket.
 * DB-ready: INSERT into support_tickets.
 */
export async function apiCreateSupportTicket(
  token: string,
  body: {
    reason:          string;
    description:     string;
    reported_id?:    string | null;
    category?:       string;
    match_id?:       string | null;
    topic?:          string | null;
    attachment_url?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; status: number; detail: string | null }> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/support/tickets`, token, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    clearTimeout(tid);
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown; id?: string };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const, id: String(raw.id ?? "") };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

/**
 * GET /support/tickets — list caller's own tickets (optional ?status= filter).
 * DB-ready: support_tickets WHERE reporter_id = me.
 */
export async function apiGetSupportTickets(
  token: string,
  opts?: { status?: string },
): Promise<ApiSupportTicketRow[] | null> {
  try {
    const q = new URLSearchParams();
    if (opts?.status) q.set("status", opts.status);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/support/tickets?${q}`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { tickets?: ApiSupportTicketRow[] };
    return Array.isArray(raw.tickets) ? raw.tickets : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/** GET /admin/support/tickets — full queue for admins */
export type ApiAdminSupportTicketRow = ApiSupportTicketRow & {
  reporter_id: string;
  reporter_username: string | null;
};

export async function apiAdminListSupportTickets(
  token: string,
  opts?: { limit?: number },
): Promise<
  | { ok: true; tickets: ApiAdminSupportTicketRow[] }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/support/tickets?${q}`, token, {});
    const raw = (await res.json().catch(() => ({}))) as {
      tickets?: ApiAdminSupportTicketRow[];
      detail?: unknown;
    };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const, tickets: Array.isArray(raw.tickets) ? raw.tickets : [] };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

/** PATCH /admin/support/tickets/{id} */
export async function apiAdminPatchSupportTicket(
  token: string,
  ticketId: string,
  body: { status?: string; admin_note?: string | null },
): Promise<{ ok: true } | { ok: false; status: number; detail: string | null }> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/admin/support/tickets/${encodeURIComponent(ticketId)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

// ── Forge Challenges ──────────────────────────────────────────────────────────
// DB-ready: forge_challenges + forge_challenge_progress; shapes match GET /forge/challenges.

export type ApiForgeChallengeRow = {
  id:          string;
  title:       string;
  description: string;
  icon:        string;
  type:        "daily" | "weekly";
  rewardAT:    number;
  rewardXP:    number;
  target:      number;
  progress:    number;
  status:      "active" | "claimable" | "claimed";
  expiresAt:   string;
};

/**
 * GET /forge/challenges — active challenges with the user's cycle progress.
 * DB-ready: forge_challenges LEFT JOIN forge_challenge_progress for current cycle.
 */
export async function apiGetForgeChallenges(token: string): Promise<ApiForgeChallengeRow[] | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(`${ENGINE_BASE}/forge/challenges`, token, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { challenges?: ApiForgeChallengeRow[] };
    return Array.isArray(raw.challenges) ? raw.challenges : [];
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

/**
 * POST /forge/challenges/:id/claim — claim AT + XP reward for a completed challenge.
 * DB-ready: UPDATE forge_challenge_progress status='claimed'; credit AT + XP.
 */
export async function apiClaimForgeChallenge(
  token: string,
  challengeId: string,
): Promise<
  | { ok: true; reward_at: number; reward_xp: number; at_balance: number }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forge/challenges/${encodeURIComponent(challengeId)}/claim`,
      token,
      { method: "POST", signal: controller.signal },
    );
    clearTimeout(tid);
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return {
      ok:         true as const,
      reward_at:  asNum(raw.reward_at)  ?? 0,
      reward_xp:  asNum(raw.reward_xp)  ?? 0,
      at_balance: asNum(raw.at_balance) ?? 0,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

// ── Forum API ─────────────────────────────────────────────────────────────────

export interface ForumUserCard {
  id: string;
  username: string;
  avatar: string | null;
  avatar_bg: string | null;
  arena_id: string;
  rank: string;
  member_since: string;
  forum_post_count: number;
  role: string;
  forum_signature: string | null;
  forum_badge: string | null;
}

export interface ForumCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  parent_id: string | null;
  thread_count: number;
  children: ForumCategory[];
}

export interface ForumThread {
  id: string;
  slug: string;
  title: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  author: ForumUserCard;
  reply_count: number;
  is_pinned: boolean;
  is_locked: boolean;
  status: string;
  created_at: string;
  last_post_at: string | null;
  view_count: number;
}

export interface ForumPost {
  id: string;
  thread_id: string;
  author: ForumUserCard;
  body: string;
  post_number: number;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  edit_count: number;
  reactions: Record<string, number>;
}

export interface ForumThreadDetail extends ForumThread {
  first_post: ForumPost;
}

export async function apiGetForumCategories(): Promise<ForumCategory[] | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/forum/categories`);
    if (!res.ok) return null;
    const data = (await res.json()) as { categories: ForumCategory[] };
    return data.categories;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiGetForumThreads(
  categorySlug: string,
  page = 1,
): Promise<{ threads: ForumThread[]; total: number; pages: number } | null> {
  try {
    const res = await fetch(
      `${ENGINE_BASE}/forum/threads?category=${encodeURIComponent(categorySlug)}&page=${page}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { threads: ForumThread[]; total: number; pages: number };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiGetForumThread(slug: string): Promise<ForumThreadDetail | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/forum/threads/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return (await res.json()) as ForumThreadDetail;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiCreateForumThread(
  token: string,
  data: { title: string; category_id: string; body: string },
): Promise<{ ok: true; slug: string } | { ok: false; detail: string }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/forum/threads`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false as const, detail: parseFastApiDetail(raw.detail) ?? "Error" };
    return { ok: true as const, slug: raw.slug as string };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, detail: "Network error" };
  }
}

export async function apiGetForumPosts(
  threadId: string,
  page = 1,
): Promise<{ posts: ForumPost[]; total: number; pages: number } | null> {
  try {
    const res = await fetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}/posts?page=${page}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { posts: ForumPost[]; total: number; pages: number };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiCreateForumPost(
  token: string,
  threadId: string,
  body: string,
): Promise<{ ok: true; post: ForumPost } | { ok: false; detail: string }> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}/posts`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false as const, detail: parseFastApiDetail(raw.detail) ?? "Error" };
    return { ok: true as const, post: raw as unknown as ForumPost };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false as const, detail: "Network error" };
  }
}

export async function apiReactForumPost(
  token: string,
  postId: string,
  emoji: string,
): Promise<Record<string, number> | null> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/posts/${encodeURIComponent(postId)}/react`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { reactions: Record<string, number> };
    return data.reactions;
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiSearchForum(
  q: string,
): Promise<{ threads: ForumThread[]; posts: ForumPost[] } | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/forum/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    return (await res.json()) as { threads: ForumThread[]; posts: ForumPost[] };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiPollForumThread(
  threadId: string,
  afterPostId: string,
): Promise<{ posts: ForumPost[] } | null> {
  try {
    const res = await fetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}/poll?after=${encodeURIComponent(afterPostId)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { posts: ForumPost[] };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiGetForumProfile(
  token: string,
): Promise<{ signature: string | null; badge: string | null } | null> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/forum/profile/me`, token, { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as { signature: string | null; badge: string | null };
  } catch (err) {
    reportEngineApiError(err);
    return null;
  }
}

export async function apiPatchForumProfile(
  token: string,
  data: { signature?: string; badge?: string },
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/forum/profile/me`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export async function apiDeleteForumPost(token: string, postId: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/posts/${encodeURIComponent(postId)}`,
      token,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export async function apiDeleteForumThread(token: string, threadId: string): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}`,
      token,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export async function apiPinForumThread(
  token: string,
  threadId: string,
  pin: boolean,
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}/pin`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

export async function apiLockForumThread(
  token: string,
  threadId: string,
  lock: boolean,
): Promise<boolean> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/forum/threads/${encodeURIComponent(threadId)}/lock`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock }),
      },
    );
    return res.ok;
  } catch (err) {
    reportEngineApiError(err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin API
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /admin/oracle/status ─────────────────────────────────────────────────
export interface OracleStatus {
  escrow_enabled:  boolean;
  listener_active: boolean;
  last_block:      number;
  last_sync_at:    string | null;
}

export async function apiAdminOracleStatus(token: string): Promise<
  ({ ok: true } & OracleStatus) |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/oracle/status`, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return {
      ok:              true,
      escrow_enabled:  raw.escrow_enabled  === true,
      listener_active: raw.listener_active === true,
      last_block:      (raw.last_block  as number) ?? 0,
      last_sync_at:    raw.last_sync_at as string | null ?? null,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── POST /admin/oracle/sync ──────────────────────────────────────────────────
export async function apiAdminOracleSync(token: string, fromBlock?: number): Promise<
  { ok: true; synced: boolean; from_block: number; to_block: number; events_processed: number } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const qs = fromBlock !== undefined ? `?from_block=${fromBlock}` : "";
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/oracle/sync${qs}`, token, {
      method: "POST",
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return {
      ok:               true,
      synced:           raw.synced === true,
      from_block:       (raw.from_block       as number) ?? 0,
      to_block:         (raw.to_block         as number) ?? 0,
      events_processed: (raw.events_processed as number) ?? 0,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── POST /admin/alerts/test-slack ─────────────────────────────────────────────
export async function apiAdminTestSlack(token: string): Promise<
  { ok: true; sent: true } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/alerts/test-slack`, token, {
      method: "POST",
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    // Engine returns { ok: true, sent: true }; narrow for callers without widening to boolean.
    if (raw.sent === true) {
      return { ok: true, sent: true };
    }
    return { ok: false, status: res.status, detail: "Invalid response" };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /admin/freeze/status ─────────────────────────────────────────────────
export async function apiAdminFreezeStatus(token: string): Promise<
  { ok: true; frozen: boolean } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/freeze/status`, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, frozen: raw.frozen === true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── POST /admin/freeze ───────────────────────────────────────────────────────
export async function apiAdminFreeze(token: string, freeze: boolean): Promise<
  { ok: true; frozen: boolean; message: string } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/freeze`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freeze }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, frozen: raw.frozen === true, message: String(raw.message ?? "") };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /admin/users ─────────────────────────────────────────────────────────
export interface AdminUser {
  user_id:        string;
  username:       string;
  email:          string;
  status:         string;
  rank:           string;
  at_balance:     number;
  wallet_address: string;
  matches:        number;
  wins:           number;
  win_rate:       number;
  penalty_count:  number;
  is_suspended:   boolean;
  is_banned:      boolean;
  suspended_until: string | null;
  banned_at:      string | null;
}

export async function apiAdminGetUsers(
  token: string,
  params?: { limit?: number; offset?: number; status?: string; search?: string; flagged?: boolean },
): Promise<
  { ok: true; users: AdminUser[]; total: number } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const qs = new URLSearchParams();
    if (params?.limit)   qs.set("limit",   String(params.limit));
    if (params?.offset)  qs.set("offset",  String(params.offset));
    if (params?.status)  qs.set("status",  params.status);
    if (params?.search)  qs.set("search",  params.search);
    if (params?.flagged) qs.set("flagged", "true");
    const url = `${ENGINE_BASE}/admin/users${qs.size ? "?" + qs.toString() : ""}`;
    const res = await arenaUserFetch(url, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, users: (raw.users as AdminUser[]) ?? [], total: (raw.total as number) ?? 0 };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /admin/disputes ──────────────────────────────────────────────────────
export interface AdminDispute {
  id:                  string;
  match_id:            string;
  raised_by:           string;
  raised_by_username:  string;
  reason:              string;
  status:              string;   // "open" | "reviewing" | "resolved" | "escalated"
  resolution:          string;
  admin_notes:         string | null;
  game:                string;
  bet_amount:          number | null;
  stake_currency:      string;
  created_at:          string;
  resolved_at:         string | null;
}

export async function apiAdminGetDisputes(
  token: string,
  params?: { limit?: number; offset?: number; status?: string },
): Promise<
  { ok: true; disputes: AdminDispute[]; total: number } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const qs = new URLSearchParams();
    if (params?.limit)  qs.set("limit",  String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.status) qs.set("status", params.status);
    const url = `${ENGINE_BASE}/admin/disputes${qs.size ? "?" + qs.toString() : ""}`;
    const res = await arenaUserFetch(url, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, disputes: (raw.disputes as AdminDispute[]) ?? [], total: (raw.total as number) ?? 0 };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── POST /admin/users/{id}/penalty ───────────────────────────────────────────
// offense_type: "rage_quit" | "kick_abuse" | "fraud" | "cheating" | "manual_ban" | "manual_suspend"
export async function apiAdminIssuePenalty(
  token: string,
  userId: string,
  offenseType: string,
  notes = "",
): Promise<
  {
    ok: true;
    penalized: boolean;
    user_id: string;
    offense_count: number;
    action: string;
    suspended_until: string | null;
    banned_at: string | null;
  } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/users/${userId}/penalty`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offense_type: offenseType, notes }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return {
      ok:              true,
      penalized:       raw.penalized === true,
      user_id:         String(raw.user_id ?? ""),
      offense_count:   (raw.offense_count as number) ?? 0,
      action:          String(raw.action ?? ""),
      suspended_until: raw.suspended_until as string | null,
      banned_at:       raw.banned_at as string | null,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /platform/config ─────────────────────────────────────────────────────
export interface PlatformConfig {
  fee_pct:                          string;
  daily_bet_max_at:                 string;
  daily_bet_max_usdt:               string;
  high_stakes_daily_max:            string;
  high_stakes_min_bet_at:           string;
  high_stakes_min_bet_usdt:         string;
  daily_loss_cap_at:                string;
  daily_loss_cap_usdt:              string;
  maintenance_mode:                 string;
  new_registrations:                string;
  auto_escalate_disputes:           string;
  fraud_pair_match_gt:              string;
  fraud_pair_window_hours:          string;
  fraud_intentional_loss_min_count: string;
  fraud_intentional_loss_days:      string;
}

export async function apiGetPlatformConfig(token: string): Promise<
  ({ ok: true } & PlatformConfig) |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/platform/config`, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return {
      ok:                               true,
      fee_pct:                          String(raw.fee_pct                          ?? "5"),
      daily_bet_max_at:                 String(raw.daily_bet_max_at                 ?? "50000"),
      daily_bet_max_usdt:               String(raw.daily_bet_max_usdt               ?? "500"),
      high_stakes_daily_max:            String(raw.high_stakes_daily_max            ?? "0"),
      high_stakes_min_bet_at:           String(raw.high_stakes_min_bet_at           ?? "25000"),
      high_stakes_min_bet_usdt:         String(raw.high_stakes_min_bet_usdt         ?? "100"),
      daily_loss_cap_at:                String(raw.daily_loss_cap_at                ?? "0"),
      daily_loss_cap_usdt:              String(raw.daily_loss_cap_usdt              ?? "0"),
      maintenance_mode:                 String(raw.maintenance_mode                 ?? "false"),
      new_registrations:                String(raw.new_registrations                ?? "true"),
      auto_escalate_disputes:           String(raw.auto_escalate_disputes           ?? "false"),
      fraud_pair_match_gt:              String(raw.fraud_pair_match_gt              ?? "3"),
      fraud_pair_window_hours:          String(raw.fraud_pair_window_hours          ?? "24"),
      fraud_intentional_loss_min_count: String(raw.fraud_intentional_loss_min_count ?? "5"),
      fraud_intentional_loss_days:      String(raw.fraud_intentional_loss_days      ?? "7"),
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── PUT /platform/config ─────────────────────────────────────────────────────
export async function apiUpdatePlatformConfig(
  token: string,
  body: Partial<PlatformConfig>,
): Promise<
  { ok: true; updated: boolean; fields: string[] } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/platform/config`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, updated: raw.updated === true, fields: (raw.fields as string[]) ?? [] };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /admin/audit-log ─────────────────────────────────────────────────────
export interface AuditEntry {
  id:             string;
  admin_id:       string;
  admin_username: string;
  action:         string;
  target_id:      string | null;
  notes:          string | null;
  created_at:     string;
}

export async function apiAdminGetAuditLog(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<
  { ok: true; entries: AuditEntry[]; total: number } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const qs = new URLSearchParams();
    if (params?.limit)  qs.set("limit",  String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const url = `${ENGINE_BASE}/admin/audit-log${qs.size ? "?" + qs.toString() : ""}`;
    const res = await arenaUserFetch(url, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, entries: (raw.entries as AuditEntry[]) ?? [], total: (raw.total as number) ?? 0 };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── GET /admin/fraud/report ──────────────────────────────────────────────────
export interface FraudFlaggedPlayer {
  user_id:  string;
  username: string;
  win_rate: number;
  matches:  number;
  wins:     number;
  reason:   string;
}
export interface FraudSuspiciousPair {
  player_a:    string;
  username_a:  string;
  player_b:    string;
  username_b:  string;
  match_count: number;
  reason:      string;
}
export interface FraudRepeatOffender {
  user_id:       string;
  username:      string;
  penalty_count: number;
  last_offense:  string;
  is_banned:     boolean;
  reason:        string;
}
export interface FraudRecentlyBanned {
  user_id:      string;
  username:     string;
  banned_at:    string;
  offense_type: string;
  notes:        string | null;
  reason:       string;
}

/** Directional loss farming — loser repeatedly loses to same winner (GET /admin/fraud/report). */
export interface FraudIntentionalLosingRow {
  loser_username:   string;
  winner_username:  string;
  loss_count:       number;
  first_match:      string;
  last_match:       string;
  reason?:          string;
}

export interface FraudSummary {
  total_flagged:      number;
  high_winrate:       number;
  pair_farming:       number;
  repeat_offenders:   number;
  recently_banned?:   number;
  intentional_losing?: number;
}

export interface FraudReport {
  generated_at:       string;
  flagged_players:    FraudFlaggedPlayer[];
  suspicious_pairs:   FraudSuspiciousPair[];
  repeat_offenders:   FraudRepeatOffender[];
  recently_banned:    FraudRecentlyBanned[];
  intentional_losing: FraudIntentionalLosingRow[];
  summary:            FraudSummary;
}

function parseFraudReportPayload(raw: Record<string, unknown>): FraudReport {
  const summaryRaw = raw.summary as FraudSummary | undefined;
  const summary: FraudSummary = summaryRaw ?? {
    total_flagged: 0,
    high_winrate: 0,
    pair_farming: 0,
    repeat_offenders: 0,
    recently_banned: 0,
    intentional_losing: 0,
  };
  return {
    generated_at:       String(raw.generated_at ?? ""),
    flagged_players:    (raw.flagged_players  as FraudFlaggedPlayer[])  ?? [],
    suspicious_pairs:   (raw.suspicious_pairs as FraudSuspiciousPair[]) ?? [],
    repeat_offenders:   (raw.repeat_offenders as FraudRepeatOffender[]) ?? [],
    recently_banned:    (raw.recently_banned  as FraudRecentlyBanned[])  ?? [],
    intentional_losing: (raw.intentional_losing as FraudIntentionalLosingRow[]) ?? [],
    summary: {
      ...summary,
      intentional_losing: summary.intentional_losing ?? 0,
      recently_banned:    summary.recently_banned    ?? 0,
    },
  };
}

/** GET /admin/fraud/summary — count badges only (same shape as report summary). */
export async function apiAdminGetFraudSummary(token: string): Promise<
  ({ ok: true } & FraudSummary) | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/fraud/summary`, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    const s = raw as unknown as FraudSummary;
    return {
      ok: true,
      total_flagged:      Number(s.total_flagged)      || 0,
      high_winrate:       Number(s.high_winrate)       || 0,
      pair_farming:       Number(s.pair_farming)       || 0,
      repeat_offenders:   Number(s.repeat_offenders)   || 0,
      recently_banned:    Number(s.recently_banned)    || 0,
      intentional_losing: Number(s.intentional_losing) || 0,
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

export async function apiAdminGetFraudReport(token: string): Promise<
  ({ ok: true } & FraudReport) |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/fraud/report`, token, {});
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    const parsed = parseFraudReportPayload(raw);
    return { ok: true, ...parsed };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

/** POST /admin/fraud/report/export — same JSON payload as GET report; used to build CSV in the admin UI. */
export async function apiAdminPostFraudExportReport(token: string): Promise<
  ({ ok: true } & FraudReport) | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/fraud/report/export`, token, {
      method: "POST",
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return { ok: true, ...parseFraudReportPayload(raw) };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

/** POST /admin/fraud/report/export — triggers browser download of the JSON file from the server. */
export async function apiAdminFraudExport(token: string): Promise<
  { ok: true } | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/fraud/report/export`, token, {
      method: "POST",
    });
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    let filename = "fraud_report_export.json";
    const m = cd?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m?.[1]) filename = decodeURIComponent(m[1].trim());
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ── POST /support/tickets ─────────────────────────────────────────────────────
export async function apiSubmitSupportTicket(
  token: string,
  params: {
    reason: string;
    description: string;
    category: string;
    topic?: string;
    reported_id?: string;
    match_id?: string;
    attachment_url?: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/support/tickets`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, detail: parseFastApiDetail(raw.detail) ?? "Failed" };
    return { ok: true, id: String(raw.id ?? "") };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, detail: "Network error" };
  }
}

// ── POST /admin/match/{id}/declare-winner ────────────────────────────────────
export async function apiAdminDeclareWinner(
  token: string,
  matchId: string,
  winnerId: string,
  reason = "",
): Promise<
  { ok: true; declared: boolean; match_id: string; winner_id: string; stake_currency: string } |
  { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/match/${matchId}/declare-winner`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner_id: winnerId, reason }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, detail: parseFastApiDetail(raw.detail) };
    return {
      ok:             true,
      declared:       raw.declared === true,
      match_id:       String(raw.match_id       ?? ""),
      winner_id:      String(raw.winner_id      ?? ""),
      stake_currency: String(raw.stake_currency ?? "AT"),
    };
  } catch (err) {
    reportEngineApiError(err);
    return { ok: false, status: 0, detail: "Network error" };
  }
}

// ─── Creators Hub ─────────────────────────────────────────────────────────────

import type { CreatorProfile, CreatorApplication } from "@/types";

export async function apiGetCreators(params?: {
  game?: string; tier?: string; featured?: boolean; limit?: number; offset?: number;
}): Promise<{ creators: CreatorProfile[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.game)    qs.set("game", params.game);
  if (params?.tier)    qs.set("tier", params.tier);
  if (params?.featured !== undefined) qs.set("featured", String(params.featured));
  if (params?.limit)   qs.set("limit", String(params.limit));
  if (params?.offset)  qs.set("offset", String(params.offset));
  const res = await fetch(`${ENGINE_BASE}/creators?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch creators");
  return res.json();
}

export async function apiGetCreator(id: string): Promise<CreatorProfile> {
  const res = await fetch(`${ENGINE_BASE}/creators/${id}`);
  if (!res.ok) throw new Error("Creator not found");
  return res.json();
}

export async function apiApplyCreator(
  token: string,
  data: {
    primary_game: string; bio?: string; motivation?: string;
    twitch_url?: string; youtube_url?: string; tiktok_url?: string; twitter_url?: string;
  }
): Promise<{ status: string }> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/creators/apply`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw.detail || "Failed to submit application");
  return raw;
}

export async function apiAdminGetCreatorApplications(
  token: string, status = "pending"
): Promise<{ applications: CreatorApplication[] }> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/admin/creators/applications?status=${status}`, token);
  if (!res.ok) throw new Error("Failed to fetch applications");
  return res.json();
}

export async function apiAdminReviewCreatorApplication(
  token: string, applicationId: string, status: "approved" | "rejected", review_note?: string
): Promise<{ status: string }> {
  const res = await arenaUserFetch(
    `${ENGINE_BASE}/admin/creators/applications/${applicationId}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_note }),
    }
  );
  const raw = await res.json();
  if (!res.ok) throw new Error(raw.detail || "Failed to review application");
  return raw;
}

export async function apiGetMyCreatorProfile(token: string): Promise<CreatorProfile> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/creators/me`, token);
  if (!res.ok) throw new Error("No creator profile");
  return res.json();
}

export async function apiEditMyCreatorProfile(
  token: string,
  data: { bio?: string; twitch_url?: string; youtube_url?: string; tiktok_url?: string; twitter_url?: string }
): Promise<{ status: string }> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/creators/me`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw.detail || "Failed to update profile");
  return raw;
}

export async function apiAdminGetCreatorProfiles(
  token: string, limit = 50, offset = 0
): Promise<{ profiles: CreatorProfile[]; total: number }> {
  const res = await arenaUserFetch(
    `${ENGINE_BASE}/admin/creators/profiles?limit=${limit}&offset=${offset}`, token
  );
  if (!res.ok) throw new Error("Failed to fetch profiles");
  return res.json();
}

export async function apiAdminEditCreatorProfile(
  token: string,
  creatorId: string,
  data: {
    display_name?: string; bio?: string; primary_game?: string; rank_tier?: string;
    twitch_url?: string; youtube_url?: string; tiktok_url?: string; twitter_url?: string;
    featured?: boolean;
  }
): Promise<{ status: string }> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/admin/creators/${creatorId}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw.detail || "Failed to update creator");
  return raw;
}

export async function apiAdminDeleteCreatorProfile(
  token: string, creatorId: string
): Promise<{ status: string }> {
  const res = await arenaUserFetch(`${ENGINE_BASE}/admin/creators/${creatorId}`, token, {
    method: "DELETE",
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw.detail || "Failed to delete creator");
  return raw;
}

// ── Live match score ───────────────────────────────────────────────────────────

/** Shape returned by GET /matches/:id/live-state */
export interface MatchLiveState {
  match_id:        string;
  ct_score:        number;
  t_score:         number;
  round_confirmed: boolean;   // true once 0-0 was seen from any client
  first_round_at:  string | null;
  submissions:     number;
  updated_at:      string | null;
}

/**
 * Fetch the latest live HUD score for an in-progress match.
 * Returns null when the engine returns 404 (no HUD data yet) or on error.
 */
export async function apiGetLiveState(
  token: string,
  matchId: string,
): Promise<MatchLiveState | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/live-state`,
      token,
      { signal: controller.signal },
    );
    clearTimeout(tid);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as MatchLiveState;
  } catch {
    return null;
  }
}

// ─── Admin: Dispute Holdings ──────────────────────────────────

export async function apiGetDisputeHoldings(
  token: string,
  status?: "pending" | "resolved" | "refunded",
): Promise<DisputeHolding[] | null> {
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await arenaUserFetch(`${ENGINE_BASE}/admin/dispute-holdings${qs}`, token);
    if (!res.ok) return null;
    const body = await res.json();
    return body.holdings as DisputeHolding[];
  } catch {
    return null;
  }
}

export async function apiResolveDisputeHolding(
  token: string,
  holdingId: string,
  action: "award_a" | "award_b" | "refund_all",
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await arenaUserFetch(
      `${ENGINE_BASE}/admin/dispute-holdings/${encodeURIComponent(holdingId)}/resolve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: notes ?? "" }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { detail?: string }).detail ?? "Failed" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

