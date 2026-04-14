import { ArenaStarfield } from "@/components/visual/ArenaStarfield";

/**
 * Full-viewport decorative layer — no pointer events, no data fetching.
 * HUD reference: central radar / energy core + cyan field + soft grid (not “flat boxes behind UI”).
 */
export function ArenaAmbientBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {/* Core bloom — soft “orb” like reference center */}
      <div
        className="absolute left-1/2 top-[42%] h-[min(85vw,720px)] w-[min(85vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.14]"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, hsl(var(--arena-cyan) / 0.35), hsl(var(--arena-hud-blue) / 0.12) 38%, transparent 62%)",
          filter: "blur(48px)",
        }}
      />

      {/* Concentric HUD rings — dashed tech readout */}
      <svg
        className="absolute left-1/2 top-[42%] h-[min(95vw,820px)] w-[min(95vw,820px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.14]"
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden
      >
        <g style={{ transformOrigin: "200px 200px", animation: "arena-radar-spin 140s linear infinite" }}>
          <circle cx="200" cy="200" r="178" stroke="hsl(var(--arena-cyan))" strokeWidth="0.6" strokeDasharray="3 10" />
          <circle cx="200" cy="200" r="152" stroke="hsl(var(--arena-hud-blue))" strokeWidth="0.5" strokeDasharray="1 6" opacity="0.85" />
        </g>
        <g style={{ transformOrigin: "200px 200px", animation: "arena-radar-spin-reverse 200s linear infinite" }}>
          <circle cx="200" cy="200" r="124" stroke="hsl(var(--primary))" strokeWidth="0.45" strokeDasharray="6 14" opacity="0.55" />
          <circle cx="200" cy="200" r="96" stroke="hsl(var(--arena-hud-magenta))" strokeWidth="0.4" strokeDasharray="2 8" opacity="0.45" />
        </g>
        <circle cx="200" cy="200" r="58" stroke="hsl(var(--arena-cyan))" strokeWidth="0.35" opacity="0.35" />
      </svg>

      {/* Field vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -18%, hsl(var(--primary) / 0.1), transparent 55%), radial-gradient(ellipse 90% 55% at 100% 48%, hsl(var(--arena-hud-blue) / 0.07), transparent 50%), radial-gradient(ellipse 70% 48% at 0% 78%, hsl(var(--arena-hud-magenta) / 0.05), transparent 45%)",
        }}
      />

      {/* Fine grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--arena-cyan)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--arena-cyan)) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Drift orbs */}
      <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-arena-cyan/12 blur-[100px] animate-pulse" />
      <div
        className="absolute -right-24 bottom-1/4 h-80 w-80 rounded-full bg-primary/12 blur-[90px] opacity-80"
        style={{ animation: "arena-float 18s ease-in-out infinite" }}
      />

      <ArenaStarfield />
    </div>
  );
}
