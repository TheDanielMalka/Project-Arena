import { create } from "zustand";
import type { UserProfile } from "@/types";

interface UserState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  walletConnected: boolean;
  showLoginGreeting: boolean;
  greetingType: "login" | "signup" | "google" | null;
  login: (email: string, password: string) => boolean;
  signup: (username: string, email: string, password: string, steamId?: string) => boolean;
  loginWithGoogle: () => void;
  logout: () => void;
  connectWallet: () => void;
  disconnectWallet: () => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  clearLoginGreeting: () => void;
}

const MOCK_USER: UserProfile = {
  id: "user-001",
  role: "user",
  username: "ArenaPlayer_01",
  email: "player@arena.gg",
  steamId: "76561198XXXXXXXX",
  walletAddress: "0x7a3F9c2E1b8D4a5C6f7e8d9B0c1A2b3C4d5E6f7A",
  walletShort: "0x7a3...6f7A",
  rank: "Gold III",
  tier: "Gold",
  verified: true,
  avatarInitials: "AP",
  preferredGame: "CS2",
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
};

const ADMIN_EMAILS = new Set(["admin@arena.gg"]);

export const useUserStore = create<UserState>((set) => ({
  user: null,
  isAuthenticated: false,
  walletConnected: false,
  showLoginGreeting: false,
  greetingType: null,

  login: (email: string, _password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const user: UserProfile = {
      ...MOCK_USER,
      email: normalizedEmail,
      role: ADMIN_EMAILS.has(normalizedEmail) ? "admin" : "user",
    };
    set({ user, isAuthenticated: true, walletConnected: true, showLoginGreeting: true, greetingType: "login" });
    return true;
  },

  signup: (username: string, email: string, _password: string, steamId?: string) => {
    const initials = username.slice(0, 2).toUpperCase();
    const user: UserProfile = {
      ...MOCK_USER,
      role: "user",
      username,
      email,
      steamId: steamId || "",
      avatarInitials: initials,
      stats: { matches: 0, wins: 0, losses: 0, winRate: 0, totalEarnings: 0, inEscrow: 0, xp: 0 },
      balance: { total: 0, available: 0, inEscrow: 0 },
    };
    set({ user, isAuthenticated: true, walletConnected: false, showLoginGreeting: true, greetingType: "signup" });
    return true;
  },

  loginWithGoogle: () => {
    set({ user: { ...MOCK_USER, role: "user" }, isAuthenticated: true, walletConnected: true, showLoginGreeting: true, greetingType: "google" });
  },

  logout: () => set({ user: null, isAuthenticated: false, walletConnected: false, showLoginGreeting: false, greetingType: null }),

  clearLoginGreeting: () => set({ showLoginGreeting: false, greetingType: null }),

  connectWallet: () => set({ walletConnected: true }),

  disconnectWallet: () => set({ walletConnected: false }),

  updateProfile: (updates) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),
}));
