/**
 * ARENA — clientStore
 * Global singleton tracking the Arena desktop client connection status.
 *
 * This store is the single source of truth for client readiness.
 * All components that need to gate on client status read from here.
 *
 * Population:
 *   • useEngineStatus hook calls syncFromHealth() after every poll
 *   • In production: WebSocket "client:*" events call setStatus() directly
 *
 * DB alignment:
 *   Table: client_sessions
 *     user_id          UUID references users
 *     status           VARCHAR  ('checking' | 'disconnected' | 'connected' | 'ready' | 'in_match')
 *     client_version   VARCHAR
 *     uptime           INTEGER  (seconds)
 *     last_heartbeat_at TIMESTAMPTZ
 *     active_match_id  UUID references matches (nullable)
 *
 * API alignment:
 *   POST /api/client/heartbeat   { status, version, uptime }  → upsert client_sessions
 *   GET  /api/client/status      → ClientSession              → seed store on page load
 *
 * WebSocket alignment (WS-ready):
 *   Client emits:  "client:ready" | "client:busy" | "client:idle"
 *   Server emits:  "match:start" | "match:cancel"
 *   All WS events call setStatus() which updates this store.
 */

import { create } from "zustand";
import type { ClientStatus, ClientSession } from "@/types";
import type { EngineHealth, ClientStatusResponse } from "@/lib/engine-api";

interface ClientState extends ClientSession {
  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Direct status setter — used by WebSocket event handlers in production.
   * DB-ready: called on "client:*" WS events from the desktop client.
   */
  setStatus: (status: ClientStatus, meta?: Partial<Pick<ClientSession, "version" | "uptime" | "matchId">>) => void;

  /**
   * Called by useEngineStatus after every HTTP health poll.
   * Maps EngineHealth → ClientStatus and syncs the store.
   *
   * Mapping:
   *   null health          → "disconnected"
   *   health.status=offline → "disconnected"
   *   health.status=error   → "connected"   (API up, capture subsystem not ready)
   *   health.status=ok      → "ready"        (fully operational)
   *
   * Note: "in_match" is set by the WS "client:busy" event / match start flow.
   * HTTP polling never downgrades "in_match" to "ready" — only the WS event does.
   */
  syncFromHealth: (health: EngineHealth | null) => void;

  /**
   * Phase 4: called by useEngineStatus after every GET /client/status poll.
   * This is the authoritative sync — replaces syncFromHealth as the primary
   * source of truth for canPlay() and UI gating.
   *
   * Mapping (backend status → frontend ClientStatus):
   *   online=false                       → "disconnected"
   *   online=true + status="idle"        → "ready"   (client up, no game running)
   *   online=true + status="in_game"     → "ready"   (game running, can start match)
   *   online=true + status="in_match"    → "in_match" (match capture active)
   *
   * canPlay() = online && version_ok (stored as versionOk on ClientSession)
   */
  syncFromClientStatus: (data: ClientStatusResponse | null) => void;

  /**
   * Called when a match goes in_progress (countdown=0) to mark client busy.
   * DB-ready: called alongside updateMatchStatus("in_progress")
   */
  markInMatch: (matchId: string) => void;

  /**
   * Called when a match ends (completed/cancelled) to return client to ready.
   * DB-ready: called on "match:completed" / "match:cancelled" WS events.
   */
  markIdle: () => void;

  // ── Computed ─────────────────────────────────────────────────────────────

  /**
   * Returns true only when the client is ready to participate in matches.
   * Used to gate Join buttons and match creation in MatchLobby.
   *
   * "in_match" also returns true — player is already in a match, still captured.
   */
  canPlay: () => boolean;

  /**
   * Phase 4 strict gate: client must be ready AND bound to the currently
   * authenticated website user (client_sessions.user_id).
   *
   * This prevents "Client Ready" from unlocking play when the desktop client
   * is running but not signed in / bound to the same user.
   */
  canPlayForUser: (userId: string | undefined) => boolean;

  /**
   * Returns a human-readable label for the current status.
   * Used in ArenaHeader and any status badge.
   */
  statusLabel: () => string;
}

export const useClientStore = create<ClientState>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────────
  status:        "checking",
  version:       undefined,
  uptime:        undefined,
  lastCheckedAt: undefined,
  matchId:       undefined,
  // Phase 4 fields
  sessionId:     undefined,
  versionOk:     false,
  bindUserId:    undefined,
  game:          undefined,

  // ── Actions ────────────────────────────────────────────────────────────

  setStatus: (status, meta) =>
    set((s) => ({
      status,
      version:       meta?.version       ?? s.version,
      uptime:        meta?.uptime        ?? s.uptime,
      matchId:       meta?.matchId       ?? s.matchId,
      lastCheckedAt: new Date().toISOString(),
    })),

  syncFromHealth: (health) => {
    const now = new Date().toISOString();
    if (!health || health.status === "offline") {
      set({ status: "disconnected", version: undefined, uptime: undefined, lastCheckedAt: now });
      return;
    }
    if (health.status === "error") {
      set({ status: "connected", lastCheckedAt: now });
      return;
    }
    // health.status === "ok" — engine API is up, but this does NOT mean the
    // desktop client is connected. Max status from health is "connected".
    // Only syncFromClientStatus (GET /client/status) can promote to "ready".
    // This prevents the header from showing "Client Ready" just because the
    // engine container is running, even when no desktop client is connected.
    set((s) => ({
      status:        s.status === "in_match" ? "in_match" : "connected",
      version:       health.version ?? s.version,
      uptime:        health.uptime  ?? s.uptime,
      lastCheckedAt: now,
    }));
  },

  syncFromClientStatus: (data) => {
    const now = new Date().toISOString();
    if (!data || !data.online) {
      set({
        status:        "disconnected",
        version:       undefined,
        versionOk:     false,
        sessionId:     data?.session_id ?? undefined,
        bindUserId:    data?.user_id    ?? undefined,
        game:          undefined,
        lastCheckedAt: now,
      });
      return;
    }
    // Map backend status → frontend ClientStatus
    let mapped: ClientStatus;
    switch (data.status) {
      case "in_match":   mapped = "in_match"; break;
      case "idle":
      case "in_game":
      default:           mapped = "ready";    break;
    }
    // Never downgrade "in_match" via polling (match capture must not be interrupted)
    set((s) => ({
      status:        s.status === "in_match" && mapped !== "in_match" ? "in_match" : mapped,
      version:       data.version       ?? s.version,
      versionOk:     data.version_ok,
      sessionId:     data.session_id    ?? undefined,
      bindUserId:    data.user_id       ?? undefined,
      matchId:       data.match_id      ?? s.matchId,
      game:          data.game          ?? undefined,
      lastCheckedAt: now,
    }));
  },

  markInMatch: (matchId) =>
    set({ status: "in_match", matchId, lastCheckedAt: new Date().toISOString() }),

  markIdle: () =>
    set({ status: "ready", matchId: undefined, lastCheckedAt: new Date().toISOString() }),

  // ── Computed ──────────────────────────────────────────────────────────

  canPlay: () => {
    const { status, versionOk } = get();
    // Phase 4: must be online (ready/in_match) AND version_ok
    return (status === "ready" || status === "in_match") && (versionOk ?? false);
  },

  canPlayForUser: (userId) => {
    const { status, versionOk, bindUserId } = get();
    if (!(status === "ready" || status === "in_match")) return false;
    if (!(versionOk ?? false)) return false;
    if (!userId) return false;
    return bindUserId === userId;
  },

  statusLabel: () => {
    const { status, game } = get() as ClientState;
    switch (status) {
      case "checking":     return "Checking…";
      case "disconnected": return "Client Offline";
      case "connected":    return "Client Starting…";
      case "ready":        return game ? `In ${game}` : "Client Ready";
      case "in_match":     return "In Match";
    }
  },
}));
