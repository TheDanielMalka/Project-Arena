import { describe, it, expect, beforeEach } from "vitest";
import { usePlayerStore } from "@/stores/playerStore";

const TOK = "token-user";

beforeEach(async () => {
  usePlayerStore.setState({ players: [] });
  await usePlayerStore.getState().searchPlayers("", undefined, TOK);
});

describe("playerStore — searchPlayers", () => {
  it("returns empty without token", async () => {
    const results = await usePlayerStore.getState().searchPlayers("Shadow", undefined, null);
    expect(results).toEqual([]);
  });

  it("returns all players when query is empty", async () => {
    const results = await usePlayerStore.getState().searchPlayers("", undefined, TOK);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns all players when query is empty and no game filter", async () => {
    const all = usePlayerStore.getState().players;
    const results = await usePlayerStore.getState().searchPlayers("", undefined, TOK);
    expect(results.length).toBe(all.length);
  });

  it("finds ShadowKill3r by full username", async () => {
    const results = await usePlayerStore.getState().searchPlayers("ShadowKill3r", undefined, TOK);
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe("ShadowKill3r");
  });

  it("finds players by partial username (case-insensitive)", async () => {
    const results = await usePlayerStore.getState().searchPlayers("shadow", undefined, TOK);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.username === "ShadowKill3r")).toBe(true);
  });

  it("returns empty array for unknown username", async () => {
    const results = await usePlayerStore.getState().searchPlayers("XYZ_NOT_A_PLAYER_123", undefined, TOK);
    expect(results).toHaveLength(0);
  });

  it("filters by game — CS2 only", async () => {
    const results = await usePlayerStore.getState().searchPlayers("", "CS2", TOK);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.preferredGame === "CS2")).toBe(true);
  });

  it("filters by game — Valorant only", async () => {
    const results = await usePlayerStore.getState().searchPlayers("", "Valorant", TOK);
    expect(results.every((p) => p.preferredGame === "Valorant")).toBe(true);
  });

  it("combines username query and game filter", async () => {
    const results = await usePlayerStore.getState().searchPlayers("Shadow", "CS2", TOK);
    expect(results.every((p) => p.preferredGame === "CS2")).toBe(true);
    expect(results.every((p) => p.username.toLowerCase().includes("shadow"))).toBe(true);
  });

  it("returns empty when username exists but game filter doesn't match", async () => {
    const results = await usePlayerStore.getState().searchPlayers("ShadowKill3r", "Valorant", TOK);
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

  it("all cached players have required fields", () => {
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
