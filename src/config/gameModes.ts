// ─── Game Modes Configuration ──────────────────────────────────────────────
// Defines which match formats are available per game.
// DB-ready: used by match creation UI and validated server-side in matches.mode.
// Aligned with: match_mode enum in init.sql, MatchMode type in types/index.ts

import type { Game, MatchMode } from "@/types";

export interface GameModeOption {
  mode: MatchMode;
  teamSize: number;   // players per team (1, 2, 4, or 5)
  label: string;      // human-readable label shown in UI
  isDefault?: boolean; // pre-selected when game is chosen
}

// Each game defines its own allowed formats.
// teamSize drives: maxPerTeam, maxPlayers (teamSize * 2), contract deposit count.
export const GAME_MODES: Record<Game, GameModeOption[]> = {
  "CS2": [
    { mode: "1v1", teamSize: 1, label: "1v1 — Aim Duel" },
    { mode: "2v2", teamSize: 2, label: "2v2 — Wingman" },
    { mode: "5v5", teamSize: 5, label: "5v5 — Competitive", isDefault: true },
  ],
  "Valorant": [
    { mode: "1v1", teamSize: 1, label: "1v1 — Duel" },
    { mode: "5v5", teamSize: 5, label: "5v5 — Competitive", isDefault: true },
  ],
  "Fortnite": [
    { mode: "2v2", teamSize: 2, label: "2v2 — Duos", isDefault: true },
    { mode: "4v4", teamSize: 4, label: "4v4 — Squads" },
  ],
  "Apex Legends": [
    { mode: "1v1", teamSize: 1, label: "1v1 — Duel" },
    { mode: "2v2", teamSize: 2, label: "2v2 — Duos", isDefault: true },
    { mode: "4v4", teamSize: 4, label: "4v4 — Squads" },
  ],
  "PUBG": [
    { mode: "1v1", teamSize: 1, label: "1v1 — Solo" },
    { mode: "2v2", teamSize: 2, label: "2v2 — Duos" },
    { mode: "4v4", teamSize: 4, label: "4v4 — Squads", isDefault: true },
  ],
  "COD": [
    { mode: "1v1", teamSize: 1, label: "1v1 — 1v1" },
    { mode: "2v2", teamSize: 2, label: "2v2 — 2v2" },
    { mode: "5v5", teamSize: 5, label: "5v5 — Team", isDefault: true },
  ],
  "League of Legends": [
    { mode: "1v1", teamSize: 1, label: "1v1 — Mid Lane" },
    { mode: "5v5", teamSize: 5, label: "5v5 — Summoner's Rift", isDefault: true },
  ],
};

// Returns the default mode for a game (isDefault flag, or first in list).
export function getDefaultMode(game: Game): GameModeOption {
  const modes = GAME_MODES[game];
  return modes.find((m) => m.isDefault) ?? modes[0];
}

// Returns players per team for a given mode string.
export function getTeamSize(mode: MatchMode): number {
  const sizes: Record<MatchMode, number> = {
    "1v1": 1,
    "2v2": 2,
    "4v4": 4,
    "5v5": 5,
  };
  return sizes[mode];
}

// Returns total players needed (both teams) for a given mode.
export function getTotalPlayers(mode: MatchMode): number {
  return getTeamSize(mode) * 2;
}
