import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineApi from "@/lib/engine-api";
import { useUserStore } from "@/stores/userStore";

const SIGNUP_GAME = { steamId: "76561198000000001" } as const;

describe("userStore", () => {
  beforeEach(() => {
    useUserStore.getState().logout();
  });

  // ── login ─────────────────────────────────────────────────────────────────
  it("login sets isAuthenticated to true", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().isAuthenticated).toBe(true);
  });

  it("login sets user role to admin for admin email", async () => {
    await useUserStore.getState().login("admin@arena.gg", "pass");
    expect(useUserStore.getState().user?.role).toBe("admin");
  });

  it("login sets user role to user for regular email", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().user?.role).toBe("user");
  });

  it("login sets showLoginGreeting to true with type 'login'", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    expect(useUserStore.getState().showLoginGreeting).toBe(true);
    expect(useUserStore.getState().greetingType).toBe("login");
  });

  // ── signup ────────────────────────────────────────────────────────────────
  it("signup creates user with correct username", async () => {
    await useUserStore.getState().signup("TestUser", "test@arena.gg", "password123", SIGNUP_GAME);
    expect(useUserStore.getState().user?.username).toBe("TestUser");
  });

  it("signup sets showLoginGreeting with type 'signup'", async () => {
    await useUserStore.getState().signup("TestUser", "test@arena.gg", "password123", SIGNUP_GAME);
    expect(useUserStore.getState().showLoginGreeting).toBe(true);
    expect(useUserStore.getState().greetingType).toBe("signup");
  });

  it("signup sets walletConnected to false", async () => {
    await useUserStore.getState().signup("TestUser", "test@arena.gg", "password123", SIGNUP_GAME);
    expect(useUserStore.getState().walletConnected).toBe(false);
  });

  it("signup starts user with 0 xp and 0 matches", async () => {
    await useUserStore.getState().signup("NewPlayer", "new@arena.gg", "password123", SIGNUP_GAME);
    const stats = useUserStore.getState().user?.stats;
    expect(stats?.xp).toBe(0);
    expect(stats?.matches).toBe(0);
  });

  it("signup returns field and detail on 409-style conflict without authenticating", async () => {
    vi.mocked(engineApi.apiRegister).mockResolvedValueOnce({
      ok: false as const,
      status: 409,
      detail: "Email already registered",
      field: "email",
    });
    const r = await useUserStore.getState().signup("TestUser", "taken@arena.gg", "password123", SIGNUP_GAME);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.field).toBe("email");
      expect(r.detail).toBe("Email already registered");
    }
    expect(useUserStore.getState().isAuthenticated).toBe(false);
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
  it("clearLoginGreeting resets showLoginGreeting and greetingType", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().clearLoginGreeting();
    expect(useUserStore.getState().showLoginGreeting).toBe(false);
    expect(useUserStore.getState().greetingType).toBeNull();
  });

  // ── logout ────────────────────────────────────────────────────────────────
  it("logout clears user and resets auth state", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().logout();
    expect(useUserStore.getState().isAuthenticated).toBe(false);
    expect(useUserStore.getState().user).toBeNull();
    expect(useUserStore.getState().showLoginGreeting).toBe(false);
  });

  // ── updateProfile ─────────────────────────────────────────────────────────
  it("updateProfile changes username", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().updateProfile({ username: "UpdatedName" });
    expect(useUserStore.getState().user?.username).toBe("UpdatedName");
  });

  it("updateProfile persists equippedBadgeIcon (DB users.equipped_badge_icon)", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().updateProfile({ equippedBadgeIcon: "badge:champions" });
    expect(useUserStore.getState().user?.equippedBadgeIcon).toBe("badge:champions");
  });

  it("updateProfile can clear equippedBadgeIcon", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    useUserStore.getState().updateProfile({ equippedBadgeIcon: "badge:founders" });
    useUserStore.getState().updateProfile({ equippedBadgeIcon: undefined });
    expect(useUserStore.getState().user?.equippedBadgeIcon).toBeUndefined();
  });

  it("updateProfile deep-merges stats (partial xp patch)", async () => {
    await useUserStore.getState().login("player@arena.gg", "pass");
    const before = useUserStore.getState().user!.stats;
    useUserStore.getState().updateProfile({ stats: { xp: before.xp + 100 } });
    const after = useUserStore.getState().user!.stats;
    expect(after.xp).toBe(before.xp + 100);
    expect(after.matches).toBe(before.matches);
  });
});
