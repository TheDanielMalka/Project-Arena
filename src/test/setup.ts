import "@testing-library/jest-dom";
import { beforeEach, vi } from "vitest";
import { friendApiFixture } from "@/test/friendApiFixture";

beforeEach(() => {
  friendApiFixture.reset();
});

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
          role: "user",
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
        role: isAdmin ? "admin" : "user",
      };
    }),
    apiPatchMe: vi.fn(async () => true),
    apiForgePurchase: vi.fn(async (_token: string, item_slug: string) => ({
      ok: true as const,
      data: { at_balance: 180, item_slug },
    })),
    apiListFriends: vi.fn(async () => [...friendApiFixture.friends]),
    apiListFriendRequests: vi.fn(async () => ({
      incoming: [...friendApiFixture.incoming],
      outgoing: [...friendApiFixture.outgoing],
    })),
    apiSendFriendRequest: vi.fn(async (_t: string, user_id: string, message?: string | null) => {
      const username =
        user_id === "user-003"
          ? "ShadowKill3r"
          : user_id === "user-002"
            ? "WingmanPro"
            : `user-${user_id}`;
      const arena_id =
        user_id === "user-003" ? "ARENA-SK0003" : user_id === "user-002" ? "ARENA-WP0002" : "ARENA-X";
      friendApiFixture.outgoing.push({
        request_id: `req-${user_id}-${friendApiFixture.outgoing.length}`,
        user_id,
        username,
        arena_id,
        avatar: null,
        message: message ?? null,
        created_at: new Date().toISOString(),
      });
      return { ok: true as const };
    }),
    apiAcceptFriendRequest: vi.fn(async () => ({ ok: true as const })),
    apiRejectFriendRequest: vi.fn(async () => ({ ok: true as const })),
    apiRemoveFriend: vi.fn(async () => ({ ok: true as const })),
    apiBlockUser: vi.fn(async () => ({ ok: true as const })),
    apiChangePassword: vi.fn(async () => ({ ok: true as const })),
    apiListMatchesOpen: vi.fn(async () => []),
    apiListMatchesHistory: vi.fn(async () => []),
    apiGetAtPackages: vi.fn(async () => ({
      packages: [
        { at_amount: 500, usdt_price: 5, discount_pct: 0, final_price: 5 },
        { at_amount: 1000, usdt_price: 10, discount_pct: 5, final_price: 9.5 },
        { at_amount: 2500, usdt_price: 25, discount_pct: 5, final_price: 23.75 },
        { at_amount: 5000, usdt_price: 50, discount_pct: 10, final_price: 45 },
      ],
    })),
    apiBuyAtPackage: vi.fn(async () => ({
      ok: true as const,
      at_balance: 5200,
      at_credited: 1000,
      usdt_spent: 9.5,
      discount_pct: 5,
    })),
    apiGetLeaderboard: vi.fn(async (opts?: { game?: string; limit?: number; range?: string }) => {
      const { LEADERBOARD_GLOBAL_TEST, LEADERBOARD_BY_GAME_TEST } =
        await import("@/test/leaderboardTestFixture");
      const g = opts?.game;
      if (!g) return [...LEADERBOARD_GLOBAL_TEST];
      return [...(LEADERBOARD_BY_GAME_TEST[g] ?? [])];
    }),
    apiSearchPlayers: vi.fn(async (_token: string | null, q: string, game?: string) => {
      const { PLAYER_SEARCH_FIXTURE } = await import("@/test/playerStoreFixture");
      const ql = (q ?? "").trim().toLowerCase();
      return PLAYER_SEARCH_FIXTURE.filter((p) => {
        if (game && p.preferredGame !== game) return false;
        if (!ql) return true;
        return p.username.toLowerCase().includes(ql) || p.arenaId.toLowerCase().includes(ql);
      }).map((p) => ({ ...p }));
    }),
    apiGetPublicPlayer: vi.fn(async (userId: string) => {
      const { PLAYER_SEARCH_FIXTURE } = await import("@/test/playerStoreFixture");
      const hit = PLAYER_SEARCH_FIXTURE.find((p) => p.id === userId);
      return hit ? { ...hit } : null;
    }),
    apiListInbox: vi.fn(async () => {
      const { INBOX_HUB_TEST_FIXTURE } = await import("@/test/inboxTestFixture");
      return INBOX_HUB_TEST_FIXTURE.map((m) => ({ ...m }));
    }),
    apiGetInboxUnreadCount: vi.fn(async () => 1),
    apiPostInbox: vi.fn(async () => ({
      ok: true as const,
      id: "inb-new",
      sender_id: "user-001",
      receiver_id: "user-002",
      subject: "Test",
      created_at: new Date().toISOString(),
    })),
    apiPatchInboxRead: vi.fn(async () => true),
    apiPatchInboxReadAll: vi.fn(async () => true),
    apiDeleteInbox: vi.fn(async () => true),
    apiAdminListSupportTicketAttachments: vi.fn(async () => []),
    apiGetAttachmentBlob: vi.fn(async () => new Blob([], { type: "image/png" })),
    apiDeleteAttachment: vi.fn(async () => true),
    apiPostSupportTicketAttachment: vi.fn(async () => ({
      ok: true as const,
      id: "att-1",
      filename: "t.png",
      content_type: "image/png",
      file_size: 4,
    })),
    apiVerifySteam: vi.fn(async () => ({ valid: true, unique: true, verified_by: "format" })),
    apiVerifyRiot: vi.fn(async () => ({ valid: true, unique: true, verified_by: "format" })),
    apiVerifyDiscord: vi.fn(async () => ({ valid: true, verified_by: "format" })),
    apiDeleteMyAccount: vi.fn(async () => ({ ok: true as const })),
    apiPatchUserSettings: vi.fn(async (_t: string, region: string) => ({ ok: true as const, region })),
    apiAuth2faSetup: vi.fn(async () => ({ ok: true as const, secret: "SECRETTEST", qr_uri: "otpauth://totp/X" })),
    apiAuth2faVerify: vi.fn(async () => ({ ok: true as const })),
    apiAuth2faDisable: vi.fn(async () => ({ ok: true as const })),
    apiAuth2faConfirm: vi.fn(async () => ({
      access_token: "token-user",
      user_id: "user-001",
      username: "ArenaPlayer_01",
      email: "player@arena.gg",
      arena_id: "ARENA-AP0001",
      wallet_address: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
    })),
    apiGetUnreadCount: vi.fn(async () => ({ count: 0 })),
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
