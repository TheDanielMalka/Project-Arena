import type { ArenaPageVariant } from "./types";

/**
 * Per-page ambient decorations — pointer-events none, behind content.
 * Respects reduced motion via CSS (.arena-decor-animate) in index.css.
 */
export function ArenaPageDecor({ variant }: { variant: ArenaPageVariant }) {
  if (variant === "default") return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
      aria-hidden
      data-arena-decor={variant}
    >
      {variant === "dashboard" && <DashboardDecor />}
      {variant === "lobby" && <LobbyDecor />}
      {variant === "leaderboard" && <LeaderboardDecor />}
      {variant === "wallet" && <WalletDecor />}
      {variant === "profile" && <ProfileDecor />}
      {variant === "admin" && <AdminDecor />}
      {variant === "history" && <HistoryDecor />}
      {variant === "hub" && <HubDecor />}
      {variant === "forge" && <ForgeDecor />}
      {variant === "settings" && <SettingsDecor />}
      {variant === "arena-client" && <ArenaClientDecor />}
      {variant === "players" && <PlayersDecor />}
      {variant === "player-profile" && <PlayerProfileDecor />}
    </div>
  );
}

function DashboardDecor() {
  return (
    <>
      <div
        className="arena-decor-animate absolute -right-8 top-8 h-40 w-40 rounded-full border border-arena-cyan/20 opacity-50 motion-safe:animate-[spin_90s_linear_infinite]"
        style={{ boxShadow: "0 0 40px hsl(var(--arena-cyan) / 0.15)" }}
      />
      <div className="absolute left-[3%] top-[20%] h-px w-24 bg-gradient-to-r from-transparent via-arena-cyan/40 to-transparent" />
      <div className="absolute left-[3%] top-[22%] font-mono text-[8px] uppercase tracking-[0.35em] text-arena-cyan/35">
        CMD · SYNC
      </div>
    </>
  );
}

function LobbyDecor() {
  return (
    <>
      <div className="arena-hud-scan absolute inset-x-0 top-0 h-[120%] opacity-[0.06] motion-reduce:opacity-0" />
      <div className="absolute left-1/2 top-0 h-32 w-px -translate-x-1/2 bg-gradient-to-b from-arena-cyan/50 to-transparent" />
      <div className="absolute bottom-4 right-6 font-mono text-[9px] text-muted-foreground/25 uppercase tracking-widest">
        QUEUE · LIVE
      </div>
    </>
  );
}

function LeaderboardDecor() {
  return (
    <>
      <div className="absolute left-1/2 top-0 h-24 w-[1px] -translate-x-1/2 bg-gradient-to-b from-arena-gold/40 via-primary/20 to-transparent" />
      <div className="arena-decor-animate absolute right-[8%] top-16 flex flex-col gap-1 motion-safe:animate-pulse">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1 rounded-full bg-gradient-to-r from-arena-cyan/50 to-primary/40"
            style={{ width: `${48 + i * 18}px`, opacity: 0.35 - i * 0.08 }}
          />
        ))}
      </div>
      <div className="absolute bottom-2 left-4 text-[8px] font-mono uppercase tracking-[0.4em] text-arena-hud-magenta/25">
        RANK · MESH
      </div>
    </>
  );
}

function WalletDecor() {
  return (
    <>
      <svg className="absolute right-0 bottom-0 h-48 w-48 opacity-[0.07]" viewBox="0 0 100 100">
        <path
          d="M10 90 L30 70 L50 85 L70 55 L90 75"
          fill="none"
          stroke="hsl(var(--arena-cyan))"
          strokeWidth="0.4"
          className="arena-decor-animate motion-safe:animate-pulse"
        />
        <circle cx="30" cy="70" r="1.5" fill="hsl(var(--arena-hud-magenta) / 0.6)" />
        <circle cx="70" cy="55" r="1.5" fill="hsl(var(--arena-cyan) / 0.6)" />
      </svg>
      <div className="absolute left-4 top-4 text-[8px] font-mono text-arena-gold/30 uppercase tracking-[0.35em]">
        LEDGER
      </div>
    </>
  );
}

function ProfileDecor() {
  return (
    <>
      <div
        className="arena-id-shimmer absolute -inset-[1px] rounded-xl opacity-30 motion-reduce:opacity-0"
        style={{
          background:
            "linear-gradient(105deg, transparent 40%, hsl(var(--arena-cyan) / 0.12) 50%, transparent 60%)",
          backgroundSize: "200% 100%",
        }}
      />
      <div className="absolute top-3 right-3 h-8 w-8 border border-t-arena-cyan/30 border-r-arena-cyan/30 border-b-transparent border-l-transparent rounded-tr-md" />
      <div className="absolute bottom-3 left-3 h-8 w-8 border border-b-primary/25 border-l-primary/25 border-t-transparent border-r-transparent rounded-bl-md" />
    </>
  );
}

function AdminDecor() {
  return (
    <>
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            90deg,
            transparent,
            transparent 12px,
            hsl(var(--destructive) / 0.15) 12px,
            hsl(var(--destructive) / 0.15) 13px
          )`,
        }}
      />
      <div className="absolute left-2 top-2 font-mono text-[8px] text-muted-foreground/35 uppercase tracking-[0.5em]">
        SYS · ROOT
      </div>
    </>
  );
}

function HistoryDecor() {
  return (
    <>
      <div className="absolute right-[5%] top-1/4 h-40 w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent" />
      <div className="arena-decor-animate absolute left-[6%] bottom-8 flex gap-1 motion-safe:animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 w-0.5 rounded-full bg-arena-cyan/20" style={{ opacity: 0.2 + (i % 3) * 0.15 }} />
        ))}
      </div>
    </>
  );
}

function HubDecor() {
  return (
    <>
      <div className="absolute inset-x-[10%] top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
      <div className="absolute right-4 top-12 h-16 w-16 rounded-full border border-arena-hud-magenta/10 opacity-40" />
    </>
  );
}

function ForgeDecor() {
  return (
    <>
      <div className="absolute -left-20 top-1/3 h-56 w-56 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute right-[12%] top-8 text-[9px] font-display font-bold uppercase tracking-[0.5em] text-arena-gold/20">
        FORGE
      </div>
    </>
  );
}

function SettingsDecor() {
  return (
    <>
      <div className="absolute right-0 top-0 h-32 w-32 bg-gradient-to-bl from-arena-cyan/8 to-transparent" />
      <div className="absolute left-0 bottom-0 h-24 w-24 bg-gradient-to-tr from-muted/20 to-transparent rounded-tr-full" />
    </>
  );
}

function ArenaClientDecor() {
  return (
    <>
      <div className="arena-decor-animate absolute right-[15%] top-24 h-20 w-20 rounded-full border border-arena-cyan/15 motion-safe:animate-pulse" />
      <div className="absolute left-8 bottom-12 font-mono text-[8px] text-arena-cyan/25 uppercase tracking-[0.45em]">
        CLIENT · BIND
      </div>
    </>
  );
}

function PlayersDecor() {
  return (
    <>
      <div className="absolute left-1/2 top-12 h-20 w-[min(90%,420px)] -translate-x-1/2 rounded-full bg-primary/5 blur-2xl" />
      <div className="absolute top-2 right-8 text-[8px] font-mono text-muted-foreground/25 uppercase">DIR</div>
    </>
  );
}

function PlayerProfileDecor() {
  return (
    <>
      <div className="absolute right-6 top-20 w-px h-32 bg-gradient-to-b from-arena-gold/30 to-transparent" />
      <div className="absolute left-6 bottom-16 text-[8px] font-mono text-primary/20 uppercase tracking-widest">
        PUBLIC
      </div>
    </>
  );
}
