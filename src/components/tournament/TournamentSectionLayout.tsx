import type { ReactNode } from "react";
import { ArenaGlobalStarfield, ArenaPageShell } from "@/components/visual";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

/**
 * Standalone public section for /tournaments (no AppLayout — guests can read).
 * Visual stack matches **Forge** route: same `ArenaPageShell variant="forge"` decor + HUD frame.
 */
export function TournamentSectionLayout({
  children,
  backTo = "/tournaments",
  backLabel = "Tournaments",
}: {
  children: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <ArenaGlobalStarfield className="fixed inset-0 z-0" />
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.06] motion-reduce:opacity-[0.02] [background:repeating-linear-gradient(0deg,transparent,transparent_2px,hsl(0_0%_0%/0.4)_2px,hsl(0_0%_0%/0.4)_3px)] mix-blend-multiply"
        aria-hidden
      />
      <div className="relative z-[2] mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 flex items-center gap-2 font-hud text-[10px] uppercase tracking-[0.3em] text-arena-cyan/70">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-arena-cyan"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
          <span className="text-border">/</span>
          <span className="text-arena-cyan/60">TOURNAMENTS</span>
        </div>
        <div
          className="arena-hud-legal-frame overflow-hidden rounded-sm border border-arena-cyan/20 bg-gradient-to-b from-card/30 via-card/10 to-background/20 shadow-[0_0_60px_-24px_hsl(var(--arena-cyan)/0.35),inset_0_1px_0_hsl(0_0%_100%/0.04)]"
        >
          <div className="p-5 sm:p-8">
            <ArenaPageShell variant="forge" className="min-h-0" contentClassName="space-y-8">
              {children}
            </ArenaPageShell>
          </div>
        </div>
      </div>
    </div>
  );
}
