import { beforeEach, describe, it, expect } from "vitest";
import { useMatchStore } from "@/stores/matchStore";
import { MATCH_STORE_TEST_FIXTURE } from "@/test/matchStoreFixture";

const SEED_MATCHES = MATCH_STORE_TEST_FIXTURE;

describe("matchStore", () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: SEED_MATCHES.map((m) => ({ ...m, teamA: [...(m.teamA ?? [])], teamB: [...(m.teamB ?? [])] })) });
  });

  // ── addMatch ──────────────────────────────────────────────────────────────

  it("addMatch returns a match with generated id and createdAt", () => {
    const created = useMatchStore.getState().addMatch({
      type: "custom", host: "TestUser", hostId: "u-test",
      game: "CS2", mode: "2v2", betAmount: 30,
      players: [], maxPlayers: 4, status: "waiting",
      hasPassword: true, teamA: ["TestUser"], teamB: [],
      maxPerTeam: 2, teamSize: 2, depositsReceived: 1,
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();
    expect(created.mode).toBe("2v2");
    expect(created.teamSize).toBe(2);
  });

  it("addMatch prepends the match to the list", () => {
    const before = useMatchStore.getState().matches.length;
    useMatchStore.getState().addMatch({
      type: "public", host: "X", hostId: "x1",
      game: "Valorant", mode: "1v1", betAmount: 10,
      players: [], maxPlayers: 2, status: "waiting",
    });
    expect(useMatchStore.getState().matches.length).toBe(before + 1);
    expect(useMatchStore.getState().matches[0].host).toBe("X");
  });

  it("addMatch generates a code for custom matches", () => {
    const m = useMatchStore.getState().addMatch({
      type: "custom", host: "Y", hostId: "y1",
      game: "CS2", mode: "5v5", betAmount: 5,
      players: [], maxPlayers: 10, status: "waiting",
      hasPassword: true, teamA: ["Y"], teamB: [],
      maxPerTeam: 5, teamSize: 5, depositsReceived: 1,
    });
    expect(m.code).toMatch(/^ARENA-/);
  });

  // ── joinMatch — public ────────────────────────────────────────────────────

  it("joinMatch adds player to public match player list", () => {
    const match = useMatchStore.getState().matches.find((m) => m.id === "m1")!;
    const before = match.players.length;
    useMatchStore.getState().joinMatch("m1", "NewPlayer");
    const after = useMatchStore.getState().matches.find((m) => m.id === "m1")!;
    expect(after.players.length).toBe(before + 1);
  });

  it("joinMatch returns false for in_progress public match", () => {
    const result = useMatchStore.getState().joinMatch("m2", "LatePlayer");
    expect(result).toBe(false);
  });

  it("joinMatch returns false if player already in public match", () => {
    useMatchStore.getState().joinMatch("m1", "DuplicatePlayer");
    const result = useMatchStore.getState().joinMatch("m1", "DuplicatePlayer");
    expect(result).toBe(false);
  });

  // ── joinMatch — custom team ───────────────────────────────────────────────

  it("joinMatch adds player to teamB of custom match", () => {
    const result = useMatchStore.getState().joinMatch("c4", "Player3", "B");
    expect(result).toBe(true);
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    expect(match.teamB).toContain("Player3");
  });

  it("joinMatch increments depositsReceived on custom match", () => {
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    expect(match.depositsReceived).toBe(3); // was 2, now 3
  });

  it("joinMatch prevents same player from joining twice (teamB then teamA)", () => {
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    const result = useMatchStore.getState().joinMatch("c4", "Player3", "A");
    expect(result).toBe(false);
  });

  it("joinMatch returns false when team is already full", () => {
    // c4 is 2v2 — teamA already has 2 players (WingmanPro, SniperX)
    const result = useMatchStore.getState().joinMatch("c4", "ExtraPlayer", "A");
    expect(result).toBe(false);
  });

  // ── auto-activate (depositsReceived >= teamSize × 2) ─────────────────────

  it("2v2 match sets lockCountdownStart when 4th player deposits (10s leave window before in_progress)", () => {
    // c4: 2v2, teamA full (2), teamB empty, depositsReceived=2 — needs 2 more
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    expect(useMatchStore.getState().matches.find((m) => m.id === "c4")!.lockCountdownStart).toBeUndefined();

    useMatchStore.getState().joinMatch("c4", "Player4", "B");
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    // Room full → countdown started, status stays "waiting" until UI triggers in_progress
    expect(match.lockCountdownStart).toBeDefined();
    expect(match.status).toBe("waiting");
    expect(match.depositsReceived).toBe(4);
  });

  it("4v4 match sets lockCountdownStart only when all 8 players deposit", () => {
    // c5: 4v4, teamA has 2, teamB empty, depositsReceived=2 — needs 6 more
    const store = useMatchStore.getState();
    store.joinMatch("c5", "A3", "A");
    store.joinMatch("c5", "A4", "A");
    store.joinMatch("c5", "B1", "B");
    store.joinMatch("c5", "B2", "B");
    store.joinMatch("c5", "B3", "B");
    const mid = useMatchStore.getState().matches.find((m) => m.id === "c5")!;
    expect(mid.lockCountdownStart).toBeUndefined();
    expect(mid.status).toBe("waiting");

    store.joinMatch("c5", "B4", "B");
    const full = useMatchStore.getState().matches.find((m) => m.id === "c5")!;
    expect(full.lockCountdownStart).toBeDefined();
    expect(full.status).toBe("waiting");  // stays waiting until UI triggers after 10s
    expect(full.depositsReceived).toBe(8);
  });

  it("depositsReceived equals teamSize × 2 after all players join", () => {
    const store = useMatchStore.getState();
    store.joinMatch("c4", "Player3", "B");
    store.joinMatch("c4", "Player4", "B");
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    expect(match.depositsReceived).toBe(4);
    expect(match.depositsReceived).toBe((match.teamSize ?? 2) * 2);
  });

  // ── updateMatchStatus ─────────────────────────────────────────────────────

  it("updateMatchStatus sets status and winnerId", () => {
    useMatchStore.getState().updateMatchStatus("h11", "completed", "user-001");
    const match = useMatchStore.getState().matches.find((m) => m.id === "h11")!;
    expect(match.status).toBe("completed");
    expect(match.winnerId).toBe("user-001");
    expect(match.endedAt).toBeDefined();
  });

  it("updateMatchStatus sets startedAt when transitioning to in_progress", () => {
    useMatchStore.getState().updateMatchStatus("m3", "in_progress");
    const match = useMatchStore.getState().matches.find((m) => m.id === "m3")!;
    expect(match.startedAt).toBeDefined();
  });

  it("updateMatchStatus without winnerId does not clear existing winnerId", () => {
    useMatchStore.getState().updateMatchStatus("h11", "completed", "WinnerX");
    useMatchStore.getState().updateMatchStatus("h11", "in_progress");
    const match = useMatchStore.getState().matches.find((m) => m.id === "h11")!;
    expect(match.status).toBe("in_progress");
    expect(match.winnerId).toBe("WinnerX");
  });

  // ── getMatchByCode ────────────────────────────────────────────────────────

  it("getMatchByCode returns correct match", () => {
    const match = useMatchStore.getState().getMatchByCode("ARENA-7X2K");
    expect(match).toBeDefined();
    expect(match?.host).toBe("ProGamer99");
  });

  it("getMatchByCode returns undefined for unknown code", () => {
    expect(useMatchStore.getState().getMatchByCode("ARENA-XXXX")).toBeUndefined();
  });

  it("getMatchByCode returns the new 2v2 seed match", () => {
    const match = useMatchStore.getState().getMatchByCode("ARENA-W2V2");
    expect(match).toBeDefined();
    expect(match?.mode).toBe("2v2");
    expect(match?.teamSize).toBe(2);
  });

  // ── leaveMatch ────────────────────────────────────────────────────────────

  it("leaveMatch removes player from public match player list", () => {
    useMatchStore.getState().joinMatch("m1", "NewPlayer");
    const before = useMatchStore.getState().matches.find((m) => m.id === "m1")!.players.length;
    const result = useMatchStore.getState().leaveMatch("m1", "NewPlayer");
    expect(result).toBe(true);
    const after = useMatchStore.getState().matches.find((m) => m.id === "m1")!;
    expect(after.players.length).toBe(before - 1);
    expect(after.players).not.toContain("NewPlayer");
  });

  it("leaveMatch removes player from teamB of custom match", () => {
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    const result = useMatchStore.getState().leaveMatch("c4", "Player3");
    expect(result).toBe(true);
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    expect(match.teamB).not.toContain("Player3");
  });

  it("leaveMatch decrements depositsReceived on custom match", () => {
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    useMatchStore.getState().leaveMatch("c4", "Player3");
    const match = useMatchStore.getState().matches.find((m) => m.id === "c4")!;
    expect(match.depositsReceived).toBe(2); // back to original
  });

  it("leaveMatch clears lockCountdownStart when player leaves full room", () => {
    useMatchStore.getState().joinMatch("c4", "Player3", "B");
    useMatchStore.getState().joinMatch("c4", "Player4", "B"); // fills room → sets lockCountdownStart
    expect(useMatchStore.getState().matches.find((m) => m.id === "c4")!.lockCountdownStart).toBeDefined();
    useMatchStore.getState().leaveMatch("c4", "Player4");
    expect(useMatchStore.getState().matches.find((m) => m.id === "c4")!.lockCountdownStart).toBeUndefined();
  });

  it("leaveMatch returns false for player not in the match", () => {
    const result = useMatchStore.getState().leaveMatch("c4", "GhostPlayer");
    expect(result).toBe(false);
  });

  it("leaveMatch returns false for in_progress match (funds already locked)", () => {
    const result = useMatchStore.getState().leaveMatch("c3", "CS2Kings"); // c3 is in_progress
    expect(result).toBe(false);
  });

  // ── deleteMatch ────────────────────────────────────────────────────────────────

  it("deleteMatch removes the match from the list", () => {
    useMatchStore.getState().deleteMatch("m1");
    expect(useMatchStore.getState().matches.find((m) => m.id === "m1")).toBeUndefined();
  });

  it("deleteMatch is a no-op for a non-existent matchId", () => {
    const before = useMatchStore.getState().matches.length;
    useMatchStore.getState().deleteMatch("non-existent-xyz");
    expect(useMatchStore.getState().matches.length).toBe(before);
  });

  // ── expireOldMatches ───────────────────────────────────────────────────────────

  it("expireOldMatches marks waiting matches with expired expiresAt as cancelled", () => {
    const added = useMatchStore.getState().addMatch({
      type: "public", host: "OldHost", hostId: "u-old",
      game: "CS2", mode: "1v1", betAmount: 10,
      players: [], maxPlayers: 2, status: "waiting",
    });
    // Backdate both createdAt and expiresAt to simulate a 31-minute-old room
    useMatchStore.setState((s) => ({
      matches: s.matches.map((m) =>
        m.id === added.id
          ? {
              ...m,
              createdAt:  new Date(Date.now() - 31 * 60 * 1000).toISOString(),
              expiresAt:  new Date(Date.now() - 1 * 60 * 1000).toISOString(),  // 1 min ago → expired
            }
          : m
      ),
    }));
    const expired = useMatchStore.getState().expireOldMatches();
    expect(expired).toContain(added.id);
    expect(useMatchStore.getState().matches.find((m) => m.id === added.id)!.status).toBe("cancelled");
  });

  it("expireOldMatches does not affect in_progress matches", () => {
    const statusBefore = useMatchStore.getState().matches.find((m) => m.id === "c3")!.status;
    useMatchStore.getState().expireOldMatches();
    expect(useMatchStore.getState().matches.find((m) => m.id === "c3")!.status).toBe(statusBefore);
  });

  it("expireOldMatches returns empty array when no user-created matches are stale", () => {
    // Seed matches have no expiresAt, so they are never auto-expired by this function
    const result = useMatchStore.getState().expireOldMatches();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);  // seeds should NOT be expired
  });

  // ── expiresAt ─────────────────────────────────────────────────────────────────

  it("addMatch sets expiresAt approximately 30 minutes after createdAt", () => {
    const m = useMatchStore.getState().addMatch({
      type: "public", host: "X", hostId: "x1",
      game: "CS2", mode: "1v1", betAmount: 10,
      players: [], maxPlayers: 2, status: "waiting",
    });
    expect(m.expiresAt).toBeDefined();
    const diff = new Date(m.expiresAt!).getTime() - new Date(m.createdAt).getTime();
    expect(diff).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  // ── updateMatchStatus → history persistence ────────────────────────────────────

  it("updateMatchStatus to completed keeps match in the array (history persistence)", () => {
    useMatchStore.getState().updateMatchStatus("m1", "completed", "p1");
    const m = useMatchStore.getState().matches.find((m) => m.id === "m1");
    expect(m).toBeDefined();
    expect(m!.status).toBe("completed");
    expect(m!.endedAt).toBeDefined();
  });
});
