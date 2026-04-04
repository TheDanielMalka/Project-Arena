import { create } from "zustand";
import type { UserProfile, UserProfilePatch, ForgeCategory, ShopEntitlement } from "@/types";
import { setPendingClientSetupAfterSignup } from "@/lib/localArenaPrefs";
import {
  apiGetMe,
  apiLogin,
  apiPatchMe,
  apiRegister,
  type RegisterConflictField,
} from "@/lib/engine-api";
import {
  hydrateWalletForgeAfterAuth,
  resetWalletForgeForLogout,
} from "@/lib/sessionAtSync";

export type SignupResult =
  | { ok: true }
  | { ok: false; detail?: string; field?: RegisterConflictField | null };

interface UserState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  walletConnected: boolean;
  showLoginGreeting: boolean;
  greetingType: "login" | "signup" | "google" | null;
  // DB-ready: replace with POST /api/auth/login
  login: (email: string, password: string) => Promise<boolean>;
  // DB-ready: replace with POST /api/auth/signup
  signup: (
    username: string,
    email: string,
    password: string,
    gameAccounts?: { steamId?: string; riotId?: string },
  ) => Promise<SignupResult>;
  // DB-ready: replace with POST /api/auth/google (OAuth)
  loginWithGoogle: () => void;
  // DB-ready: replace with POST /api/auth/logout
  logout: () => void;
  /** Restore session from localStorage token (Phase 3). */
  restoreSession: () => Promise<void>;
  /** After server changes AT — call GET /auth/me again (no POST body yet). */
  refreshProfileFromServer: () => Promise<void>;
  // DB-ready: replace with POST /api/wallet/connect
  connectWallet: () => void;
  /** Clear profile wallet fields locally (after PATCH unlink or when not persisting). */
  unlinkWalletFromProfile: () => void;
  /** After MetaMask link + PATCH success — keep user.* in sync with chain address. */
  setLinkedWalletAddress: (address: string) => void;
  // DB-ready: replace with POST /api/wallet/disconnect
  disconnectWallet: () => void;
  // DB-ready: PATCH /api/users/me — persist identity row (avatar, avatar_bg, equipped_badge_icon, forge_unlocked_item_ids, …)
  updateProfile: (updates: UserProfilePatch) => void;
  /** DB-ready: POST /api/forge/purchase response — append forge_unlocked_item_ids; for badge also set equipped_badge_icon to purchased icon (auto-equip) */
  applyForgePurchase: (payload: { itemId: string; category: ForgeCategory; icon: string }) => void;
  /** DB-ready: POST /api/forge/drops/:id/purchase — timed grants (VIP days, boost stacks) */
  applyDropPurchaseEffects: (dropId: string) => void;
  /** Client mirror of DB TTL cleanup — call on app tick / GET /users/me normalization */
  pruneExpiredShopEntitlements: () => void;
  clearLoginGreeting: () => void;
}

const MOCK_USER: UserProfile = {
  id: "user-001",
  role: "user",
  username: "ArenaPlayer_01",
  email: "player@arena.gg",
  steamId: "76561198XXXXXXXX",
  riotId: null,
  walletAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
  walletShort: "0x7a3...6f7A",
  rank: "Gold III",
  tier: "Gold",
  verified: true,
  avatarInitials: "AP",
  preferredGame: "CS2",
  arenaId: "ARENA-AP0001",
  memberSince: "March 2026",
  status: "active",
  avatar: "initials",
  avatarBg: "default",
  stats: {
    matches: 147,
    wins: 94,
    losses: 53,
    winRate: 64.2,
    totalEarnings: 2847,
    inEscrow: 50,
    xp: 840,
  },
  balance: {
    total: 7248.20,
    available: 7198.20,
    inEscrow: 50,
  },
  atBalance: 200,
};

const ADMIN_EMAILS = new Set(["admin@arena.gg"]);

function extendVipExpiresAt(currentIso: string | undefined, days: number): string {
  const now = Date.now();
  const base = currentIso ? Math.max(now, new Date(currentIso).getTime()) : now;
  return new Date(base + days * 864e5).toISOString();
}

function appendBoostHours(user: UserProfile, itemId: string, label: string, hours: number): UserProfile {
  const list: ShopEntitlement[] = [...(user.shopEntitlements ?? [])];
  const expiresAt = new Date(Date.now() + hours * 3600e3).toISOString();
  list.push({ itemId, kind: "boost", label, expiresAt });
  return { ...user, shopEntitlements: list };
}

function grantEliteBundle(user: UserProfile): UserProfile {
  let next: UserProfile = { ...user };
  const keys = new Set(next.unlockedForgeItemIds ?? []);
  keys.add("item-012");
  keys.add("item-006");
  next.unlockedForgeItemIds = [...keys];
  next.equippedBadgeIcon = "badge:champions";
  next.vipExpiresAt = extendVipExpiresAt(next.vipExpiresAt, 30);
  for (let i = 0; i < 3; i++) {
    next = appendBoostHours(next, "item-008", "Double XP (24h)", 24);
  }
  return next;
}

function scheduleSyncForgePurchasesToProfile() {
  void import("@/stores/forgeStore").then((m) => m.syncForgePurchasesToUserProfile());
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  walletConnected: false,
  showLoginGreeting: false,
  greetingType: null,

  login: async (email: string, password: string): Promise<boolean> => {
    const data = await apiLogin(email, password);
    if (!data) return false;
    const profile = await apiGetMe(data.access_token);
    if (!profile) return false;

    const normalizedEmail = data.email.trim().toLowerCase();
    const wallet = data.wallet_address ?? profile.wallet_address ?? null;
    const wins = profile.wins ?? 0;
    const losses = profile.losses ?? 0;

    const user: UserProfile = {
      id: data.user_id,
      role: ADMIN_EMAILS.has(normalizedEmail) ? "admin" : "user",
      username: data.username,
      email: normalizedEmail,
      steamId: profile.steam_id?.trim() || null,
      riotId: profile.riot_id?.trim() || null,
      walletAddress: wallet,
      walletShort: wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "",
      rank: profile.rank?.trim() || "—",
      tier: "",
      verified: true,
      avatarInitials: data.username.slice(0, 2).toUpperCase(),
      preferredGame: "CS2",
      arenaId: data.arena_id ?? profile.arena_id ?? "",
      memberSince: "—",
      status: "active",
      avatar: profile.avatar ?? "initials",
      avatarBg: profile.avatar_bg ?? "default",
      equippedBadgeIcon: profile.equipped_badge_icon ?? undefined,
      unlockedForgeItemIds: profile.forge_unlocked_item_ids ?? [],
      vipExpiresAt: profile.vip_expires_at ?? undefined,
      stats: {
        matches: 0,
        wins,
        losses,
        winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        totalEarnings: 0,
        inEscrow: 0,
        xp: profile.xp ?? 0,
      },
      balance: { total: 0, available: 0, inEscrow: 0 },
      atBalance: profile.at_balance,
    };

    set({
      user,
      token: data.access_token,
      isAuthenticated: true,
      walletConnected: !!wallet,
      showLoginGreeting: true,
      greetingType: "login",
    });
    hydrateWalletForgeAfterAuth(user);
    scheduleSyncForgePurchasesToProfile();
    return true;
  },

  signup: async (
    username: string,
    email: string,
    password: string,
    gameAccounts?: { steamId?: string; riotId?: string },
  ): Promise<SignupResult> => {
    const reg = await apiRegister(username, email, password, {
      steam_id: gameAccounts?.steamId?.trim() || null,
      riot_id: gameAccounts?.riotId?.trim() || null,
    });
    if (reg.ok === false) {
      return {
        ok: false as const,
        detail: reg.detail ?? undefined,
        field: reg.field,
      };
    }
    const data = reg.data;
    const profile = await apiGetMe(data.access_token);

    const initials = data.username.slice(0, 2).toUpperCase();
    const normalizedEmail = data.email.trim().toLowerCase();
    const wallet = profile?.wallet_address ?? data.wallet_address ?? null;
    const wins = profile?.wins ?? 0;
    const losses = profile?.losses ?? 0;

    const user: UserProfile = {
      id: data.user_id,
      role: "user",
      username: data.username,
      email: normalizedEmail,
      arenaId: data.arena_id ?? profile?.arena_id ?? "",
      walletAddress: wallet,
      walletShort: wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "",
      steamId: gameAccounts?.steamId?.trim() || profile?.steam_id?.trim() || null,
      riotId: gameAccounts?.riotId?.trim() || profile?.riot_id?.trim() || null,
      avatarInitials: initials,
      rank: profile?.rank?.trim() || "—",
      tier: "",
      verified: true,
      preferredGame: "CS2",
      memberSince: "—",
      status: "active",
      avatar: profile?.avatar ?? "initials",
      avatarBg: profile?.avatar_bg ?? "default",
      equippedBadgeIcon: profile?.equipped_badge_icon ?? undefined,
      unlockedForgeItemIds: profile?.forge_unlocked_item_ids ?? [],
      vipExpiresAt: profile?.vip_expires_at ?? undefined,
      stats: {
        matches: 0,
        wins,
        losses,
        winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        totalEarnings: 0,
        inEscrow: 0,
        xp: profile?.xp ?? 0,
      },
      balance: { total: 0, available: 0, inEscrow: 0 },
      atBalance: profile?.at_balance ?? 0,
    };

    set({
      user,
      token: data.access_token,
      isAuthenticated: true,
      walletConnected: !!wallet,
      showLoginGreeting: true,
      greetingType: "signup",
    });
    hydrateWalletForgeAfterAuth(user);
    setPendingClientSetupAfterSignup();
    scheduleSyncForgePurchasesToProfile();
    return { ok: true as const };
  },

  loginWithGoogle: () => {
    const u: UserProfile = { ...MOCK_USER, role: "user" };
    set({ user: u, isAuthenticated: true, walletConnected: true, showLoginGreeting: true, greetingType: "google" });
    hydrateWalletForgeAfterAuth(u);
    scheduleSyncForgePurchasesToProfile();
  },

  logout: () => {
    resetWalletForgeForLogout();
    set({ user: null, token: null, isAuthenticated: false, walletConnected: false, showLoginGreeting: false, greetingType: null });
  },

  refreshProfileFromServer: async () => {
    const { token, user } = get();
    if (!token || !user) return;
    const profile = await apiGetMe(token);
    if (!profile) return;
    const wins = profile.wins ?? 0;
    const losses = profile.losses ?? 0;
    const w = profile.wallet_address ?? null;
    const next: UserProfile = {
      ...user,
      username: profile.username,
      steamId: profile.steam_id?.trim() || null,
      riotId: profile.riot_id?.trim() || null,
      walletAddress: w,
      walletShort: w ? `${w.slice(0, 6)}...${w.slice(-4)}` : "",
      rank: profile.rank?.trim() || user.rank,
      avatar: profile.avatar ?? user.avatar,
      avatarBg: profile.avatar_bg ?? user.avatarBg,
      equippedBadgeIcon: profile.equipped_badge_icon ?? user.equippedBadgeIcon,
      unlockedForgeItemIds: profile.forge_unlocked_item_ids ?? user.unlockedForgeItemIds,
      vipExpiresAt: profile.vip_expires_at ?? user.vipExpiresAt,
      stats: {
        ...user.stats,
        wins,
        losses,
        winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        xp: profile.xp ?? user.stats.xp,
      },
      atBalance: profile.at_balance,
    };
    set({ user: next, walletConnected: !!w });
    hydrateWalletForgeAfterAuth(next);
  },

  restoreSession: async (): Promise<void> => {
    // Temporarily disabled: do not persist login between refreshes.
    // Kept for backward-compat callers/tests.
    return;
  },

  clearLoginGreeting: () => set({ showLoginGreeting: false, greetingType: null }),

  connectWallet: () => set({ walletConnected: true }),

  unlinkWalletFromProfile: () =>
    set((state) => {
      if (!state.user) return { walletConnected: false };
      return {
        walletConnected: false,
        user: {
          ...state.user,
          walletAddress: null,
          walletShort: "",
        },
      };
    }),

  setLinkedWalletAddress: (address: string) => {
    const trimmed = address.trim();
    set((state) => {
      if (!state.user) return { walletConnected: !!trimmed };
      return {
        walletConnected: true,
        user: {
          ...state.user,
          walletAddress: trimmed,
          walletShort:
            trimmed.length >= 10
              ? `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
              : trimmed,
        },
      };
    });
  },

  disconnectWallet: () => {
    get().unlinkWalletFromProfile();
  },

  updateProfile: (updates) => {
    set((state) => {
      if (!state.user) return { user: null };
      const u = state.user;
      const { stats: statsPatch, ...restPatch } = updates;
      const next: UserProfile = { ...u, ...restPatch };
      if (statsPatch !== undefined) {
        next.stats = { ...u.stats, ...statsPatch };
      }
      return { user: next };
    });

    const { token } = get();
    if (!token || !updates) return;

    const patch: Parameters<typeof apiPatchMe>[1] = {};
    if ("avatar" in updates) patch.avatar = updates.avatar ?? null;
    if ("avatarBg" in updates) patch.avatar_bg = updates.avatarBg ?? null;
    if ("equippedBadgeIcon" in updates) patch.equipped_badge_icon = updates.equippedBadgeIcon ?? null;
    if ("unlockedForgeItemIds" in updates) patch.forge_unlocked_item_ids = updates.unlockedForgeItemIds ?? [];
    if ("steamId" in updates && updates.steamId !== undefined) {
      const s = updates.steamId;
      patch.steam_id = s === null || s === "" ? null : s.trim();
    }
    if ("riotId" in updates && updates.riotId !== undefined) {
      const r = updates.riotId;
      patch.riot_id = r === null || r === "" ? null : r.trim();
    }
    if ("username" in updates && updates.username !== undefined) patch.username = updates.username;

    if (Object.keys(patch).length > 0) void apiPatchMe(token, patch);
  },

  applyDropPurchaseEffects: (dropId) =>
    set((state) => {
      if (!state.user) return state;
      let next: UserProfile = { ...state.user };
      if (dropId === "dr-001") {
        next.vipExpiresAt = extendVipExpiresAt(next.vipExpiresAt, 30);
      } else if (dropId === "dr-002") {
        next.vipExpiresAt = extendVipExpiresAt(next.vipExpiresAt, 7);
        for (let i = 0; i < 3; i++) {
          next = appendBoostHours(next, "item-008", "Double XP (24h)", 24);
        }
      } else if (dropId === "dr-003") {
        const keys = new Set(next.unlockedForgeItemIds ?? []);
        keys.add("item-005");
        next.unlockedForgeItemIds = [...keys];
        next.equippedBadgeIcon = "badge:founders";
        next.vipExpiresAt = extendVipExpiresAt(next.vipExpiresAt, 30);
      }
      return { user: next };
    }),

  pruneExpiredShopEntitlements: () =>
    set((state) => {
      if (!state.user) return state;
      const now = Date.now();
      const ent = (state.user.shopEntitlements ?? []).filter((e) => new Date(e.expiresAt).getTime() > now);
      let vip = state.user.vipExpiresAt;
      if (vip && new Date(vip).getTime() <= now) vip = undefined;
      if (
        ent.length === (state.user.shopEntitlements ?? []).length &&
        vip === state.user.vipExpiresAt
      ) {
        return state;
      }
      return { user: { ...state.user, shopEntitlements: ent, vipExpiresAt: vip } };
    }),

  applyForgePurchase: ({ itemId, category, icon }) =>
    set((state) => {
      if (!state.user) return state;
      const prev = state.user.unlockedForgeItemIds ?? [];
      const unlockedForgeItemIds = prev.includes(itemId) ? prev : [...prev, itemId];
      let next: UserProfile = { ...state.user, unlockedForgeItemIds };

      if (category === "bundle" && itemId === "item-012") {
        return { user: grantEliteBundle(next) };
      }

      if (category === "avatar" && icon.startsWith("preset:")) {
        next.avatar = icon;
      } else if (category === "frame" && icon.startsWith("bg:")) {
        next.avatarBg = icon.slice(3);
      } else if (category === "badge" && icon.startsWith("badge:")) {
        next.equippedBadgeIcon = icon;
      } else if (category === "vip") {
        const days = itemId === "item-010" ? 30 : itemId === "item-011" ? 7 : 0;
        if (days > 0) {
          next.vipExpiresAt = extendVipExpiresAt(next.vipExpiresAt, days);
        }
      } else if (category === "boost") {
        const hours = itemId === "item-008" ? 24 : itemId === "item-009" ? 72 : 24;
        const label = itemId === "item-008" ? "Double XP (24h)" : itemId === "item-009" ? "Win Shield (72h)" : "Boost";
        next = appendBoostHours(next, itemId, label, hours);
      }

      return { user: next };
    }),
}));
