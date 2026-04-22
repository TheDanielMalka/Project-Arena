import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/userStore";
import { ArenaLogo } from "@/components/shared/ArenaLogo";

const chip =
  "inline-flex items-center justify-center border border-arena-cyan/40 bg-gradient-to-b from-black/60 to-black/80 px-2 py-1.5 font-hud text-[7px] font-semibold uppercase tracking-[0.2em] text-arena-cyan/95 shadow-[0_0_22px_-8px_hsl(var(--arena-cyan)/0.4),inset_0_1px_0_hsl(0_0%_100%/0.07)] transition-all hover:border-primary/50 hover:text-foreground hover:shadow-[0_0_28px_-6px_hsl(var(--primary)/0.35)] sm:px-2.5 sm:text-[8px] sm:tracking-[0.24em]";

export type LandingPublicNavActive = "home" | "why" | "how";

export function LandingPublicNav({
  active,
  showMarketingLinks = true,
}: {
  active: LandingPublicNavActive;
  /** Why / How chips next to wordmark (default: visible) */
  showMarketingLinks?: boolean;
}) {
  const navigate = useNavigate();
  const isAuthed = useUserStore((s) => s.isAuthenticated);
  const goLoginOrDashboard = () => navigate(isAuthed ? "/dashboard" : "/auth");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-arena-cyan/15 bg-[hsl(220_22%_4%/0.9)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <Link to="/" className="flex min-w-0 items-center">
            <ArenaLogo variant="compact" markSize={30} />
          </Link>
          {showMarketingLinks && (
            <div className="ml-1 hidden sm:flex min-w-0 flex-wrap items-center gap-1 sm:ml-3 sm:gap-2">
              <Link
                to="/why-arena"
                className={cn(chip, active === "why" && "border-primary/55 text-primary shadow-[0_0_20px_-6px_hsl(var(--primary)/0.35)]")}
              >
                Why Arena
              </Link>
              <Link
                to="/how-to-play"
                className={cn(chip, active === "how" && "border-primary/55 text-primary shadow-[0_0_20px_-6px_hsl(var(--primary)/0.35)]")}
              >
                How to Play
              </Link>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => navigate(isAuthed ? "/dashboard" : "/auth")}
            className="px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground sm:px-2 sm:text-sm font-display tracking-wide"
          >
            {isAuthed ? "Dashboard" : "Login"}
          </button>
          <Button
            type="button"
            size="sm"
            onClick={() => navigate(isAuthed ? "/lobby" : "/auth")}
            className="glow-green font-display tracking-wider px-2.5 text-[9px] sm:px-4 sm:text-xs"
          >
            <Swords className="mr-1 h-3 w-3 sm:mr-1.5 sm:h-3.5 sm:w-3.5" /> {isAuthed ? "Match Lobby" : "Enter Arena"}
          </Button>
        </div>
      </div>
    </nav>
  );
}
