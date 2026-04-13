import { Link } from "react-router-dom";
import { Download, Monitor, Swords } from "lucide-react";

/** Matches landing download CTA (Index). */
const ARENA_CLIENT_SETUP_URL =
  "https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip" as const;

/**
 * Marketing footer: Client (2 links) + Legal (3). No dashboard/lobby — those live in AppLayout sidebar.
 */
export function LandingGuestFooter() {
  return (
    <>
      <div className="border-t border-white/[0.06] bg-[hsl(220_22%_4%/0.6)] px-5 py-12 sm:px-8">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">ARENA</span>
            </div>
            <p className="max-w-[260px] text-xs leading-relaxed text-muted-foreground/65">
              Compete. Earn. Rise. Skill-based wagering for competitive gamers.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:mt-0">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground/45">Client</h4>
            <nav className="flex flex-col gap-2">
              <Link
                to={{ pathname: "/", hash: "#download" }}
                className="flex items-center gap-2 text-sm font-medium text-arena-cyan/90 transition-colors hover:text-arena-cyan"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                Download client
              </Link>
              <a
                href={ARENA_CLIENT_SETUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground/75 transition-colors hover:text-foreground"
              >
                <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                Arena Client setup (.zip)
              </a>
            </nav>
          </div>
          <div className="flex flex-col gap-3 sm:mt-0">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground/45">Legal</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/legal/terms" className="text-sm text-muted-foreground/75 transition-colors hover:text-foreground">
                Terms of Service
              </Link>
              <Link to="/legal/privacy" className="text-sm text-muted-foreground/75 transition-colors hover:text-foreground">
                Privacy Policy
              </Link>
              <Link
                to="/legal/responsible-gaming"
                className="text-sm text-muted-foreground/75 transition-colors hover:text-foreground"
              >
                Responsible Gaming
              </Link>
            </nav>
          </div>
        </div>
      </div>

      <footer className="border-t border-border/50 px-5 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">ARENA</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-muted-foreground/55 sm:text-xs">
            <Link to={{ pathname: "/", hash: "#download" }} className="hover:text-muted-foreground transition-colors">
              Download
            </Link>
            <span aria-hidden>·</span>
            <a href={ARENA_CLIENT_SETUP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
              Client setup
            </a>
            <span aria-hidden>·</span>
            <Link to="/legal/terms" className="hover:text-muted-foreground transition-colors">
              Terms
            </Link>
            <span aria-hidden>·</span>
            <Link to="/legal/privacy" className="hover:text-muted-foreground transition-colors">
              Privacy
            </Link>
            <span aria-hidden>·</span>
            <Link to="/legal/responsible-gaming" className="hover:text-muted-foreground transition-colors">
              Responsible Gaming
            </Link>
          </div>
          <p className="text-center font-mono text-[10px] text-muted-foreground/35">
            © {new Date().getFullYear()} Arena · 18+
          </p>
        </div>
      </footer>
    </>
  );
}
