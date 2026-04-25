import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  fetchTournamentSeason,
  registerTournament,
  fetchTournamentTeams,
} from "@/lib/tournament-api";
import type { PlayerDetail, TeamEntry } from "@/lib/tournament-api";
import type { TournamentSeason, TournamentDivision } from "@/types";
import { useUserStore } from "@/stores/userStore";
import { useWalletStore } from "@/stores/walletStore";
import { cn } from "@/lib/utils";
import {
  Crown,
  Users,
  X,
  Loader2,
  Trophy,
  Shield,
  Zap,
  ChevronRight,
  Wallet,
  CheckCircle2,
  Flag,
  User,
  Hash,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerSlot = { ign: string; steamId: string; country: string; email: string };

type ActiveReg = {
  div: TournamentDivision;
  teamName: string;
  players: PlayerSlot[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slotsForMode(mode: string): number {
  if (mode === "5v5") return 5;
  if (mode === "2v2") return 2;
  return 1;
}

const emptySlot = (): PlayerSlot => ({ ign: "", steamId: "", country: "", email: "" });

// ── Static fallback ───────────────────────────────────────────────────────────

const FALLBACK: TournamentSeason = {
  id: "local",
  slug: "cs2-arena-open-2026",
  title: "Arena CS2 Open — System Test",
  subtitle: "5v5 · 2v2 · 1v1 · Testnet",
  game: "CS2",
  networkPhase: "testnet",
  state: "registration_open",
  warmUpMinutes: 30,
  registrationOpensAt: null,
  registrationClosesAt: null,
  mainStartsAt: null,
  testDisclaimerMd:
    "**Test event.** Prizes in ILS; payouts follow operator treasury / escrow when the testnet contract is live.",
  futureRewardsMd:
    "Early participants may be eligible for future in-app rewards if Arena ships.",
  marketingBlurbMd: "**Run the client. Run the chain. Run the book.**",
  divisions: [
    {
      id: "div-5v5",
      mode: "5v5",
      title: "Grand Bracket",
      position: 0,
      prize1Ils: 5000,
      prize2Ils: 3000,
      prize3Ils: 2000,
      formatMarkdown:
        "16 team slots · Single elimination · every round **BO3** — Grand final **BO5**.",
      maxSlots: 16,
      isTeamMode: true,
      registeredCount: 0,
    },
    {
      id: "div-2v2",
      mode: "2v2",
      title: "Wingman Bracket",
      position: 1,
      prize1Ils: 1500,
      prize2Ils: 750,
      prize3Ils: 250,
      formatMarkdown: "Knockout · **BO3** series.",
      maxSlots: 32,
      isTeamMode: true,
      registeredCount: 0,
    },
    {
      id: "div-1v1",
      mode: "1v1",
      title: "Duel Bracket",
      position: 2,
      prize1Ils: 1500,
      prize2Ils: 750,
      prize3Ils: 250,
      formatMarkdown: "Duel bracket · **BO3**; final **BO5**.",
      maxSlots: 32,
      isTeamMode: false,
      registeredCount: 0,
    },
  ],
};

// ── Division card ─────────────────────────────────────────────────────────────

function DivisionCard({
  d,
  rank,
  onRegister,
  isActive,
}: {
  d: TournamentDivision;
  rank: number;
  onRegister: (d: TournamentDivision) => void;
  isActive: boolean;
}) {
  const pct = Math.min(100, ((d.registeredCount ?? 0) / d.maxSlots) * 100);
  const isFull = (d.registeredCount ?? 0) >= d.maxSlots;

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-sm border transition-all duration-200",
        isActive
          ? "border-arena-cyan/60 shadow-[0_0_32px_-8px_hsl(var(--arena-cyan)/0.35)]"
          : "border-arena-cyan/20 hover:border-arena-cyan/35",
        "bg-gradient-to-b from-card/80 via-card/40 to-background/10",
      )}
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-cyan/30 to-transparent" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Mode badge + prize crown */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <span className="font-hud text-[9px] uppercase tracking-[0.4em] text-muted-foreground/60">
              Division {String(rank).padStart(2, "0")}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-2xl font-bold text-arena-cyan">{d.mode}</span>
              <span className="font-hud text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {d.title}
              </span>
            </div>
          </div>
          <Crown className="h-5 w-5 shrink-0 text-amber-400/70" />
        </div>

        {/* Prizes */}
        <ul className="space-y-0.5 font-mono text-xs">
          <li className="flex items-center gap-2">
            <span className="font-hud text-[8px] text-amber-400/80">1ST</span>
            <span className="text-foreground/90">₪ {d.prize1Ils.toLocaleString()}</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="font-hud text-[8px] text-muted-foreground/60">2ND</span>
            <span className="text-muted-foreground">₪ {d.prize2Ils.toLocaleString()}</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="font-hud text-[8px] text-muted-foreground/40">3RD</span>
            <span className="text-muted-foreground/70">₪ {d.prize3Ils.toLocaleString()}</span>
          </li>
        </ul>

        {/* Format */}
        {d.formatMarkdown && (
          <div className="text-[10px] leading-relaxed text-muted-foreground/70 [&_p]:m-0 [&_strong]:text-foreground/80">
            <ReactMarkdown>{d.formatMarkdown}</ReactMarkdown>
          </div>
        )}

        {/* Slot progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between font-hud text-[9px] uppercase tracking-wider text-muted-foreground/60">
            <span>Slots</span>
            <span className={cn(isFull ? "text-red-400/80" : "text-arena-cyan/70")}>
              {d.registeredCount ?? 0} / {d.maxSlots}
            </span>
          </div>
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={cn(
                "h-full transition-all duration-700",
                isFull ? "bg-red-500/60" : "bg-arena-cyan/60",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Register button */}
        <button
          onClick={() => onRegister(d)}
          disabled={isFull}
          className={cn(
            "mt-auto w-full border py-2 font-hud text-[10px] uppercase tracking-[0.3em] transition-all duration-200",
            isActive
              ? "border-arena-cyan/60 bg-arena-cyan/10 text-arena-cyan"
              : isFull
              ? "cursor-not-allowed border-muted-foreground/15 text-muted-foreground/40"
              : "border-arena-cyan/30 text-arena-cyan/80 hover:border-arena-cyan/60 hover:bg-arena-cyan/[0.06]",
          )}
        >
          {isFull ? "Full" : isActive ? "Cancel" : `Register · ${d.mode}`}
        </button>
      </div>
    </div>
  );
}

// ── Player slot row ───────────────────────────────────────────────────────────

function PlayerRow({
  index,
  slot,
  isTeamMode,
  onChange,
}: {
  index: number;
  slot: PlayerSlot;
  isTeamMode: boolean;
  onChange: (s: PlayerSlot) => void;
}) {
  const label = index === 0 ? "Captain" : `Player ${index + 1}`;
  return (
    <div className="space-y-2 rounded-sm border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 font-hud text-[9px] uppercase tracking-[0.35em] text-arena-cyan/60">
        <Hash className="h-3 w-3" />
        {String(index + 1).padStart(2, "0")} — {label}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="font-hud text-[8px] uppercase tracking-wider text-muted-foreground/50">
            IGN *
          </label>
          <input
            value={slot.ign}
            onChange={(e) => onChange({ ...slot, ign: e.target.value })}
            placeholder="In-game name"
            className="w-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-arena-cyan/40 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="font-hud text-[8px] uppercase tracking-wider text-muted-foreground/50">
            Steam ID 64 *
          </label>
          <input
            value={slot.steamId}
            onChange={(e) => onChange({ ...slot, steamId: e.target.value })}
            placeholder="76561198..."
            className="w-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-arena-cyan/40 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="font-hud text-[8px] uppercase tracking-wider text-muted-foreground/50">
            Country
          </label>
          <input
            value={slot.country}
            onChange={(e) => onChange({ ...slot, country: e.target.value })}
            placeholder="IL / US / DE …"
            className="w-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-arena-cyan/40 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="font-hud text-[8px] uppercase tracking-wider text-muted-foreground/50">
            {index === 0 ? "Contact Email" : "Email (optional)"}
          </label>
          <input
            value={slot.email}
            onChange={(e) => onChange({ ...slot, email: e.target.value })}
            type="email"
            placeholder="player@mail.com"
            className="w-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-arena-cyan/40 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

// ── Teams board ───────────────────────────────────────────────────────────────

function TeamsBoard({
  teams,
  divisions,
}: {
  teams: TeamEntry[];
  divisions: TournamentDivision[];
}) {
  if (teams.length === 0) {
    return (
      <div className="border border-white/5 bg-white/[0.01] p-6 text-center font-hud text-[10px] uppercase tracking-[0.35em] text-muted-foreground/40">
        No registrations yet — be first.
      </div>
    );
  }

  const byMode = divisions.map((d) => ({
    div: d,
    entries: teams.filter((t) => t.mode === d.mode),
  }));

  return (
    <div className="space-y-6">
      {byMode.map(({ div, entries }) => (
        <div key={div.id} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-display text-base font-bold text-arena-cyan">{div.mode}</span>
            <span className="font-hud text-[9px] uppercase tracking-wider text-muted-foreground/50">
              {div.title}
            </span>
            <div className="ml-auto font-hud text-[9px] text-muted-foreground/50">
              {entries.length} / {div.maxSlots}
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="font-hud text-[9px] uppercase tracking-wider text-muted-foreground/30 pl-1">
              No entries yet
            </p>
          ) : (
            <div className="space-y-1.5">
              {entries.map((t, idx) => (
                <div
                  key={t.registrationId}
                  className="flex flex-col gap-2 border border-white/5 bg-white/[0.025] p-3 sm:flex-row sm:items-start"
                >
                  {/* Index + team name */}
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <span className="font-hud text-[10px] text-muted-foreground/40">
                      #{String(idx + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="font-hud text-[11px] font-bold uppercase tracking-wider text-foreground/90">
                        {t.teamLabel}
                      </p>
                      <p className="font-hud text-[8px] uppercase tracking-wider text-muted-foreground/40">
                        Captain: {t.captain}
                      </p>
                    </div>
                  </div>

                  {/* Player IGNs */}
                  {t.players.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {t.players.map((p) => (
                        <span
                          key={p.slot}
                          className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70"
                        >
                          <User className="h-2.5 w-2.5 text-arena-cyan/40" />
                          {p.ign}
                          {p.country && (
                            <span className="font-hud text-[8px] text-muted-foreground/40">
                              {p.country}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Status + date */}
                  <div className="ml-auto shrink-0 text-right">
                    <span
                      className={cn(
                        "font-hud text-[8px] uppercase tracking-wider",
                        t.status === "confirmed" ? "text-emerald-400/70" : "text-amber-400/70",
                      )}
                    >
                      {t.status}
                    </span>
                    {t.registeredAt && (
                      <p className="font-hud text-[8px] text-muted-foreground/30">
                        {new Date(t.registeredAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TournamentSeasonPage() {
  const { slug } = useParams<{ slug: string }>();
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);
  const wConnected = useWalletStore((s) => s.connectedAddress !== null);

  const [season, setSeason] = useState<TournamentSeason | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<TeamEntry[]>([]);

  // Acks (shared across divisions)
  const [ackClient, setAckClient] = useState(false);
  const [ackTest, setAckTest] = useState(false);
  const [ackCs2, setAckCs2] = useState(false);
  const [wantsDemo, setWantsDemo] = useState(false);

  // Active registration form
  const [activeReg, setActiveReg] = useState<ActiveReg | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadSeason = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const s = await fetchTournamentSeason(slug);
    setSeason(s ?? { ...FALLBACK, slug });
    setLoading(false);
  }, [slug]);

  const loadTeams = useCallback(async () => {
    if (!slug) return;
    const t = await fetchTournamentTeams(slug);
    setTeams(t);
  }, [slug]);

  useEffect(() => {
    void loadSeason();
    void loadTeams();
  }, [loadSeason, loadTeams]);

  const openReg = (div: TournamentDivision) => {
    if (activeReg?.div.id === div.id) {
      setActiveReg(null);
      return;
    }
    const n = slotsForMode(div.mode);
    const slots: PlayerSlot[] = Array.from({ length: n }, (_, i) =>
      i === 0
        ? {
            ign: user?.username ?? "",
            steamId: user?.steamId ?? "",
            country: "",
            email: user?.email ?? "",
          }
        : emptySlot(),
    );
    setActiveReg({ div, teamName: "", players: slots });
  };

  const updatePlayer = (index: number, slot: PlayerSlot) => {
    if (!activeReg) return;
    const updated = [...activeReg.players];
    updated[index] = slot;
    setActiveReg({ ...activeReg, players: updated });
  };

  const onSubmit = async () => {
    if (!activeReg || !token) {
      toast.error("Log in to register");
      return;
    }
    if (!ackClient || !ackTest || !ackCs2) {
      toast.error("Check all required acknowledgements");
      return;
    }
    const validPlayers = activeReg.players.filter((p) => p.ign.trim().length > 0);
    if (activeReg.div.isTeamMode && validPlayers.length < slotsForMode(activeReg.div.mode)) {
      toast.error(`Fill in all ${slotsForMode(activeReg.div.mode)} player IGNs`);
      return;
    }

    setSubmitting(true);
    const players: PlayerDetail[] = validPlayers.map((p) => ({
      ign: p.ign.trim(),
      steamId: p.steamId.trim() || undefined,
      country: p.country.trim() || undefined,
      email: p.email.trim() || undefined,
    }));

    const r = await registerTournament(token, season!.slug, {
      divisionId: activeReg.div.id,
      teamLabel: activeReg.div.isTeamMode ? activeReg.teamName.trim() || undefined : undefined,
      ackArenaClient: ackClient,
      ackTestnet: ackTest,
      ackCs2,
      wantsDemoAt: wantsDemo,
      metWalletConnected: wConnected,
      players,
    });
    setSubmitting(false);

    if (r.ok) {
      toast.success(r.status === "waitlist" ? "Added to waitlist!" : "Registration confirmed!");
      setActiveReg(null);
      void loadSeason();
      void loadTeams();
    } else {
      toast.error(r.error ?? "Registration failed");
    }
  };

  if (loading || !season) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Trophy className="h-8 w-8 animate-pulse text-arena-cyan/40" />
        <p className="font-hud text-[10px] uppercase tracking-[0.5em] text-muted-foreground/50">
          Loading event…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* ── Hero header ── */}
      <header className="relative space-y-4 border-b border-arena-cyan/10 pb-8">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-arena-cyan/[0.04] via-transparent to-transparent" />
        <div className="flex flex-wrap items-center gap-2 font-hud text-[9px] uppercase tracking-[0.4em]">
          <Link to="/tournaments" className="text-muted-foreground/50 hover:text-arena-cyan/70 transition-colors">
            Tournaments
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
          <span className="text-arena-cyan/70">{season.networkPhase}</span>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          {season.title}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{season.subtitle}</p>

        <div className="flex flex-wrap gap-2 pt-1 font-hud text-[8px] uppercase tracking-[0.35em]">
          <span className="border border-arena-cyan/20 bg-arena-cyan/[0.04] px-2 py-1 text-arena-cyan/70">
            {season.networkPhase}
          </span>
          <span
            className={cn(
              "border px-2 py-1",
              season.state === "registration_open"
                ? "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-400/70"
                : "border-muted-foreground/15 text-muted-foreground/40",
            )}
          >
            {season.state.replace(/_/g, " ")}
          </span>
          {season.warmUpMinutes ? (
            <span className="border border-white/10 px-2 py-1 text-muted-foreground/40">
              warm-up {season.warmUpMinutes}m
            </span>
          ) : null}
        </div>
      </header>

      {/* ── Test disclaimer ── */}
      {season.testDisclaimerMd && (
        <section className="flex gap-3 rounded-sm border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/70" />
          <div className="prose prose-invert prose-sm max-w-none text-amber-100/80 [&_strong]:text-amber-300">
            <ReactMarkdown>{season.testDisclaimerMd}</ReactMarkdown>
          </div>
        </section>
      )}

      {/* ── Division cards ── */}
      <section className="space-y-4">
        <h2 className="font-hud text-[10px] uppercase tracking-[0.4em] text-muted-foreground/70">
          Prize divisions
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {season.divisions.map((d, i) => (
            <DivisionCard
              key={d.id}
              d={d}
              rank={i + 1}
              onRegister={openReg}
              isActive={activeReg?.div.id === d.id}
            />
          ))}
        </div>
      </section>

      {/* ── Registration form ── */}
      {activeReg && (
        <section className="space-y-6 rounded-sm border border-arena-cyan/30 bg-gradient-to-b from-arena-cyan/[0.04] to-transparent p-5 shadow-[0_0_48px_-16px_hsl(var(--arena-cyan)/0.2)]">
          {/* Form header */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="font-hud text-[9px] uppercase tracking-[0.4em] text-arena-cyan/60">
                Registration
              </p>
              <h3 className="font-display text-xl font-bold text-foreground">
                {activeReg.div.mode} — {activeReg.div.title}
              </h3>
            </div>
            <button
              onClick={() => setActiveReg(null)}
              className="border border-white/10 p-1.5 text-muted-foreground/50 hover:border-white/20 hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Steam gate */}
          {!user?.steamId && (
            <div className="flex items-center gap-2 rounded-sm border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-xs text-amber-300/80">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              Link your Steam ID in{" "}
              <Link to="/settings" className="underline underline-offset-2">
                Settings
              </Link>{" "}
              before registering.
            </div>
          )}

          {/* Team name (team modes only) */}
          {activeReg.div.isTeamMode && (
            <div className="space-y-1.5">
              <label className="font-hud text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
                Team name
              </label>
              <input
                value={activeReg.teamName}
                onChange={(e) => setActiveReg({ ...activeReg, teamName: e.target.value })}
                placeholder="Squad name for brackets"
                maxLength={64}
                className="w-full max-w-sm border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-arena-cyan/40 focus:outline-none"
              />
            </div>
          )}

          {/* Player roster */}
          <div className="space-y-3">
            <p className="font-hud text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
              Player roster — {slotsForMode(activeReg.div.mode)} slot
              {slotsForMode(activeReg.div.mode) > 1 ? "s" : ""}
            </p>
            {activeReg.players.map((slot, i) => (
              <PlayerRow
                key={i}
                index={i}
                slot={slot}
                isTeamMode={activeReg.div.isTeamMode}
                onChange={(s) => updatePlayer(i, s)}
              />
            ))}
          </div>

          {/* Acknowledgements */}
          <div className="space-y-2 border-t border-white/5 pt-4">
            <p className="font-hud text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
              Acknowledgements
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={ackClient} onCheckedChange={(v) => setAckClient(!!v)} className="mt-0.5" />
              <span className="text-foreground/80">
                I will run the Arena desktop client and keep heartbeats active during matches
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={ackTest} onCheckedChange={(v) => setAckTest(!!v)} className="mt-0.5" />
              <span className="text-foreground/80">
                This is a testnet / system test — rules and schedules may change
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={ackCs2} onCheckedChange={(v) => setAckCs2(!!v)} className="mt-0.5" />
              <span className="text-foreground/80">
                I own CS2 on the Steam account linked to my Arena profile
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted-foreground/60">
              <Checkbox checked={wantsDemo} onCheckedChange={(v) => setWantsDemo(!!v)} className="mt-0.5" />
              <span>Request test / demo USDT / AT tokens (operator grants manually)</span>
            </label>

            <div className="flex items-center gap-2 pt-1 font-hud text-[9px] uppercase tracking-wider text-muted-foreground/50">
              <Wallet className="h-3 w-3" /> Wallet:{" "}
              {wConnected ? (
                <span className="text-arena-cyan/70">connected</span>
              ) : (
                <Link to="/wallet" className="text-amber-400/70 hover:text-amber-400 transition-colors">
                  not connected · /wallet
                </Link>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={() => void onSubmit()}
            disabled={submitting || !token || !user?.steamId}
            className={cn(
              "flex w-full items-center justify-center gap-2 border py-3 font-hud text-[11px] uppercase tracking-[0.35em] transition-all duration-200",
              submitting || !token || !user?.steamId
                ? "cursor-not-allowed border-muted-foreground/15 text-muted-foreground/30"
                : "border-arena-cyan/50 bg-arena-cyan/[0.08] text-arena-cyan hover:border-arena-cyan hover:bg-arena-cyan/[0.15]",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" /> Confirm Registration
              </>
            )}
          </button>
        </section>
      )}

      {/* ── Future rewards ── */}
      {season.futureRewardsMd && (
        <section className="prose prose-invert prose-sm max-w-none text-muted-foreground">
          <ReactMarkdown>{season.futureRewardsMd}</ReactMarkdown>
        </section>
      )}

      {/* ── Registered teams board ── */}
      <section className="space-y-5 border-t border-arena-cyan/10 pt-8">
        <div className="flex items-center gap-3">
          <Users className="h-4 w-4 text-arena-cyan/60" />
          <h2 className="font-hud text-[10px] uppercase tracking-[0.4em] text-foreground/80">
            Registered Teams
          </h2>
          <span className="ml-auto font-hud text-[9px] text-muted-foreground/40">
            {teams.length} total
          </span>
          <button
            onClick={() => void loadTeams()}
            className="font-hud text-[8px] uppercase tracking-wider text-arena-cyan/50 hover:text-arena-cyan/80 transition-colors"
          >
            Refresh
          </button>
        </div>
        <TeamsBoard teams={teams} divisions={season.divisions} />
      </section>
    </div>
  );
}
