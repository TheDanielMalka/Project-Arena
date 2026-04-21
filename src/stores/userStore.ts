import { create } from "zustand";
import type {
  UserProfile,
  UserProfilePatch,
  ForgeCategory,
  ShopEntitlement,
  UserRole,
  UserSettingsRegion,
} from "@/types";
import { setPendingClientSetupAfterSignup } from "@/lib/localArenaPrefs";
import {
  apiAuth2faConfirm,
  apiAuthGoogle,
  apiGetMe,
  apiLogin,
  apiPatchMe,
  apiRegister,
  type ApiLoginSuccess,
  type RegisterConflictField,
} from "@/lib/engine-api";
import {
  hydrateWalletForgeAfterAuth,
  resetWalletForgeForLogout,
} from "@/lib/sessionAtSync";
import {
  clearStoredAccessToken,
  readStoredAccessToken,
  writeStoredAccessToken,
} from "@/lib/authStorage";

export type SignupResult =
  | { ok: true }
  | { ok: false; status?: number; detail?: string; field?: RegisterConflictField | null };

interface UserState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  /** True after first `restoreSession` completes, or after login/signup/logout (avoids auth flash before hydration). */
  authHydrated: boolean;
  walletConnected: boolean;
  showLoginGreeting: boolean;
  greetingType: "login" | "signup" | "google" | null;
  // DB-ready: replace with POST /api/auth/login
  login: (
    email: string,
    password: string,
  ) => Promise<boolean | "rate_limited" | { needs_2fa: true; temp_token: string }>;
  /** After login returned needs_2fa — POST /auth/2fa/confirm then same hydration as login */
  completeTwoFactorLogin: (temp_token: string, code: string) => Promise<boolean>;
  signup: (
    username: string,
    email: string,
    password: string,
    opts?: { steamId?: string; riotId?: string },
  ) => Promise<SignupResult>;
  /** POST /auth/google with Google Identity id_token — same hydration as login */
  loginWithGoogleIdToken: (
    idToken: string,
  ) => Promise<boolean | "rate_limited" | { needs_2fa: true; temp_token: string }>;
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

/** Role comes exclusively from GET /auth/me; server is the source of truth. */
function roleFromApi(apiRole: string | undefined): UserRole {
  if (apiRole === "admin" || apiRole === "moderator" || apiRole === "user") {
    return apiRole;
  }
  return "user";
}

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

function scheduleSocialSyncAfterAuth() {
  if (import.meta.env.VITEST) return;
  void import("@/stores/friendStore").then((m) => m.syncFriendsFromServer());
}

type MeProfile = NonNullable<Awaited<ReturnType<typeof apiGetMe>>>;

const ME_REGIONS = new Set<string>(["EU", "NA", "ASIA", "SA", "OCE", "ME"]);

function regionFromMe(raw: string | null | undefined): UserSettingsRegion | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const u = raw.trim().toUpperCase();
  return ME_REGIONS.has(u) ? (u as UserSettingsRegion) : undefined;
}

function userProfileFromMe(profile: MeProfile): UserProfile {
  const normalizedEmail = profile.email.trim().toLowerCase();
  const wallet = profile.wallet_address ?? null;
  const wins = profile.wins ?? 0;
  const losses = profile.losses ?? 0;
  return {
    id: profile.user_id,
    role: roleFromApi(profile.role),
    username: profile.username,
    email: normalizedEmail,
    steamId: profile.steam_id?.trim() || null,
    riotId: profile.riot_id?.trim() || null,
    walletAddress: wallet,
    walletShort: wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "",
    rank: profile.rank?.trim() || "—",
    tier: "",
    verified: true,
    avatarInitials: profile.username.slice(0, 2).toUpperCase(),
    preferredGame: "CS2",
    arenaId: profile.arena_id ?? "",
    memberSince: "—",
    status: "active",
    avatar: profile.avatar ?? "initials",
    avatarBg: profile.avatar_bg ?? "default",
    equippedBadgeIcon: profile.equipped_badge_icon ?? undefined,
    unlockedForgeItemIds: profile.forge_unlocked_item_ids ?? [],
    vipExpiresAt: profile.vip_expires_at ?? undefined,
    stats: {
      matches: wins + losses,
      wins,
      losses,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
      totalEarnings: 0,
      inEscrow: 0,
      xp: profile.xp ?? 0,
    },
    balance: { total: 0, available: 0, inEscrow: 0 },
    atBalance: profile.at_balance,
    region: regionFromMe(profile.region ?? undefined),
    twoFactorEnabled: !!profile.two_factor_enabled,
    authProvider: profile.auth_provider === "google" ? "google" : "email",
    steamVerified: !!profile.steam_verified,
    riotVerified: !!profile.riot_verified,
    country: profile.country ?? null,
  };
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  authHydrated: false,
  walletConnected: false,
  showLoginGreeting: false,
  greetingType: null,

  login: async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    if (!data) return false;
    if ("_rate_limited" in data) return "rate_limited";
    if ("requires_2fa" in data && data.requires_2fa) {
      return { needs_2fa: true as const, temp_token: data.temp_token };
    }
    const creds = data as ApiLoginSuccess;
    const profile = await apiGetMe(creds.access_token);
    if (!profile) return false;

    const user = userProfileFromMe(profile);

    writeStoredAccessToken(creds.access_token);
    set({
      user,
      token: creds.access_token,
      isAuthenticated: true,
      authHydrated: true,
      walletConnected: !!user.walletAddress,
      showLoginGreeting: true,
      greetingType: "login",
    });
    hydrateWalletForgeAfterAuth(user);
    scheduleSyncForgePurchasesToProfile();
    scheduleSocialSyncAfterAuth();
    return true;
  },

  completeTwoFactorLogin: async (temp_token: string, code: string) => {
    const data = await apiAuth2faConfirm(temp_token, code);
    if (!data?.access_token) return false;
    const profile = await apiGetMe(data.access_token);
    if (!profile) return false;
    const user = userProfileFromMe(profile);
    writeStoredAccessToken(data.access_token);
    set({
      user,
      token: data.access_token,
      isAuthenticated: true,
      authHydrated: true,
      walletConnected: !!user.walletAddress,
      showLoginGreeting: true,
      greetingType: "login",
    });
    hydrateWalletForgeAfterAuth(user);
    scheduleSyncForgePurchasesToProfile();
    scheduleSocialSyncAfterAuth();
    return true;
  },

  signup: async (
    username: string,
    email: string,
    password: string,
    _opts?: { steamId?: string; riotId?: string },
  ): Promise<SignupResult> => {
    const reg = await apiRegister(username, email, password, {});
    if (reg.ok === false) {
      return {
        ok: false as const,
        status: reg.status,
        detail: reg.detail ?? undefined,
        field: reg.field,
      };
    }
    const data = reg.data;
    const profile = await apiGetMe(data.access_token);

    if (!profile) {
      return { ok: false as const, detail: "Could not load profile after signup.", field: null };
    }

    const user = userProfileFromMe(profile);
    const merged: UserProfile = {
      ...user,
      username: data.username,
      email: data.email.trim().toLowerCase(),
      avatarInitials: data.username.slice(0, 2).toUpperCase(),
      arenaId: data.arena_id ?? profile.arena_id ?? user.arenaId,
    };

    writeStoredAccessToken(data.access_token);
    set({
      user: merged,
      token: data.access_token,
      isAuthenticated: true,
      authHydrated: true,
      walletConnected: !!merged.walletAddress,
      showLoginGreeting: true,
      greetingType: "signup",
    });
    hydrateWalletForgeAfterAuth(merged);
    setPendingClientSetupAfterSignup();
    scheduleSyncForgePurchasesToProfile();
    scheduleSocialSyncAfterAuth();
    return { ok: true as const };
  },

  loginWithGoogleIdToken: async (idToken: string) => {
    const data = await apiAuthGoogle(idToken);
    if (!data) return false;
    if ("_rate_limited" in data) return "rate_limited";
    if ("requires_2fa" in data && data.requires_2fa) {
      return { needs_2fa: true as const, temp_token: data.temp_token };
    }
    const creds = data as ApiLoginSuccess;
    const profile = await apiGetMe(creds.access_token);
    if (!profile) return false;

    const user = userProfileFromMe(profile);

    writeStoredAccessToken(creds.access_token);
    set({
      user,
      token: creds.access_token,
      isAuthenticated: true,
      authHydrated: true,
      walletConnected: !!user.walletAddress,
      showLoginGreeting: true,
      greetingType: "google",
    });
    hydrateWalletForgeAfterAuth(user);
    scheduleSyncForgePurchasesToProfile();
    scheduleSocialSyncAfterAuth();
    return true;
  },

  logout: () => {
    clearStoredAccessToken();
    resetWalletForgeForLogout();
    void import("@/stores/friendStore").then((m) => m.useFriendStore.getState().resetSocialLocal());
    void import("@/stores/messageStore").then((m) => m.useMessageStore.getState().resetConversationsLocal());
    void import("@/stores/inboxStore").then((m) => m.useInboxStore.getState().resetInboxLocal());
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      authHydrated: true,
      walletConnected: false,
      showLoginGreeting: false,
      greetingType: null,
    });
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
      role: roleFromApi(profile.role),
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
        matches: wins + losses,
        wins,
        losses,
        winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        xp: profile.xp ?? user.stats.xp,
      },
      atBalance: profile.at_balance,
      region: regionFromMe(profile.region ?? undefined) ?? user.region,
      twoFactorEnabled: profile.two_factor_enabled ?? user.twoFactorEnabled,
      authProvider: profile.auth_provider === "google" ? "google" : "email",
      steamVerified: !!profile.steam_verified,
      riotVerified: !!profile.riot_verified,
    };
    set({ user: next, walletConnected: !!w });
    hydrateWalletForgeAfterAuth(next);
  },

  restoreSession: async (): Promise<void> => {
    const raw = readStoredAccessToken();
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) {
      set({ authHydrated: true });
      return;
    }
    const profile = await apiGetMe(trimmed);
    if (!profile) {
      clearStoredAccessToken();
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        walletConnected: false,
        authHydrated: true,
        showLoginGreeting: false,
        greetingType: null,
      });
      return;
    }
    const user = userProfileFromMe(profile);
    set({
      user,
      token: trimmed,
      isAuthenticated: true,
      authHydrated: true,
      walletConnected: !!user.walletAddress,
      showLoginGreeting: false,
      greetingType: null,
    });
    hydrateWalletForgeAfterAuth(user);
    scheduleSyncForgePurchasesToProfile();
    scheduleSocialSyncAfterAuth();
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
