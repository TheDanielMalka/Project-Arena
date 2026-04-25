import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowRight, Radio, Swords, Users, Calendar } from "lucide-react";
import { fetchTournamentSeasons } from "@/lib/tournament-api";
import type { TournamentSeason } from "@/types";
import { cn } from "@/lib/utils";

const FALLBACK_SLUG = "cs2-arena-open-2026";

const STATE_LABEL: Record<string, string> = {
  registration_open: "Registration Open",
  warmup: "Warm-up",
  live: "Live",
  completed: "Completed",
  draft: "Draft",
};

export default function TournamentsHub() {
  const [rows, setRows] = useState<TournamentSeason[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchTournamentSeasons();
        if (s.length) setRows(s);
        else setErr(true);
      } catch {
        setErr(true);
      }
    })();
  }, []);

  const hasApi = rows && rows.length > 0;

  return (
    <div className="space-y-10">
      {/* ── Header ── */}
      <header className="relative space-y-3 border-b border-arena-cyan/10 pb-8">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-arena-cyan/[0.03] via-transparent to-transparent" />
        <p className="font-hud text-[10px] uppercase tracking-[0.5em] text-arena-cyan/60">
          Competitive Division
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Tournaments
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          On-platform CS2 brackets with live escrow, automated result detection, and
          prize distribution. Each event runs on its own registration page.
        </p>
      </header>

      {/* ── Offline banner ── */}
      {err && !hasApi && (
        <div className="flex items-start gap-3 rounded-sm border border-amber-500/25 bg-amber-500/[0.04] p-4 text-sm text-amber-200/80">
          <Radio className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <strong className="text-amber-300">Engine offline.</strong> Showing featured event — live data resumes when the API is reachable.
          </span>
        </div>
      )}

      {/* ── Season cards ── */}
      <div className="grid gap-5 md:grid-cols-2">
        {(hasApi ? rows! : [null]).map((row, i) => (
          <SeasonCard key={row?.id ?? `fallback-${i}`} row={row} />
        ))}
      </div>
    </div>
  );
}

function SeasonCard({ row }: { row: TournamentSeason | null }) {
  const title = row?.title ?? "Arena CS2 Open — System Test (Testnet)";
  const subtitle = row?.subtitle ?? "5v5 · 2v2 · 1v1 — ILS prize pool · testnet";
  const phase = row?.networkPhase ?? "testnet";
  const state = row?.state ?? "registration_open";
  const slug = row?.slug ?? FALLBACK_SLUG;
  const totalSlots = row?.divisions?.reduce((a, d) => a + (d.maxSlots ?? 0), 0) ?? 80;
  const registered = row?.divisions?.reduce((a, d) => a + (d.registeredCount ?? 0), 0) ?? 0;

  return (
    <Link
      to={`/tournaments/${slug}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-sm border border-arena-cyan/20",
        "bg-gradient-to-br from-card/90 via-card/50 to-background/20",
        "p-0 shadow-[0_0_48px_-24px_hsl(var(--arena-cyan)/0.15)]",
        "transition-all duration-300 hover:border-arena-cyan/40 hover:shadow-[0_0_64px_-16px_hsl(var(--arena-cyan)/0.25)]",
      )}
    >
      {/* Glow top strip */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-cyan/40 to-transparent" />

      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-hud text-[8px] uppercase tracking-[0.4em] px-1.5 py-0.5 border",
                  phase === "testnet"
                    ? "border-amber-500/40 text-amber-400/80 bg-amber-500/[0.06]"
                    : "border-arena-cyan/30 text-arena-cyan/70 bg-arena-cyan/[0.05]",
                )}
              >
                {phase}
              </span>
              <span
                className={cn(
                  "font-hud text-[8px] uppercase tracking-[0.3em] px-1.5 py-0.5 border",
                  state === "registration_open"
                    ? "border-emerald-500/40 text-emerald-400/80 bg-emerald-500/[0.06]"
                    : state === "live"
                    ? "border-red-500/40 text-red-400/80 bg-red-500/[0.06]"
                    : "border-muted-foreground/20 text-muted-foreground/60",
                )}
              >
                {STATE_LABEL[state] ?? state}
              </span>
            </div>
            <h2 className="font-display text-lg font-bold leading-snug text-foreground transition-colors group-hover:text-arena-cyan sm:text-xl">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Trophy className="h-9 w-9 shrink-0 text-arena-cyan/30 transition-colors group-hover:text-arena-cyan/60" />
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-3 font-hud text-[9px] uppercase tracking-wider text-muted-foreground/70">
          <span className="inline-flex items-center gap-1.5">
            <Swords className="h-3 w-3 text-arena-cyan/50" /> CS2
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3 text-arena-cyan/50" />
            {registered} / {totalSlots} registered
          </span>
          {row?.mainStartsAt && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-arena-cyan/50" />
              {new Date(row.mainStartsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>

        {/* Division pills */}
        {row?.divisions && row.divisions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {row.divisions.map((d) => (
              <span
                key={d.id}
                className="border border-arena-cyan/15 bg-arena-cyan/[0.04] px-2 py-0.5 font-hud text-[9px] uppercase tracking-wider text-arena-cyan/70"
              >
                {d.mode}
              </span>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto pt-2">
          <span className="inline-flex items-center gap-2 border border-arena-cyan/30 bg-arena-cyan/[0.06] px-4 py-2 font-hud text-[10px] uppercase tracking-[0.25em] text-arena-cyan transition-all group-hover:border-arena-cyan/60 group-hover:bg-arena-cyan/[0.12]">
            Open Event Brief
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>

      {/* Bottom glow strip */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-arena-cyan/20 to-transparent" />
    </Link>
  );
}
