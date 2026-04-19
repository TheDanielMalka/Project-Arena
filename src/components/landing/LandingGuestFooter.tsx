import { Link } from "react-router-dom";
import { Download, Facebook, Instagram, Monitor, Swords, Youtube } from "lucide-react";

/** Matches landing download CTA (Index). */
const ARENA_CLIENT_SETUP_URL =
  "https://arena-client-dist.s3.us-east-1.amazonaws.com/setup.zip" as const;

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  { label: "Instagram", href: "https://www.instagram.com/projectarenaltd/", Icon: Instagram },
  { label: "Facebook", href: "https://www.facebook.com/profile.php?id=61572141136349", Icon: Facebook },
  { label: "YouTube", href: "https://www.youtube.com/channel/UCZ-cdlzcJ0om-7zI3v9kQmQ", Icon: Youtube },
  { label: "X", href: "https://x.com/ProjectArenaLTD", Icon: XIcon },
  { label: "TikTok", href: "https://www.tiktok.com/@projectarenaltd", Icon: TikTokIcon },
  { label: "Discord", href: "https://discord.com/channels/1495475034951647312/1495475035513819400", Icon: DiscordIcon },
] as const;

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
            <nav aria-label="Social media" className="mt-1 flex items-center gap-2">
              {SOCIAL_LINKS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Arena on ${label}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-muted-foreground/70 transition-colors hover:border-primary/40 hover:bg-white/[0.04] hover:text-primary"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </nav>
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
