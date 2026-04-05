import type { LeaderboardPlayerRow } from "@/types";

/** Mirrors former mockLeaderboard — used by vitest mock for apiGetLeaderboard. */
export const LEADERBOARD_GLOBAL_TEST: LeaderboardPlayerRow[] = [
  { id: "lb-001", arenaId: "ARENA-SK0001", rank: 1,  username: "ShadowKing",  wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2",          avatar: "preset:arcane_emperor", equippedBadgeIcon: "badge:founders" },
  { id: "lb-002", arenaId: "ARENA-NV0002", rank: 2,  username: "NeonViper",   wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7,  change: "up",   game: "CS2",          avatar: "preset:vermilion_edge", equippedBadgeIcon: "badge:shadow_ronin" },
  { id: "lb-003", arenaId: "ARENA-PS0003", rank: 3,  username: "PixelStorm",  wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4,  change: "up",   game: "Valorant",     avatar: "preset:emerald_samurai", equippedBadgeIcon: "badge:champions" },
  { id: "U-288",  arenaId: "ARENA-BF0005", rank: 4,  username: "BlazeFury",   wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2,  change: "down", game: "CS2",          avatar: "preset:ember_valkyrie", equippedBadgeIcon: "badge:neon_hunter" },
  { id: "lb-005", arenaId: "ARENA-AH0005", rank: 5,  username: "AceHunter",   wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5,  change: "up",   game: "Valorant",     avatar: "preset:titan_shifter", equippedBadgeIcon: "badge:sun_god" },
  { id: "lb-006", arenaId: "ARENA-GR0006", rank: 6,  username: "GhostRider",  wins: 98,  losses: 50, winRate: 66.2, earnings: 2400, streak: 1,  change: "down", game: "CS2",          avatar: "preset:storm_warden", equippedBadgeIcon: "badge:veterans" },
  { id: "lb-007", arenaId: "ARENA-IW0007", rank: 7,  username: "IronWolf",    wins: 95,  losses: 48, winRate: 66.4, earnings: 2200, streak: 3,  change: "same", game: "Fortnite",     avatar: "preset:gold_tempest", equippedBadgeIcon: "badge:crimson_core" },
  { id: "lb-008", arenaId: "ARENA-CN0008", rank: 8,  username: "CyberNinja",  wins: 90,  losses: 55, winRate: 62.1, earnings: 1900, streak: 0,  change: "down", game: "Apex Legends", avatar: "preset:dusk_raven", equippedBadgeIcon: "badge:void_warden" },
  { id: "lb-009", arenaId: "ARENA-VE0009", rank: 9,  username: "VoltEdge",    wins: 88,  losses: 52, winRate: 62.9, earnings: 1800, streak: 2,  change: "up",   game: "CS2",          avatar: "preset:rift_runner", equippedBadgeIcon: "badge:arena_ring" },
  { id: "lb-010", arenaId: "ARENA-TB0010", rank: 10, username: "ThunderBolt", wins: 85,  losses: 58, winRate: 59.4, earnings: 1650, streak: 1,  change: "same", game: "Valorant",     avatar: "preset:frost_oracle", equippedBadgeIcon: "badge:iron_command" },
];

export const LEADERBOARD_BY_GAME_TEST: Record<string, LeaderboardPlayerRow[]> = {
  CS2: [
    { id: "lb-001", arenaId: "ARENA-SK0001", rank: 1, username: "ShadowKing",  wins: 142, losses: 28, winRate: 83.5, earnings: 4250, streak: 12, change: "same", game: "CS2", avatar: "preset:arcane_emperor", equippedBadgeIcon: "badge:founders" },
    { id: "lb-002", arenaId: "ARENA-NV0002", rank: 2, username: "NeonViper",   wins: 128, losses: 35, winRate: 78.5, earnings: 3800, streak: 7,  change: "up",   game: "CS2", avatar: "preset:vermilion_edge", equippedBadgeIcon: "badge:shadow_ronin" },
    { id: "U-288",  arenaId: "ARENA-BF0005", rank: 3, username: "BlazeFury",   wins: 110, losses: 42, winRate: 72.4, earnings: 2900, streak: 2,  change: "down", game: "CS2", avatar: "preset:ember_valkyrie", equippedBadgeIcon: "badge:neon_hunter" },
    { id: "lb-006", arenaId: "ARENA-GR0006", rank: 4, username: "GhostRider",  wins: 98,  losses: 50, winRate: 66.2, earnings: 2400, streak: 1,  change: "down", game: "CS2", avatar: "preset:storm_warden", equippedBadgeIcon: "badge:veterans" },
    { id: "lb-009", arenaId: "ARENA-VE0009", rank: 5, username: "VoltEdge",    wins: 88,  losses: 52, winRate: 62.9, earnings: 1800, streak: 2,  change: "up",   game: "CS2", avatar: "preset:rift_runner", equippedBadgeIcon: "badge:arena_ring" },
    { id: "cs2-006", arenaId: "ARENA-HK0011", rank: 6, username: "HeadClick",   wins: 80,  losses: 55, winRate: 59.3, earnings: 1520, streak: 0,  change: "same", game: "CS2", avatar: "preset:crown_duelist", equippedBadgeIcon: "badge:desert_prince" },
    { id: "cs2-007", arenaId: "ARENA-RM0012", rank: 7, username: "RushMaster",  wins: 74,  losses: 58, winRate: 56.1, earnings: 1280, streak: 1,  change: "up",   game: "CS2", avatar: "preset:spiral_hero", equippedBadgeIcon: "badge:black_mage" },
  ],
  Valorant: [
    { id: "lb-003", arenaId: "ARENA-PS0003", rank: 1, username: "PixelStorm",  wins: 115, losses: 40, winRate: 74.2, earnings: 3200, streak: 4, change: "up",   game: "Valorant", avatar: "preset:emerald_samurai", equippedBadgeIcon: "badge:champions" },
    { id: "lb-005", arenaId: "ARENA-AH0005", rank: 2, username: "AceHunter",   wins: 105, losses: 45, winRate: 70.0, earnings: 2750, streak: 5, change: "up",   game: "Valorant", avatar: "preset:titan_shifter", equippedBadgeIcon: "badge:sun_god" },
    { id: "lb-010", arenaId: "ARENA-TB0010", rank: 3, username: "ThunderBolt", wins: 85,  losses: 58, winRate: 59.4, earnings: 1650, streak: 1, change: "same", game: "Valorant", avatar: "preset:frost_oracle", equippedBadgeIcon: "badge:iron_command" },
    { id: "val-004", arenaId: "ARENA-JM0013", rank: 4, username: "JettMain",    wins: 78,  losses: 60, winRate: 56.5, earnings: 1380, streak: 0, change: "down", game: "Valorant", avatar: "preset:solar_grin", equippedBadgeIcon: "badge:storm_swordsman" },
    { id: "val-005", arenaId: "ARENA-RP0014", rank: 5, username: "ReynaPeak",   wins: 71,  losses: 62, winRate: 53.4, earnings: 1140, streak: 2, change: "up",   game: "Valorant", avatar: "preset:crimson_veil", equippedBadgeIcon: "badge:crimson_core" },
    { id: "val-006", arenaId: "ARENA-SB0015", rank: 6, username: "SageBlock",   wins: 66,  losses: 65, winRate: 50.4, earnings: 980,  streak: 0, change: "same", game: "Valorant", avatar: "preset:void_archon", equippedBadgeIcon: "badge:void_warden" },
  ],
  Fortnite: [
    { id: "lb-007",  arenaId: "ARENA-IW0007", rank: 1, username: "IronWolf",    wins: 95,  losses: 48, winRate: 66.4, earnings: 2200, streak: 3, change: "same", game: "Fortnite", avatar: "preset:gold_tempest", equippedBadgeIcon: "badge:crimson_core" },
    { id: "fn-002",  arenaId: "ARENA-SB0016", rank: 2, username: "StormBreak",  wins: 82,  losses: 54, winRate: 60.3, earnings: 1760, streak: 1, change: "up",   game: "Fortnite", avatar: "preset:ash_chieftain", equippedBadgeIcon: "badge:sun_god" },
    { id: "fn-003",  arenaId: "ARENA-ZZ0017", rank: 3, username: "ZeroZone",    wins: 70,  losses: 58, winRate: 54.7, earnings: 1340, streak: 0, change: "down", game: "Fortnite", avatar: "preset:green_blade", equippedBadgeIcon: "badge:arena_ring" },
    { id: "fn-004",  arenaId: "ARENA-GK0018", rank: 4, username: "GlideKing",   wins: 62,  losses: 60, winRate: 50.8, earnings: 1080, streak: 2, change: "up",   game: "Fortnite", avatar: "preset:steel_fury", equippedBadgeIcon: "badge:neon_hunter" },
    { id: "fn-005",  arenaId: "ARENA-LV0019", rank: 5, username: "LootVault",   wins: 55,  losses: 63, winRate: 46.6, earnings: 870,  streak: 0, change: "same", game: "Fortnite", avatar: "preset:spiral_hero", equippedBadgeIcon: "badge:iron_command" },
  ],
  "Apex Legends": [
    { id: "lb-008",  arenaId: "ARENA-CN0008", rank: 1, username: "CyberNinja",  wins: 90,  losses: 55, winRate: 62.1, earnings: 1900, streak: 0, change: "down", game: "Apex Legends", avatar: "preset:dusk_raven", equippedBadgeIcon: "badge:void_warden" },
    { id: "apex-002", arenaId: "ARENA-WR0020", rank: 2, username: "WraithX",     wins: 76,  losses: 58, winRate: 56.7, earnings: 1520, streak: 3, change: "up",   game: "Apex Legends", avatar: "preset:vermilion_edge", equippedBadgeIcon: "badge:shadow_ronin" },
    { id: "apex-003", arenaId: "ARENA-BP0021", rank: 3, username: "BangBang",    wins: 68,  losses: 62, winRate: 52.3, earnings: 1240, streak: 1, change: "same", game: "Apex Legends", avatar: "preset:ember_valkyrie", equippedBadgeIcon: "badge:founders" },
    { id: "apex-004", arenaId: "ARENA-PK0022", rank: 4, username: "PathFinder",  wins: 60,  losses: 65, winRate: 48.0, earnings: 980,  streak: 0, change: "down", game: "Apex Legends", avatar: "preset:arcane_emperor", equippedBadgeIcon: "badge:champions" },
    { id: "apex-005", arenaId: "ARENA-CL0023", rank: 5, username: "CausticLab",  wins: 52,  losses: 68, winRate: 43.3, earnings: 740,  streak: 0, change: "same", game: "Apex Legends", avatar: "preset:titan_shifter", equippedBadgeIcon: "badge:veterans" },
  ],
};
