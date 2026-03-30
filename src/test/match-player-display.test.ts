import { describe, it, expect } from "vitest";
import type { PublicPlayerProfile } from "@/types";
import { resolveRosterProfile, rosterDisplayUsername, syntheticUserIdFromDisplayKey } from "@/lib/matchPlayerDisplay";

const catalog: PublicPlayerProfile[] = [
  {
    id: "user-010",
    arenaId: "ARENA-NH",
    username: "NightHawk",
    avatarInitials: "NH",
    rank: "Platinum II",
    tier: "Platinum",
    preferredGame: "CS2",
    memberSince: "December 2025",
    status: "active",
    stats: { matches: 0, wins: 0, losses: 0, winRate: 0, totalEarnings: 0 },
  },
];

describe("matchPlayerDisplay — roster resolution", () => {
  it("resolveRosterProfile finds player by roster user id (not username string)", () => {
    const p = resolveRosterProfile("user-010", "user-001", "Me", catalog);
    expect(p?.username).toBe("NightHawk");
    expect(p?.id).toBe("user-010");
  });

  it("rosterDisplayUsername returns catalog username when slot is id", () => {
    expect(rosterDisplayUsername("user-010", "user-001", "Me", catalog)).toBe("NightHawk");
  });

  it("syntheticUserIdFromDisplayKey strips non-alphanumeric", () => {
    expect(syntheticUserIdFromDisplayKey("user-010")).toBe("u-user010");
  });
});
