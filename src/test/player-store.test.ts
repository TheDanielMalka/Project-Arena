import { describe, it, expect } from "vitest";
import { usePlayerStore } from "@/stores/playerStore";

// ─── playerStore — data integrity & API-readiness ──────────────
//
// playerStore is the source-of-truth for all public player lookups.
// It is used by:
//   • Hub community tab   → searchPlayers(query, game)
//   • Players page        → searchPlayers
//   • PlayerProfile page  → getPlayerByUsername
//   • inboxStore          → players.find(arenaId) for send-message validation
//   • friendStore         → player metadata when sending requests
//
// DB-ready: all queries map to GET /api/players and GET /api/players/:username

describe("playerStore — seed data integrity", () => {
  it("contains exactly 20 seed players", () => {
    // 9 leaderboard top-10 entries (lb-001..lb-010, minus BlazeFury which is shared) + 11 original = 20
    const { players } = usePlayerStore.getState();
    expect(players).toHaveLength(20);
  });

  it("every player has a unique id", () => {
    const { players } = usePlayerStore.getState();
    const ids = players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every player has a unique arenaId", () => {
    const { players } = usePlayerStore.getState();
    const arenaIds = players.map((p) => p.arenaId);
    expect(new Set(arenaIds).size).toBe(arenaIds.length);
  });

  it("all arenaIds follow the ARENA-XXXXXX format", () => {
    const { players } = usePlayerStore.getState();
    const pattern = /^ARENA-[A-Z0-9]{6}$/;
    for (const p of players) {
      expect(p.arenaId).toMatch(pattern);
    }
  });

  it("all players have non-empty required fields", () => {
    const { players } = usePlayerStore.getState();
    for (const p of players) {
      expect(p.id).toBeTruthy();
      expect(p.username).toBeTruthy();
      expect(p.arenaId).toBeTruthy();
      expect(p.avatarInitials).toBeTruthy();
      expect(p.rank).toBeTruthy();
      expect(p.tier).toBeTruthy();
      expect(p.preferredGame).toBeTruthy();
      expect(p.memberSince).toBeTruthy();
      expect(p.status).toBeTruthy();
    }
  });

  it("all avatarInitials are exactly 2 uppercase characters", () => {
    const { players } = usePlayerStore.getState();
    for (const p of players) {
      expect(p.avatarInitials).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("all win rates are between 0 and 100", () => {
    const { players } = usePlayerStore.getState();
    for (const p of players) {
      expect(p.stats.winRate).toBeGreaterThanOrEqual(0);
      expect(p.stats.winRate).toBeLessThanOrEqual(100);
    }
  });

  it("wins + losses do not exceed total matches", () => {
    const { players } = usePlayerStore.getState();
    for (const p of players) {
      expect(p.stats.wins + p.stats.losses).toBeLessThanOrEqual(p.stats.matches);
    }
  });

  it("all earnings are non-negative", () => {
    const { players } = usePlayerStore.getState();
    for (const p of players) {
      expect(p.stats.totalEarnings).toBeGreaterThanOrEqual(0);
    }
  });

  it("seed includes players with all three status values", () => {
    const { players } = usePlayerStore.getState();
    const statuses = new Set(players.map((p) => p.status));
    // DB: users.status — CHECK constraint ('active','flagged','banned','suspended')
    expect(statuses.has("active")).toBe(true);
    expect(statuses.has("banned")).toBe(true);
    expect(statuses.has("flagged")).toBe(true);
  });

  it("covers multiple tier levels (Gold, Diamond, Platinum, Silver)", () => {
    const { players } = usePlayerStore.getState();
    const tiers = new Set(players.map((p) => p.tier));
    expect(tiers.has("Gold")).toBe(true);
    expect(tiers.has("Diamond")).toBe(true);
    expect(tiers.has("Platinum")).toBe(true);
    expect(tiers.has("Silver")).toBe(true);
  });

  it("covers only active preferred games (CS2, Valorant — Coming Soon games not in seed)", () => {
    const { players } = usePlayerStore.getState();
    const games = new Set(players.map((p) => p.preferredGame));
    expect(games.has("CS2")).toBe(true);
    expect(games.has("Valorant")).toBe(true);
    // Coming Soon games must NOT appear as preferredGame in seed players
    expect(games.has("Fortnite")).toBe(false);
    expect(games.has("PUBG")).toBe(false);
    expect(games.has("Apex Legends")).toBe(false);
  });
});

// ─── playerStore — searchPlayers (used by Hub community + inboxStore) ─

describe("playerStore — searchPlayers (arenaId path — used by inboxStore)", () => {
  it("finds WingmanPro by exact arenaId (used by sendInboxMessage)", () => {
    // This is the exact lookup inboxStore performs: targetArenaId.trim().toLowerCase()
    const results = usePlayerStore.getState().searchPlayers("ARENA-WP0002");
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe("WingmanPro");
  });

  it("arenaId search is case-insensitive (matches inboxStore behavior)", () => {
    const results = usePlayerStore.getState().searchPlayers("arena-wp0002");
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe("WingmanPro");
  });

  it("partial arenaId prefix search works", () => {
    const results = usePlayerStore.getState().searchPlayers("ARENA-SK");
    expect(results.some((p) => p.username === "ShadowKill3r")).toBe(true);
  });

  it("returns empty when arenaId does not exist — inboxStore returns error", () => {
    const results = usePlayerStore.getState().searchPlayers("ARENA-XXXXXX");
    expect(results).toHaveLength(0);
  });

  it("game filter combined with arenaId search narrows results", () => {
    // ShadowKill3r plays CS2 — should match
    const found = usePlayerStore.getState().searchPlayers("ARENA-SK0003", "CS2");
    expect(found).toHaveLength(1);
    // WingmanPro plays Valorant — should NOT appear with CS2 filter
    const notFound = usePlayerStore.getState().searchPlayers("ARENA-WP0002", "CS2");
    expect(notFound).toHaveLength(0);
  });
});

// ─── playerStore — getPlayerByUsername (used by PlayerProfile page) ─

describe("playerStore — getPlayerByUsername", () => {
  it("returns WingmanPro with correct arenaId and tier", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("WingmanPro");
    expect(p).toBeDefined();
    expect(p?.arenaId).toBe("ARENA-WP0002");
    expect(p?.tier).toBe("Gold");
    expect(p?.preferredGame).toBe("Valorant");
  });

  it("returns Diamond player ShadowKill3r", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("ShadowKill3r");
    expect(p?.tier).toBe("Diamond");
    expect(p?.stats.winRate).toBeGreaterThan(70);
  });

  it("is case-insensitive", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("wingmanpro");
    expect(p?.username).toBe("WingmanPro");
  });

  it("returns undefined for unknown player (→ PlayerProfile shows not-found)", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("GhostPlayer_404");
    expect(p).toBeUndefined();
  });

  it("returns banned player BlazeFury with status=banned", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("BlazeFury");
    expect(p?.status).toBe("banned");
  });

  it("returns flagged player xDragon99 with suspiciously high winRate", () => {
    // flagged: 92.6% win rate — anomaly detection target in DB
    const p = usePlayerStore.getState().getPlayerByUsername("xDragon99");
    expect(p?.status).toBe("flagged");
    expect(p?.stats.winRate).toBeGreaterThan(90);
    expect(p?.stats.totalEarnings).toBeGreaterThan(4000);
  });

  it("returns flagged player PhantomAce with below-average winRate", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("PhantomAce");
    expect(p?.status).toBe("flagged");
    expect(p?.stats.winRate).toBeLessThan(50);
  });

  it("xDragon99 arenaId is valid for sendInboxMessage flow", () => {
    // inboxStore uses players.find(p => p.arenaId.toLowerCase() === target.toLowerCase())
    const results = usePlayerStore.getState().searchPlayers("ARENA-XD0012");
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe("xDragon99");
  });
});

// ─── playerStore — winRate data consistency ────────────────────

describe("playerStore — winRate ↔ wins/matches consistency", () => {
  it("WingmanPro winRate is approximately wins/matches * 100", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("WingmanPro")!;
    const computed = (p.stats.wins / p.stats.matches) * 100;
    expect(Math.abs(computed - p.stats.winRate)).toBeLessThan(1);
  });

  it("NovaBlade winRate is approximately wins/matches * 100", () => {
    const p = usePlayerStore.getState().getPlayerByUsername("NovaBlade")!;
    const computed = (p.stats.wins / p.stats.matches) * 100;
    expect(Math.abs(computed - p.stats.winRate)).toBeLessThan(1);
  });

  it("top earner has high wins and matches", () => {
    const { players } = usePlayerStore.getState();
    const top = [...players].sort((a, b) => b.stats.totalEarnings - a.stats.totalEarnings)[0];
    expect(top.stats.wins).toBeGreaterThan(30);
    expect(top.stats.matches).toBeGreaterThan(30);
  });
});
