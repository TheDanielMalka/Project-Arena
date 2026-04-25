import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowRight, Radio, Swords } from "lucide-react";
import { fetchTournamentSeasons } from "@/lib/tournament-api";
import type { TournamentSeason } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const FALLBACK_SLUG = "cs2-arena-open-2026";

/** Public hub — /tournaments — lists seasons (or deep-link card when API offline). */
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
    <div className="space-y-8">
      <header className="space-y-3 text-center sm:text-left">
        <p className="font-hud text-[10px] uppercase tracking-[0.4em] text-arena-cyan/70">
          Standalone event sector
        </p>
        <h1 className="font-display text-2xl font-bold tracking-wide text-foreground sm:text-3xl md:text-4xl">
          Tournaments
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          CS2 open brackets, on-platform registration, and testnet escrows. Events live on their own URLs
          (like <code className="text-xs text-arena-cyan/80">/legal/terms</code>
          <span className="mx-1 text-muted-foreground/40">·</span>
          separate from the app shell list above).
        </p>
      </header>

      {err && !hasApi && (
        <div
          className="rounded-sm border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200/90"
          role="status"
        >
          <strong>Engine data offline.</strong> The featured card still links to the season page; wire{" "}
          <code className="text-xs">/tournaments</code> API on the server when you are ready.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(hasApi ? rows! : [null]).map((row, i) => (
          <div
            key={row?.id ?? `fallback-${i}`}
            className={cn(
              "group relative overflow-hidden rounded-sm border border-arena-cyan/25",
              "bg-gradient-to-br from-primary/[0.08] via-card/40 to-background/30",
              "p-5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04),0_20px_50px_-32px_hsl(0_0%_0%/0.5)]",
            )}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-arena-cyan/10 blur-2xl" />
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <span className="font-hud text-[9px] uppercase tracking-[0.35em] text-muted-foreground/80">
                  {(row?.networkPhase ?? "testnet").toUpperCase()}
                </span>
                <h2 className="font-display text-lg font-bold text-foreground sm:text-xl">
                  {row?.title ?? "Arena CS2 Open — System Test (Testnet)"}
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {row?.subtitle ??
                    "5v5 · 2v2 · 1v1 — ILS prize table · client + site + testnet flow"}
                </p>
              </div>
              <Trophy className="h-10 w-10 shrink-0 text-arena-cyan/50" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 font-hud text-[9px] uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 border border-arena-cyan/20 bg-black/20 px-2 py-1">
                <Swords className="h-3 w-3 text-arena-cyan" /> CS2
              </span>
              <span className="inline-flex items-center gap-1.5 border border-arena-cyan/20 bg-black/20 px-2 py-1">
                <Radio className="h-3 w-3 text-arena-cyan" />
                {row?.state ?? "registration_open"}
              </span>
            </div>
            <div className="mt-5">
              <Button
                asChild
                className="w-full font-hud text-[10px] uppercase tracking-[0.2em] sm:w-auto"
              >
                <Link
                  to={`/tournaments/${row?.slug ?? FALLBACK_SLUG}`}
                  className="inline-flex items-center justify-center gap-2"
                >
                  Open event brief
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
