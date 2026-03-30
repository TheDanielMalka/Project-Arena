import { beforeEach, describe, expect, it } from "vitest";
import {
  ARENA_LS_PENDING_CLIENT_SETUP,
  clearArenaLocalPreferences,
  clearPendingClientSetup,
  hasPendingClientSetup,
  setPendingClientSetupAfterSignup,
} from "@/lib/localArenaPrefs";

describe("localArenaPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("setPendingClientSetupAfterSignup sets flag", () => {
    setPendingClientSetupAfterSignup();
    expect(localStorage.getItem(ARENA_LS_PENDING_CLIENT_SETUP)).toBe("1");
    expect(hasPendingClientSetup()).toBe(true);
  });

  it("clearPendingClientSetup removes flag", () => {
    setPendingClientSetupAfterSignup();
    clearPendingClientSetup();
    expect(hasPendingClientSetup()).toBe(false);
  });

  it("clearArenaLocalPreferences clears known keys", () => {
    setPendingClientSetupAfterSignup();
    const { clearedKeys } = clearArenaLocalPreferences();
    expect(clearedKeys).toContain(ARENA_LS_PENDING_CLIENT_SETUP);
    expect(hasPendingClientSetup()).toBe(false);
  });
});
