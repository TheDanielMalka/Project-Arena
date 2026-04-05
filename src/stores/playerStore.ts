import { create } from "zustand";
import type { PublicPlayerProfile } from "@/types";
import { apiGetPublicPlayer, apiSearchPlayers } from "@/lib/engine-api";

function mergePlayers(
  existing: PublicPlayerProfile[],
  add: PublicPlayerProfile[],
): PublicPlayerProfile[] {
  const map = new Map(existing.map((p) => [p.id, p]));
  for (const p of add) map.set(p.id, p);
  return [...map.values()];
}

interface PlayerState {
  /** Cached profiles from search + GET /players/{id} (popover / roster). */
  players: PublicPlayerProfile[];

  /** GET /players?q=&game= — requires Bearer; updates cache. */
  searchPlayers: (
    query: string,
    gameFilter?: string,
    token?: string | null,
  ) => Promise<PublicPlayerProfile[]>;

  getPlayerByUsername: (username: string) => PublicPlayerProfile | undefined;

  fetchPublicPlayerByUsername: (
    username: string,
    token: string | null,
  ) => Promise<PublicPlayerProfile | null>;

  fetchPublicPlayerById: (
    userId: string,
    token: string | null,
  ) => Promise<PublicPlayerProfile | null>;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  players: [],

  searchPlayers: async (query, gameFilter, token) => {
    if (!token) return [];
    const list = await apiSearchPlayers(token, query.trim(), gameFilter);
    set((s) => ({ players: mergePlayers(s.players, list) }));
    return list;
  },

  getPlayerByUsername: (username) =>
    get().players.find((p) => p.username.toLowerCase() === username.toLowerCase()),

  fetchPublicPlayerByUsername: async (username, token) => {
    if (!token) return null;
    const q = username.trim();
    const list = await apiSearchPlayers(token, q, undefined);
    const exact = list.find((p) => p.username.toLowerCase() === q.toLowerCase());
    if (exact) set((s) => ({ players: mergePlayers(s.players, [exact]) }));
    return exact ?? null;
  },

  fetchPublicPlayerById: async (userId, token) => {
    const p = await apiGetPublicPlayer(userId, token ?? null);
    if (p) set((s) => ({ players: mergePlayers(s.players, [p]) }));
    return p;
  },
}));
