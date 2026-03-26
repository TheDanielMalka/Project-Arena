import { describe, it, expect, beforeEach } from "vitest";
import { usePlayerStore } from "@/stores/playerStore";

beforeEach(() => {
  // Reset to original seed state (re-import store state)
  // playerStore has no mutations — seed data is always present
});

describe("playerStore — searchPlayers", () => {
  it("returns all players when query is empty", () => {
    const results = usePlayerStore.getState().searchPlayers("");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns all players when query is empty and no game filter", () => {
    const all = usePlayerStore.getState().players;
    const results = usePlayerStore.getState().searchPlayers("", undefined);
    expect(results.length).toBe(all.length);
  });

  it("finds ShadowKill3r by full username", () => {
    const results = usePlayerStore.getState().searchPlayers("ShadowKill3r");
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe("ShadowKill3r");
  });

  it("finds players by partial username (case-insensitive)", () => {
    const results = usePlayerStore.getState().searchPlayers("shadow");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.username === "ShadowKill3r")).toBe(true);
  });

  it("returns empty array for unknown username", () => {
    const results = usePlayerStore.getState().searchPlayers("XYZ_NOT_A_PLAYER_123");
    expect(results).toHaveLength(0);
  });

  it("filters by game — CS2 only", () => {
    const results = usePlayerStore.getState().searchPlayers("", "CS2");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.preferredGame === "CS2")).toBe(true);
  });

  it("filters by game — Valorant only", () => {
    const results = usePlayerStore.getState().searchPlayers("", "Valorant");
    expect(results.every((p) => p.preferredGame === "Valorant")).toBe(true);
  });

  it("combines username query and game filter", () => {
    const results = usePlayerStore.getState().searchPlayers("Shadow", "CS2");
    expect(results.every((p) => p.preferredGame === "CS2")).toBe(true);
    expect(results.every((p) => p.username.toLowerCase().includes("shadow"))).toBe(true);
  });

  it("returns empty when username exists but game filter doesn't match", () => {
    // ShadowKill3r plays CS2, not Valorant
    const results = usePlayerStore.getState().searchPlayers("ShadowKill3r", "Valorant");
    expect(results).toHaveLength(0);
  });
});

describe("playerStore — getPlayerByUsername", () => {
  it("finds NovaBlade", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("NovaBlade");
    expect(p).toBeDefined();
    expect(p?.username).toBe("NovaBlade");
    expect(p?.preferredGame).toBe("CS2");
  });

  it("is case-insensitive", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("novablade");
    expect(p?.username).toBe("NovaBlade");
  });

  it("returns undefined for unknown player", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("DoesNotExist");
    expect(p).toBeUndefined();
  });

  it("finds flagged player xDragon99", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("xDragon99");
    expect(p?.status).toBe("flagged");
    expect(p?.stats.winRate).toBeGreaterThan(90);
  });

  it("all seed players have required fields", () => {
    const players = usePlayerStore.getState().players;
    for (const p of players) {
      expect(p.id).toBeTruthy();
      expect(p.username).toBeTruthy();
      expect(p.avatarInitials).toBeTruthy();
      expect(p.rank).toBeTruthy();
      expect(p.tier).toBeTruthy();
      expect(p.stats.winRate).toBeGreaterThanOrEqual(0);
      expect(p.stats.winRate).toBeLessThanOrEqual(100);
      expect(p.stats.matches).toBeGreaterThanOrEqual(0);
    }
  });
});
