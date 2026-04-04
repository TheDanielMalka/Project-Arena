import "@testing-library/jest-dom";
import { vi } from "vitest";

// Prevent unit tests from making real network calls for auth/profile.
// We keep the rest of engine-api behavior intact.
vi.mock("@/lib/engine-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/engine-api")>("@/lib/engine-api");

  return {
    ...actual,
    apiLogin: vi.fn(async (identifier: string, _password: string) => {
      const email = identifier.trim().toLowerCase();
      const isAdmin = email === "admin@arena.gg";
      return {
        access_token: isAdmin ? "token-admin" : "token-user",
        user_id: isAdmin ? "user-admin-001" : "user-001",
        username: isAdmin ? "Admin" : "ArenaPlayer_01",
        email,
        arena_id: isAdmin ? "ARENA-ADM001" : "ARENA-AP0001",
        wallet_address: isAdmin ? "0xADMIN" : "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
      };
    }),
    apiRegister: vi.fn(async (username: string, email: string, _password: string, _opts?: unknown) => ({
      ok: true as const,
      data: {
        access_token: "token-new",
        user_id: "user-new-001",
        username,
        email: email.trim().toLowerCase(),
        arena_id: "ARENA-NEW001",
        wallet_address: null,
      },
    })),
    apiGetMe: vi.fn(async (token: string) => {
      if (token === "token-new") {
        return {
          user_id: "user-new-001",
          username: "NewUser",
          email: "new@arena.gg",
          arena_id: "ARENA-NEW001",
          rank: null,
          wallet_address: null,
          steam_id: null,
          riot_id: null,
          xp: 0,
          wins: 0,
          losses: 0,
          avatar: "initials",
          avatar_bg: "default",
          equipped_badge_icon: null,
          forge_unlocked_item_ids: [],
          vip_expires_at: null,
          at_balance: 200,
        };
      }
      const isAdmin = token === "token-admin";
      return {
        user_id: isAdmin ? "user-admin-001" : "user-001",
        username: isAdmin ? "Admin" : "ArenaPlayer_01",
        email: isAdmin ? "admin@arena.gg" : "player@arena.gg",
        arena_id: isAdmin ? "ARENA-ADM001" : "ARENA-AP0001",
        rank: isAdmin ? "Diamond I" : "Gold III",
        wallet_address: isAdmin ? "0xADMIN" : "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
        steam_id: "76561198000000001",
        riot_id: null,
        xp: isAdmin ? 9999 : 840,
        wins: isAdmin ? 999 : 94,
        losses: isAdmin ? 1 : 53,
        avatar: "initials",
        avatar_bg: "default",
        equipped_badge_icon: null,
        forge_unlocked_item_ids: [],
        vip_expires_at: null,
        at_balance: isAdmin ? 50_000 : 200,
      };
    }),
    apiPatchMe: vi.fn(async () => true),
  };
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
