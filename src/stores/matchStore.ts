import { create } from "zustand";
import type { Match, Game, MatchStatus } from "@/types";

interface MatchState {
  matches: Match[];
  addMatch: (match: Omit<Match, "id" | "createdAt">) => Match;
  joinMatch: (matchId: string, playerId: string, team?: "A" | "B") => boolean;
  updateMatchStatus: (matchId: string, status: MatchStatus, winnerId?: string) => void;
  getMatchByCode: (code: string) => Match | undefined;
}

let matchCounter = 100;

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "ARENA-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const SEED_MATCHES: Match[] = [
  { id: "m1", type: "public", host: "ShadowKill3r", hostId: "u-shadow", game: "CS2", mode: "1v1", betAmount: 25, players: ["ShadowKill3r", "p2", "p3", "p4", "p5", "p6", "p7", "p8"], maxPlayers: 10, status: "waiting", createdAt: "2026-03-08T12:00:00" },
  { id: "m2", type: "public", host: "NightHawk", hostId: "u-night", game: "CS2", mode: "1v1", betAmount: 50, players: Array(10).fill("p"), maxPlayers: 10, status: "in_progress", createdAt: "2026-03-08T11:00:00", timeLeft: "12:34" },
  { id: "m3", type: "public", host: "BlazeFury", hostId: "u-blaze", game: "Valorant", mode: "1v1", betAmount: 10, players: ["BlazeFury", "p2", "p3", "p4"], maxPlayers: 10, status: "waiting", createdAt: "2026-03-08T10:00:00" },
  { id: "m4", type: "public", host: "VortexX", hostId: "u-vortex", game: "CS2", mode: "1v1", betAmount: 25, players: Array(10).fill("p"), maxPlayers: 10, status: "completed", createdAt: "2026-03-08T09:00:00" },
  { id: "m5", type: "public", host: "StormRider", hostId: "u-storm", game: "CS2", mode: "1v1", betAmount: 50, players: ["StormRider", "p2", "p3", "p4", "p5", "p6"], maxPlayers: 10, status: "waiting", createdAt: "2026-03-08T08:00:00" },
  { id: "m6", type: "public", host: "CyberWolf", hostId: "u-cyber", game: "Valorant", mode: "1v1", betAmount: 10, players: Array(10).fill("p"), maxPlayers: 10, status: "in_progress", createdAt: "2026-03-08T07:00:00", timeLeft: "05:21" },
  // Custom matches
  { id: "c1", type: "custom", host: "ProGamer99", hostId: "u-pro", game: "CS2", mode: "5v5", betAmount: 50, players: [], maxPlayers: 10, status: "waiting", createdAt: "2026-03-08T12:00:00", code: "ARENA-7X2K", password: "1234", teamA: ["ProGamer99", "AceShot", "NitroX", "FlashBang", "SmokeY"], teamB: ["DarkSide", "VenomX", "IceBreaker"], maxPerTeam: 5 },
  { id: "c2", type: "custom", host: "EliteSquad", hostId: "u-elite", game: "Valorant", mode: "5v5", betAmount: 25, players: [], maxPlayers: 10, status: "waiting", createdAt: "2026-03-08T11:00:00", code: "ARENA-M4QP", password: "gg99", teamA: ["EliteSquad", "PhoenixRise", "JettMain"], teamB: ["SageHealer", "OmenShadow", "RazeBlast", "BrimFire", "KillJoyX"], maxPerTeam: 5 },
  { id: "c3", type: "custom", host: "CS2Kings", hostId: "u-kings", game: "CS2", mode: "5v5", betAmount: 100, players: [], maxPlayers: 10, status: "in_progress", createdAt: "2026-03-08T10:00:00", code: "ARENA-9FHL", password: "elite5", teamA: ["CS2Kings", "HeadClick", "SprayMaster", "ClutchKing", "AWPGod"], teamB: ["RushB", "SiteHold", "RotateKing", "FlankMaster", "Defuser"], maxPerTeam: 5 },
];

export const useMatchStore = create<MatchState>((set, get) => ({
  matches: SEED_MATCHES,

  addMatch: (matchData) => {
    const newMatch: Match = {
      ...matchData,
      id: `m-${++matchCounter}`,
      createdAt: new Date().toISOString(),
      code: matchData.type === "custom" ? generateCode() : undefined,
    };
    set((state) => ({ matches: [newMatch, ...state.matches] }));
    return newMatch;
  },

  joinMatch: (matchId, playerId, team) => {
    const match = get().matches.find((m) => m.id === matchId);
    if (!match || match.status !== "waiting") return false;

    if (match.type === "custom" && team) {
      const teamKey = team === "A" ? "teamA" : "teamB";
      const currentTeam = match[teamKey] ?? [];
      if (currentTeam.length >= (match.maxPerTeam ?? 5)) return false;
      if (currentTeam.includes(playerId)) return false;
      set((state) => ({
        matches: state.matches.map((m) =>
          m.id === matchId ? { ...m, [teamKey]: [...currentTeam, playerId] } : m
        ),
      }));
      return true;
    }

    if (match.players.length >= match.maxPlayers) return false;
    if (match.players.includes(playerId)) return false;
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId ? { ...m, players: [...m.players, playerId] } : m
      ),
    }));
    return true;
  },

  updateMatchStatus: (matchId, status, winnerId) => {
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId
          ? { ...m, status, winnerId, ...(status === "in_progress" ? { startedAt: new Date().toISOString() } : {}), ...(status === "completed" ? { endedAt: new Date().toISOString() } : {}) }
          : m
      ),
    }));
  },

  getMatchByCode: (code) => get().matches.find((m) => m.code === code),
}));
