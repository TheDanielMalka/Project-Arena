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
  Game,
  InboxMessage,
  LeaderboardPlayerRow,
  Match,
  MatchStatus,
  PublicPlayerProfile,
  UserStatus,
} from "@/types";

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
  status:    "waiting" | "in_progress" | "completed" | "cancelled" | "disputed";
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

    const headers: HeadersInit = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = walletAddress
      ? `${ENGINE_BASE}/client/status?wallet_address=${encodeURIComponent(walletAddress)}`
      : `${ENGINE_BASE}/client/status`;

    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as ClientStatusResponse;
  } catch {
    return null;
  }
}

function engineAuthHeaders(userToken?: string | null): HeadersInit {
  const headers: HeadersInit = {};
  if (userToken) headers["Authorization"] = `Bearer ${userToken}`;
  else if (ENGINE_TOKEN) headers["Authorization"] = `Bearer ${ENGINE_TOKEN}`;
  return headers;
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
    const res = await fetch(
      `${ENGINE_BASE}/match/${encodeURIComponent(matchId)}/status`,
      { signal: controller.signal, headers: engineAuthHeaders(token) },
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    return (await res.json()) as MatchStatusApiResponse;
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/match/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as ActiveMatchResponse;
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}`, {
      method: "DELETE",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    clearTimeout(tid);
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) ?? "Cancel failed" };
    }
    return { ok: true };
  } catch {
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
    const res = await fetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/leave`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    clearTimeout(tid);
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) ?? "Leave failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, detail: "Network error" };
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
): Promise<{ ok: true } | { ok: false; detail: string | null }> {
  try {
    const res = await fetch(
      `${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/invite`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ friend_id: friendId }),
      },
    );
    if (!res.ok) {
      const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return { ok: false, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true };
  } catch {
    return { ok: false, detail: null };
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

// POST /auth/login
export async function apiLogin(
  identifier: string,
  password: string,
): Promise<{
  access_token: string;
  user_id: string;
  username: string;
  email: string;
  arena_id: string | null;
  wallet_address: string | null;
} | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      access_token: string;
      user_id: string;
      username: string;
      email: string;
      arena_id: string | null;
      wallet_address: string | null;
    };
  } catch {
    return null;
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
  access_token: string;
  user_id: string;
  username: string;
  email: string;
  arena_id: string | null;
  wallet_address: string | null;
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
  } catch {
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
} | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
    };
  } catch {
    return null;
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
    const res = await fetch(`${ENGINE_BASE}/forge/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
  } catch {
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
    game:            string;
    stake_amount:    number;
    stake_currency?: "CRYPTO" | "AT";
    mode?:           string;        // "1v1" | "2v2" | "4v4" | "5v5" — MUST be sent
    match_type?:     string;        // "public" | "custom" — MUST be sent
  },
): Promise<ApiMatchMutationResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/matches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
  } catch {
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
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/wallet/buy-at-package`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
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
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

/**
 * POST /wallet/withdraw-at — burn AT and receive BNB equivalent to user's linked wallet.
 *
 * Rates:
 *   Standard:   1100 AT = $10 USDT  (use_discount: false)
 *   Discounted:  950 AT = $10 USDT  (use_discount: true)
 *
 * Daily limit: 10,000 AT per user.
 * CONTRACT-ready: platform wallet sends BNB to user wallet.
 */
export async function apiWithdrawAT(
  token: string,
  body: { at_amount: number; use_discount: boolean },
): Promise<
  | { ok: true; at_burned: number; usdt_value: number; wallet_address: string; at_balance: number; daily_remaining: number; rate: string }
  | { ok: false; status: number; detail: string | null }
> {
  try {
    const res = await fetch(`${ENGINE_BASE}/wallet/withdraw-at`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export type ApiJoinMatchSuccess = { joined: boolean; match_id: string; game: string };

/** POST /matches/{match_id}/join — Bearer auth */
export async function apiJoinMatch(
  token: string,
  matchId: string,
): Promise<{ ok: true; data: ApiJoinMatchSuccess } | { ok: false; status: number; detail: string | null }> {
  try {
    const res = await fetch(`${ENGINE_BASE}/matches/${encodeURIComponent(matchId)}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      joined?: boolean;
      match_id?: string;
      game?: string;
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
        joined: !!raw.joined,
        match_id: String(raw.match_id ?? matchId),
        game: String(raw.game ?? ""),
      },
    };
  } catch {
    return { ok: false as const, status: 0, detail: null };
  }
}

// PATCH /users/me — persist avatar, badge, forge changes to DB
export async function apiPatchMe(
  token: string,
  patch: {
    avatar?: string | null;
    avatar_bg?: string | null;
    equipped_badge_icon?: string | null;
    forge_unlocked_item_ids?: string[];
    steam_id?: string | null;
    riot_id?: string | null;
    username?: string | null;
  },
): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_BASE}/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * PATCH /users/me — set `wallet_address` after client-side signature (Issue #23).
 * Engine: `wallet_address` on PatchUserRequest — checksummed address string.
 */
export async function apiPatchMeWalletAddress(token: string, wallet_address: string): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_BASE}/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wallet_address }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * PATCH /users/me — clear linked wallet (`users.wallet_address` → NULL).
 * Engine: same contract as unlinking steam/riot — send empty string (or null once supported).
 */
export async function apiUnlinkMeWalletAddress(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_BASE}/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wallet_address: "" }),
    });
    return res.ok;
  } catch {
    return false;
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
    const res = await fetch(`${ENGINE_BASE}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password, new_password }),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { friends?: ApiFriendRow[] };
    return Array.isArray(raw.friends) ? raw.friends : [];
  } catch {
    return null;
  }
}

export async function apiListFriendRequests(token: string): Promise<{
  incoming: ApiFriendRequestRow[];
  outgoing: ApiFriendRequestRow[];
} | null> {
  try {
    const res = await fetch(`${ENGINE_BASE}/friends/requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      incoming?: ApiFriendRequestRow[];
      outgoing?: ApiFriendRequestRow[];
    };
    return {
      incoming: Array.isArray(raw.incoming) ? raw.incoming : [],
      outgoing: Array.isArray(raw.outgoing) ? raw.outgoing : [],
    };
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/friends/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id, message: message ?? null }),
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiAcceptFriendRequest(token: string, from_user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/friends/${encodeURIComponent(from_user_id)}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiRejectFriendRequest(token: string, from_user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/friends/${encodeURIComponent(from_user_id)}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiRemoveFriend(token: string, user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/friends/${encodeURIComponent(user_id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiBlockUser(token: string, user_id: string): Promise<ApiFriendMutationResult> {
  try {
    const res = await fetch(`${ENGINE_BASE}/friends/${encodeURIComponent(user_id)}/block`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      return { ok: false as const, status: res.status, detail: parseFastApiDetail(raw.detail) };
    }
    return { ok: true as const };
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/messages/${encodeURIComponent(friend_id)}?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { messages?: ApiDmRow[] };
    return Array.isArray(raw.messages) ? raw.messages : [];
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
  } catch {
    return { ok: false as const, status: 0, detail: "Network error" };
  }
}

export async function apiMarkMessagesRead(token: string, friend_id: string): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE_BASE}/messages/${encodeURIComponent(friend_id)}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
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
  const allowed: MatchStatus[] = ["waiting", "in_progress", "completed", "cancelled", "disputed"];
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
  const password = asStr(row.password) ?? undefined;
  const maxPlayers = asNum(row.max_players ?? row.maxPlayers) ?? 2;
  const maxPerTeam = asNum(row.max_per_team ?? row.maxPerTeam) ?? undefined;
  const teamSize = maxPerTeam ?? (asNum(row.team_size ?? row.teamSize) ?? undefined);
  const depositsReceived = asNum(row.deposits_received ?? row.depositsReceived) ?? undefined;
  const timeLeft = asStr(row.time_left ?? row.timeLeft) ?? undefined;
  const lockCountdownStart = asStr(row.lock_countdown_start ?? row.lockCountdownStart) ?? undefined;
  const expiresAt = asStr(row.expires_at ?? row.expiresAt) ?? undefined;

  const mPlayers = parseMatchPlayerRows(row.match_players ?? row.matchPlayers);
  let teamA: string[] | undefined;
  let teamB: string[] | undefined;
  if (mPlayers.length > 0) {
    // Use username for display (room slot renders these values directly).
    // Fall back to userId only when username is unavailable.
    teamA = mPlayers.filter((p) => p.team === "A").map((p) => p.username ?? p.userId);
    teamB = mPlayers.filter((p) => p.team === "B").map((p) => p.username ?? p.userId);
  }
  const teamAraw = row.team_a ?? row.teamA;
  const teamBraw = row.team_b ?? row.teamB;
  if (Array.isArray(teamAraw)) teamA = teamAraw.map((x) => String(x));
  if (Array.isArray(teamBraw)) teamB = teamBraw.map((x) => String(x));

  let players: string[] = [];
  if (Array.isArray(row.players)) {
    players = (row.players as unknown[]).map((x) => {
      if (x && typeof x === "object") {
        const uid = asStr((x as Record<string, unknown>).user_id ?? (x as Record<string, unknown>).userId);
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
    maxPlayers,
    status,
    createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(winnerId ? { winnerId } : {}),
    ...(code ? { code } : {}),
    ...(password ? { password } : {}),
    ...(teamA?.length ? { teamA } : {}),
    ...(teamB?.length ? { teamB } : {}),
    ...(teamSize !== undefined ? { teamSize, maxPerTeam: teamSize } : {}),
    ...(depositsReceived !== undefined ? { depositsReceived } : {}),
    ...(timeLeft ? { timeLeft } : {}),
    ...(lockCountdownStart ? { lockCountdownStart } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(stakeCurrency ? { stakeCurrency } : {}),
  };

  return base;
}

async function fetchJsonMatches(path: string, token?: string | null): Promise<Match[] | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${ENGINE_BASE}${path}`, {
      signal: controller.signal,
      headers: engineAuthHeaders(token ?? null),
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
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/players?${params}`, {
      signal: controller.signal,
      headers: engineAuthHeaders(token ?? null),
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
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/players/${encodeURIComponent(userId)}`, {
      signal: controller.signal,
      headers: engineAuthHeaders(token ?? null),
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return mapApiPlayerRowToPublic(raw);
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/leaderboard${suffix}`, {
      signal: controller.signal,
      headers: engineAuthHeaders(opts?.token ?? null),
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
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/inbox?${q}`, {
      signal: controller.signal,
      headers: engineAuthHeaders(token),
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
  } catch {
    return null;
  }
}

/** GET /inbox/unread-count → sidebar / tab badge */
export async function apiGetInboxUnreadCount(token: string | null | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${ENGINE_BASE}/inbox/unread-count`, {
      signal: controller.signal,
      headers: engineAuthHeaders(token),
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const raw = (await res.json()) as { unread_count?: unknown };
    const n = asNum(raw.unread_count);
    return n ?? 0;
  } catch {
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
    const res = await fetch(`${ENGINE_BASE}/inbox`, {
      method: "POST",
      signal: controller.signal,
      headers: { ...engineAuthHeaders(token), "Content-Type": "application/json" },
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
  } catch {
    return { ok: false as const, error: "Network error", status: 0 };
  }
}

/** PATCH /inbox/:id/read */
export async function apiPatchInboxRead(token: string, messageId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${ENGINE_BASE}/inbox/${encodeURIComponent(messageId)}/read`, {
      method: "PATCH",
      signal: controller.signal,
      headers: engineAuthHeaders(token),
    });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}

/** PATCH /inbox/read-all */
export async function apiPatchInboxReadAll(token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${ENGINE_BASE}/inbox/read-all`, {
      method: "PATCH",
      signal: controller.signal,
      headers: engineAuthHeaders(token),
    });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}

/** DELETE /inbox/:id (soft delete) */
export async function apiDeleteInbox(token: string, messageId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${ENGINE_BASE}/inbox/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      signal: controller.signal,
      headers: engineAuthHeaders(token),
    });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}

