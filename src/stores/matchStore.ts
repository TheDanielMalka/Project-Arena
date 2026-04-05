import { create } from "zustand";
import type { Match, Game, MatchStatus } from "@/types";
import { apiListMatchesHistory, apiListMatchesOpen } from "@/lib/engine-api";

interface MatchState {
  matches: Match[];

  /**
   * The match ID the current user is actively hosting or joined — persisted
   * in Zustand so it survives React navigation (unlike useState which resets
   * on component unmount). This is the source of truth for "am I in a room".
   */
  activeRoomId: string | null;
  setActiveRoomId: (id: string | null) => void;

  // DB-ready: replace with POST /api/matches — pass `id` when server returned match UUID
  addMatch: (match: Omit<Match, "id" | "createdAt"> & { id?: string }) => Match;
  // DB-ready: replace with POST /api/matches/:id/join
  joinMatch: (matchId: string, playerId: string, team?: "A" | "B") => boolean;
  // DB-ready: replace with PATCH /api/matches/:id/status
  updateMatchStatus: (matchId: string, status: MatchStatus, winnerId?: string) => void;
  // DB-ready: replace with GET /api/matches/by-code/:code
  getMatchByCode: (code: string) => Match | undefined;
  // DB-ready: replace with DELETE /api/matches/:id/players/:userId (refunds escrow client-side)
  leaveMatch: (matchId: string, playerId: string) => boolean;

  // DB-ready: replace with DELETE /api/matches/:id
  // Contract: ArenaEscrow.cancelMatch(onChainMatchId) — MatchState.WAITING only.
  // Emits MatchCancelled → server creates 'refund' tx for all deposited players.
  deleteMatch: (matchId: string) => void;

  // DB-ready: server-side CRON runs every 30s: UPDATE matches SET status='cancelled' WHERE status='waiting' AND expires_at < NOW()
  // Contract: timeout fallback — any player calls ArenaEscrow.claimRefund() after 2h on-chain timeout
  expireOldMatches: () => string[];  // returns array of expired matchIds

  /** GET /matches + GET /matches/history — merges server rows; keeps optimistic local-only matches. */
  refreshMatchesFromServer: (token: string | null) => Promise<void>;
}

let matchCounter = 100;

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "ARENA-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const useMatchStore = create<MatchState>((set, get) => ({
  matches: [],
  activeRoomId: null,
  setActiveRoomId: (id) => set({ activeRoomId: id }),

  addMatch: (matchData) => {
    const { id: presetId, ...rest } = matchData;
    const id =
      typeof presetId === "string" && presetId.trim().length > 0
        ? presetId.trim()
        : `m-${++matchCounter}`;

    // Idempotent: if a match with this ID already exists, update it in-place
    // rather than prepending a duplicate entry (important for lobby persistence
    // useEffect which fires on every remount when myRoomMatchId is null).
    const existing = get().matches.find((m) => m.id === id);
    if (existing) {
      const updated: Match = {
        ...existing,
        ...rest,
        id,
        // Never overwrite a real server code with a locally-generated one
        code: rest.code ?? existing.code,
      };
      set((state) => ({
        matches: state.matches.map((m) => (m.id === id ? updated : m)),
      }));
      return updated;
    }

    const newMatch: Match = {
      ...rest,
      id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      // Use server-provided code when available; generate one only for new custom rooms
      code: rest.code ?? (rest.type === "custom" ? generateCode() : undefined),
    };
    set((state) => ({ matches: [newMatch, ...state.matches] }));
    return newMatch;
  },

  joinMatch: (matchId, playerId, team) => {
    const match = get().matches.find((m) => m.id === matchId);
    if (!match || match.status !== "waiting") return false;

    // Prevent a player from joining twice
    const alreadyInA = (match.teamA ?? []).includes(playerId);
    const alreadyInB = (match.teamB ?? []).includes(playerId);
    if (alreadyInA || alreadyInB || match.players.includes(playerId)) return false;

    if (match.type === "custom" && team) {
      const teamKey    = team === "A" ? "teamA" : "teamB";
      const currentTeam = match[teamKey] ?? [];
      const maxPerTeam  = match.maxPerTeam ?? match.teamSize ?? 5;
      if (currentTeam.length >= maxPerTeam) return false;

      const updatedTeam = [...currentTeam, playerId];
      const newTeamA    = teamKey === "teamA" ? updatedTeam : (match.teamA ?? []);
      const newTeamB    = teamKey === "teamB" ? updatedTeam : (match.teamB ?? []);
      const deposited      = (match.depositsReceived ?? 0) + 1;
      const totalNeeded    = (match.teamSize ?? maxPerTeam) * 2;
      const roomNowFull    = deposited >= totalNeeded;
      // Room full → start 10s countdown (UI calls updateMatchStatus after 10s)
      const lockCountdownStart = roomNowFull ? new Date().toISOString() : undefined;

      set((state) => ({
        matches: state.matches.map((m) =>
          m.id === matchId
            ? {
                ...m,
                [teamKey]: updatedTeam,
                teamA: newTeamA,
                teamB: newTeamB,
                depositsReceived: deposited,
                status: "waiting",  // stays waiting — UI triggers in_progress after countdown
                ...(lockCountdownStart ? { lockCountdownStart } : {}),
              }
            : m
        ),
      }));
      return true;
    }

    // Public match — simple player list
    if (match.players.length >= match.maxPlayers) return false;
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId ? { ...m, players: [...m.players, playerId] } : m
      ),
    }));
    return true;
  },

  updateMatchStatus: (matchId, status, winnerId) => {
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId
          ? {
              ...m,
              status,
              ...(winnerId !== undefined ? { winnerId } : {}),
              ...(status === "in_progress" ? { startedAt: new Date().toISOString() } : {}),
              ...(status === "completed" ? { endedAt: new Date().toISOString() } : {}),
            }
          : m
      ),
    }));
  },

  getMatchByCode: (code) => get().matches.find((m) => m.code === code),

  leaveMatch: (matchId, playerId) => {
    const match = get().matches.find((m) => m.id === matchId);
    // Can only leave a waiting room (not yet locked)
    if (!match || match.status !== "waiting") return false;

    if (match.type === "custom") {
      const inA = (match.teamA ?? []).includes(playerId);
      const inB = (match.teamB ?? []).includes(playerId);
      // Fallback: after navigation rehydration, teamA/B may be empty but players[] has IDs
      const inPlayers = match.players.includes(playerId);
      if (!inA && !inB && !inPlayers) return false;

      const newTeamA = inA ? (match.teamA ?? []).filter((p) => p !== playerId) : (match.teamA ?? []);
      const newTeamB = inB ? (match.teamB ?? []).filter((p) => p !== playerId) : (match.teamB ?? []);
      const newDeposits = Math.max(0, (match.depositsReceived ?? 0) - 1);

      set((state) => ({
        matches: state.matches.map((m) =>
          m.id === matchId
            ? {
                ...m,
                teamA: newTeamA,
                teamB: newTeamB,
                players: m.players.filter((p) => p !== playerId),
                depositsReceived: newDeposits,
                lockCountdownStart: undefined,  // room no longer full
              }
            : m
        ),
      }));
      return true;
    }

    // Public match — remove from players list
    if (!match.players.includes(playerId)) return false;
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId
          ? {
              ...m,
              players: m.players.filter((p) => p !== playerId),
              lockCountdownStart: undefined,
            }
          : m
      ),
    }));
    return true;
  },

  deleteMatch: (matchId) => {
    // DB-ready: DELETE /api/matches/:id — server first calls ArenaEscrow.cancelMatch() to refund all depositors
    set((state) => ({
      matches: state.matches.filter((m) => m.id !== matchId),
    }));
  },

  expireOldMatches: () => {
    // DB-ready: server CRON: UPDATE matches SET status='cancelled' WHERE status='waiting' AND expires_at < NOW()
    // Only matches with an explicit expiresAt (set by addMatch) are eligible — seed data never expires.
    const now = Date.now();
    const expiredIds: string[] = [];
    set((state) => ({
      matches: state.matches.map((m) => {
        if (m.status !== "waiting") return m;
        if (!m.expiresAt) return m;                                    // seed / legacy rows — never auto-expire
        if (new Date(m.expiresAt).getTime() > now) return m;           // not yet expired
        expiredIds.push(m.id);
        return { ...m, status: "cancelled" as MatchStatus };
      }),
    }));
    return expiredIds;
  },

  refreshMatchesFromServer: async (token) => {
    const open = (await apiListMatchesOpen(token)) ?? [];
    const hist = token ? (await apiListMatchesHistory(token)) ?? [] : [];
    const byId = new Map<string, Match>();
    for (const m of open) byId.set(m.id, m);
    for (const m of hist) byId.set(m.id, m);
    const serverList = [...byId.values()];
    set((s) => {
      const serverIds = new Set(serverList.map((m) => m.id));
      // Keep local-only matches (created but not yet on server, or filtered out)
      const locals = s.matches.filter((m) => !serverIds.has(m.id));
      // Merge: list_matches returns player_count only — no individual player UUIDs.
      // If the existing store entry has richer player data (from get_active_match),
      // preserve it so the room panel doesn't lose its roster after a refresh poll.
      const merged = serverList.map((srv) => {
        const existing = s.matches.find((m) => m.id === srv.id);
        if (!existing) return srv;
        return {
          ...srv,
          players:  srv.players.length  > 0 ? srv.players  : existing.players,
          teamA:   (srv.teamA?.length   ?? 0) > 0 ? srv.teamA  : existing.teamA,
          teamB:   (srv.teamB?.length   ?? 0) > 0 ? srv.teamB  : existing.teamB,
        };
      });
      return { matches: [...merged, ...locals] };
    });
  },
}));
