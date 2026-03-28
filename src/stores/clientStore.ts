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
import type { EngineHealth } from "@/lib/engine-api";

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
    // health.status === "ok" — only upgrade to "ready" if not already "in_match"
    // (don't downgrade an active capture session via HTTP poll)
    set((s) => ({
      status:        s.status === "in_match" ? "in_match" : "ready",
      version:       health.version ?? s.version,
      uptime:        health.uptime  ?? s.uptime,
      lastCheckedAt: now,
    }));
  },

  markInMatch: (matchId) =>
    set({ status: "in_match", matchId, lastCheckedAt: new Date().toISOString() }),

  markIdle: () =>
    set({ status: "ready", matchId: undefined, lastCheckedAt: new Date().toISOString() }),

  // ── Computed ──────────────────────────────────────────────────────────

  canPlay: () => {
    const s = get().status;
    return s === "ready" || s === "in_match";
  },

  statusLabel: () => {
    switch (get().status) {
      case "checking":     return "Checking…";
      case "disconnected": return "Client Offline";
      case "connected":    return "Client Starting…";
      case "ready":        return "Client Ready";
      case "in_match":     return "In Match";
    }
  },
}));
