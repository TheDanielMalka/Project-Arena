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
      const now = Date.now();
      // Keep local-only matches, but drop stale active matches the server no longer reports
      // (i.e. auto-cancelled by the server CRON before they were in history)
      const locals = s.matches.filter((m) => {
        if (serverIds.has(m.id)) return false;
        if (m.status === "waiting" || m.status === "in_progress") {
          const age = now - new Date(m.createdAt).getTime();
          if (age > 3 * 60 * 1000) return false; // drop stale active match
        }
        return true;
      });
      // Merge: list payload may include player_count without roster arrays — then drop stale local roster.
      const merged = serverList.map((srv) => {
        const existing = s.matches.find((m) => m.id === srv.id);
        if (!existing) return srv;

        const srvRosterEmpty =
          srv.players.length === 0 &&
          (srv.teamA?.length ?? 0) === 0 &&
          (srv.teamB?.length ?? 0) === 0;
        const serverGaveCount = typeof srv.filledPlayerCount === "number";

        const existingNames = [...(existing.teamA ?? []), ...(existing.teamB ?? []), ...existing.players]
          .filter((x, i, arr) => !!x && arr.indexOf(x) === i);

        const rosterFromServer = (() => {
          // Server list row has count-only. Keep existing known names stable and trim by the new count,
          // so the UI doesn't flicker between username and "In lobby". When count decreases, this also
          // removes stale names beyond the new count.
          if (srvRosterEmpty && serverGaveCount) {
            const maxPerSide = srv.maxPerTeam ?? srv.teamSize ?? existing.maxPerTeam ?? existing.teamSize ?? 5;
            const total = Math.max(0, Math.min(srv.filledPlayerCount ?? 0, maxPerSide * 2));
            const kept = existingNames.slice(0, total);
            return {
              players: [] as string[],
              teamA: kept.slice(0, maxPerSide),
              teamB: kept.slice(maxPerSide, maxPerSide * 2),
            };
          }
          return {
            players: (srv.players.length > 0) ? srv.players : existing.players,
            teamA:
              ((srv.teamA?.length ?? 0) > 0) ? srv.teamA! : existing.teamA ?? [],
            teamB:
              ((srv.teamB?.length ?? 0) > 0) ? srv.teamB! : existing.teamB ?? [],
          };
        })();

        return {
          ...existing,
          ...srv,
          ...rosterFromServer,
          filledPlayerCount:
            srv.filledPlayerCount ?? existing.filledPlayerCount,
          expiresAt:          existing.expiresAt,
          lockCountdownStart: existing.lockCountdownStart,
          password:           existing.password,
          hasPassword:
            srv.hasPassword !== undefined ? srv.hasPassword : existing.hasPassword,
          depositsReceived:   existing.depositsReceived,
        };
      });
      return { matches: [...merged, ...locals] };
    });
  },
}));
