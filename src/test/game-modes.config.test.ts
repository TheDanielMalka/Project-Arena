import { describe, it, expect } from "vitest";
import { GAME_MODES, getTeamSize, getTotalPlayers, getDefaultMode } from "@/config/gameModes";
import type { Game, MatchMode } from "@/types";

// ── All games defined in the Game type ──────────────────────────────────────
const ALL_GAMES: Game[] = [
  "CS2", "Valorant", "Fortnite", "Apex Legends", "PUBG", "COD", "League of Legends",
];

// ── All modes defined in MatchMode ───────────────────────────────────────────
const ALL_MODES: MatchMode[] = ["1v1", "2v2", "4v4", "5v5"];

describe("GAME_MODES config", () => {

  // ── Coverage ──────────────────────────────────────────────────────────────

  it("covers every game in the Game type", () => {
    ALL_GAMES.forEach((game) => {
      expect(GAME_MODES[game], `${game} missing from GAME_MODES`).toBeDefined();
      expect(GAME_MODES[game].length).toBeGreaterThan(0);
    });
  });

  it("every mode entry has a valid MatchMode value", () => {
    ALL_GAMES.forEach((game) => {
      GAME_MODES[game].forEach((opt) => {
        expect(ALL_MODES).toContain(opt.mode);
      });
    });
  });

  it("every mode entry has a non-empty label", () => {
    ALL_GAMES.forEach((game) => {
      GAME_MODES[game].forEach((opt) => {
        expect(opt.label.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it("each game has at most one default mode", () => {
    ALL_GAMES.forEach((game) => {
      const defaults = GAME_MODES[game].filter((m) => m.isDefault);
      expect(defaults.length, `${game} has more than one default`).toBeLessThanOrEqual(1);
    });
  });

  it("teamSize matches the mode prefix for every entry", () => {
    const expectedSize: Record<MatchMode, number> = { "1v1": 1, "2v2": 2, "4v4": 4, "5v5": 5 };
    ALL_GAMES.forEach((game) => {
      GAME_MODES[game].forEach((opt) => {
        expect(opt.teamSize).toBe(expectedSize[opt.mode]);
      });
    });
  });

  // ── Game-specific rules ───────────────────────────────────────────────────

  it("Fortnite does not offer 1v1", () => {
    const modes = GAME_MODES["Fortnite"].map((m) => m.mode);
    expect(modes).not.toContain("1v1");
  });

  it("CS2 offers 1v1, 2v2, and 5v5", () => {
    const modes = GAME_MODES["CS2"].map((m) => m.mode);
    expect(modes).toContain("1v1");
    expect(modes).toContain("2v2");
    expect(modes).toContain("5v5");
  });

  it("CS2 default mode is 5v5", () => {
    expect(getDefaultMode("CS2").mode).toBe("5v5");
  });

  it("PUBG default mode is 4v4", () => {
    expect(getDefaultMode("PUBG").mode).toBe("4v4");
  });

  it("Fortnite default mode is 2v2", () => {
    expect(getDefaultMode("Fortnite").mode).toBe("2v2");
  });

  it("Valorant default mode is 5v5", () => {
    expect(getDefaultMode("Valorant").mode).toBe("5v5");
  });

  it("League of Legends default mode is 5v5", () => {
    expect(getDefaultMode("League of Legends").mode).toBe("5v5");
  });

  // ── getTeamSize ───────────────────────────────────────────────────────────

  it("getTeamSize returns 1 for 1v1", () => expect(getTeamSize("1v1")).toBe(1));
  it("getTeamSize returns 2 for 2v2", () => expect(getTeamSize("2v2")).toBe(2));
  it("getTeamSize returns 4 for 4v4", () => expect(getTeamSize("4v4")).toBe(4));
  it("getTeamSize returns 5 for 5v5", () => expect(getTeamSize("5v5")).toBe(5));

  // ── getTotalPlayers ───────────────────────────────────────────────────────

  it("getTotalPlayers is always teamSize × 2", () => {
    ALL_MODES.forEach((mode) => {
      expect(getTotalPlayers(mode)).toBe(getTeamSize(mode) * 2);
    });
  });

  it("getTotalPlayers returns 2  for 1v1", () => expect(getTotalPlayers("1v1")).toBe(2));
  it("getTotalPlayers returns 4  for 2v2", () => expect(getTotalPlayers("2v2")).toBe(4));
  it("getTotalPlayers returns 8  for 4v4", () => expect(getTotalPlayers("4v4")).toBe(8));
  it("getTotalPlayers returns 10 for 5v5", () => expect(getTotalPlayers("5v5")).toBe(10));

  // ── getDefaultMode fallback ───────────────────────────────────────────────

  it("getDefaultMode always returns a valid mode even with no isDefault flag", () => {
    ALL_GAMES.forEach((game) => {
      const def = getDefaultMode(game);
      expect(def).toBeDefined();
      expect(ALL_MODES).toContain(def.mode);
    });
  });
});
