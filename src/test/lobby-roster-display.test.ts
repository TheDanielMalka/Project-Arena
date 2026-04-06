import { describe, it, expect } from "vitest";
import {
  lobbyFilledTotal,
  lobbySlotsForSide,
  lobbyTeamViewFromMatch,
} from "@/lib/lobbyRosterDisplay";
import type { Match } from "@/types";

const base = (): Match => ({
  id: "m1",
  type: "public",
  host: "HostUser",
  hostId: "h1",
  game: "CS2",
  mode: "5v5",
  betAmount: 10,
  players: [],
  maxPlayers: 10,
  status: "waiting",
  createdAt: "2026-01-01T00:00:00Z",
  maxPerTeam: 5,
  teamSize: 5,
});

describe("lobbyTeamViewFromMatch", () => {
  it("uses filledPlayerCount when roster arrays are empty (host on Team A)", () => {
    const m = { ...base(), filledPlayerCount: 1, players: [], teamA: [], teamB: [] };
    const v = lobbyTeamViewFromMatch(m);
    expect(v.filledA).toBe(1);
    expect(v.filledB).toBe(0);
    expect(v.namesA).toEqual(["HostUser"]);
    expect(v.namesB).toEqual([]);
  });

  it("splits count across teams (fill A first)", () => {
    const m = { ...base(), filledPlayerCount: 6, players: [], teamA: [], teamB: [] };
    const v = lobbyTeamViewFromMatch(m);
    expect(v.filledA).toBe(5);
    expect(v.filledB).toBe(1);
  });

  it("prefers explicit teamA/teamB from server", () => {
    const m = {
      ...base(),
      filledPlayerCount: 99,
      teamA: ["a", "b"],
      teamB: ["c"],
    };
    const v = lobbyTeamViewFromMatch(m);
    expect(v.filledA).toBe(2);
    expect(v.filledB).toBe(1);
    expect(v.namesA).toEqual(["a", "b"]);
  });
});

describe("lobbySlotsForSide", () => {
  it("interleaves named players, anonymous filled, and open slots", () => {
    const slots = lobbySlotsForSide(["Host"], 3, 5);
    expect(slots.map((s) => s.kind)).toEqual(["player", "filled", "filled", "open", "open"]);
    expect(slots[0]).toMatchObject({ kind: "player", name: "Host" });
  });
});

describe("lobbyFilledTotal", () => {
  it("sums both sides", () => {
    const m = { ...base(), filledPlayerCount: 3 };
    expect(lobbyFilledTotal(m)).toBe(3);
  });
});
