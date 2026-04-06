import type { Match } from "@/types";

/**
 * Per-side roster for lobby UI (public + custom).
 * Prefers server `teamA` / `teamB` or flat `players` (join order).
 * If only `filledPlayerCount` is present (GET /matches `player_count`), uses fill-team-A-first
 * and shows the host as the first known name on Team A. Full per-player order requires
 * `match_players` from the engine (joined_at).
 */
export type LobbyTeamView = {
  maxPerTeam: number;
  namesA: string[];
  namesB: string[];
  /** Headcount for headers (includes unnamed players). */
  filledA: number;
  filledB: number;
};

export function lobbyTeamViewFromMatch(match: Match): LobbyTeamView {
  const maxPerTeam =
    match.maxPerTeam ?? match.teamSize ?? Math.max(1, Math.ceil(match.maxPlayers / 2));

  const teamA = match.teamA ?? [];
  const teamB = match.teamB ?? [];
  const hasSplitRoster = teamA.length > 0 || teamB.length > 0;

  if (hasSplitRoster) {
    return {
      maxPerTeam,
      namesA: teamA,
      namesB: teamB,
      filledA: Math.min(teamA.length, maxPerTeam),
      filledB: Math.min(teamB.length, maxPerTeam),
    };
  }

  const flat = match.players ?? [];
  if (flat.length > 0) {
    const namesA = flat.slice(0, maxPerTeam);
    const namesB = flat.slice(maxPerTeam, maxPerTeam * 2);
    return {
      maxPerTeam,
      namesA,
      namesB,
      filledA: namesA.length,
      filledB: namesB.length,
    };
  }

  const n = match.filledPlayerCount;
  if (typeof n === "number" && n > 0) {
    const onA = Math.min(n, maxPerTeam);
    const onB = Math.max(0, n - maxPerTeam);
    const namesA: string[] = onA > 0 && match.host ? [match.host] : [];
    return {
      maxPerTeam,
      namesA,
      namesB: [],
      filledA: onA,
      filledB: onB,
    };
  }

  return { maxPerTeam, namesA: [], namesB: [], filledA: 0, filledB: 0 };
}

/** One slot per index 0..max-1 for in-room grids. */
export type LobbySlot =
  | { kind: "player"; name: string }
  | { kind: "filled" }
  | { kind: "open" };

export function lobbySlotsForSide(
  names: string[],
  filled: number,
  maxPerTeam: number,
): LobbySlot[] {
  const out: LobbySlot[] = [];
  for (let i = 0; i < maxPerTeam; i++) {
    if (i < names.length) out.push({ kind: "player", name: names[i]! });
    else if (i < filled) out.push({ kind: "filled" });
    else out.push({ kind: "open" });
  }
  return out;
}

/** Total players in lobby for caps and pool math. */
export function lobbyFilledTotal(match: Match): number {
  const v = lobbyTeamViewFromMatch(match);
  return v.filledA + v.filledB;
}
