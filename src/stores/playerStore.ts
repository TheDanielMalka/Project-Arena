import { create } from "zustand";
import type { PublicPlayerProfile } from "@/types";

// ─── Seed Data ────────────────────────────────────────────────
// DB-ready: replace with GET /api/players?q=query&game=game

const SEED_PLAYERS: PublicPlayerProfile[] = [
  {
    id: "user-002", arenaId: "ARENA-WP0002",
    username: "WingmanPro", avatarInitials: "WP",
    rank: "Gold II", tier: "Gold", preferredGame: "Valorant",
    memberSince: "January 2026", status: "active",
    stats: { matches: 89, wins: 60, losses: 29, winRate: 67.4, totalEarnings: 1240 },
  },
  {
    id: "user-003", arenaId: "ARENA-SK0003",
    username: "ShadowKill3r", avatarInitials: "SK",
    rank: "Diamond I", tier: "Diamond", preferredGame: "CS2",
    memberSince: "December 2025", status: "active",
    stats: { matches: 134, wins: 95, losses: 39, winRate: 70.9, totalEarnings: 3180 },
  },
  {
    id: "user-004", arenaId: "ARENA-NB0004",
    username: "NovaBlade", avatarInitials: "NB",
    rank: "Platinum III", tier: "Platinum", preferredGame: "CS2",
    memberSince: "February 2026", status: "active",
    stats: { matches: 203, wins: 118, losses: 85, winRate: 58.1, totalEarnings: 2760 },
  },
  {
    id: "U-288", arenaId: "ARENA-BF0005",
    username: "BlazeFury", avatarInitials: "BF",
    rank: "Gold III", tier: "Gold", preferredGame: "Valorant",
    memberSince: "January 2026", status: "banned",
    stats: { matches: 31, wins: 14, losses: 17, winRate: 45.2, totalEarnings: 180 },
  },
  {
    id: "U-260", arenaId: "ARENA-PA0006",
    username: "PhantomAce", avatarInitials: "PA",
    rank: "Silver I", tier: "Silver", preferredGame: "Valorant",
    memberSince: "February 2026", status: "flagged",
    stats: { matches: 77, wins: 32, losses: 45, winRate: 41.6, totalEarnings: 420 },
  },
  {
    id: "U-275", arenaId: "ARENA-SR0007",
    username: "StormRider", avatarInitials: "SR",
    rank: "Gold I", tier: "Gold", preferredGame: "CS2",
    memberSince: "November 2025", status: "active",
    stats: { matches: 120, wins: 74, losses: 46, winRate: 61.7, totalEarnings: 1850 },
  },
  {
    id: "user-007", arenaId: "ARENA-DV0008",
    username: "DarkViper", avatarInitials: "DV",
    rank: "Platinum I", tier: "Platinum", preferredGame: "Fortnite",
    memberSince: "January 2026", status: "active",
    stats: { matches: 88, wins: 48, losses: 40, winRate: 54.5, totalEarnings: 970 },
  },
  {
    id: "user-008", arenaId: "ARENA-CW0009",
    username: "CyberWolf", avatarInitials: "CW",
    rank: "Gold II", tier: "Gold", preferredGame: "PUBG",
    memberSince: "February 2026", status: "active",
    stats: { matches: 156, wins: 76, losses: 80, winRate: 48.7, totalEarnings: 1120 },
  },
  {
    id: "user-009", arenaId: "ARENA-IC0010",
    username: "IronClad", avatarInitials: "IC",
    rank: "Gold III", tier: "Gold", preferredGame: "CS2",
    memberSince: "January 2026", status: "active",
    stats: { matches: 95, wins: 49, losses: 46, winRate: 51.6, totalEarnings: 740 },
  },
  {
    id: "user-010", arenaId: "ARENA-NH0011",
    username: "NightHawk", avatarInitials: "NH",
    rank: "Platinum II", tier: "Platinum", preferredGame: "Apex Legends",
    memberSince: "December 2025", status: "active",
    stats: { matches: 110, wins: 66, losses: 44, winRate: 60.0, totalEarnings: 1640 },
  },
  {
    id: "U-301", arenaId: "ARENA-XD0012",
    username: "xDragon99", avatarInitials: "XD",
    rank: "Platinum I", tier: "Platinum", preferredGame: "CS2",
    memberSince: "November 2025", status: "flagged",
    stats: { matches: 54, wins: 50, losses: 4, winRate: 92.6, totalEarnings: 4200 },
  },
];

// ─── Store ────────────────────────────────────────────────────

interface PlayerState {
  players: PublicPlayerProfile[];

  // DB-ready: replace with GET /api/players?q=query&game=game
  searchPlayers: (query: string, gameFilter?: string) => PublicPlayerProfile[];

  // DB-ready: replace with GET /api/players/:username
  getPlayerByUsername: (username: string) => PublicPlayerProfile | undefined;
}

export const usePlayerStore = create<PlayerState>((_set, get) => ({
  players: SEED_PLAYERS,

  searchPlayers: (query, gameFilter) => {
    const q = query.trim().toLowerCase();
    return get().players.filter((p) => {
      if (q && !p.username.toLowerCase().includes(q) && !p.arenaId.toLowerCase().includes(q)) return false;
      if (gameFilter && p.preferredGame !== gameFilter) return false;
      return true;
    });
  },

  getPlayerByUsername: (username) =>
    get().players.find(
      (p) => p.username.toLowerCase() === username.toLowerCase()
    ),
}));
