import { describe, expect, it } from "vitest";
import {
  isValidRiotId,
  isValidSteamId,
  looksLikeServerMatchId,
} from "@/lib/gameAccounts";

describe("gameAccounts", () => {
  it("isValidSteamId matches engine rules", () => {
    expect(isValidSteamId("76561198000000001")).toBe(true);
    expect(isValidSteamId(" 76561198000000001 ")).toBe(true);
    expect(isValidSteamId("12345678901234567")).toBe(false);
    expect(isValidSteamId("7656118")).toBe(false);
  });

  it("isValidRiotId matches engine rules", () => {
    expect(isValidRiotId("Player#1234")).toBe(true);
    expect(isValidRiotId("ABC#XY1")).toBe(true);
    expect(isValidRiotId("NoHash")).toBe(false);
    expect(isValidRiotId("AB#123")).toBe(false);
  });

  it("looksLikeServerMatchId detects UUID", () => {
    expect(looksLikeServerMatchId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(looksLikeServerMatchId("m-101")).toBe(false);
  });
});
