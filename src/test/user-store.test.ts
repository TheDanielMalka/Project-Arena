import { beforeEach, describe, expect, it } from "vitest";
import { useUserStore } from "@/stores/userStore";

describe("userStore", () => {
  beforeEach(() => {
    useUserStore.getState().logout();
  });

  // ── login ─────────────────────────────────────────────────────────────────
  it("login sets isAuthenticated to true", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().isAuthenticated).toBe(true);
  });

  it("login sets user role to admin for admin email", () => {
    useUserStore.getState().login("admin@arena.gg", "pass");
    expect(useUserStore.getState().user?.role).toBe("admin");
  });

  it("login sets user role to user for regular email", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().user?.role).toBe("user");
  });

  it("login sets showLoginGreeting to true with type 'login'", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().showLoginGreeting).toBe(true);
    expect(useUserStore.getState().greetingType).toBe("login");
  });

  // ── signup ────────────────────────────────────────────────────────────────
  it("signup creates user with correct username", () => {
    useUserStore.getState().signup("TestUser", "test@arena.gg", "password123");
    expect(useUserStore.getState().user?.username).toBe("TestUser");
  });

  it("signup sets showLoginGreeting with type 'signup'", () => {
    useUserStore.getState().signup("TestUser", "test@arena.gg", "password123");
    expect(useUserStore.getState().showLoginGreeting).toBe(true);
    expect(useUserStore.getState().greetingType).toBe("signup");
  });

  it("signup sets walletConnected to false", () => {
    useUserStore.getState().signup("TestUser", "test@arena.gg", "password123");
    expect(useUserStore.getState().walletConnected).toBe(false);
  });

  it("signup starts user with 0 xp and 0 matches", () => {
    useUserStore.getState().signup("NewPlayer", "new@arena.gg", "password123");
    const stats = useUserStore.getState().user?.stats;
    expect(stats?.xp).toBe(0);
    expect(stats?.matches).toBe(0);
  });

  // ── loginWithGoogle ───────────────────────────────────────────────────────
  it("loginWithGoogle authenticates user", () => {
    useUserStore.getState().loginWithGoogle();
    expect(useUserStore.getState().isAuthenticated).toBe(true);
  });

  it("loginWithGoogle sets greetingType to 'google'", () => {
    useUserStore.getState().loginWithGoogle();
    expect(useUserStore.getState().greetingType).toBe("google");
  });

  // ── clearLoginGreeting ────────────────────────────────────────────────────
  it("clearLoginGreeting resets showLoginGreeting and greetingType", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().clearLoginGreeting();
    expect(useUserStore.getState().showLoginGreeting).toBe(false);
    expect(useUserStore.getState().greetingType).toBeNull();
  });

  // ── logout ────────────────────────────────────────────────────────────────
  it("logout clears user and resets auth state", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().logout();
    expect(useUserStore.getState().isAuthenticated).toBe(false);
    expect(useUserStore.getState().user).toBeNull();
    expect(useUserStore.getState().showLoginGreeting).toBe(false);
  });

  // ── updateProfile ─────────────────────────────────────────────────────────
  it("updateProfile changes username", () => {
    useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().updateProfile({ username: "UpdatedName" });
    expect(useUserStore.getState().user?.username).toBe("UpdatedName");
  });
});
