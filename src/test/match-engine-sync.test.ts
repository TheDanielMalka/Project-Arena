import { describe, it, expect } from "vitest";
import { resolveUserWonFromEngineWinner } from "@/lib/match-engine-sync";

describe("resolveUserWonFromEngineWinner", () => {
  const user = { id: "user-001", username: "ArenaPlayer_01" };

  it("returns null when user is missing", () => {
    expect(resolveUserWonFromEngineWinner("user-001", null)).toBeNull();
  });

  it("returns null when winnerId is missing or blank", () => {
    expect(resolveUserWonFromEngineWinner(undefined, user)).toBeNull();
    expect(resolveUserWonFromEngineWinner("", user)).toBeNull();
    expect(resolveUserWonFromEngineWinner("   ", user)).toBeNull();
  });

  it("returns true when winner matches id or username", () => {
    expect(resolveUserWonFromEngineWinner("user-001", user)).toBe(true);
    expect(resolveUserWonFromEngineWinner("ArenaPlayer_01", user)).toBe(true);
  });

  it("returns false when another player won", () => {
    expect(resolveUserWonFromEngineWinner("other-user", user)).toBe(false);
  });
});
