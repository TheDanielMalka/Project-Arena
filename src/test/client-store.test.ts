/**
 * Phase 4 — clientStore tests
 *
 * Verifies that syncFromClientStatus() correctly maps the canonical
 * GET /client/status response to the frontend ClientStatus enum,
 * and that canPlay() gates correctly on online + version_ok.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useClientStore } from "@/stores/clientStore";
import type { ClientStatusResponse } from "@/lib/engine-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStatus(overrides: Partial<ClientStatusResponse> = {}): ClientStatusResponse {
  return {
    online:         true,
    status:         "idle",
    session_id:     "sess-test-01",
    user_id:        "user-test-01",
    wallet_address: "0xABCD",
    match_id:       null,
    version:        "1.0.0",
    version_ok:     true,
    last_seen:      new Date().toISOString(),
    game:           null,
    ...overrides,
  };
}

beforeEach(() => {
  useClientStore.setState({
    status:        "checking",
    version:       undefined,
    versionOk:     false,
    sessionId:     undefined,
    bindUserId:    undefined,
    game:          undefined,
    matchId:       undefined,
    inMatchSince:  undefined,
    lastCheckedAt: undefined,
  });
});

// ── syncFromClientStatus ──────────────────────────────────────────────────────

describe("syncFromClientStatus", () => {

  it("null → disconnected, canPlay=false", () => {
    useClientStore.getState().syncFromClientStatus(null);
    const s = useClientStore.getState();
    expect(s.status).toBe("disconnected");
    expect(s.canPlay()).toBe(false);
  });

  it("online=false → disconnected, canPlay=false", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ online: false }));
    const s = useClientStore.getState();
    expect(s.status).toBe("disconnected");
    expect(s.canPlay()).toBe(false);
  });

  it("online=true, status=idle, version_ok=true → ready, canPlay=true", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ status: "idle", version_ok: true }));
    const s = useClientStore.getState();
    expect(s.status).toBe("ready");
    expect(s.versionOk).toBe(true);
    expect(s.canPlay()).toBe(true);
  });

  it("online=true, status=in_game, version_ok=true → ready, canPlay=true", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ status: "in_game", version_ok: true }));
    const s = useClientStore.getState();
    expect(s.status).toBe("ready");
    expect(s.canPlay()).toBe(true);
  });

  it("online=true, status=in_match → in_match, canPlay=true", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ status: "in_match", version_ok: true }));
    const s = useClientStore.getState();
    expect(s.status).toBe("in_match");
    expect(s.canPlay()).toBe(true);
  });

  it("online=true, version_ok=false → ready, canPlay=false", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ version_ok: false }));
    const s = useClientStore.getState();
    expect(s.status).toBe("ready");
    expect(s.versionOk).toBe(false);
    expect(s.canPlay()).toBe(false);
  });

  it("stores sessionId, bindUserId, game from response", () => {
    useClientStore.getState().syncFromClientStatus(
      makeStatus({ session_id: "sess-123", user_id: "usr-456", game: "CS2" })
    );
    const s = useClientStore.getState();
    expect(s.sessionId).toBe("sess-123");
    expect(s.bindUserId).toBe("usr-456");
    expect(s.game).toBe("CS2");
  });

  it("stores matchId when status=in_match", () => {
    useClientStore.getState().syncFromClientStatus(
      makeStatus({ status: "in_match", match_id: "match-999", version_ok: true })
    );
    expect(useClientStore.getState().matchId).toBe("match-999");
  });

  it("does not downgrade in_match to ready within 15-second grace period", () => {
    // markInMatch sets inMatchSince so the grace period applies
    useClientStore.getState().markInMatch("match-gp");
    useClientStore.getState().syncFromClientStatus(makeStatus({ status: "idle", version_ok: true }));
    // in_match must be preserved while the backend hasn't yet confirmed the new status
    expect(useClientStore.getState().status).toBe("in_match");
  });

  it("downgrades in_match to ready via polling when grace period has expired", () => {
    // Simulate an expired grace: inMatchSince set to 20 seconds ago
    useClientStore.setState({ status: "in_match", versionOk: true, inMatchSince: Date.now() - 20_000 });
    useClientStore.getState().syncFromClientStatus(makeStatus({ status: "idle", version_ok: true }));
    expect(useClientStore.getState().status).toBe("ready");
  });

  it("downgrades in_match to ready when explicitly marked idle", () => {
    useClientStore.getState().markInMatch("match-idle");
    useClientStore.getState().markIdle();
    expect(useClientStore.getState().status).toBe("ready");
    expect(useClientStore.getState().inMatchSince).toBeUndefined();
  });

  it("version is stored", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus({ version: "2.1.0" }));
    expect(useClientStore.getState().version).toBe("2.1.0");
  });

  it("lastCheckedAt is set after sync", () => {
    useClientStore.getState().syncFromClientStatus(makeStatus());
    expect(useClientStore.getState().lastCheckedAt).toBeTruthy();
  });
});

// ── canPlay ───────────────────────────────────────────────────────────────────

describe("canPlay", () => {

  it("false when status=checking", () => {
    useClientStore.setState({ status: "checking", versionOk: true });
    expect(useClientStore.getState().canPlay()).toBe(false);
  });

  it("false when status=disconnected", () => {
    useClientStore.setState({ status: "disconnected", versionOk: true });
    expect(useClientStore.getState().canPlay()).toBe(false);
  });

  it("false when status=connected", () => {
    useClientStore.setState({ status: "connected", versionOk: true });
    expect(useClientStore.getState().canPlay()).toBe(false);
  });

  it("false when ready but version_ok=false", () => {
    useClientStore.setState({ status: "ready", versionOk: false });
    expect(useClientStore.getState().canPlay()).toBe(false);
  });

  it("true when ready + version_ok=true", () => {
    useClientStore.setState({ status: "ready", versionOk: true });
    expect(useClientStore.getState().canPlay()).toBe(true);
  });

  it("true when in_match + version_ok=true", () => {
    useClientStore.setState({ status: "in_match", versionOk: true });
    expect(useClientStore.getState().canPlay()).toBe(true);
  });
});

// ── canPlayForUser (strict bind gate) ─────────────────────────────────────────

describe("canPlayForUser", () => {
  it("false when userId missing", () => {
    useClientStore.setState({ status: "ready", versionOk: true, bindUserId: "u1" });
    expect(useClientStore.getState().canPlayForUser(undefined)).toBe(false);
  });

  it("false when not bound to the same user", () => {
    useClientStore.setState({ status: "ready", versionOk: true, bindUserId: "u-other" });
    expect(useClientStore.getState().canPlayForUser("u1")).toBe(false);
  });

  it("true when ready + version_ok=true + bound user matches", () => {
    useClientStore.setState({ status: "ready", versionOk: true, bindUserId: "u1" });
    expect(useClientStore.getState().canPlayForUser("u1")).toBe(true);
  });
});

// ── statusLabel ───────────────────────────────────────────────────────────────

describe("statusLabel", () => {

  it("shows game name when ready + game set", () => {
    useClientStore.setState({ status: "ready", game: "Valorant" });
    expect(useClientStore.getState().statusLabel()).toBe("In Valorant");
  });

  it("shows Client Ready when ready + no game", () => {
    useClientStore.setState({ status: "ready", game: undefined });
    expect(useClientStore.getState().statusLabel()).toBe("Client Ready");
  });

  it("shows In Match when in_match", () => {
    useClientStore.setState({ status: "in_match" });
    expect(useClientStore.getState().statusLabel()).toBe("In Match");
  });

  it("shows Client Offline when disconnected", () => {
    useClientStore.setState({ status: "disconnected" });
    expect(useClientStore.getState().statusLabel()).toBe("Client Offline");
  });
});

// ── Backward compat: syncFromHealth still works ───────────────────────────────

describe("syncFromHealth (backward compat)", () => {

  it("null health → disconnected", () => {
    useClientStore.getState().syncFromHealth(null);
    expect(useClientStore.getState().status).toBe("disconnected");
  });

  it("health.status=ok → connected (engine up but no desktop client)", () => {
    // Phase 4 fix: syncFromHealth must never promote to "ready".
    // Only syncFromClientStatus (GET /client/status) can set "ready".
    // This prevents the header showing "Client Ready" just because the
    // engine container is running with no desktop client connected.
    useClientStore.getState().syncFromHealth({ status: "ok" });
    expect(useClientStore.getState().status).toBe("connected");
  });

  it("health.status=error → connected", () => {
    useClientStore.getState().syncFromHealth({ status: "error" });
    expect(useClientStore.getState().status).toBe("connected");
  });
});
