import { notifyAuth401 } from "@/lib/authSession";
import type { TournamentSeason } from "@/types";
import { ENGINE_BASE } from "@/lib/engine-api";

async function userFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${ENGINE_BASE}${path}`, { ...init, headers });
  if (res.status === 401) notifyAuth401();
  return res;
}

export async function fetchTournamentSeasons(): Promise<TournamentSeason[]> {
  const res = await fetch(`${ENGINE_BASE}/tournaments/seasons`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { seasons: TournamentSeason[] };
  return data.seasons ?? [];
}

export async function fetchTournamentSeason(slug: string): Promise<TournamentSeason | null> {
  const res = await fetch(`${ENGINE_BASE}/tournaments/seasons/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { season: TournamentSeason };
  return data.season ?? null;
}

export type PlayerDetail = {
  ign: string;
  steamId?: string;
  country?: string;
  email?: string;
};

export type TeamEntry = {
  mode: string;
  divisionTitle: string;
  registrationId: string;
  teamLabel: string;
  status: string;
  registeredAt: string | null;
  captain: string;
  players: { slot: number; ign: string; steamId?: string; country?: string }[];
};

export async function fetchTournamentTeams(slug: string): Promise<TeamEntry[]> {
  const res = await fetch(
    `${ENGINE_BASE}/tournaments/seasons/${encodeURIComponent(slug)}/teams`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { teams: TeamEntry[] };
  return data.teams ?? [];
}

export type RegisterTournamentBody = {
  divisionId: string;
  teamLabel?: string | null;
  ackArenaClient: boolean;
  ackTestnet: boolean;
  ackCs2: boolean;
  wantsDemoAt: boolean;
  metWalletConnected: boolean;
  players?: PlayerDetail[];
};

export async function registerTournament(
  token: string,
  slug: string,
  body: RegisterTournamentBody,
): Promise<{ ok: boolean; status: string; error?: string }> {
  const res = await userFetch(`/tournaments/seasons/${encodeURIComponent(slug)}/register`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      division_id: body.divisionId,
      team_label: body.teamLabel ?? null,
      ack_arena_client: body.ackArenaClient,
      ack_testnet: body.ackTestnet,
      ack_cs2_ownership: body.ackCs2,
      wants_demo_at: body.wantsDemoAt,
      met_wallet_connected: body.metWalletConnected,
      players: (body.players ?? []).map((p) => ({
        ign: p.ign,
        steam_id: p.steamId ?? null,
        country: p.country ?? null,
        email: p.email ?? null,
      })),
    }),
  });
  if (res.status === 409) {
    return { ok: false, status: "duplicate", error: "Already registered in this division." };
  }
  if (!res.ok) {
    let msg = "Registration failed";
    try {
      const j = (await res.json()) as { detail?: string | unknown };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* ignore */
    }
    return { ok: false, status: "error", error: msg };
  }
  const data = (await res.json()) as { ok: boolean; status: string };
  return { ok: true, status: data.status };
}

export async function fetchMyTournamentRegs(token: string): Promise<
  { id: string; seasonSlug: string; mode: string; divisionTitle: string; status: string; seasonTitle: string }[]
> {
  const res = await userFetch("/tournaments/me", token);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    registrations: {
      id: string;
      seasonSlug: string;
      mode: string;
      divisionTitle: string;
      status: string;
      seasonTitle: string;
    }[];
  };
  return data.registrations ?? [];
}
