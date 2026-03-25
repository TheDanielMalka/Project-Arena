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
  // ── Lobby matches (public, not user-001) ─────────────────────────────
  { id: "m1", type: "public", host: "ShadowKill3r", hostId: "u-shadow", game: "CS2",          mode: "1v1", betAmount: 25,  players: ["ShadowKill3r", "p2", "p3", "p4", "p5", "p6", "p7", "p8"], maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T12:00:00" },
  { id: "m2", type: "public", host: "NightHawk",    hostId: "u-night", game: "CS2",           mode: "1v1", betAmount: 50,  players: Array(10).fill("p"),                                          maxPlayers: 10, status: "in_progress", createdAt: "2026-03-25T11:00:00", timeLeft: "12:34" },
  { id: "m3", type: "public", host: "BlazeFury",    hostId: "u-blaze", game: "Valorant",      mode: "1v1", betAmount: 10,  players: ["BlazeFury", "p2", "p3", "p4"],                              maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T10:00:00" },
  { id: "m4", type: "public", host: "VortexX",      hostId: "u-vortex", game: "CS2",          mode: "1v1", betAmount: 25,  players: Array(10).fill("p"),                                          maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T09:00:00" },
  { id: "m5", type: "public", host: "StormRider",   hostId: "u-storm", game: "CS2",           mode: "1v1", betAmount: 50,  players: ["StormRider", "p2", "p3", "p4", "p5", "p6"],                 maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T08:00:00" },
  { id: "m6", type: "public", host: "CyberWolf",    hostId: "u-cyber", game: "Valorant",      mode: "1v1", betAmount: 10,  players: Array(10).fill("p"),                                          maxPlayers: 10, status: "in_progress", createdAt: "2026-03-25T07:00:00", timeLeft: "05:21" },
  // ── Custom lobby matches ─────────────────────────────────────────────
  { id: "c1", type: "custom", host: "ProGamer99",   hostId: "u-pro",   game: "CS2",           mode: "5v5", betAmount: 50,  players: [], maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T12:00:00", code: "ARENA-7X2K", password: "1234",   teamA: ["ProGamer99", "AceShot", "NitroX", "FlashBang", "SmokeY"],        teamB: ["DarkSide", "VenomX", "IceBreaker"],                                maxPerTeam: 5 },
  { id: "c2", type: "custom", host: "EliteSquad",   hostId: "u-elite", game: "Valorant",      mode: "5v5", betAmount: 25,  players: [], maxPlayers: 10, status: "waiting",     createdAt: "2026-03-25T11:00:00", code: "ARENA-M4QP", password: "gg99",   teamA: ["EliteSquad", "PhoenixRise", "JettMain"],                          teamB: ["SageHealer", "OmenShadow", "RazeBlast", "BrimFire", "KillJoyX"], maxPerTeam: 5 },
  { id: "c3", type: "custom", host: "CS2Kings",     hostId: "u-kings", game: "CS2",           mode: "5v5", betAmount: 100, players: [], maxPlayers: 10, status: "in_progress", createdAt: "2026-03-25T10:00:00", code: "ARENA-9FHL", password: "elite5", teamA: ["CS2Kings", "HeadClick", "SprayMaster", "ClutchKing", "AWPGod"],  teamB: ["RushB", "SiteHold", "RotateKing", "FlankMaster", "Defuser"],     maxPerTeam: 5 },
  // ── user-001 match history ───────────────────────────────────────────
  { id: "h1",  type: "public", host: "ShadowKill3r", hostId: "user-001", game: "CS2",          mode: "1v1", betAmount: 50,  players: ["user-001", "ShadowKill3r"], maxPlayers: 2, status: "completed",   winnerId: "user-001", createdAt: "2026-03-25T09:00:00", endedAt: "2026-03-25T09:45:00", teamA: ["user-001"],    teamB: ["ShadowKill3r"], maxPerTeam: 1 },
  { id: "h2",  type: "public", host: "NightHawk",   hostId: "u-night",  game: "Valorant",     mode: "1v1", betAmount: 25,  players: ["NightHawk", "user-001"],    maxPlayers: 2, status: "completed",   winnerId: "u-night",  createdAt: "2026-03-24T18:00:00", endedAt: "2026-03-24T18:40:00", teamA: ["NightHawk"],   teamB: ["user-001"],    maxPerTeam: 1 },
  { id: "h3",  type: "public", host: "user-001",    hostId: "user-001", game: "Fortnite",     mode: "1v1", betAmount: 10,  players: ["user-001", "BlazeFury"],    maxPlayers: 2, status: "completed",   winnerId: "user-001", createdAt: "2026-03-24T14:00:00", endedAt: "2026-03-24T14:30:00", teamA: ["user-001"],    teamB: ["BlazeFury"],   maxPerTeam: 1 },
  { id: "h4",  type: "public", host: "VortexX",     hostId: "u-vortex", game: "CS2",          mode: "1v1", betAmount: 100, players: ["VortexX", "user-001"],      maxPlayers: 2, status: "completed",   winnerId: "u-vortex", createdAt: "2026-03-23T10:00:00", endedAt: "2026-03-23T11:00:00", teamA: ["VortexX"],     teamB: ["user-001"],    maxPerTeam: 1 },
  { id: "h5",  type: "public", host: "user-001",    hostId: "user-001", game: "Apex Legends", mode: "1v1", betAmount: 30,  players: ["user-001", "CyberWolf"],    maxPlayers: 2, status: "completed",   winnerId: "user-001", createdAt: "2026-03-23T20:00:00", endedAt: "2026-03-23T21:00:00", teamA: ["user-001"],    teamB: ["CyberWolf"],   maxPerTeam: 1 },
  { id: "h6",  type: "public", host: "StormRider",  hostId: "u-storm",  game: "Valorant",     mode: "1v1", betAmount: 75,  players: ["StormRider", "user-001"],   maxPlayers: 2, status: "disputed",                         createdAt: "2026-03-22T15:00:00",                                 teamA: ["StormRider"],  teamB: ["user-001"],    maxPerTeam: 1 },
  { id: "h7",  type: "public", host: "user-001",    hostId: "user-001", game: "CS2",          mode: "1v1", betAmount: 50,  players: ["user-001", "NightHawk"],    maxPlayers: 2, status: "completed",   winnerId: "user-001", createdAt: "2026-03-22T12:00:00", endedAt: "2026-03-22T13:00:00", teamA: ["user-001"],    teamB: ["NightHawk"],   maxPerTeam: 1 },
  { id: "h8",  type: "public", host: "user-001",    hostId: "user-001", game: "CS2",          mode: "1v1", betAmount: 25,  players: ["user-001", "BlazeFury"],    maxPlayers: 2, status: "cancelled",                        createdAt: "2026-03-21T10:00:00",                                 teamA: ["user-001"],    teamB: ["BlazeFury"],   maxPerTeam: 1 },
  { id: "h9",  type: "custom", host: "user-001",    hostId: "user-001", game: "CS2",          mode: "5v5", betAmount: 200, players: [], maxPlayers: 10,            status: "completed",   winnerId: "user-001", createdAt: "2026-03-20T18:00:00", endedAt: "2026-03-20T20:00:00", code: "ARENA-USR1", teamA: ["user-001", "AceShot", "NitroX", "FlashBang", "SmokeY"], teamB: ["DarkSide", "VenomX", "IceBreaker", "CryptoX", "NeonBlade"], maxPerTeam: 5 },
  { id: "h10", type: "public", host: "ProGamer99",  hostId: "u-pro",    game: "Apex Legends", mode: "1v1", betAmount: 40,  players: ["ProGamer99", "user-001"],   maxPlayers: 2, status: "completed",   winnerId: "u-pro",    createdAt: "2026-03-19T14:00:00", endedAt: "2026-03-19T15:00:00", teamA: ["ProGamer99"],  teamB: ["user-001"],    maxPerTeam: 1 },
  { id: "h11", type: "public", host: "user-001",    hostId: "user-001", game: "Valorant",     mode: "1v1", betAmount: 60,  players: ["user-001", "CyberWolf"],    maxPlayers: 2, status: "in_progress",                      createdAt: "2026-03-25T09:30:00", timeLeft: "08:45",              teamA: ["user-001"],    teamB: ["CyberWolf"],   maxPerTeam: 1 },
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
